import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { COMPLETED_STATUSES, isPastDeadline } from '@/backend/lib/proctor/access';

/**
 * How many chances someone has at a test, shared by every place that asks:
 * starting, the public link's pre-check, the signed-in test page and the list.
 *
 * Chances count from the attempts made after HR's last reset (or all of them,
 * if HR never reset), plus one for every extra chance HR granted since.
 * A signed-in member is known by user id, a candidate by the email on the test.
 */

export type Identity =
    | { kind: 'user'; userId: string }
    | { kind: 'candidate'; name: string; email: string };

/** A test page that went silent (crash, power, network) can pick up where it was for this long. */
export const RESUME_GRACE_MS = 5 * 60_000;
/**
 * A page heard from more recently than this is still open (the heartbeat is every 20s). Resuming
 * it would hand a live test to whoever asked, so it is refused instead — wait a moment and retry.
 */
export const LIVE_WINDOW_MS = 45_000;

export interface AttemptRow {
    id: string;
    status: string;
    attempt_no: number;
    termination_reason: string | null;
    started_at: string;
    last_seen_at: string | null;
    answers: Record<string, unknown> | null;
    question_order: unknown;
    resume_count: number;
}

export interface GrantRow {
    kind: string;
    created_at: string;
}

/** Enough to count chances; lists use this so they don't pull every attempt's answers. */
export const STANDING_COLUMNS = 'id, status, attempt_no, termination_reason, started_at, last_seen_at, resume_count';
/** Plus what resuming needs. */
export const ATTEMPT_COLUMNS = `${STANDING_COLUMNS}, answers, question_order`;

export function standingFrom(
    attempts: AttemptRow[],
    grants: GrantRow[],
    test: { max_attempts: number; duration_minutes: number },
) {
    const resetAt = grants
        .filter((g) => g.kind === 'reset')
        .reduce<string | null>((latest, g) => (!latest || g.created_at > latest ? g.created_at : latest), null);
    const counts = (at: string) => !resetAt || new Date(at).getTime() > new Date(resetAt).getTime();

    const active = attempts.filter((a) => counts(a.started_at)).sort((a, b) => a.started_at.localeCompare(b.started_at));
    const extra = grants.filter((g) => g.kind === 'extra_chance' && counts(g.created_at)).length;
    const allowed = (test.max_attempts || 1) + extra;
    const inProgress = active.filter((a) => a.status === 'in_progress');
    const silentFor = (a: AttemptRow) => Date.now() - new Date(a.last_seen_at || a.started_at).getTime();
    const withinTime = (a: AttemptRow) => !isPastDeadline(a.started_at, test.duration_minutes);
    // Still open somewhere: never resumed or closed from another start.
    const live = inProgress.find((a) => withinTime(a) && silentFor(a) < LIVE_WINDOW_MS) || null;
    const resumable = live ? null : inProgress.find((a) => withinTime(a) && silentFor(a) <= RESUME_GRACE_MS) || null;
    const last = active[active.length - 1];

    return {
        active,
        allowed,
        used: active.length,
        // A resumable attempt is carried on, not restarted, so it costs nothing more.
        left: Math.max(0, allowed - active.length),
        completed: active.some((a) => COMPLETED_STATUSES.includes(a.status)),
        inProgress,
        live,
        resumable,
        lastReason: last?.termination_reason || null,
        nextAttemptNo: Math.max(0, ...attempts.map((a) => a.attempt_no || 0)) + 1,
    };
}

export type Standing = ReturnType<typeof standingFrom>;

export async function loadStanding(
    test: { id: string; max_attempts: number; duration_minutes: number },
    identity: Identity,
): Promise<Standing> {
    let attemptQuery = supabaseAdmin.from('proctor_attempts').select(ATTEMPT_COLUMNS).eq('test_id', test.id);
    let grantQuery = supabaseAdmin.from('proctor_grants').select('kind, created_at').eq('test_id', test.id);
    if (identity.kind === 'user') {
        attemptQuery = attemptQuery.eq('user_id', identity.userId);
        grantQuery = grantQuery.eq('user_id', identity.userId);
    } else {
        // Exact match: emails are stored lower-cased, and ilike would treat _ and % as wildcards.
        attemptQuery = attemptQuery.eq('candidate_email', identity.email.trim().toLowerCase());
        grantQuery = grantQuery.eq('candidate_email', identity.email.trim().toLowerCase());
    }
    const [attempts, grants] = await Promise.all([attemptQuery, grantQuery]);
    // Fail closed: an empty answer here would hand out fresh chances.
    if (attempts.error || grants.error) throw new Error(`Could not read chances: ${(attempts.error || grants.error)?.message}`);
    return standingFrom((attempts.data || []) as AttemptRow[], (grants.data || []) as GrantRow[], test);
}
