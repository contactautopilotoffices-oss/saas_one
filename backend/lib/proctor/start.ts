import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { type ProctorAnswer, type ProctorQuestion } from '@/backend/lib/proctor/access';
import { loadStanding, type Identity } from '@/backend/lib/proctor/chances';
import { buildOrder, presentQuestions, toShownAnswers } from '@/backend/lib/proctor/order';
import { grade } from '@/backend/lib/proctor/grade';

export type { Identity } from '@/backend/lib/proctor/chances';

/**
 * Opening an attempt, shared by the signed-in route and the public link.
 *
 * Chances: leaving the page uses one; a submitted attempt ends the test. HR can
 * add a chance or reset someone's attempts (see chances.ts).
 *
 * Resume: an attempt still "in progress" whose page went silent less than
 * 5 minutes ago (crash, power cut, lost network — the page never reported
 * leaving) is picked up where it was: same questions in the same order, saved
 * answers back, the clock still running from the original start. The secret
 * is rotated, so the old page can no longer write to it. A page heard from in
 * the last 45s is still open, so starting again is refused rather than taking
 * it over. An attempt silent for longer than 5 minutes counts as left — it is closed as
 * "reopened" and uses its chance.
 *
 * A signed-in person is counted by user id. From the public link there is no
 * account, so they are counted by the email they typed. Someone can type a
 * different email to get more chances; that is the price of no sign-in, and
 * the reviewer sees every attempt either way.
 */

export interface StartableTest {
    id: string;
    organization_id: string;
    is_active: boolean;
    questions: ProctorQuestion[];
    sections: unknown;
    duration_minutes: number;
    ai_monitoring: boolean;
    max_attempts: number;
    look_away_strikes: number;
    shuffle: boolean;
}

export type StartOutcome =
    | { error: string; status: number }
    | {
          attempt_id: string;
          attempt_token: string;
          attempt_no: number;
          max_attempts: number;
          look_away_strikes: number;
          started_at: string;
          duration_minutes: number;
          remaining_seconds: number;
          ai_monitoring: boolean;
          questions: ReturnType<typeof presentQuestions>;
          resumed: boolean;
          answers: Record<string, ProctorAnswer>;
      };

function remainingSeconds(startedAt: string, durationMinutes: number) {
    return Math.max(0, Math.round((new Date(startedAt).getTime() + durationMinutes * 60_000 - Date.now()) / 1000));
}

export async function openAttempt(test: StartableTest, identity: Identity): Promise<StartOutcome> {
    if (!test.is_active) return { error: 'This test is not open', status: 404 };

    const standing = await loadStanding(test, identity);
    const questions = test.questions || [];

    if (standing.completed) {
        return { error: 'You have already completed this test', status: 409 };
    }

    // Open right now in another window or device. Taking it over would lock that page out
    // (and hand the test to anyone who typed the right email), so wait for it to go quiet.
    if (standing.live) {
        return { error: 'This test is already open in another window or device. If your browser closed, wait a minute and open the link again.', status: 409 };
    }

    if (standing.resumable) {
        const a = standing.resumable;
        const now = new Date().toISOString();
        const { data: resumed } = await supabaseAdmin
            .from('proctor_attempts')
            .update({
                attempt_token: crypto.randomUUID().replace(/-/g, ''),
                last_seen_at: now,
                resume_count: (a.resume_count || 0) + 1,
            })
            .eq('id', a.id)
            .eq('status', 'in_progress')
            .select('id, attempt_token, attempt_no, started_at')
            .maybeSingle();
        if (resumed) {
            const gapSeconds = Math.round((Date.now() - new Date(a.last_seen_at || a.started_at).getTime()) / 1000);
            await supabaseAdmin.from('proctor_events').insert({ attempt_id: a.id, kind: 'resumed', detail: { gap_seconds: gapSeconds, at: now } });
            return {
                attempt_id: resumed.id,
                attempt_token: resumed.attempt_token,
                attempt_no: resumed.attempt_no,
                max_attempts: standing.allowed,
                look_away_strikes: test.look_away_strikes || 3,
                started_at: resumed.started_at,
                duration_minutes: test.duration_minutes,
                remaining_seconds: remainingSeconds(resumed.started_at, test.duration_minutes),
                ai_monitoring: test.ai_monitoring,
                questions: presentQuestions(questions, a.question_order),
                resumed: true,
                answers: toShownAnswers(questions, a.question_order, a.answers || {}),
            };
        }
        // It ended a moment ago (a late violation report won the race); start fresh below.
    }

    const stale = standing.inProgress;
    if (stale.length) {
        const now = new Date().toISOString();
        // Each keeps a partial score from its last autosave.
        await Promise.all(stale.map((a) => supabaseAdmin
            .from('proctor_attempts')
            .update({ status: 'terminated', termination_reason: 'reopened', ...grade(questions, (a.answers || {}) as Record<string, number>), ended_at: now })
            .eq('id', a.id)
            .eq('status', 'in_progress')));
        await supabaseAdmin.from('proctor_events').insert(
            stale.map((a) => ({ attempt_id: a.id, kind: 'reopened', detail: { at: now } })),
        );
    }

    if (standing.used >= standing.allowed) {
        return {
            error: standing.allowed === 1
                ? 'You have used your only chance at this test'
                : `You have used all ${standing.allowed} chances at this test`,
            status: 409,
        };
    }

    const order = buildOrder(questions, test.sections, test.shuffle !== false);
    const { data: attempt, error } = await supabaseAdmin
        .from('proctor_attempts')
        .insert({
            test_id: test.id,
            organization_id: test.organization_id,
            attempt_no: standing.nextAttemptNo,
            question_order: order,
            last_seen_at: new Date().toISOString(),
            ...(identity.kind === 'user'
                ? { user_id: identity.userId }
                : { candidate_name: identity.name, candidate_email: identity.email }),
        })
        .select('id, started_at, attempt_no, attempt_token')
        .single();

    if (error) {
        if (error.code === '23505') return { error: 'This test was just started in another window', status: 409 };
        console.error('[proctor] could not open an attempt:', error.message);
        return { error: 'Could not start the test. Please try again.', status: 500 };
    }

    return {
        attempt_id: attempt.id,
        attempt_token: attempt.attempt_token,
        attempt_no: attempt.attempt_no,
        max_attempts: standing.allowed,
        look_away_strikes: test.look_away_strikes || 3,
        started_at: attempt.started_at,
        duration_minutes: test.duration_minutes,
        remaining_seconds: remainingSeconds(attempt.started_at, test.duration_minutes),
        ai_monitoring: test.ai_monitoring,
        questions: presentQuestions(questions, order),
        resumed: false,
        answers: {},
    };
}

const TEST_START_COLUMNS =
    'id, organization_id, is_active, questions, sections, duration_minutes, ai_monitoring, max_attempts, look_away_strikes, shuffle';

export async function loadTestById(id: string) {
    const { data } = await supabaseAdmin.from('proctor_tests').select(TEST_START_COLUMNS).eq('id', id).maybeSingle();
    return data as StartableTest | null;
}

export async function loadTestByPublicToken(token: string) {
    const { data } = await supabaseAdmin.from('proctor_tests').select(TEST_START_COLUMNS).eq('public_token', token).maybeSingle();
    return data as StartableTest | null;
}
