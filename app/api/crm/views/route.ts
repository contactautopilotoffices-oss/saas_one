import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

const VIEW_COLUMNS = 'id, organization_id, created_by, name, icon, color, filters, sort_order, is_default, is_active, created_at, updated_at';

// GET /api/crm/views — the current user's saved views for this org, in tab order.
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('crm_saved_views')
        .select(VIEW_COLUMNS)
        .eq('organization_id', access.organizationId)
        .eq('created_by', access.user.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ views: data ?? [] });
}

// POST /api/crm/views — action-dispatched writes. Views are personal, so every
// mutation is scoped to (organization_id, created_by = me).
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;

    const org = access.organizationId;
    const uid = access.user.id;
    const { action, data: d } = body;

    // Load + ownership-guard a view the caller wants to mutate.
    const loadOwned = async (id: string) => {
        const { data: row } = await supabaseAdmin
            .from('crm_saved_views')
            .select('id, created_by, organization_id')
            .eq('id', id)
            .maybeSingle();
        if (!row || row.organization_id !== org || row.created_by !== uid) return null;
        return row;
    };

    // Clear the default flag on the user's other views (one default per user/org).
    const clearOtherDefaults = async (exceptId?: string) => {
        let q = supabaseAdmin
            .from('crm_saved_views')
            .update({ is_default: false, updated_at: new Date().toISOString() })
            .eq('organization_id', org)
            .eq('created_by', uid)
            .eq('is_default', true);
        if (exceptId) q = q.neq('id', exceptId);
        await q;
    };

    switch (action) {
        case 'create_view': {
            if (!d?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

            // Append to the end of the user's tab order.
            const { data: last } = await supabaseAdmin
                .from('crm_saved_views')
                .select('sort_order')
                .eq('organization_id', org)
                .eq('created_by', uid)
                .eq('is_active', true)
                .order('sort_order', { ascending: false })
                .limit(1)
                .maybeSingle();
            const nextOrder = (last?.sort_order ?? -1) + 1;

            if (d.is_default) await clearOtherDefaults();

            const { data: created, error } = await supabaseAdmin
                .from('crm_saved_views')
                .insert({
                    organization_id: org,
                    created_by: uid,
                    name: String(d.name).trim().slice(0, 120),
                    icon: d.icon ?? null,
                    color: d.color ?? null,
                    filters: d.filters ?? {},
                    sort_order: nextOrder,
                    is_default: !!d.is_default,
                })
                .select(VIEW_COLUMNS)
                .single();

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ view: created }, { status: 201 });
        }

        case 'update_view': {
            if (!d?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
            if (!(await loadOwned(d.id))) return NextResponse.json({ error: 'View not found' }, { status: 404 });

            if (d.is_default) await clearOtherDefaults(d.id);

            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (d.name !== undefined) patch.name = String(d.name).trim().slice(0, 120);
            if (d.icon !== undefined) patch.icon = d.icon;
            if (d.color !== undefined) patch.color = d.color;
            if (d.filters !== undefined) patch.filters = d.filters;
            if (d.is_default !== undefined) patch.is_default = !!d.is_default;

            const { data: updated, error } = await supabaseAdmin
                .from('crm_saved_views')
                .update(patch)
                .eq('id', d.id)
                .select(VIEW_COLUMNS)
                .single();

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ view: updated });
        }

        case 'delete_view': {
            if (!d?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
            if (!(await loadOwned(d.id))) return NextResponse.json({ error: 'View not found' }, { status: 404 });

            // Soft delete — views are never hard-removed.
            const { error } = await supabaseAdmin
                .from('crm_saved_views')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', d.id);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ ok: true });
        }

        case 'reorder': {
            const order: string[] = Array.isArray(d?.order) ? d.order : [];
            if (!order.length) return NextResponse.json({ error: 'order[] is required' }, { status: 400 });

            // Persist the new tab order. Only the caller's own views are touched.
            await Promise.all(order.map((id, idx) =>
                supabaseAdmin
                    .from('crm_saved_views')
                    .update({ sort_order: idx, updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .eq('organization_id', org)
                    .eq('created_by', uid)
            ));
            return NextResponse.json({ ok: true });
        }

        case 'set_default': {
            if (!d?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
            if (!(await loadOwned(d.id))) return NextResponse.json({ error: 'View not found' }, { status: 404 });

            await clearOtherDefaults(d.id);
            const { error } = await supabaseAdmin
                .from('crm_saved_views')
                .update({ is_default: true, updated_at: new Date().toISOString() })
                .eq('id', d.id);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ ok: true });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}
