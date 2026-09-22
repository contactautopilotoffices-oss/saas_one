import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt } from '@/backend/lib/proctor/access';

/** Leaving the locked page in any of these ways ends the attempt. */
const TERMINATING = new Set(['tab_hidden', 'window_blur', 'fullscreen_exit', 'page_unload', 'camera_lost']);

/**
 * POST /api/proctor/attempts/[id]/event — the locked page reporting that the
 * taker left. Also receives navigator.sendBeacon on tab close, which posts
 * text/plain, so the body is read as text.
 * Body: { kind, detail? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const loaded = await loadOwnAttempt(id);
    if ('error' in loaded) return loaded.error;
    const { attempt } = loaded;

    let body: { kind?: string; detail?: Record<string, unknown> } = {};
    try { body = JSON.parse(await request.text()); } catch { /* empty beacon */ }
    const kind = String(body.kind || '');
    if (!TERMINATING.has(kind)) return NextResponse.json({ error: 'Unknown event kind' }, { status: 400 });

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
