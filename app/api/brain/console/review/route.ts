import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { consoleStatus, judgeAiItem, labelTurn, reviewView, setCaseActive } from '@/backend/lib/aiLayer/brain/console/server';
import { NO_STORE, consoleGuard, fail } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Brain Console → Review (Tech team only): the learning loop.
 *   GET  ?orgId=   turns that look wrong and nobody has judged yet, and the test cases taught so far.
 *   POST ?orgId=   { action: 'label', turnId, verdict: 'right' | 'wrong', expectedOutcome, expectedSkill, note }
 *                  { action: 'set_active', caseId, active }
 *                  { action: 'ai_judge', id, verdict: 'teach' | 'ignore', entryId, fields }   a flagged message of the
 *                                                        older AI assistant: teach it the right answer, or ignore it
 * A judged turn becomes a test case for the brain (scripts/brain/eval.ts --taught) and, when the organisation has
 * switched lessons on (Switches → Learning, off by default), an example the brain is shown for similar messages from
 * the same kind of login. The case keeps the message with phone numbers, emails and ids masked and the kind of login;
 * it never keeps who sent it. The flagged messages of the older AI assistant are returned too and can be judged here;
 * the task assistant's review panel is shown in the same screen, served by app/api/task-manager/bot-learning.
 */
export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    try {
        const { status, settings } = await consoleStatus(supabaseAdmin, guard.orgId);
        const data = await reviewView(supabaseAdmin, guard.orgId, settings);
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] review GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The review queue could not be loaded.');
    }
}

export async function POST(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return fail(400, 'Nothing to save.');
    try {
        const done = body.action === 'label' ? await labelTurn(supabaseAdmin, guard.orgId, guard.userId, body)
            : body.action === 'set_active' ? await setCaseActive(supabaseAdmin, guard.orgId, body)
                : body.action === 'ai_judge' ? await judgeAiItem(supabaseAdmin, guard.orgId, guard.userId, body)
                : { ok: false as const, status: 400 as const, error: 'Unknown action.' };
        if (!done.ok) return fail(done.status, done.error);
        const { status, settings } = await consoleStatus(supabaseAdmin, guard.orgId);
        const data = await reviewView(supabaseAdmin, guard.orgId, settings);
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] review POST failed:', err instanceof Error ? err.message : err);
        return fail(500, 'That could not be saved. Nothing was changed.');
    }
}
