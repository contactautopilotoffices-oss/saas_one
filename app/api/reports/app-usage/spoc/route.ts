import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess,
    isCommandCenterAccessError,
    isMissingRelation,
    readOrgId,
} from '@/backend/lib/commandCenter/access';
import { APP_USAGE_MODULE_KEYS } from '@/backend/lib/reports/appUsageModules';

/**
 * POST /api/reports/app-usage/spoc
 * Body: { orgId, propertyId, moduleKey, userId | null }
 *
 * Assigns (or clears, with userId null) the SPOC for one property + module in the
 * App Usage report. Org super admins (and master admins) only. The SPOC must be an
 * active member of that property's own team (not a tenant or vendor).
 */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as
        { orgId?: string; propertyId?: string; moduleKey?: string; userId?: string | null } | null;
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

    const access = await resolveCommandCenterAccess(request, readOrgId(request, body) || (typeof body.orgId === 'string' ? body.orgId : null));
    if (isCommandCenterAccessError(access)) return access;
    // isSuperAdmin = master admin, or org_super_admin of the resolved org.
    if (!access.isSuperAdmin) {
        return NextResponse.json({ error: 'Only org super admins can assign SPOCs' }, { status: 403 });
    }

    const { propertyId, moduleKey } = body;
    // userId must be sent explicitly: null clears the SPOC, a uuid sets it. A missing
    // or malformed value is rejected so a bad request can never clear a SPOC by accident.
    if (!('userId' in body) || (body.userId !== null && (typeof body.userId !== 'string' || !UUID_RE.test(body.userId)))) {
        return NextResponse.json({ error: 'userId must be a person id, or null to clear the SPOC' }, { status: 400 });
    }
    const userId = body.userId;
    if (!propertyId || !access.propertyIds.includes(propertyId)) {
        return NextResponse.json({ error: 'Unknown property' }, { status: 400 });
    }
    if (!moduleKey || !APP_USAGE_MODULE_KEYS.includes(moduleKey)) {
        return NextResponse.json({ error: 'Unknown module' }, { status: 400 });
    }

    if (!userId) {
        const { error } = await supabaseAdmin
            .from('module_spocs')
            .delete()
            .eq('organization_id', access.organizationId)
            .eq('property_id', propertyId)
            .eq('module_key', moduleKey);
        if (error) return storageError(error);
        return NextResponse.json({ ok: true, spoc: null });
    }

    const { data: membership, error: memberError } = await supabaseAdmin
        .from('property_memberships')
        .select('role')
        .eq('organization_id', access.organizationId)
        .eq('property_id', propertyId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
    if (memberError) {
        console.error('[app-usage spoc] membership check:', memberError.message);
        return NextResponse.json({ error: 'Could not check that person' }, { status: 500 });
    }
    const role = String(membership?.role || '').toLowerCase();
    if (!membership || role.includes('tenant') || role.includes('vendor')) {
        return NextResponse.json({ error: 'The SPOC must be on this property\'s team' }, { status: 400 });
    }

    const values = {
        organization_id: access.organizationId,
        property_id: propertyId,
        module_key: moduleKey,
        user_id: userId,
        assigned_by: access.user.id,
        updated_at: new Date().toISOString(),
    };
    let { error } = await supabaseAdmin
        .from('module_spocs')
        .upsert(values, { onConflict: 'property_id,module_key' });
    // 42P10: the live table lacks the (property_id, module_key) unique constraint the
    // upsert needs. Fall back to update-else-insert so the SPOC still saves.
    if (error?.code === '42P10') {
        console.warn('[app-usage spoc] module_spocs has no (property_id, module_key) unique constraint; re-apply 20261016000002_module_spocs.sql');
        const { data: existing, error: findError } = await supabaseAdmin
            .from('module_spocs')
            .select('id')
            .eq('organization_id', access.organizationId)
            .eq('property_id', propertyId)
            .eq('module_key', moduleKey)
            .limit(1)
            .maybeSingle();
        if (findError) return storageError(findError);
        ({ error } = existing
            ? await supabaseAdmin.from('module_spocs').update(values)
                .eq('organization_id', access.organizationId).eq('id', existing.id)
            : await supabaseAdmin.from('module_spocs').insert(values));
    }
    if (error) return storageError(error);

    const { data: user } = await supabaseAdmin.from('users').select('full_name, email').eq('id', userId).maybeSingle();
    return NextResponse.json({ ok: true, spoc: { userId, name: user?.full_name || user?.email || 'Unknown user', active: true } });
}

function storageError(error: { code?: string; message?: string; details?: string }) {
    if (isMissingRelation(error)) {
        return NextResponse.json(
            { error: 'SPOCs are not set up yet. Apply migration 20261016000002_module_spocs.sql first.' },
            { status: 503 });
    }
    console.error('[app-usage spoc] save:', error.code, error.message, error.details);
    if (error.code === '23503') {
        return NextResponse.json({ error: 'Could not save the SPOC: that person or your account is missing from the users table' }, { status: 500 });
    }
    if (error.code === '42501') {
        return NextResponse.json({ error: 'Could not save the SPOC: the database does not allow writes to module_spocs' }, { status: 500 });
    }
    // Show the database error code so the cause can be traced from a screenshot.
    return NextResponse.json({ error: `Could not save the SPOC${error.code ? ` (database error ${error.code})` : ''}` }, { status: 500 });
}
