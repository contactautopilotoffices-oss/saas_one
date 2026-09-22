import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, stripAnswers, COMPLETED_STATUSES, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * POST /api/proctor/tests/[id]/start
 * Called by the locked page once the camera is on and fullscreen is entered.
 * Opens the next chance this person has and only then hands over the
 * questions, so nobody can read them without the lock running.
 *
 * Chances: leaving the page uses one; a submitted attempt ends the test. An
 * attempt still "in progress" when the link is opened again (crashed browser,
 * second tab) counts as left — it is closed as "reopened" and uses its chance.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, organization_id, is_active, questions, duration_minutes, ai_monitoring, max_attempts')
        .eq('id', id)
        .maybeSingle();
    if (!test || !test.is_active) return NextResponse.json({ error: 'This test is not open' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;

    const { data: previous } = await supabaseAdmin
        .from('proctor_attempts')
        .select('id, status, attempt_no')
        .eq('test_id', id)
        .eq('user_id', access.userId);
    const mine = previous || [];

    if (mine.some((a) => COMPLETED_STATUSES.includes(a.status))) {
        return NextResponse.json({ error: 'You have already completed this test' }, { status: 409 });
    }

    const stale = mine.filter((a) => a.status === 'in_progress');
    if (stale.length) {
        const now = new Date().toISOString();
        await supabaseAdmin
            .from('proctor_attempts')
            .update({ status: 'terminated', termination_reason: 'reopened', ended_at: now })
            .in('id', stale.map((a) => a.id))
            .eq('status', 'in_progress');
        await supabaseAdmin.from('proctor_events').insert(
            stale.map((a) => ({ attempt_id: a.id, kind: 'reopened', detail: { at: now } })),
        );
    }

    const maxAttempts = test.max_attempts || 1;
    if (mine.length >= maxAttempts) {
        return NextResponse.json({
            error: maxAttempts === 1 ? 'You have used your only chance at this test' : `You have used all ${maxAttempts} chances at this test`,
        }, { status: 409 });
    }

    const attemptNo = Math.max(0, ...mine.map((a) => a.attempt_no || 0)) + 1;
    const { data: attempt, error } = await supabaseAdmin
        .from('proctor_attempts')
        .insert({ test_id: id, organization_id: test.organization_id, user_id: access.userId, attempt_no: attemptNo })
        .select('id, started_at, attempt_no')
        .single();

    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'This test was just started in another window' }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        attempt_id: attempt.id,
        attempt_no: attempt.attempt_no,
        max_attempts: maxAttempts,
        started_at: attempt.started_at,
        duration_minutes: test.duration_minutes,
        ai_monitoring: test.ai_monitoring,
        questions: stripAnswers((test.questions || []) as ProctorQuestion[]),
    });
}
