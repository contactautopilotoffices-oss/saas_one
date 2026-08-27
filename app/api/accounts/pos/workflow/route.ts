import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

/**
 * GET /api/accounts/pos/workflow — every po_workflow_state row for the caller's org.
 *
 * Exists so the Payment Tracker reads critical flags under the SAME access model as the
 * rest of the page. Reading po_workflow_state straight from the browser put criticality
 * behind RLS while every other read on that screen goes through this service-role layer,
 * and the two do not agree: resolveAccountsAccess grants a master_admin access without
 * any membership row (access.ts:91) and sources roles from property_memberships too
 * (access.ts:82,85). Those users got an empty flag map and no error.
 */

const PAGE = 1000;
const MAX_ROWS = 100000;

export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    // PostgREST clamps at 1000 rows and this org holds 5k+ POs — page until a short one
    // comes back or a flag on row 1001+ would silently never render.
    const rows: any[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await supabaseAdmin
            .from('po_workflow_state')
            .select('*')
            .eq('organization_id', access.organizationId)
            .order('po_id', { ascending: true })
            .range(from, from + PAGE - 1);
        // 42P01 = the migration has not been applied yet. That is "no flags", not a failure.
        if (error) {
            if (error.code === '42P01') return NextResponse.json({ workflow: [], migrated: false });
            console.error('PO workflow list error:', error);
            return NextResponse.json({ error: 'Failed to read PO workflow state' }, { status: 500 });
        }
        rows.push(...(data || []));
        if ((data || []).length < PAGE) break;
    }

    return NextResponse.json({ workflow: rows, migrated: true });
}
