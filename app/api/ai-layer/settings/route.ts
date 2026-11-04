import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getOrganizationUsers } from '@/backend/lib/whatsapp/interpreter/organization-users.mjs';
import { CATALOG, PLATFORM_LIMITS, WHATSAPP_CHANNEL_READY, settingsSchema } from '@/backend/lib/aiLayer';
import { loadSettings } from '@/backend/lib/aiLayer/server';
import { requireOrgSuperAdmin } from '../_lib/auth';

export const runtime = 'nodejs';

const ROLE = /^[a-z][a-z0-9_]{1,63}$/;

async function orgDirectory(organizationId: string) {
    const [props, orgRoles, propRoles, users] = await Promise.all([
        supabaseAdmin.from('properties').select('id, name, is_active, deleted_at').eq('organization_id', organizationId).order('name'),
        supabaseAdmin.from('organization_memberships').select('role').eq('organization_id', organizationId).eq('is_active', true).limit(5000),
        supabaseAdmin.from('property_memberships').select('role, properties!inner(organization_id)').eq('properties.organization_id', organizationId).eq('is_active', true).limit(10000),
        getOrganizationUsers(supabaseAdmin, organizationId) as Promise<Array<{ id: string; name: string; email: string }>>,
    ]);
    for (const r of [props, orgRoles, propRoles]) if (r.error) throw new Error(r.error.message);
    const properties = ((props.data || []) as Array<{ id: string; name: string; is_active: boolean | null; deleted_at: string | null }>)
        .filter(p => p.is_active !== false && !p.deleted_at).map(p => ({ id: p.id, name: p.name }));
    const roles = [...new Set([...(orgRoles.data || []), ...(propRoles.data || [])].map(r => String((r as { role: string | null }).role || '')).filter(Boolean))].sort();
    return { properties, roles, users: users.map(u => ({ id: u.id, name: u.name, email: u.email })) };
}

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    const auth = await requireOrgSuperAdmin(organizationId);
    if (auth.error) return auth.error;
    try {
        const [{ settings, tableMissing }, directory] = await Promise.all([loadSettings(supabaseAdmin, organizationId), orgDirectory(organizationId)]);
        return NextResponse.json({
            config: settings, tableMissing, whatsappReady: WHATSAPP_CHANNEL_READY, platformLimits: PLATFORM_LIMITS,
            entries: CATALOG.map(e => ({ id: e.id, kind: e.kind, module: e.module, defaultMode: e.defaultMode, label: e.abilities.en })),
            ...directory,
        }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
        console.error('[AiLayer] settings load failed', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Couldn't load AI settings" }, { status: 500 });
    }
}

const putBody = z.object({ organizationId: z.string().uuid(), config: settingsSchema }).strict();

export async function PUT(request: NextRequest) {
    const raw = await request.json().catch(() => null) as { organizationId?: unknown } | null;
    // Authorize first, so callers who aren't the org super admin learn nothing about the settings shape.
    const auth = await requireOrgSuperAdmin(typeof raw?.organizationId === 'string' ? raw.organizationId : '');
    if (auth.error) return auth.error;
    const parsed = putBody.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid settings', details: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
    const { organizationId, config } = parsed.data;

    try {
        const directory = await orgDirectory(organizationId);
        const userIds = new Set(directory.users.map(u => u.id));
        const propertyIds = new Set(directory.properties.map(p => p.id));
        const badUser = [...config.access.userIds, ...config.blockedUserIds].find(id => !userIds.has(id));
        if (badUser) return NextResponse.json({ error: 'Every selected or blocked person must belong to this organization' }, { status: 400 });
        if (config.propertyIds?.some(id => !propertyIds.has(id))) return NextResponse.json({ error: 'Every selected property must belong to this organization' }, { status: 400 });
        const badRole = [...config.access.roles, ...Object.keys(config.grid)].find(r => !ROLE.test(r));
        if (badRole) return NextResponse.json({ error: `Unknown role: ${badRole}` }, { status: 400 });
        const knownEntries = new Set(CATALOG.map(e => e.id));
        if (Object.keys(config.entryModes).some(id => !knownEntries.has(id))) return NextResponse.json({ error: 'Unknown catalog entry in entryModes' }, { status: 400 });

        const before = await loadSettings(supabaseAdmin, organizationId);
        if (before.tableMissing) return NextResponse.json({ error: 'The AI settings table is not set up yet. The migration 20261104000002_ai_action_layer.sql must be run first.' }, { status: 503 });

        // History first: a change that can't be recorded is not saved ("who turned this on?" must always have an answer).
        const history = await supabaseAdmin.from('ai_access_settings_history').insert({ organization_id: organizationId, changed_by: auth.user.id, before: before.settings, after: config });
        if (history.error) throw new Error(history.error.message);
        const { error } = await supabaseAdmin.from('ai_access_settings').upsert({ organization_id: organizationId, config, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' });
        if (error) throw new Error(error.message);
        return NextResponse.json({ config });
    } catch (err) {
        console.error('[AiLayer] settings save failed', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Couldn't save AI settings" }, { status: 500 });
    }
}
