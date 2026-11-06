import { NextRequest, NextResponse } from 'next/server';
import { loadOwnAttempt, readAttemptToken, isPastDeadline } from '@/backend/lib/proctor/access';
import { recordFlag, isFlagCategory } from '@/backend/lib/proctor/flags';

const MAX_IMAGE_CHARS = 400_000;

/**
 * POST /api/proctor/attempts/[id]/flag — a problem seen by the detector running
 * in the candidate's browser (MediaPipe): a phone, a second person, no face, or
 * head/eyes off the screen, held for ~1.5s. That is what makes the warning pop
 * up within about two seconds; the server's camera check every ~10s stays as a
 * backstop, since a page can be tampered with.
 *
 * Counted exactly like a camera-check flag (recordFlag): warning, at most one
 * strike per 20s, the limit closes the attempt, and the frame sent with it is
 * kept as evidence.
 * Body: { category, detail?: { observation, yaw, pitch, score, ... }, image?, attempt_token? }
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
    if (!isFlagCategory(body.category)) return NextResponse.json({ error: 'Unknown category' }, { status: 400 });

    const image = typeof body.image === 'string' && body.image.startsWith('data:image/jpeg;base64,') && body.image.length <= MAX_IMAGE_CHARS
        ? body.image
        : null;

    // Only short, flat facts from the page — never trusted for anything but the log.
    const raw = body.detail && typeof body.detail === 'object' ? body.detail as Record<string, unknown> : {};
    const detail: Record<string, unknown> = { source: 'device' };
    for (const key of ['observation', 'yaw', 'pitch', 'score', 'faces', 'held_ms']) {
        const v = raw[key];
        if (typeof v === 'number' && Number.isFinite(v)) detail[key] = Math.round(v * 100) / 100;
        else if (typeof v === 'string') detail[key] = v.slice(0, 200);
    }

    const result = await recordFlag({
        attemptId: id,
        test,
        answers: attempt.answers as Record<string, unknown> | null,
        category: body.category,
        detail,
        image,
    });
    return NextResponse.json(result);
}
