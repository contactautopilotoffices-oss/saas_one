/**
 * ACTION ORCHESTRATOR — one finding, N recipients, only what each must do.
 * -----------------------------------------------------------------------------
 * The rule this file exists to enforce:
 *
 *   DO NOT send one common accountability email to the whole team.
 *
 * A finding carries a per-recipient action list. This splits it, so the CEO sees
 * a decision, procurement sees an operational task, and technical sees nothing
 * at all unless there is genuinely something technical to do. A recipient with no
 * actions gets NO EMAIL — not an empty one, not a courtesy copy.
 *
 * Routing is deterministic and derived from `finding.actions[].recipient`, which
 * comes from a fixed enum. A model cannot add a recipient, and cannot cc anyone.
 */

import type { Finding, Priority, RecipientAction, RecipientKey } from './types';

export interface RecipientProfile {
    key: RecipientKey;
    /** Shown in the email header, e.g. "Decisions required". */
    lens: string;
    /** How the recipient is described in the subject line. */
    role: string;
    /**
     * Whether this recipient CLOSES lines, or only reads their status.
     *
     * The people who do the work answer the line; the executive reads what they
     * answered. An exec may never click anything and the loop must still close,
     * so the disposition control ships only where the work happens. Putting
     * buttons on an email nobody actions is how a feedback loop dies quietly.
     */
    canDisposition: boolean;
}

export const RECIPIENTS: Record<RecipientKey, RecipientProfile> = {
    ceo: {
        key: 'ceo', lens: 'Decisions required', role: 'CEO',
        // Reads status. Saniel is not the one raising credit notes.
        canDisposition: false,
    },
    procurement: {
        key: 'procurement', lens: 'Actions required', role: 'Procurement',
        // Vidya, Sahil — the people who actually work these lines and close them.
        canDisposition: true,
    },
    technical: {
        key: 'technical', lens: 'Technical / data actions', role: 'Technical',
        canDisposition: true,
    },
};

/** A finding as it will appear for ONE recipient — with only their action on it. */
export interface RoutedFinding extends Omit<Finding, 'actions'> {
    /** Exactly the actions addressed to this recipient. Never empty. */
    actions: RecipientAction[];
}

export interface RecipientBundle {
    recipient: RecipientProfile;
    findings: RoutedFinding[];
    counts: {
        total: number;
        critical: number;
        action: number;
        watch: number;
        closed: number;
        /** Rupee exposure across this recipient's non-closed findings. */
        exposure: number;
    };
}

const ORDER: Record<Priority, number> = { critical: 0, action: 1, watch: 2, closed: 3 };

/**
 * The one sort order for findings: severity, then money. Exported because the
 * site splitter re-sorts each slice and must not invent a second ordering — two
 * orderings in one email system is how "why is this one first?" starts.
 */
export function ORDER_BY_PRIORITY(a: RoutedFinding, b: RoutedFinding): number {
    return ORDER[a.priority] - ORDER[b.priority] || (b.amount ?? 0) - (a.amount ?? 0);
}

/** Counts for an arbitrary slice of findings. One definition of "exposure". */
export function countsFor(list: ReadonlyArray<RoutedFinding>): RecipientBundle['counts'] {
    return {
        total: list.length,
        critical: list.filter((f) => f.priority === 'critical').length,
        action: list.filter((f) => f.priority === 'action').length,
        watch: list.filter((f) => f.priority === 'watch').length,
        closed: list.filter((f) => f.priority === 'closed').length,
        exposure: list
            .filter((f) => f.priority !== 'closed')
            .reduce((sum, f) => sum + (f.amount ?? 0), 0),
    };
}

/**
 * Split findings into one bundle per recipient who actually has something to do.
 *
 * Recipients with zero actions are OMITTED from the result — the caller cannot
 * accidentally send them an empty digest, because there is no bundle to send.
 */
export function routeFindings(findings: ReadonlyArray<Finding>): RecipientBundle[] {
    const bundles = new Map<RecipientKey, RoutedFinding[]>();

    for (const finding of findings) {
        for (const key of Object.keys(RECIPIENTS) as RecipientKey[]) {
            const mine = finding.actions.filter((a) => a.recipient === key);
            if (!mine.length) continue;
            const list = bundles.get(key) ?? [];
            list.push({ ...finding, actions: mine });
            bundles.set(key, list);
        }
    }

    const out: RecipientBundle[] = [];
    for (const [key, list] of bundles) {
        list.sort(ORDER_BY_PRIORITY);
        out.push({ recipient: RECIPIENTS[key], findings: list, counts: countsFor(list) });
    }

    // Stable order: CEO, procurement, technical.
    const rank: RecipientKey[] = ['ceo', 'procurement', 'technical'];
    out.sort((a, b) => rank.indexOf(a.recipient.key) - rank.indexOf(b.recipient.key));
    return out;
}
