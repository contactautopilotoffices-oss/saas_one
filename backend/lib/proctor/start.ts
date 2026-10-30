import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { stripAnswers, COMPLETED_STATUSES, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * Opening an attempt, shared by the signed-in route and the public link.
 *
 * Chances: leaving the page uses one; a submitted attempt ends the test. An
 * attempt still "in progress" when the test is opened again (crashed browser,
 * second tab) counts as left — it is closed as "reopened" and uses its chance.
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
    duration_minutes: number;
    ai_monitoring: boolean;
    max_attempts: number;
    look_away_strikes: number;
}

export type Identity =
    | { kind: 'user'; userId: string }
    | { kind: 'candidate'; name: string; email: string };

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
          ai_monitoring: boolean;
          questions: ReturnType<typeof stripAnswers>;
      };

export async function openAttempt(test: StartableTest, identity: Identity): Promise<StartOutcome> {
    if (!test.is_active) return { error: 'This test is not open', status: 404 };

    let query = supabaseAdmin.from('proctor_attempts').select('id, status, attempt_no').eq('test_id', test.id);
    query = identity.kind === 'user'
        ? query.eq('user_id', identity.userId)
        : query.ilike('candidate_email', identity.email);

    const { data: previous } = await query;
    const mine = previous || [];

    if (mine.some((a) => COMPLETED_STATUSES.includes(a.status))) {
        return { error: 'You have already completed this test', status: 409 };
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
        return {
            error: maxAttempts === 1
                ? 'You have used your only chance at this test'
                : `You have used all ${maxAttempts} chances at this test`,
            status: 409,
        };
    }

    const attemptNo = Math.max(0, ...mine.map((a) => a.attempt_no || 0)) + 1;
    const { data: attempt, error } = await supabaseAdmin
        .from('proctor_attempts')
        .insert({
            test_id: test.id,
            organization_id: test.organization_id,
            attempt_no: attemptNo,
            ...(identity.kind === 'user'
                ? { user_id: identity.userId }
                : { candidate_name: identity.name, candidate_email: identity.email }),
        })
        .select('id, started_at, attempt_no, attempt_token')
        .single();

    if (error) {
        if (error.code === '23505') return { error: 'This test was just started in another window', status: 409 };
        return { error: error.message, status: 500 };
    }

    return {
        attempt_id: attempt.id,
        attempt_token: attempt.attempt_token,
        attempt_no: attempt.attempt_no,
        max_attempts: maxAttempts,
        look_away_strikes: test.look_away_strikes || 3,
        started_at: attempt.started_at,
        duration_minutes: test.duration_minutes,
        ai_monitoring: test.ai_monitoring,
        questions: stripAnswers(test.questions || []),
    };
}

const TEST_START_COLUMNS =
    'id, organization_id, is_active, questions, duration_minutes, ai_monitoring, max_attempts, look_away_strikes';

export async function loadTestById(id: string) {
    const { data } = await supabaseAdmin.from('proctor_tests').select(TEST_START_COLUMNS).eq('id', id).maybeSingle();
    return data as StartableTest | null;
}

export async function loadTestByPublicToken(token: string) {
    const { data } = await supabaseAdmin.from('proctor_tests').select(TEST_START_COLUMNS).eq('public_token', token).maybeSingle();
    return data as StartableTest | null;
}
