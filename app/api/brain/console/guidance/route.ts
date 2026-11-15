import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { activate, discardDraft, guidanceView, saveDraft, testStep, turnOff, type GuidanceDeps } from '@/backend/lib/aiLayer/brain/console/guidance';
import { consoleStatus } from '@/backend/lib/aiLayer/brain/console/server';
import { suggestGuidance, withSuggest } from '@/backend/lib/aiLayer/brain/console/suggest';
import { liveBrainModel } from '@/backend/lib/aiLayer/brain/providers/router';
import { NO_STORE, consoleGuard, fail } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One `test_step` plays a few test messages on the real model and returns; the console calls it until the test is done.
export const maxDuration = 60;

/**
 * Brain Console → Guidance (Tech team only): a short note the Tech team writes for the brain, in versions.
 *   GET  ?orgId=   the live note, the versions, and what a test would cost.
 *   POST ?orgId=   { action: 'save_draft', text }
 *                  { action: 'test_step', versionId }    plays the next steps of the test (real model, FAKE data)
 *                  { action: 'activate', versionId }     refused unless the stored test passed and is still current
 *                  { action: 'turn_off' }
 *                  { action: 'discard_draft', versionId }
 *                  { action: 'suggest' }                 one model call: proposes the words of a note from the answers
 *                                                        judged wrong. Returned as `suggestion`; NOTHING is saved and
 *                                                        nothing goes live. Limit: three a day.
 * A note can never change who may see or do what, which skills exist, or the confirmation before an action: those are
 * code. The test spends model credit (limit: five tests a day, two dollars a test); it reads and writes no business
 * data and cannot send a message. Only one step of a test runs at a time: a second request for the same draft gets
 * HTTP 409 before it spends anything.
 */
function deps(keyOrder: readonly number[]): GuidanceDeps {
    return {
        model: liveBrainModel(keyOrder),
        chain: async () => (await import('@/task-manager/ai/AiModelSettings')).chainFor('brain_turn'),
        now: () => new Date(),
    };
}

export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    try {
        const { status, settings } = await consoleStatus(supabaseAdmin, guard.orgId);
        const data = await withSuggest(await guidanceView(supabaseAdmin, guard.orgId, deps(settings.keys.order)), supabaseAdmin, guard.orgId, new Date());
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] guidance GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'Guidance could not be loaded.');
    }
}

export async function POST(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return fail(400, 'Nothing to save.');
    try {
        const { settings } = await consoleStatus(supabaseAdmin, guard.orgId);
        const d = deps(settings.keys.order);
        let suggestion: { text: string; basedOn: number } | undefined;
        if (body.action === 'suggest') {
            const made = await suggestGuidance(supabaseAdmin, guard.orgId, guard.userId, d);
            if (!made.ok) return fail(made.status, made.error);
            suggestion = { text: made.text, basedOn: made.basedOn };
        }
        const done = suggestion ? { ok: true as const }
            : body.action === 'save_draft' ? await saveDraft(supabaseAdmin, guard.orgId, guard.userId, body.text)
            : body.action === 'test_step' ? await testStep(supabaseAdmin, guard.orgId, guard.userId, body.versionId, d)
                : body.action === 'activate' ? await activate(supabaseAdmin, guard.orgId, guard.userId, body.versionId, d)
                    : body.action === 'turn_off' ? await turnOff(supabaseAdmin, guard.orgId)
                        : body.action === 'discard_draft' ? await discardDraft(supabaseAdmin, guard.orgId, body.versionId)
                            : { ok: false as const, status: 400 as const, error: 'Unknown action.' };
        if (!done.ok) return fail(done.status, done.error);
        const [{ status }, view] = await Promise.all([consoleStatus(supabaseAdmin, guard.orgId), guidanceView(supabaseAdmin, guard.orgId, d)]);
        const data = await withSuggest(view, supabaseAdmin, guard.orgId, new Date());
        return NextResponse.json({ success: true, status, data, ...(suggestion ? { suggestion } : {}) }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] guidance POST failed:', err instanceof Error ? err.message : err);
        return fail(500, 'That could not be done. Nothing was changed.');
    }
}
