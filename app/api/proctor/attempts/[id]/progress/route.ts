import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, readAttemptToken, isPastDeadline } from '@/backend/lib/proctor/access';
import { toOriginalAnswers } from '@/backend/lib/proctor/order';

/**
 * POST /api/proctor/attempts/[id]/progress — autosave and heartbeat.
 * The locked page sends its answers when one changes and every ~20s anyway.
 * The answers are kept on the attempt (not graded until submit), and
 * last_seen_at says the page is still alive: if it goes silent (crash, power,
 * network) the attempt can be resumed within 5 minutes of the last one.
 * Body: { answers: { [questionId]: optionIndex as shown }, attempt_token? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const loaded = await loadOwnAttempt(id, readAttemptToken(request, body));
    if ('error' in loaded) return loaded.error;
    const { attempt, test } = loaded;

    if (attempt.status !== 'in_progress') return NextResponse.json({ status: attempt.status });
    if (isPastDeadline(attempt.started_at, test.duration_minutes)) return NextResponse.json({ error: 'Time is up' }, { status: 409 });

    const given = (body.answers && typeof body.answers === 'object') ? body.answers as Record<string, unknown> : {};
    const answers = toOriginalAnswers(test.questions || [], attempt.question_order, given);

    const { error } = await supabaseAdmin
        .from('proctor_attempts')
        .update({ answers, last_seen_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'in_progress');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, saved: Object.keys(answers).length });
}
