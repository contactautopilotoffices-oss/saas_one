/**
 * CHECK — which orders are sitting with someone, and for how long?
 * -----------------------------------------------------------------------------
 * An order in `pending_approval` is a site that cannot buy and a vendor holding
 * a quote open. It is not a duplicate and nothing is wrong with it — it is
 * simply waiting on one person, and nobody is counting the days.
 *
 * The queue is invisible today because the two halves live in different tables:
 * Zoho holds the status, and po_workflow_state holds who it was handed to. Neither
 * side alone can say "Abhiram has nine of these and the oldest is six weeks old",
 * which is the only sentence that makes anyone act.
 *
 * Structural, not an event: an order does not stop waiting because a window
 * moved. It is true every morning until the person decides, so it belongs to the
 * weekly and slower runs where "still true" is the point — a daily would just be
 * the same list, read back at the same people.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: per person, how many orders await their
 *                   approval and how long has the oldest waited              [BAA p.104]
 *   Tools           none — two SELECTs (po_workflow_state, users) joined in
 *                   memory against the POs the scan already holds. No model
 *                   call anywhere; every figure is a column                  [BAA p.94]
 *   Failure mode    a missing table or a failed query returns `skipped` with
 *                   the reason. It never returns an empty `cleared`, because
 *                   "nobody is sitting on anything" and "I could not read the
 *                   queue" must never render the same                        [BAA p.94]
 *   Memory          none — re-derived from the two tables every run          [BAA p.103]
 *   Evaluation      counts, sums and ages all trace to columns; the age is
 *                   measured from raisedAt(), the moment the business raised
 *                   the order, never from our sync timestamp                 [BAA p.95]
 *   Known deviation the finding key carries the holder's user id, so it is a
 *                   per-person key and NOT the bare check id. That excludes it
 *                   from the singleton auto-close in the digest cron, which
 *                   matches on exact keys — a person who clears their tray has
 *                   their line closed by a human, not automatically. Naming
 *                   them is worth more than the auto-close.                  [BAA p.96]
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { Check, CheckContext, CheckOutcome, PoRow } from './contract';
import { inr, num, raisedAt, shortDate, siteName } from './contract';
import type { Evidence, Finding } from '../types';

/** Zoho's word for an order that is waiting on a human decision. */
export const PENDING_APPROVAL = 'pending_approval';

/** Past this, an approval is not slow — it is stuck, and reads as critical. */
const STUCK_DAYS = 30;
/** Under a week in someone's tray is a working queue, not a finding worth shouting. */
const SLOW_DAYS = 7;

/**
 * One row of po_workflow_state. This table exists because
 * zoho_purchase_orders is fully overwritten every two hours by the Books sync
 * (see 20260801000001_po_workflow_state.sql), so who an order was handed to
 * cannot be stored on the order itself — it would be clobbered.
 */
export interface WorkflowRow {
    po_id: string;
    assigned_spoc: string | null;
    ops_review_status: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/**
 * Every workflow row for the org, keyed by purchase-order id.
 *
 * Returns the error text rather than throwing, and rather than an empty map:
 * an empty map means "no order has been handed to anyone", which is a real and
 * reportable state, while an error means we cannot see the queue at all. A
 * caller that cannot tell those apart will eventually report a broken table as
 * good news. Shared with orphanedApprovals so one scan holds one shape of this
 * table, not two that can drift.
 */
export async function loadWorkflowState(orgId: string): Promise<{ byPo: Map<string, WorkflowRow>; error?: string }> {
    const byPo = new Map<string, WorkflowRow>();
    try {
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseAdmin
                .from('po_workflow_state')
                .select('po_id, assigned_spoc, ops_review_status, created_at, updated_at')
                .eq('organization_id', orgId)
                .range(from, from + 999);
            if (error) return { byPo, error: error.message };
            if (!data?.length) break;
            for (const r of data as WorkflowRow[]) byPo.set(String(r.po_id), r);
            if (data.length < 1000) break;
        }
    } catch (e) {
        return { byPo, error: e instanceof Error ? e.message : String(e) };
    }
    return { byPo };
}

/**
 * Whole days an order has been waiting, measured from when the BUSINESS raised
 * it — raisedAt(), which reads Zoho's own created_time.
 *
 * Never the row's created_at. 5,265 of this org's orders carry
 * created_at = 2026-07-31, the day of the backfill, so an age taken from it
 * would tell an executive that a six-month-old order is a week old. That
 * mistake has already shipped once (see contract.ts:raisedAt) and this is the
 * same trap wearing a different hat.
 */
export function waitingDays(asOf: Date, po: PoRow): number | null {
    const at = raisedAt(po);
    if (!at) return null;
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((asOf.getTime() - t) / 86_400_000));
}

/** Oldest first, by when the order was raised. Undated orders sort last. */
export function oldestFirst(rows: ReadonlyArray<PoRow>): PoRow[] {
    return [...rows].sort((a, b) => {
        const ta = Date.parse(raisedAt(a) ?? '');
        const tb = Date.parse(raisedAt(b) ?? '');
        return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
    });
}

/** "Abhiram Kumar" -> "Abhiram". The ask reads as a sentence, not a directory entry. */
function firstName(full: string): string {
    return full.trim().split(/\s+/)[0] || full.trim();
}

export const approvalQueueAging: Check = {
    id: 'approval-queue-aging',
    question: 'Which orders are sitting with someone for approval, and for how long?',
    nature: 'structural',
    needs: ['pos', 'workflow'],

    async run(ctx: CheckContext): Promise<CheckOutcome> {
        // Structural: true every morning until the person decides. Reporting it
        // daily is nagging the same people with the same list.
        /**
         * A STANDING CONDITION IS REPORTED EVERY DAY, under its own heading.
         *
         * This used to bail out on the daily cadence, on the reasoning that a
         * thing which is true every morning is nagging. The result was a daily
         * scan that went out EMPTY while 109 orders worth ₹84 lakh sat with no
         * approver — the reader learned nothing, and read the silence as "all
         * clear". The nagging was never the daily repetition; it was printing a
         * standing condition as though it had just happened. The runner marks
         * these `section: 'standing'` and the mail prints them apart from
         * today's news, which is what makes the repetition honest.
         */

        const pending = ctx.live.filter((r) => String(r.status ?? '') === PENDING_APPROVAL);
        if (!pending.length) {
            return { findings: [], cleared: { looked: 0, unit: 'orders awaiting approval', note: 'nothing is waiting on an approval' } };
        }

        const { byPo, error } = await loadWorkflowState(ctx.orgId);
        // Without the assignment table there is no "with someone". Reporting an
        // empty queue here would say every approval is moving, which is the one
        // thing we do not know.
        if (error) return { findings: [], skipped: `po_workflow_state unavailable: ${error}` };

        const held = new Map<string, PoRow[]>();
        let unowned = 0;
        for (const po of pending) {
            const spoc = byPo.get(po.id)?.assigned_spoc ?? null;
            // No owner is a real problem, but it is orphanedApprovals' question.
            // Two checks reporting the same order twice is how a reader learns to
            // skim the mail.
            if (!spoc) { unowned++; continue; }
            held.set(spoc, [...(held.get(spoc) ?? []), po]);
        }

        if (!held.size) {
            return {
                findings: [],
                cleared: {
                    looked: pending.length,
                    unit: 'orders awaiting approval',
                    note: `none of the ${pending.length} is assigned to a named person — ownership is the orphaned-approvals check's question, not this one`,
                },
                rejected: { 'awaiting approval with nobody assigned': unowned },
            };
        }

        // Resolve the holders to human names. The finding's entire ask is
        // addressed to a named person, so a failed lookup is a skip and not a
        // finding that says "user 644a2e33 is holding nine orders".
        const ids = [...held.keys()];
        const { data: users, error: userErr } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', ids.slice(0, 500));
        if (userErr) return { findings: [], skipped: `could not resolve approvers to names: ${userErr.message}` };

        const nameOf = new Map<string, string>();
        for (const u of users ?? []) {
            const label = String(u.full_name ?? '').trim() || String(u.email ?? '').trim();
            if (label) nameOf.set(String(u.id), label);
        }

        const findings: Finding[] = [];
        let unnamed = 0;

        for (const [spoc, rows] of held) {
            const name = nameOf.get(spoc);
            // A spoc id with no user row is a deleted account still holding a
            // queue. Real, but it is a data-integrity story with no one to ask,
            // so it is counted and not raised as somebody's backlog.
            if (!name) { unnamed += rows.length; continue; }

            const ordered = oldestFirst(rows);
            const total = rows.reduce((s, r) => s + num(r.po_amount), 0);
            const ages = rows.map((r) => waitingDays(ctx.asOf, r)).filter((d): d is number => d !== null);
            const oldest = ages.length ? Math.max(...ages) : null;
            const oldestPo = ordered[0];

            const evidence: Evidence[] = ordered.slice(0, 5).map((r) => {
                const d = waitingDays(ctx.asOf, r);
                const stage = byPo.get(r.id)?.ops_review_status;
                return {
                    ref: ctx.poRef(r),
                    facts: [
                        `raised ${shortDate(raisedAt(r))}`,
                        inr(num(r.po_amount)),
                        d === null ? 'undated' : `waiting ${d} day${d === 1 ? '' : 's'}`,
                        r.vendor_name ?? '',
                        siteName(ctx, r) ?? '',
                        // The stage says whether it is stuck before ops review or
                        // after it — a different conversation with a different person.
                        stage ? `ops review ${stage}` : '',
                    ].filter(Boolean).join(' · '),
                };
            });

            const aged = oldest === null ? 'an unknown time' : `${oldest} day${oldest === 1 ? '' : 's'}`;
            const who = firstName(name);

            findings.push({
                // Per person and stable: the same holder produces the same key
                // next week, so an answer given once carries forward.
                key: `approval-queue-aging:${spoc}`,
                priority: oldest !== null && oldest >= STUCK_DAYS ? 'critical' : oldest !== null && oldest >= SLOW_DAYS ? 'action' : 'watch',
                title: `${name} is holding ${rows.length} order${rows.length === 1 ? '' : 's'} awaiting approval — the oldest for ${aged}`,
                vendor: null,
                property: null,
                amount: total,
                // Nothing has been committed: this money is queued, not exposed.
                exposure: 'none',
                problem:
                    `${rows.length} purchase order${rows.length === 1 ? ' is' : 's are'} assigned to ${name} and still in pending_approval, ` +
                    `worth ${inr(total)} together. The oldest — ${oldestPo.po_number ?? oldestPo.id} — was raised on ` +
                    `${shortDate(raisedAt(oldestPo))} and has waited ${aged}.\n\n` +
                    `Nothing moves until each is approved or sent back: the site cannot place the order and the vendor is holding a quote ` +
                    `that ages. The wait is invisible in Zoho, which shows a status and not a clock.`,
                refs: evidence.map((e) => e.ref),
                evidence,
                counter:
                    'The fair counter is that some of these are parked on purpose — waiting on a revised quote, a budget line that opens next month, ' +
                    'or a site decision. That is a legitimate answer, and it belongs written on the order rather than left as silence.',
                ask: `Clear or send back the ${rows.length} order${rows.length === 1 ? '' : 's'} sitting with ${who} — the oldest has waited ${aged}.`,
                stats: [
                    { label: 'Orders', value: String(rows.length) },
                    { label: 'Value', value: inr(total) },
                    { label: 'Oldest', value: oldest === null ? 'undated' : `${oldest}d` },
                ],
                actions: [
                    { recipient: 'procurement', action: `Approve or return the ${rows.length} order${rows.length === 1 ? '' : 's'} assigned to ${who}, oldest first, and say which were returned and why.`, deadline: oldest !== null && oldest >= STUCK_DAYS ? 'This week' : 'This month' },
                    { recipient: 'ceo', action: `Confirm ${who} is still the right approver for ${inr(total)} of pending orders, or reassign the queue.`, deadline: 'This month' },
                ],
            });
        }

        findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

        return {
            findings,
            cleared: findings.length
                ? null
                : { looked: pending.length, unit: 'orders awaiting approval', note: 'every assigned order points at a user record that no longer exists' },
            rejected: {
                'awaiting approval with nobody assigned': unowned,
                'assigned to a user record that no longer exists': unnamed,
            },
        };
    },
};
