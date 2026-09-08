/**
 * CHECK — how much pending spend has nobody to approve it?
 * -----------------------------------------------------------------------------
 * The complement of approvalQueueAging, and the more dangerous half. That check
 * asks how long a named person has been sitting on an order. This one asks about
 * the orders that were never handed to anybody: no row in po_workflow_state at
 * all, or a row whose assigned_spoc is null.
 *
 * An order with a slow approver eventually gets chased, because there is
 * somebody to chase. An order with no approver is chased by nobody and shows up
 * nowhere — it is not late, it is not anyone's, and it will still be sitting
 * there next quarter. Every escalation path in this app starts from
 * assigned_spoc, so a null there means the order is outside the process
 * entirely, not merely behind in it.
 *
 * ONE FINDING FOR THE WHOLE SET, deliberately. A hundred unowned orders is one
 * decision — who owns this queue — and a hundred findings would bury the four
 * that this scan found real money in.
 *
 * Structural: nothing about an unowned order changes overnight, so it is true
 * every morning until somebody is named. Weekly and slower, like its sibling.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: how many pending orders, and how much money,
 *                   have no owner at all                                     [BAA p.104]
 *   Tools           none — one SELECT on po_workflow_state, joined in memory
 *                   to the POs the scan already holds. No model call         [BAA p.94]
 *   Failure mode    a missing table or failed query returns `skipped` with the
 *                   reason. It must NEVER read an unreadable table as "every
 *                   order is unowned" — that would raise the largest finding
 *                   this agent can emit off the back of a broken query       [BAA p.94]
 *   Memory          none — re-derived every run                              [BAA p.103]
 *   Evaluation      count, value and age all trace to columns; the age uses
 *                   raisedAt(), the moment the order was raised, never our
 *                   sync timestamp                                           [BAA p.95]
 *   Known deviation the finding key is `orphaned-approvals:pending`, not the
 *                   bare check id, so the digest cron's singleton auto-close
 *                   (which matches keys exactly) will not touch it. That is on
 *                   purpose: this check skips on daily cadences, so a daily run
 *                   would see the key absent and close a line that is still
 *                   perfectly true. A stale open line costs less than a
 *                   silently closed one.                                     [BAA p.96]
 */

import type { Check, CheckContext, CheckOutcome, PoRow } from './contract';
import { inr, num, raisedAt, shortDate, siteName } from './contract';
import { PENDING_APPROVAL, loadWorkflowState, oldestFirst, waitingDays } from './approvalQueueAging';
import type { Evidence, Finding } from '../types';

/** Past this the queue is not slow, it is abandoned, and the finding says so. */
const ABANDONED_DAYS = 30;
/** Unowned spend above this is a critical line however new it is. */
const CRITICAL_INR = 10_00_000;

export const orphanedApprovals: Check = {
    id: 'orphaned-approvals',
    question: 'How much pending spend has nobody assigned to approve it?',
    nature: 'structural',
    needs: ['pos', 'workflow'],

    async run(ctx: CheckContext): Promise<CheckOutcome> {
        // Structural: an unowned order is unowned every morning. A daily would be
        // the same paragraph, seven times a week.
        if (ctx.window && ctx.window.cadence === 'daily') {
            return { findings: [], skipped: 'structural — reported on weekly and slower cadences, not daily' };
        }

        const pending = ctx.live.filter((r) => String(r.status ?? '') === PENDING_APPROVAL);
        if (!pending.length) {
            return { findings: [], cleared: { looked: 0, unit: 'orders awaiting approval', note: 'nothing is waiting on an approval' } };
        }

        const { byPo, error } = await loadWorkflowState(ctx.orgId);
        // An unreadable table looks exactly like an empty one from here, and the
        // two produce opposite findings: "nobody owns ₹84L of orders" versus
        // nothing at all. Saying nothing is the only honest option.
        if (error) return { findings: [], skipped: `po_workflow_state unavailable: ${error}` };

        // No workflow row, or a row with a null spoc — both mean the same thing
        // to the person waiting: nobody has been asked to decide.
        const orphans: PoRow[] = pending.filter((r) => !byPo.get(r.id)?.assigned_spoc);
        const owned = pending.length - orphans.length;

        if (!orphans.length) {
            return {
                findings: [],
                cleared: { looked: pending.length, unit: 'orders awaiting approval', note: `all ${pending.length} are assigned to a named approver` },
            };
        }

        const total = orphans.reduce((s, r) => s + num(r.po_amount), 0);
        const ages = orphans.map((r) => waitingDays(ctx.asOf, r)).filter((d): d is number => d !== null);
        const oldest = ages.length ? Math.max(...ages) : null;
        const oldestPo = oldestFirst(orphans)[0];
        const aged = oldest === null ? 'an unknown time' : `${oldest} day${oldest === 1 ? '' : 's'}`;

        // The largest few, not the oldest: this finding is about money with no
        // owner, and the reader should see the biggest cheque nobody is holding.
        const evidence: Evidence[] = [...orphans]
            .sort((a, b) => num(b.po_amount) - num(a.po_amount))
            .slice(0, 5)
            .map((r) => {
                const d = waitingDays(ctx.asOf, r);
                return {
                    ref: ctx.poRef(r),
                    facts: [
                        `raised ${shortDate(raisedAt(r))}`,
                        inr(num(r.po_amount)),
                        d === null ? 'undated' : `waiting ${d} day${d === 1 ? '' : 's'}`,
                        r.vendor_name ?? '',
                        siteName(ctx, r) ?? '',
                        byPo.has(r.id) ? 'workflow row exists, no SPOC' : 'no workflow row',
                    ].filter(Boolean).join(' · '),
                };
            });

        const finding: Finding = {
            key: 'orphaned-approvals:pending',
            priority: total >= CRITICAL_INR || (oldest !== null && oldest >= ABANDONED_DAYS) ? 'critical' : 'action',
            title: `${orphans.length} orders worth ${inr(total)} are awaiting approval with nobody assigned`,
            vendor: null,
            property: null,
            amount: total,
            // Queued, not committed. Nothing has been billed and nothing is at
            // risk of leaving — the cost here is time and a stalled site.
            exposure: 'none',
            problem:
                `${orphans.length} of the ${pending.length} purchase orders in pending_approval have no approver: ` +
                `${owned ? `only ${owned} carry an assigned SPOC` : 'not one of them carries an assigned SPOC'}. ` +
                `Together they are worth ${inr(total)}, and the oldest — ${oldestPo.po_number ?? oldestPo.id} — has waited ${aged}.\n\n` +
                `Every reminder, escalation and queue view in this app starts from assigned_spoc. With it null, these orders are not late ` +
                `to anybody: no one is asked about them, no one is measured on them, and nothing in the system will ever raise them again.`,
            refs: evidence.map((e) => e.ref),
            evidence,
            reconcile: [{
                what: 'Orders awaiting approval vs orders with an owner',
                expected: String(pending.length),
                actual: String(owned),
                gap: `${orphans.length} with nobody assigned, ${inr(total)}`,
            }],
            counter:
                'The fair counter is that this org never adopted the in-app SPOC field and approvals are chased in person or on WhatsApp. ' +
                'That may well be true — but then the age of the oldest one is the evidence against it, and nothing in this app can chase them.',
            ask: `Assign an approver to the ${orphans.length} unowned pending orders, or say which of them should be cancelled outright.`,
            stats: [
                { label: 'Unowned', value: `${orphans.length} of ${pending.length}` },
                { label: 'Value', value: inr(total) },
                { label: 'Oldest', value: oldest === null ? 'undated' : `${oldest}d` },
            ],
            actions: [
                { recipient: 'procurement', action: `Assign a SPOC to each of the ${orphans.length} pending orders with no owner, largest first, and cancel any that are dead.`, deadline: 'This week' },
                { recipient: 'ceo', action: `Name who owns the approval queue for ${inr(total)} of pending spend, and by when it is cleared.`, deadline: 'This week' },
                { recipient: 'technical', action: 'Require an assigned SPOC when an order enters pending_approval, so a new order cannot join this queue unowned.', deadline: 'This sprint' },
            ],
        };

        return {
            findings: [finding],
            cleared: null,
            rejected: { 'already assigned to a named approver': owned },
        };
    },
};
