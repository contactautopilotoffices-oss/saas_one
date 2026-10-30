import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveProctorAccess, isProctorAccessError, isPastDeadline, resolveSections,
    COMPLETED_STATUSES, EVIDENCE_BUCKET, type ProctorQuestion,
} from '@/backend/lib/proctor/access';

const TEST_COLUMNS =
    'id, organization_id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, look_away_strikes, public_token, sections, questions, created_at';

/** Evidence frames are private; reviewers get a link that expires in an hour. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * GET /api/proctor/tests/[id]
 *   - taker:                the test without the answer key, plus their own attempts and chances left.
 *   - author ?view=preview: the whole test with its answer key, for the preview page.
 *   - author ?view=results: every attempt, its event log, and links to any evidence frames.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: test } = await supabaseAdmin.from('proctor_tests').select(TEST_COLUMNS).eq('id', id).maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;

    const questions = (test.questions || []) as ProctorQuestion[];
    const sections = resolveSections(test.sections, questions);
    const view = new URL(request.url).searchParams.get('view');

    if (view === 'preview' || view === 'results') {
        if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (view === 'preview') {
        return NextResponse.json({ test: { ...test, questions, sections } });
    }

    if (view === 'results') {
        const { data: attempts } = await supabaseAdmin
            .from('proctor_attempts')
            .select('id, user_id, candidate_name, candidate_email, attempt_no, status, started_at, ended_at, termination_reason, score, total, section_scores, ai_checks, ai_flags')
            .eq('test_id', id)
            .order('started_at', { ascending: false });

        const attemptIds = (attempts || []).map((a) => a.id);
        const userIds = [...new Set((attempts || []).map((a) => a.user_id).filter(Boolean))] as string[];
        const [{ data: events }, { data: users }] = await Promise.all([
            attemptIds.length
                ? supabaseAdmin.from('proctor_events').select('attempt_id, kind, detail, created_at').in('attempt_id', attemptIds).order('created_at')
                : Promise.resolve({ data: [] }),
            userIds.length
                ? supabaseAdmin.from('users').select('id, full_name, email').in('id', userIds)
                : Promise.resolve({ data: [] }),
        ]);

        // One signed URL per saved frame, so the reviewer can open the evidence.
        const paths = (events || [])
            .map((e) => (e.detail as { evidence_path?: string } | null)?.evidence_path)
            .filter(Boolean) as string[];
        const signed = new Map<string, string>();
        if (paths.length) {
            const { data: urls } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
            (urls || []).forEach((u) => { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl); });
        }

        return NextResponse.json({
            test: { ...test, questions, sections },
            attempts: (attempts || []).map((a) => {
                const u = (users || []).find((x) => x.id === a.user_id);
                return {
                    ...a,
                    // Still "in progress" after the time limit = the page never reported back
                    // (browser killed, network cut). Shown, not stored, so a late submit still lands.
                    status: a.status === 'in_progress' && isPastDeadline(a.started_at, test.duration_minutes) ? 'abandoned' : a.status,
                    name: u?.full_name || a.candidate_name || u?.email || a.candidate_email || 'Unknown',
                    email: u?.email || a.candidate_email || null,
                    from_public_link: !a.user_id,
                    events: (events || [])
                        .filter((e) => e.attempt_id === a.id && e.kind !== 'ai_ok')
                        .map((e) => {
                            const path = (e.detail as { evidence_path?: string } | null)?.evidence_path;
                            return { ...e, evidence_url: path ? signed.get(path) || null : null };
                        }),
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
            look_away_strikes: test.look_away_strikes,
            question_count: questions.length,
            sections,
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
