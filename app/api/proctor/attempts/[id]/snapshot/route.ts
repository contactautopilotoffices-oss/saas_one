import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, readAttemptToken, isPastDeadline, EVIDENCE_BUCKET } from '@/backend/lib/proctor/access';
import { checkFrame, type FrameVerdict } from '@/backend/lib/proctor/vision';

const MAX_IMAGE_CHARS = 400_000; // ~300 KB of JPEG; the page sends ~20 KB frames

/** What the frame was flagged for. Every category warns the taker and counts towards the strike limit. */
type FlagCategory = 'multiple_faces' | 'phone' | 'no_face' | 'looking_away';

const WARNING_CATEGORIES: FlagCategory[] = ['no_face', 'multiple_faces', 'phone', 'looking_away'];

/** Flags a reviewer has to judge for themselves, so the frame is kept as evidence. */
const EVIDENCE_CATEGORIES: FlagCategory[] = ['multiple_faces', 'phone'];

const WARNING_MESSAGE: Record<FlagCategory, string> = {
    no_face: 'Your face is not visible — look into the camera',
    multiple_faces: 'Only you should be in view — someone else was seen on camera',
    phone: 'Put away phones and other devices',
    looking_away: 'Please look into the camera',
};

function categorise(v: FrameVerdict): FlagCategory | null {
    if (v.face_count === 0) return 'no_face';
    if (v.face_count > 1) return 'multiple_faces';
    if (v.phone_or_device_visible) return 'phone';
    if (!v.looking_at_screen) return 'looking_away';
    return null;
}

/**
 * POST /api/proctor/attempts/[id]/snapshot — one webcam frame, checked by the
 * vision model.
 *
 * Any flag — not looking at the screen, no face, a phone, or a second person
 * in frame — warns the taker and counts as a strike. After the test's strike
 * limit (default 3) the attempt closes. For a phone or a second person the
 * frame is also saved to a private bucket for the reviewer.
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
    const { data: still } = await supabaseAdmin.from('proctor_attempts').select('status').eq('id', id).maybeSingle();
    if (still?.status !== 'in_progress') return NextResponse.json({ status: still?.status || 'ended' });

    const category = verdict.flagged ? categorise(verdict) : null;
    const warns = !!category && WARNING_CATEGORIES.includes(category);

    // Evidence: keep the frame only when it is the kind of flag a reviewer has
    // to judge for themselves (a phone, someone else in the room).
    let evidencePath: string | null = null;
    if (category && EVIDENCE_CATEGORIES.includes(category)) {
        const path = `${id}/${Date.now()}-${category}.jpg`;
        const { error: uploadError } = await supabaseAdmin.storage
            .from(EVIDENCE_BUCKET)
            .upload(path, Buffer.from(image.split(',')[1] || '', 'base64'), { contentType: 'image/jpeg', upsert: false });
        if (uploadError) {
            console.error('[proctor] evidence upload failed:', uploadError.message);
        } else {
            evidencePath = path;
        }
    }

    await Promise.all([
        supabaseAdmin.from('proctor_events').insert({
            attempt_id: id,
            kind: verdict.flagged ? 'ai_flag' : 'ai_ok',
            detail: { ...verdict, category, evidence_path: evidencePath },
        }),
        supabaseAdmin.rpc('proctor_bump_ai_counts', { p_attempt_id: id, p_flagged: verdict.flagged }),
    ]);

    if (!warns) {
        return NextResponse.json({ ok: true, warn: false });
    }

    // Strikes are counted from the event log, so a reload or a second tab can't reset them.
    const { data: flagRows } = await supabaseAdmin
        .from('proctor_events')
        .select('detail')
        .eq('attempt_id', id)
        .eq('kind', 'ai_flag');
    const strikes = (flagRows || []).filter((r) => {
        const c = (r.detail as { category?: string } | null)?.category;
        return WARNING_CATEGORIES.includes(c as FlagCategory);
    }).length;
    const allowed = test.look_away_strikes || 3;

    if (strikes >= allowed) {
        const { data: closed } = await supabaseAdmin
            .from('proctor_attempts')
            .update({ status: 'terminated', termination_reason: 'looking_away', ended_at: new Date().toISOString() })
            .eq('id', id)
            .eq('status', 'in_progress')
            .select('id')
            .maybeSingle();
        if (closed) {
            await supabaseAdmin.from('proctor_events').insert({
                attempt_id: id,
                kind: 'looking_away',
                detail: { strikes, allowed },
            });
        }
        return NextResponse.json({ ok: true, warn: true, status: 'terminated', strikes, strikes_allowed: allowed });
    }

    return NextResponse.json({
        ok: true,
        warn: true,
        message: WARNING_MESSAGE[category],
        strikes,
        strikes_allowed: allowed,
    });
}
