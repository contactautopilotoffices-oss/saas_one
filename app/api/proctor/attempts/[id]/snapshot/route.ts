import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, isPastDeadline } from '@/backend/lib/proctor/access';
import { checkFrame } from '@/backend/lib/proctor/vision';

const MAX_IMAGE_CHARS = 400_000; // ~300 KB of JPEG; the page sends ~20 KB frames

/**
 * POST /api/proctor/attempts/[id]/snapshot — one webcam frame, checked by the
 * vision model. The verdict is logged and returned so the page can warn the
 * taker; it never ends the attempt. The frame itself is not stored.
 * Body: { image: "data:image/jpeg;base64,..." }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const loaded = await loadOwnAttempt(id);
    if ('error' in loaded) return loaded.error;
    const { attempt, test } = loaded;

    if (attempt.status !== 'in_progress') return NextResponse.json({ status: attempt.status });
    if (!test.ai_monitoring) return NextResponse.json({ skipped: true });
    if (isPastDeadline(attempt.started_at, test.duration_minutes)) return NextResponse.json({ error: 'Time is up' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const image = typeof body.image === 'string' ? body.image : '';
    if (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_CHARS) {
        return NextResponse.json({ error: 'Send a JPEG data URL under 300 KB' }, { status: 400 });
    }

    const verdict = await checkFrame(image);

    if ('error' in verdict) {
        await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind: 'ai_error', detail: { error: verdict.error } });
        return NextResponse.json({ ok: false, error: verdict.error });
    }

    await Promise.all([
        supabaseAdmin.from('proctor_events').insert({
            attempt_id: id,
            kind: verdict.flagged ? 'ai_flag' : 'ai_ok',
            detail: verdict,
        }),
        supabaseAdmin.rpc('proctor_bump_ai_counts', { p_attempt_id: id, p_flagged: verdict.flagged }),
    ]);

    return NextResponse.json({ ok: true, flagged: verdict.flagged, reason: verdict.reason });
}
