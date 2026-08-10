import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';

/**
 * PATCH /api/council/findings/[id] {status} — ack / resolve / dismiss a
 * finding (re-open with 'open').
 */
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['open', 'acked', 'resolved', 'dismissed']);

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const { id } = await params;

    let body: { status?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    }
    if (!body.status || !VALID_STATUSES.has(body.status)) {
        return NextResponse.json({
            error: `status must be one of ${[...VALID_STATUSES].join(', ')}`,
        }, { status: 400 });
    }

    const { data, error } = await access.adminClient
        .from('council_findings')
        .update({ status: body.status })
        .eq('id', id)
        .select('id, session_id, agent_key, severity, title, status, created_at')
        .maybeSingle();

    if (error) {
        console.error('[council/findings/id] patch', error.message);
        return NextResponse.json({ error: 'Could not update finding', details: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Finding not found' }, { status: 404 });

    return NextResponse.json({ finding: data });
}
