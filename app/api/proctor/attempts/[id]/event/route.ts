import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, readAttemptToken } from '@/backend/lib/proctor/access';

/** Leaving the locked page in any of these ways ends the attempt. */
const TERMINATING = new Set(['tab_hidden', 'window_blur', 'fullscreen_exit', 'page_unload', 'camera_lost']);

/** Recorded for the reviewer, but the test carries on. */
const LOGGED_ONLY = new Set(['voice_detected', 'mic_lost']);

/**
 * POST /api/proctor/attempts/[id]/event — the locked page reporting that the
 * taker left. Also receives navigator.sendBeacon on tab close, which posts
 * text/plain, so the body is read as text.
 * Body: { kind, detail?, attempt_token? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    let body: { kind?: string; detail?: Record<string, unknown>; attempt_token?: string } = {};
    try { body = JSON.parse(await request.text()); } catch { /* empty beacon */ }

    const loaded = await loadOwnAttempt(id, readAttemptToken(request, body));
    if ('error' in loaded) return loaded.error;
    const { attempt } = loaded;

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

    const { data: updated } = await supabaseAdmin
        .from('proctor_attempts')
        .update({ status: 'terminated', termination_reason: kind, ended_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'in_progress')
        .select('id')
        .maybeSingle();

    if (updated) {
        await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind, detail: body.detail || {} });
    }
    return NextResponse.json({ status: 'terminated' });
}
