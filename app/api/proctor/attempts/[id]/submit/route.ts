import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadOwnAttempt, isPastDeadline } from '@/backend/lib/proctor/access';

/**
 * POST /api/proctor/attempts/[id]/submit — grade and close the attempt.
 * A submit that arrives after the time limit (plus a minute of grace) is still
 * graded but recorded as "expired", so the reviewer can decide.
 * Body: { answers: { [questionId]: optionIndex } }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const loaded = await loadOwnAttempt(id);
    if ('error' in loaded) return loaded.error;
    const { attempt, test } = loaded;

    if (attempt.status !== 'in_progress') {
        return NextResponse.json({ error: 'This attempt has already ended', status: attempt.status }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const given = (body.answers && typeof body.answers === 'object') ? body.answers as Record<string, unknown> : {};

    const answers: Record<string, number> = {};
    let score = 0;
    for (const q of test.questions || []) {
        const pick = Number(given[q.id]);
        if (Number.isInteger(pick) && pick >= 0 && pick < q.options.length) {
            answers[q.id] = pick;
            if (pick === q.answer_index) score++;
        }
    }

    const status = isPastDeadline(attempt.started_at, test.duration_minutes) ? 'expired' : 'submitted';
    const { data: updated, error } = await supabaseAdmin
        .from('proctor_attempts')
        .update({ status, answers, score, total: (test.questions || []).length, ended_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'in_progress')
        .select('id')
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Lost a race with a violation that ended the attempt a moment earlier.
    if (!updated) return NextResponse.json({ error: 'This attempt has already ended' }, { status: 409 });

    return NextResponse.json({ status });
}
