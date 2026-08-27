import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';

/**
 * GET /api/council/findings?status=open — org findings, newest first.
 * `status` is optional; omit it for every finding regardless of state.
 */
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['open', 'acked', 'resolved', 'dismissed']);

export async function GET(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const orgId = await resolveCouncilOrgId(access, request);
    const status = new URL(request.url).searchParams.get('status');
    if (status && !VALID_STATUSES.has(status)) {
        return NextResponse.json({ error: `Invalid status '${status}'` }, { status: 400 });
    }

    let query = access.adminClient
        .from('council_findings')
        .select('id, session_id, agent_key, severity, title, detail, evidence, recommendation, status, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
        console.error('[council/findings]', error.message);
        return NextResponse.json({ error: 'Could not load findings', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ org_id: orgId, findings: data || [] });
}
