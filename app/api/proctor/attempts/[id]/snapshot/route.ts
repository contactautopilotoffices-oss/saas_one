import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, readAttemptToken, isPastDeadline } from '@/backend/lib/proctor/access';
import { checkFrame, type FrameVerdict } from '@/backend/lib/proctor/vision';
import { recordFlag, type FlagCategory } from '@/backend/lib/proctor/flags';

const MAX_IMAGE_CHARS = 400_000; // ~300 KB of JPEG; the page sends ~20 KB frames

/**
 * Decided from what the model saw, not from its overall "flagged": a verdict
 * that reports no face, two faces, a phone or eyes off the screen but forgets
 * to set flagged=true still counts.
 */
function categorise(v: FrameVerdict): FlagCategory | null {
    if (v.face_count === 0) return 'no_face';
    if (v.face_count > 1) return 'multiple_faces';
    if (v.phone_or_device_visible) return 'phone';
    if (!v.looking_at_screen) return 'looking_away';
    return null;
}

/**
 * POST /api/proctor/attempts/[id]/snapshot — one webcam frame, checked by the
 * vision model. The backstop to the detector in the candidate's browser, and
 * the source of the evidence frames.
 *
 * Any flag — head or eyes off the screen, no face, a phone, or a second person
 * in frame — warns the taker; strikes, the 20s gap and the limit are applied
 * in recordFlag (flags.ts), the same as for flags from the device detector.
 *
 * Body: { image: "data:image/jpeg;base64,...", attempt_token? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const loaded = await loadOwnAttempt(id, readAttemptToken(request, body));
    if ('error' in loaded) return loaded.error;
    const { attempt, test } = loaded;

    if (attempt.status !== 'in_progress') return NextResponse.json({ status: attempt.status });
    if (!test.ai_monitoring) return NextResponse.json({ skipped: true });
    if (isPastDeadline(attempt.started_at, test.duration_minutes)) return NextResponse.json({ error: 'Time is up' }, { status: 409 });

    const image = typeof body.image === 'string' ? body.image : '';
    if (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_CHARS) {
        return NextResponse.json({ error: 'Send a JPEG data URL under 300 KB' }, { status: 400 });
    }

    const verdict = await checkFrame(image);

    if ('error' in verdict) {
        await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind: 'ai_error', detail: { error: verdict.error } });
        return NextResponse.json({ ok: false, error: verdict.error });
    }

    // The vision call takes a few seconds, and the attempt can end while it runs
    // (a real run recorded a clean check 4s after the test had closed). Re-read
    // the status before recording anything, so the log ends when the test does.
    const { data: still } = await supabaseAdmin.from('proctor_attempts').select('status, answers').eq('id', id).maybeSingle();
    if (still?.status !== 'in_progress') return NextResponse.json({ status: still?.status || 'ended' });

    const category = categorise(verdict);
    if (!category) {
        await Promise.all([
            supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind: verdict.flagged ? 'ai_flag' : 'ai_ok', detail: { ...verdict, category: null } }),
            supabaseAdmin.rpc('proctor_bump_ai_counts', { p_attempt_id: id, p_flagged: verdict.flagged }),
        ]);
        return NextResponse.json({ ok: true, warn: false });
    }

    const result = await recordFlag({
        attemptId: id,
        test,
        answers: still.answers as Record<string, unknown> | null,
        category,
        detail: { ...verdict, flagged: true, source: 'camera_check' },
        image,
    });
    return NextResponse.json(result);
}
