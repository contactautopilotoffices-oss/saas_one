import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';

/**
 * PATCH /api/council/assignments/[id] { status, outcome_note?, dismissed_reason? }
 *
 * Closing the loop. 'done' with an outcome_note is what makes impact measurable rather
 * than asserted; 'dismissed' with a reason is the false-positive record, kept
 * deliberately because a council whose wrong findings quietly vanish cannot be evaluated
 * (EVAL.md REQ-04 asks for an honest false-positive count).
 */

export const dynamic = 'force-dynamic';

const TERMINAL = new Set(['done', 'dismissed']);
const VALID = new Set(['open', 'acked', 'done', 'dismissed']);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const { id } = await context.params;

    let body: { status?: string; outcome_note?: string; dismissed_reason?: string } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const status = body.status;
    if (!status || !VALID.has(status)) {
        return NextResponse.json({ error: `status must be one of ${[...VALID].join(', ')}` }, { status: 400 });
    }
    // A dismissal without a reason is how false positives get laundered into silence.
    if (status === 'dismissed' && !body.dismissed_reason?.trim()) {
        return NextResponse.json({ error: 'dismissed_reason is required when dismissing' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, updated_at: now };
    if (body.outcome_note !== undefined) patch.outcome_note = body.outcome_note;
    if (body.dismissed_reason !== undefined) patch.dismissed_reason = body.dismissed_reason;
    if (status === 'acked') patch.acked_at = now;
    if (TERMINAL.has(status)) {
        patch.closed_at = now;
        patch.closed_by = access.user.id;
    } else {
        // Reopening clears the close, otherwise a reopened row reads as both open and closed.
        patch.closed_at = null;
        patch.closed_by = null;
    }

    const { data, error } = await access.adminClient
        .from('council_assignments')
        .update(patch)
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.error('[council/assignments/:id] update:', error.message);
        return NextResponse.json({
            error: 'Could not update the assignment',
            details: error.message,
            hint: 'If this mentions a missing relation, apply supabase/migrations/20260803000002_council_dispatch.sql',
        }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

    return NextResponse.json({ assignment: data });
}
