import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, stripAnswers, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * POST /api/proctor/tests/[id]/start
 * Called by the locked page once the camera is on and fullscreen is entered.
 * Creates the one attempt this person gets and only then hands over the
 * questions, so nobody can read them without the lock running.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, organization_id, is_active, questions, duration_minutes, ai_monitoring')
        .eq('id', id)
        .maybeSingle();
    if (!test || !test.is_active) return NextResponse.json({ error: 'This test is not open' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;

    const { data: attempt, error } = await supabaseAdmin
        .from('proctor_attempts')
        .insert({ test_id: id, organization_id: test.organization_id, user_id: access.userId })
        .select('id, started_at')
        .single();

    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'You have already taken this test' }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        attempt_id: attempt.id,
        started_at: attempt.started_at,
        duration_minutes: test.duration_minutes,
        ai_monitoring: test.ai_monitoring,
        questions: stripAnswers((test.questions || []) as ProctorQuestion[]),
    });
}
