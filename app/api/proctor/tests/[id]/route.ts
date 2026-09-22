import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, isPastDeadline, COMPLETED_STATUSES, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * GET /api/proctor/tests/[id]
 *   - taker:            the test without the answer key, plus their own attempts and chances left.
 *   - author ?view=results: the test with answers, every attempt, and each attempt's event log.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, organization_id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, questions, created_at')
        .eq('id', id)
        .maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;

    const questions = (test.questions || []) as ProctorQuestion[];
    const wantsResults = new URL(request.url).searchParams.get('view') === 'results';

    if (wantsResults) {
        if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { data: attempts } = await supabaseAdmin
            .from('proctor_attempts')
            .select('id, user_id, attempt_no, status, started_at, ended_at, termination_reason, score, total, section_scores, ai_checks, ai_flags')
            .eq('test_id', id)
            .order('started_at', { ascending: false });

        const attemptIds = (attempts || []).map((a) => a.id);
        const userIds = [...new Set((attempts || []).map((a) => a.user_id))];
        const [{ data: events }, { data: users }] = await Promise.all([
            attemptIds.length
                ? supabaseAdmin.from('proctor_events').select('attempt_id, kind, detail, created_at').in('attempt_id', attemptIds).order('created_at')
                : Promise.resolve({ data: [] }),
            userIds.length
                ? supabaseAdmin.from('users').select('id, full_name, email').in('id', userIds)
                : Promise.resolve({ data: [] }),
        ]);

        return NextResponse.json({
            test: { ...test, questions },
            attempts: (attempts || []).map((a) => {
                const u = (users || []).find((x) => x.id === a.user_id);
                return {
                    ...a,
                    // Still "in progress" after the time limit = the page never reported back
                    // (browser killed, network cut). Shown, not stored, so a late submit still lands.
                    status: a.status === 'in_progress' && isPastDeadline(a.started_at, test.duration_minutes) ? 'abandoned' : a.status,
                    name: u?.full_name || u?.email || 'Unknown',
                    email: u?.email || null,
                    events: (events || []).filter((e) => e.attempt_id === a.id && e.kind !== 'ai_ok'),
                };
            }),
        });
    }

    if (!test.is_active && !access.canAuthor) return NextResponse.json({ error: 'This test is closed' }, { status: 404 });

    const { data: mineRows } = await supabaseAdmin
        .from('proctor_attempts')
        .select('attempt_no, status, termination_reason')
        .eq('test_id', id)
        .eq('user_id', access.userId)
        .order('attempt_no');
    const mine = mineRows || [];
    const maxAttempts = test.max_attempts || 1;

    return NextResponse.json({
        test: {
            id: test.id,
            title: test.title,
            instructions: test.instructions,
            duration_minutes: test.duration_minutes,
            ai_monitoring: test.ai_monitoring,
            max_attempts: maxAttempts,
            question_count: questions.length,
            sections: [...new Set(questions.map((q) => q.section || 'general'))],
        },
        my_attempts: mine,
        completed: mine.some((a) => COMPLETED_STATUSES.includes(a.status)),
        // An in-progress attempt will be closed as "reopened" on start, so it already counts.
        chances_left: Math.max(0, maxAttempts - mine.length),
    });
}

/** PATCH /api/proctor/tests/[id] — open or close a test. Body: { is_active } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { data: test } = await supabaseAdmin.from('proctor_tests').select('organization_id').eq('id', id).maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { error } = await supabaseAdmin.from('proctor_tests').update({ is_active: !!body.is_active }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
