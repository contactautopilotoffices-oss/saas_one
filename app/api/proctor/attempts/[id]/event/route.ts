import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, readAttemptToken } from '@/backend/lib/proctor/access';
import { toOriginalAnswers } from '@/backend/lib/proctor/order';
import { grade } from '@/backend/lib/proctor/grade';

/** Leaving the locked page in any of these ways ends the attempt — after the warnings below, for the first three. */
const TERMINATING = new Set(['tab_hidden', 'window_blur', 'fullscreen_exit', 'page_unload', 'camera_lost']);

/**
 * Owner 2026-10-31: switching tab or app, or leaving fullscreen, gets this many warnings;
 * the next time ends the test. Closing/refreshing the page or turning the camera off still
 * ends it at once.
 */
const WARNABLE = new Set(['tab_hidden', 'window_blur', 'fullscreen_exit']);
const LEAVE_WARNINGS_ALLOWED = 2;
/** One switch fires several of these together (hidden + blur + fullscreen exit): count it once. */
const SAME_LEAVE_MS = 3_000;

/** Recorded for the reviewer, but the test carries on. */
const LOGGED_ONLY = new Set(['voice_detected', 'mic_lost', 'detector_unavailable']);

/**
 * POST /api/proctor/attempts/[id]/event — the locked page reporting that the
 * taker left. Also receives navigator.sendBeacon on tab close, which posts
 * text/plain, so the body is read as text. A tab/app switch or fullscreen exit
 * answers { status: 'warned', warnings, allowed } until the warnings run out;
 * a terminating event grades the answers given so far as a partial score.
 * Body: { kind, detail?, attempt_token?, answers? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    let body: { kind?: string; detail?: Record<string, unknown>; attempt_token?: string; answers?: Record<string, unknown> } = {};
    try { body = JSON.parse(await request.text()); } catch { /* empty beacon */ }

    const loaded = await loadOwnAttempt(id, readAttemptToken(request, body));
    if ('error' in loaded) return loaded.error;
    const { attempt, test } = loaded;

    const kind = String(body.kind || '');
    if (!TERMINATING.has(kind) && !LOGGED_ONLY.has(kind)) {
        return NextResponse.json({ error: 'Unknown event kind' }, { status: 400 });
    }

    if (LOGGED_ONLY.has(kind)) {
        if (attempt.status === 'in_progress') {
            await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind, detail: body.detail || {} });
        }
        return NextResponse.json({ status: attempt.status });
    }

    // Already submitted/ended (e.g. fullscreen exits after a normal submit) — nothing to do.
    if (attempt.status !== 'in_progress') return NextResponse.json({ status: attempt.status });

    if (WARNABLE.has(kind)) {
        const { data: warnings } = await supabaseAdmin
            .from('proctor_events')
            .select('created_at')
            .eq('attempt_id', id)
            .eq('kind', 'left_warning')
            .order('created_at', { ascending: false });
        const given = warnings || [];
        if (given[0] && Date.now() - new Date(given[0].created_at).getTime() < SAME_LEAVE_MS) {
            return NextResponse.json({ status: 'warned', warnings: given.length, allowed: LEAVE_WARNINGS_ALLOWED });
        }
        if (given.length < LEAVE_WARNINGS_ALLOWED) {
            const n = given.length + 1;
            await supabaseAdmin.from('proctor_events').insert({
                attempt_id: id,
                kind: 'left_warning',
                detail: { ...(body.detail || {}), reason: kind, n, allowed: LEAVE_WARNINGS_ALLOWED },
            });
            return NextResponse.json({ status: 'warned', warnings: n, allowed: LEAVE_WARNINGS_ALLOWED });
        }
        // Warnings used up: this one ends it, below.
    }

    // The answers given so far still count, as a partial score: the page's own copy if it sent
    // one (newest), otherwise the last autosave.
    const answers = body.answers && typeof body.answers === 'object'
        ? toOriginalAnswers(test.questions || [], attempt.question_order, body.answers)
        : (attempt.answers || {}) as Record<string, number>;

    const { data: updated } = await supabaseAdmin
        .from('proctor_attempts')
        .update({ status: 'terminated', termination_reason: kind, answers, ...grade(test.questions || [], answers), ended_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'in_progress')
        .select('id')
        .maybeSingle();

    if (updated) {
        await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind, detail: body.detail || {} });
    }
    return NextResponse.json({ status: 'terminated' });
}
