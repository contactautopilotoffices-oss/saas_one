import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';

// Statuses/sources visible to an org = its own rows + the shared global (NULL) defaults.
function orgOrGlobal(query: any, organizationId: string) {
    return query.or(`organization_id.eq.${organizationId},organization_id.is.null`);
}

async function orgMemberIds(organizationId: string): Promise<string[]> {
    const [p, o] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', organizationId).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', organizationId).eq('is_active', true),
    ]);
    return [...new Set([...(p.data || []), ...(o.data || [])].map((m: any) => m.user_id))];
}

async function bdMemberIds(organizationId: string): Promise<string[]> {
    const { data } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        // NOTE: role is the app_role Postgres enum; 'bd_super_admin' is NOT an
        // enum value (the 3 super admins are bd_admin on the backend), so it must
        // not appear here or the query throws 'invalid input value for enum'.
        .in('role', ['bd_rep', 'bd_admin']);
    return (data || []).map((m: any) => m.user_id);
}

// GET /api/crm/settings?type=statuses|sources|properties|meta|all
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    const org = access.organizationId;
    const type = new URL(request.url).searchParams.get('type');

    if (type === 'statuses') {
        const { data: statuses } = await orgOrGlobal(
            supabaseAdmin.from('crm_lead_statuses').select('*').eq('is_active', true), org
        ).order('sort_order');
        return NextResponse.json({ statuses });
    }
    if (type === 'sources') {
        const { data: sources } = await orgOrGlobal(
            supabaseAdmin.from('crm_lead_sources').select('*').eq('is_active', true), org
        ).order('name');
        return NextResponse.json({ sources });
    }
    if (type === 'properties') {
        const { data: properties } = await supabaseAdmin
            .from('properties').select('id, name, code').eq('organization_id', org).order('name');
        return NextResponse.json({ properties });
    }
    if (type === 'meta') {
        if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { data } = await supabaseAdmin.from('crm_meta_config').select('*').eq('organization_id', org).maybeSingle();
        // Never leak secrets back to the browser — only whether they're set.
        const safe = data
            ? {
                  ...data,
                  app_secret: data.app_secret ? '••••••••' : null,
                  page_access_token: data.page_access_token ? '••••••••' : null,
                  meta_user_access_token: data.meta_user_access_token ? '••••••••' : null,
              }
            : null;
        return NextResponse.json({ meta: safe });
    }
    if (type === 'linkedin') {
        const isLinkedInAdmin = isBdSuperAdmin(access.user.email) || access.roles?.includes('bd_super_admin') || access.isMasterAdmin;
        if (!isLinkedInAdmin) {
            return NextResponse.json({ error: 'Forbidden — BD super admin only' }, { status: 403 });
        }
        const { data } = await supabaseAdmin.from('crm_linkedin_config').select('*').eq('organization_id', org).maybeSingle();
        const now = Date.now();
        const safe = data
            ? {
                  ...data,
                  client_secret: data.client_secret ? '••••••••' : null,
                  access_token: undefined,
                  refresh_token: undefined,
                  oauth_state: undefined,
                  // Surface connection health without leaking tokens.
                  connected: !!data.access_token && !!data.is_active,
                  token_expired: data.token_expires_at ? new Date(data.token_expires_at).getTime() <= now : null,
              }
            : null;
        return NextResponse.json({ linkedin: safe });
    }

    // type === 'all' (or unspecified): bundle everything the settings UI needs.
    const [statusesRes, sourcesRes, propsRes] = await Promise.all([
        orgOrGlobal(supabaseAdmin.from('crm_lead_statuses').select('*').eq('is_active', true), org).order('sort_order'),
        orgOrGlobal(supabaseAdmin.from('crm_lead_sources').select('*').eq('is_active', true), org).order('name'),
        supabaseAdmin.from('properties').select('id, name, code').eq('organization_id', org).order('name'),
    ]);
    const scope = new URL(request.url).searchParams.get('scope');
    const BD_CITIES = ['mumbai', 'bangalore', 'noida', 'andheri', 'lower parel', 'kalyan'];
    const filteredProps = scope === 'bd'
        ? (propsRes.data || []).filter((p: any) => BD_CITIES.some(c => p.name?.toLowerCase().includes(c)))
        : propsRes.data || [];
    const memberIds = scope === 'bd' ? await bdMemberIds(org) : await orgMemberIds(org);
    const { data: users } = memberIds.length
        ? await supabaseAdmin.from('users').select('id, full_name, email').in('id', memberIds).order('full_name')
        : { data: [] as any[] };

    return NextResponse.json({
        statuses: statusesRes.data || [],
        sources: sourcesRes.data || [],
        properties: filteredProps,
        users: users || [],
    });
}

// POST /api/crm/settings  (admin only)
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const org = access.organizationId;
    const { action, data: d } = body;

    switch (action) {
        case 'create_status': {
            // Reactivate a previously soft-deleted same-name status instead of colliding.
            const { data: existing } = await supabaseAdmin
                .from('crm_lead_statuses').select('id').eq('organization_id', org).ilike('name', d.name).maybeSingle();
            const payload = {
                name: d.name, color: d.color || '#6B7280', sort_order: d.sort_order || 0,
                is_won: !!d.is_won, is_lost: !!d.is_lost, is_terminal: !!d.is_terminal, is_default: !!d.is_default,
                is_active: true,
            };
            const res = existing
                ? await supabaseAdmin.from('crm_lead_statuses').update(payload).eq('id', existing.id).select().single()
                : await supabaseAdmin.from('crm_lead_statuses').insert({ ...payload, organization_id: org }).select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            if (payload.is_default) {
                // Only one default per org.
                await supabaseAdmin.from('crm_lead_statuses').update({ is_default: false })
                    .eq('organization_id', org).neq('id', res.data.id);
            }
            return NextResponse.json({ status: res.data }, { status: 201 });
        }
        case 'update_status': {
            // Cannot edit the shared global defaults — clone-on-write semantics are out of scope;
            // only org-owned statuses are mutable here.
            const { data: row } = await supabaseAdmin.from('crm_lead_statuses').select('organization_id').eq('id', d.id).maybeSingle();
            if (!row) return NextResponse.json({ error: 'Status not found' }, { status: 404 });
            if (row.organization_id !== org) return NextResponse.json({ error: 'Cannot edit shared default statuses' }, { status: 403 });
            const upd: Record<string, any> = { updated_at: new Date().toISOString() };
            for (const f of ['name', 'color', 'sort_order', 'is_won', 'is_lost', 'is_terminal', 'is_default']) {
                if (d[f] !== undefined) upd[f] = d[f];
            }
            const res = await supabaseAdmin.from('crm_lead_statuses').update(upd).eq('id', d.id).select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            if (upd.is_default) {
                await supabaseAdmin.from('crm_lead_statuses').update({ is_default: false }).eq('organization_id', org).neq('id', d.id);
            }
            return NextResponse.json({ status: res.data });
        }
        case 'delete_status': {
            const { data: row } = await supabaseAdmin.from('crm_lead_statuses').select('organization_id').eq('id', d.id).maybeSingle();
            if (!row) return NextResponse.json({ error: 'Status not found' }, { status: 404 });
            if (row.organization_id !== org) return NextResponse.json({ error: 'Cannot delete shared default statuses' }, { status: 403 });
            const { count } = await supabaseAdmin.from('crm_leads').select('id', { count: 'exact', head: true }).eq('status', d.id);
            if ((count || 0) > 0) {
                return NextResponse.json({ error: `Cannot delete: ${count} lead(s) still use this status` }, { status: 409 });
            }
            const { error } = await supabaseAdmin.from('crm_lead_statuses').update({ is_active: false }).eq('id', d.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        }
        case 'create_source': {
            const { data: existing } = await supabaseAdmin
                .from('crm_lead_sources').select('id').eq('organization_id', org).ilike('name', d.name).maybeSingle();
            const res = existing
                ? await supabaseAdmin.from('crm_lead_sources').update({ is_active: true }).eq('id', existing.id).select().single()
                : await supabaseAdmin.from('crm_lead_sources').insert({ name: d.name, organization_id: org }).select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            return NextResponse.json({ source: res.data }, { status: 201 });
        }
        case 'delete_source': {
            const { data: row } = await supabaseAdmin.from('crm_lead_sources').select('organization_id').eq('id', d.id).maybeSingle();
            if (!row) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
            if (row.organization_id !== org) return NextResponse.json({ error: 'Cannot delete shared default sources' }, { status: 403 });
            const { error } = await supabaseAdmin.from('crm_lead_sources').update({ is_active: false }).eq('id', d.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        }
        case 'update_property_mapping': {
            const res = await supabaseAdmin
                .from('crm_property_mapping')
                .upsert({ property_id: d.property_id, crm_property_name: d.crm_property_name }, { onConflict: 'property_id' })
                .select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            return NextResponse.json({ mapping: res.data });
        }
        case 'save_meta_config': {
            // Only overwrite secrets when a real (non-masked) value is supplied.
            const upd: Record<string, any> = {
                organization_id: org,
                verify_token: d.verify_token ?? null,
                page_id: d.page_id ?? null,
                default_assignee: d.default_assignee ?? null,
                default_property: d.default_property ?? null,
                default_lead_source: d.default_lead_source ?? null,
                is_active: d.is_active ?? true,
                updated_at: new Date().toISOString(),
            };
            if (d.app_secret && d.app_secret !== '••••••••') upd.app_secret = d.app_secret;
            if (d.page_access_token && d.page_access_token !== '••••••••') upd.page_access_token = d.page_access_token;
            // Marketing API access (drives the hourly insights sync).
            if (d.meta_ad_account_id !== undefined) upd.meta_ad_account_id = d.meta_ad_account_id || null;
            if (d.meta_app_id !== undefined) upd.meta_app_id = d.meta_app_id || null;
            if (d.meta_user_access_token && d.meta_user_access_token !== '••••••••') {
                upd.meta_user_access_token = d.meta_user_access_token;
            }
            const res = await supabaseAdmin
                .from('crm_meta_config').upsert(upd, { onConflict: 'organization_id' }).select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        }
        case 'save_linkedin_config': {
            const isLinkedInAdmin = isBdSuperAdmin(access.user.email) || access.roles?.includes('bd_super_admin') || access.isMasterAdmin;
            if (!isLinkedInAdmin) {
                return NextResponse.json({ error: 'Forbidden — BD super admin only' }, { status: 403 });
            }
            const upd: Record<string, any> = {
                organization_id: org,
                client_id: d.client_id ?? null,
                ad_account_urn: d.ad_account_urn || null,
                organization_urn: d.organization_urn || null,
                default_assignee: d.default_assignee ?? null,
                default_property: d.default_property ?? null,
                default_lead_source: d.default_lead_source ?? null,
                updated_at: new Date().toISOString(),
            };
            // Only overwrite the secret when a real (non-masked) value is supplied.
            if (d.client_secret && d.client_secret !== '••••••••') upd.client_secret = d.client_secret;
            // is_active is driven by the OAuth callback, not the form — but allow
            // an explicit disable.
            if (d.is_active === false) upd.is_active = false;
            const res = await supabaseAdmin
                .from('crm_linkedin_config').upsert(upd, { onConflict: 'organization_id' }).select().single();
            if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        }
        default:
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
}
