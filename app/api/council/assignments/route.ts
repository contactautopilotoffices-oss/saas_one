import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';
import { dispatchSessionFindings, currentWorkload } from '@/backend/lib/council/dispatch';

/**
 * The council work queue — who owns which finding, and who is drowning.
 *
 *   GET  /api/council/assignments?status=open&session=<id>
 *        → { assignments, workload, counts }
 *   POST /api/council/assignments {session_id}
 *        → dispatch (or re-dispatch) that session's open findings. Idempotent.
 *
 * Per-assignment status changes live in ./[id]/route.ts.
 * Master-admin only; the council is still the master-admin playground (REQ-09).
 */

export const dynamic = 'force-dynamic';

const MIGRATION_HINT =
    'If this mentions a missing relation, apply supabase/migrations/20260803000002_council_dispatch.sql';

const VALID_STATUS = new Set(['open', 'acked', 'done', 'dismissed']);

export async function GET(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const orgId = await resolveCouncilOrgId(access, request, {});
    const sp = new URL(request.url).searchParams;
    const status = sp.get('status');
    const sessionId = sp.get('session');

    if (status && status !== 'all' && !VALID_STATUS.has(status)) {
        return NextResponse.json({ error: `status must be one of ${[...VALID_STATUS].join(', ')} or all` }, { status: 400 });
    }

    // The finding is embedded so the queue is readable on its own — an assignment row
    // without its finding's title is an id pointing at another id (FP-03).
    let query = access.adminClient
        .from('council_assignments')
        .select(`
            id, org_id, session_id, finding_id, agent_key, severity, domain,
            assignee_user_id, assigned_role, routed_by, routing_note,
            sla_hours, due_at, status, outcome_note, dismissed_reason,
            acked_at, closed_at, notified_at, notify_skipped, created_at,
            finding:council_findings ( title, detail, evidence, recommendation ),
            assignee:users!council_assignments_assignee_user_id_fkey ( full_name, email )
        `)
        .eq('org_id', orgId)
        .order('severity', { ascending: true })
        .order('due_at', { ascending: true })
        .limit(500);

    if (status && status !== 'all') query = query.eq('status', status);
    if (sessionId) query = query.eq('session_id', sessionId);

    const { data, error } = await query;
    if (error) {
        console.error('[council/assignments] list:', error.message);
        return NextResponse.json({ error: 'Could not load assignments', details: error.message, hint: MIGRATION_HINT }, { status: 500 });
    }

    let workload: Awaited<ReturnType<typeof currentWorkload>> = [];
    try {
        workload = await currentWorkload(orgId);
    } catch (e) {
        console.warn('[council/assignments] workload:', e instanceof Error ? e.message : e);
    }

    const rows = data || [];
    const counts = { open: 0, acked: 0, done: 0, dismissed: 0, overdue: 0, unassigned: 0 } as Record<string, number>;
    const nowIso = new Date().toISOString();
    for (const r of rows as { status: string; due_at: string | null; assignee_user_id: string | null }[]) {
        if (counts[r.status] !== undefined) counts[r.status]++;
        if (r.due_at && r.due_at < nowIso && (r.status === 'open' || r.status === 'acked')) counts.overdue++;
        if (!r.assignee_user_id) counts.unassigned++;
    }

    return NextResponse.json({ assignments: rows, workload, counts });
}

export async function POST(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    let body: { session_id?: string; org_id?: string } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const orgId = await resolveCouncilOrgId(access, request, body);
    if (!body.session_id) {
        return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
    }

    try {
        const result = await dispatchSessionFindings(orgId, body.session_id);
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[council/assignments] dispatch:', message);
        return NextResponse.json({ error: 'Dispatch failed', details: message, hint: MIGRATION_HINT }, { status: 500 });
    }
}
