import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveProctorAccess, isProctorAccessError, isPastDeadline, resolveSections,
    EVIDENCE_BUCKET, type ProctorQuestion, type ProctorSection,
} from '@/backend/lib/proctor/access';
import { loadStanding, standingFrom, type AttemptRow, type GrantRow } from '@/backend/lib/proctor/chances';
import { parseTestBody } from '@/backend/lib/proctor/testBody';
import { removeEvidence } from '@/backend/lib/proctor/cleanup';

const TEST_COLUMNS =
    'id, organization_id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, look_away_strikes, shuffle, public_token, sections, questions, created_at';

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
        // Whether anyone has started decides what the editor lets HR change.
        const { count } = await supabaseAdmin.from('proctor_attempts').select('id', { count: 'exact', head: true }).eq('test_id', id);
        return NextResponse.json({ test: { ...test, questions, sections, stored_sections: test.sections || [] }, attempt_count: count || 0 });
    }

    if (view === 'results') {
        const { data: attempts } = await supabaseAdmin
            .from('proctor_attempts')
            .select('id, user_id, candidate_name, candidate_email, attempt_no, status, started_at, ended_at, termination_reason, score, total, section_scores, ai_checks, ai_flags, last_seen_at, resume_count')
            .eq('test_id', id)
            .order('started_at', { ascending: false });

        const attemptIds = (attempts || []).map((a) => a.id);
        const userIds = [...new Set((attempts || []).map((a) => a.user_id).filter(Boolean))] as string[];
        const [{ data: events }, { data: users }, { data: grants }] = await Promise.all([
            attemptIds.length
                ? supabaseAdmin.from('proctor_events').select('attempt_id, kind, detail, created_at').in('attempt_id', attemptIds).order('created_at')
                : Promise.resolve({ data: [] }),
            userIds.length
                ? supabaseAdmin.from('users').select('id, full_name, email').in('id', userIds)
                : Promise.resolve({ data: [] }),
            supabaseAdmin.from('proctor_grants').select('user_id, candidate_email, kind, created_at').eq('test_id', id),
        ]);

        // Each person's chances now, so HR knows whether to add one or reset.
        const personKey = (a: { user_id: string | null; candidate_email: string | null }) =>
            a.user_id ? `u:${a.user_id}` : `e:${(a.candidate_email || '').toLowerCase()}`;
        const standingFor = (key: string) => {
            const standing = standingFrom(
                (attempts || []).filter((a) => personKey(a) === key) as unknown as AttemptRow[],
                (grants || []).filter((g) => personKey(g) === key) as GrantRow[],
                test,
            );
            return { allowed: standing.allowed, used: standing.used, left: standing.left, completed: standing.completed };
        };

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
                    standing: standingFor(personKey(a)),
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

    const standing = await loadStanding(test, { kind: 'user', userId: access.userId });
    const mine = standing.active.map((a) => ({ attempt_no: a.attempt_no, status: a.status, termination_reason: a.termination_reason }));
    const maxAttempts = standing.allowed;

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
        completed: standing.completed,
        // An in-progress attempt is either resumed or closed as "reopened" on start, so it already counts.
        chances_left: standing.resumable || standing.live ? Math.max(1, standing.left) : standing.left,
        resumable: !!(standing.resumable || standing.live),
    });
}

/**
 * DELETE /api/proctor/tests/[id] — delete a test with everything under it:
 * results (attempts), proctoring logs and HR grants cascade with it, and the
 * kept camera frames are removed from storage. Authors only. The page warns
 * first when the test has results.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: test } = await supabaseAdmin.from('proctor_tests').select('organization_id').eq('id', id).maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: attempts } = await supabaseAdmin.from('proctor_attempts').select('id').eq('test_id', id);
    await removeEvidence((attempts || []).map((a) => a.id));

    const { error } = await supabaseAdmin.from('proctor_tests').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/proctor/tests/[id]
 *   - Body: { is_active } — open or close a test.
 *   - Body: the whole test, as for create — edit it. Until anyone has started,
 *     everything can change. After that, only what nobody is scored on: title,
 *     instructions, chances, camera warnings, shuffle, and the wording of
 *     existing sections. Questions, time limit and camera checks stay
 *     as they were, so every candidate sat the same test ("Duplicate and edit"
 *     makes a new test for that).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { data: test } = await supabaseAdmin.from('proctor_tests').select('organization_id, sections').eq('id', id).maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (Object.keys(body).length === 1 && 'is_active' in body) {
        const { error } = await supabaseAdmin.from('proctor_tests').update({ is_active: !!body.is_active }).eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    const parsed = parseTestBody(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { count } = await supabaseAdmin.from('proctor_attempts').select('id', { count: 'exact', head: true }).eq('test_id', id);
    const locked = (count || 0) > 0;

    const f = parsed.fields;
    const update = locked
        ? {
            title: f.title,
            instructions: f.instructions,
            max_attempts: f.max_attempts,
            look_away_strikes: f.look_away_strikes,
            shuffle: f.shuffle,
            sections: ((test.sections || []) as ProctorSection[]).map((s) => {
                const edited = f.sections.find((x) => x.key === s.key);
                return edited ? { ...s, title: edited.title, description: edited.description } : s;
            }),
        }
        : f;

    const { error } = await supabaseAdmin.from('proctor_tests').update({ ...update, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, locked });
}
