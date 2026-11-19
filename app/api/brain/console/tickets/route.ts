import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { consoleStatus } from '@/backend/lib/aiLayer/brain/console/server';
import { judgeTicketSort, keepExample, ticketReviewView, undoTicketJudgement, type Reassign } from '@/backend/lib/ticketing/sortReview';
import { continueRulesRun, rejectRulesVersion, startRulesRun, stopRules, applyRulesVersion, type Decision } from '@/backend/lib/ticketing/sortRulesStore';

/** 2026-11-19: "Suggest rules now" drafts and starts testing in one request; the screen asks to carry on until done. */
export const maxDuration = 120;
const RULES_STEP_MS = 45_000;
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
 *                  Sorting rules (sortRulesStore.ts): { action: 'rules_suggest' } | { action: 'rules_continue', runId }
 *                              | { action: 'rules_own', text } | { action: 'rules_use' | 'rules_reject', versionId }
 *                              | { action: 'rules_stop' }. Only rules_use makes rules live, and only for a Tech person.
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
        const action = typeof body.action === 'string' ? body.action : '';
        const done = action === 'undo' ? await undoTicketJudgement(supabaseAdmin, guard.orgId, guard.userId, body, reassign)
            : action === 'keep' ? await keepExample(supabaseAdmin, guard.orgId, body)
            : action.startsWith('rules_') ? await rulesAction(action, body, guard.orgId, guard.userId)
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

/** The sorting rules actions (owner 2026-11-19). Drafting and testing run here; making rules live is rules_use only. */
async function rulesAction(action: string, body: Record<string, unknown>, orgId: string, userId: string): Promise<Decision> {
    if (action === 'rules_use') return applyRulesVersion(supabaseAdmin, orgId, body.versionId, userId);
    if (action === 'rules_reject') return rejectRulesVersion(supabaseAdmin, orgId, body.versionId, userId);
    if (action === 'rules_stop') return stopRules(supabaseAdmin, orgId, userId);
    if (action === 'rules_continue') {
        if (typeof body.runId !== 'string' || !body.runId) return { ok: false, status: 400, error: 'Which run?' };
        const step = await continueRulesRun(body.runId, RULES_STEP_MS, { admin: supabaseAdmin, orgId });
        return step.status === 'gone' ? { ok: false, status: 404, error: 'That run could not be found.' } : { ok: true, message: step.message };
    }
    if (action === 'rules_suggest' || action === 'rules_own') {
        const own = action === 'rules_own';
        if (own && (typeof body.text !== 'string' || !body.text.trim())) return { ok: false, status: 400, error: 'Write at least one rule.' };
        const started = await startRulesRun(orgId, own ? 'person' : 'button', { admin: supabaseAdmin, by: userId, ownText: own ? String(body.text) : undefined });
        if (!started.ok) return started;
        if (!started.runId) return { ok: true, message: started.message };
        const step = await continueRulesRun(started.runId, RULES_STEP_MS, { admin: supabaseAdmin, orgId });
        return { ok: true, message: step.status === 'gone' || step.status === 'busy' ? started.message : step.message };
    }
    return { ok: false, status: 400, error: 'Unknown action.' };
}
