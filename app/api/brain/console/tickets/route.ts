import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { consoleStatus } from '@/backend/lib/aiLayer/brain/console/server';
import { judgeTicketSort, keepExample, ticketReviewView, undoTicketJudgement, type Reassign } from '@/backend/lib/ticketing/sortReview';
import { NO_STORE, consoleGuard, fail } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Brain Console → Review → Tickets (Tech team only; owner 2026-11-15).
 *   GET  ?orgId=   tickets the AI sorted with less than High confidence, or the keyword rules sorted, that nobody has
 *                  judged yet (last 30 days); the categories each could have; the sorting accuracy; the last judgements.
 *   POST ?orgId=   { ticketId, verdict: 'right' | 'wrong', code }   code = the right category, when wrong.
 *                  Wrong: becomes a correction the AI learns from, and an open ticket is moved to that category and team
 *                  and assigned again (backend/lib/ticketing/sortReview.ts).
 *                  2026-11-19: { action: 'undo', ticketId }  takes a judgement back (within 7 days).
 *                              { action: 'keep', keep, drop }  two learning examples disagree: keep one.
 * The ticket's words are masked and nothing says who raised it.
 */
export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    try {
        const { status } = await consoleStatus(supabaseAdmin, guard.orgId);
        const data = await ticketReviewView(supabaseAdmin, guard.orgId);
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] ticket review GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The ticket review could not be loaded.');
    }
}

const reassign: Reassign = async ticket => {
    const { processIntelligentAssignment } = await import('@/backend/lib/ticketing/assignment');
    const { results } = await processIntelligentAssignment(supabaseAdmin, [ticket], ticket.property_id);
    // It reports a failure in its results instead of throwing.
    if (results[0]?.status === 'error') throw new Error(results[0].error || 'assignment failed');
};

export async function POST(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return fail(400, 'Nothing to save.');
    try {
        const done = body.action === 'undo' ? await undoTicketJudgement(supabaseAdmin, guard.orgId, guard.userId, body, reassign)
            : body.action === 'keep' ? await keepExample(supabaseAdmin, guard.orgId, body)
            : await judgeTicketSort(supabaseAdmin, guard.orgId, guard.userId, body, reassign);
        if (!done.ok) return fail(done.status, done.error);
        const { status } = await consoleStatus(supabaseAdmin, guard.orgId);
        const data = await ticketReviewView(supabaseAdmin, guard.orgId);
        return NextResponse.json({ success: true, status, data, message: done.message }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] ticket review POST failed:', err instanceof Error ? err.message : err);
        return fail(500, 'That could not be saved.');
    }
}
