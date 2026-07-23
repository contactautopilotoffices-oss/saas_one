import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

// GET /api/crm/statuses — returns all status definitions for this org
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    // scope=org restricts to this org's own lifecycle stages (used by the lead
    // pipeline so it shows only the org's stages, not the shared global defaults).
    const scope = new URL(request.url).searchParams.get('scope');

    let query = supabaseAdmin
        .from('crm_lead_statuses')
        .select('id, name, color, sort_order, is_won, is_lost, is_terminal, is_default')
        .eq('is_active', true)
        .order('sort_order');

    query = scope === 'org'
        ? query.eq('organization_id', access.organizationId)
        : query.or(`organization_id.eq.${access.organizationId},organization_id.is.null`);

    const { data, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ statuses: data });
}