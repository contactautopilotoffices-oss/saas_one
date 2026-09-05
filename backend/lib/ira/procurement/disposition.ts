/**
 * DISPOSITION — the per-line-item answer that closes a finding.
 * -----------------------------------------------------------------------------
 * This is NOT "rate the agent". Nobody has time for that, and the person who
 * receives a summary is usually not the person who works the item.
 *
 * The distinction that matters:
 *
 *   WHO DOES THE WORK answers the line.   (procurement — Vidya, Sahil)
 *   WHO NEEDS THE DECISION reads status.  (CEO — Saniel)
 *
 * The loop must close even if the executive never clicks anything. So the
 * disposition control ships on the worker's email, and the executive's email
 * READS the same field: "already actioned by Vidya" rather than a to-do.
 *
 * ── DISPOSITION IS ALSO THE TRAINING SIGNAL ─────────────────────────────────
 * A separate "was this useful?" question would be a second thing to ask busy
 * people, and would be ignored. It is unnecessary: closing a line already says
 * what the agent needs to know.
 *
 *   not_an_issue  ->  the finding should not have been raised  ->  reject
 *   done          ->  it was real and worth surfacing          ->  praise
 *   blocked/need_info -> real, but the agent lacked context    ->  correction
 *
 * One click, two effects. See SIGNAL_FROM_DISPOSITION.
 */

import type { AgentFeedbackSignal } from '@/frontend/types/agentRuntime';

/** Mirrors the CHECK on oem_agent_findings.disposition. */
export type Disposition = 'done' | 'not_an_issue' | 'in_progress' | 'blocked' | 'need_info';

export const DISPOSITIONS: readonly Disposition[] = [
    'done', 'not_an_issue', 'in_progress', 'blocked', 'need_info',
] as const;

export function isDisposition(v: string): v is Disposition {
    return (DISPOSITIONS as readonly string[]).includes(v);
}

export interface DispositionSpec {
    value: Disposition;
    /** Button label in the email. Imperative and short — this is a phone tap. */
    label: string;
    /** One line under the label. */
    hint: string;
    /** Closes the line: it will not be re-raised while this stands. */
    closes: boolean;
    /** A note is mandatory — the answer is meaningless without it. */
    requiresNote: boolean;
    /** What this teaches the agent. Null when it teaches nothing. */
    signal: AgentFeedbackSignal | null;
}

export const DISPOSITION_SPECS: Record<Disposition, DispositionSpec> = {
    done: {
        value: 'done',
        label: 'Done',
        hint: 'Actioned — credit note raised, PO corrected, or otherwise settled',
        closes: true,
        requiresNote: false,
        // It was real and worth raising. That is the praise signal, earned rather
        // than asked for.
        signal: 'praise',
    },
    not_an_issue: {
        value: 'not_an_issue',
        label: 'Not an issue',
        hint: 'Should not have been raised — say why so it stops recurring',
        closes: true,
        // Without the reason this is just noise suppression; with it, the agent
        // can stop raising the whole class.
        requiresNote: true,
        signal: 'reject',
    },
    in_progress: {
        value: 'in_progress',
        label: 'Working on it',
        hint: 'Picked up — keep it on the list but stop escalating',
        closes: false,
        requiresNote: false,
        signal: null,
    },
    blocked: {
        value: 'blocked',
        label: 'Blocked',
        hint: 'Cannot proceed — name what is blocking it',
        closes: false,
        requiresNote: true,
        signal: 'correction',
    },
    need_info: {
        value: 'need_info',
        label: 'Need more from the agent',
        hint: 'The finding is missing something you need to act',
        closes: false,
        requiresNote: true,
        signal: 'correction',
    },
};

/** What a disposition teaches the agent, or null. */
export function signalFor(d: Disposition): AgentFeedbackSignal | null {
    return DISPOSITION_SPECS[d].signal;
}

/** True when this disposition closes the line for future scans. */
export function closesLine(d: Disposition): boolean {
    return DISPOSITION_SPECS[d].closes;
}

/**
 * How a finding's current state reads to someone who is NOT going to action it.
 * This is what the executive email renders instead of a button.
 */
export interface DispositionStatus {
    disposition: Disposition | null;
    by: string | null;
    at: string | null;
    note: string | null;
}

export function statusLine(s: DispositionStatus | undefined): string | null {
    if (!s || !s.disposition) return null;
    const spec = DISPOSITION_SPECS[s.disposition];
    const who = s.by ? ` by ${s.by}` : '';
    const when = s.at ? ` · ${s.at}` : '';
    return `${spec.label}${who}${when}`;
}
