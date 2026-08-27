import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';

/**
 * GET /api/aop/warnings?org_id=&include_acknowledged=
 *
 * Everything the importer could not resolve on its own — stale column headers, sites whose
 * figures contradict between sheets. These are surfaced rather than swallowed because the
 * failure mode they guard against is silent: May's numbers filed as June look completely
 * normal on screen.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const includeAcked = sp.get('include_acknowledged') === 'true';

    let query = supabaseAdmin
        .from('aop_import_warnings')
        .select('id, severity, sheet_name, site_label, message, imported_at, is_acknowledged')
        .eq('organization_id', access.organizationId)
        .order('imported_at', { ascending: false })
        .range(0, 499);

    if (!includeAcked) query = query.eq('is_acknowledged', false);

    const { data, error } = await query;

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, warnings: [], open_count: 0 });
        }
        console.error('[aop warnings]', error.message);
        return NextResponse.json({ error: 'Could not load import warnings' }, { status: 500 });
    }

    const warnings = data || [];
    return NextResponse.json({
        provisioned: true,
        warnings,
        open_count: warnings.filter(w => !w.is_acknowledged).length,
    });
}
