/**
 * CHECK — one invoice reference, more than one purchase order.
 * -----------------------------------------------------------------------------
 * The oldest check here and still the one that finds real money. A naive "same
 * vendor + same reference_number" sweep returns 149 groups in this org and
 * almost all are noise, so the gating is the interesting part:
 *
 *   · reference_number is free text in Zoho and people type dates into it.
 *     "Date;- 30.05.2025" sits on four unrelated orders. A habit, not a
 *     duplicate.
 *   · One reference across ₹1,11,274 and ₹1,17,79,044 is part-billing against
 *     one order, which is normal.
 *
 * So a duplicate is raised only when the reference looks like an invoice
 * number, the amounts match within tolerance, and the orders are live.
 * Everything filtered is counted and reported.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: is a single invoice reference carried by more
 *                   than one purchase order for the same money               [BAA p.104]
 *   Tools           none — SQL rows in, findings out; no model call          [BAA p.94]
 *   Failure mode    returns findings and counts; never throws                [BAA p.94]
 *   Memory          NONE by design. An earlier version kept unanswered lines
 *                   alive past their window and produced a "7 Sept" scan
 *                   citing May-2025 orders. Age never re-dates a finding.   [BAA p.103]
 *   Evaluation      every figure traces to a column; the evidence rows name
 *                   the order, the date, the amount and the billed state so a
 *                   reader can check the claim without opening Zoho          [BAA p.95]
 *   Known deviation none
 */

import type { Check, CheckContext, CheckOutcome, PoRow } from './contract';
import { inr, isBilled, newestRaisedAt, num, shortDate, siteName } from './contract';
import { inWindow } from '../cadence';
import type { Evidence, Finding } from '../types';

/** Two POs are the same money if their amounts differ by less than this. */
const AMOUNT_TOLERANCE = 0.01; // 1%

/** Below this, a duplicate is not worth an executive's attention. */
const MIN_DUPLICATE_INR = 10_000;

/**
 * True when a reference_number is plausibly an invoice identifier.
 *
 * Rejects anything that is mostly a date, anything with no digits, and anything
 * under 4 characters. This single predicate removes the large majority of false
 * positives, because the dominant noise pattern is a typed-in date.
 */
export function looksLikeInvoiceRef(raw: string): boolean {
    const s = raw.trim();
    if (s.length < 4) return false;
    if (!/\d/.test(s)) return false;
    if (/^\s*(date|dt|dated)\b/i.test(s)) return false;
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return false;
    const skeleton = s.replace(/[\d\s.\-/:;,]/g, '');
    if (skeleton.length === 0 && !/[/-]/.test(s)) return false;
    return true;
}

/** Amounts equal within tolerance — a true duplicate, not a part-bill. */
function sameMoney(a: number, b: number): boolean {
    if (a <= 0 || b <= 0) return false;
    return Math.abs(a - b) / Math.max(a, b) <= AMOUNT_TOLERANCE;
}

/** Normalised vendor identity, for spotting the same supplier spelled two ways. */
export function normaliseVendor(name: string): string {
    return name
        .toLowerCase()
        .replace(/\b(pvt|private|limited|ltd|llp|inc|co|company|the|and)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

export const duplicateInvoiceRef: Check = {
    id: 'dup-ref',
    question: 'Is one invoice reference carried by more than one live purchase order, for the same amount?',
    nature: 'event',
    needs: ['pos'],

    run(ctx: CheckContext): CheckOutcome {
        const findings: Finding[] = [];
        const rejected = { refShape: 0, amountMismatch: 0, belowFloor: 0, outsideWindow: 0 };

        const byRef = new Map<string, PoRow[]>();
        for (const r of ctx.live) {
            const ref = String(r.raw?.reference_number ?? '').trim();
            if (!ref) continue;
            if (!looksLikeInvoiceRef(ref)) { rejected.refShape++; continue; }
            const key = `${normaliseVendor(r.vendor_name ?? '')}::${ref.toLowerCase()}`;
            byRef.set(key, [...(byRef.get(key) ?? []), r]);
        }

        let groups = 0;
        for (const [, group] of byRef) {
            if (group.length < 2) continue;
            groups++;

            // Only the orders whose money actually matches the largest.
            const sorted = [...group].sort((a, b) => num(b.po_amount) - num(a.po_amount));
            const matched: PoRow[] = [];
            for (const r of sorted) {
                if (!matched.length || sameMoney(num(matched[0].po_amount), num(r.po_amount))) matched.push(r);
            }
            if (matched.length < 2) { rejected.amountMismatch++; continue; }

            const dupValue = matched.slice(1).reduce((s, r) => s + num(r.po_amount), 0);
            if (dupValue < MIN_DUPLICATE_INR) { rejected.belowFloor++; continue; }

            const ref = String(matched[0].raw?.reference_number ?? '');
            const vendor = matched[0].vendor_name ?? 'Unknown vendor';
            const site = siteName(ctx, matched[0]);
            // Stable across scans: derived from the problem, never from a date
            // or row order, so a closed line stays closed next week.
            const key = `dup-ref:${normaliseVendor(vendor)}:${ref.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)}`;

            /**
             * A duplicate PAIR comes into being when the SECOND order is raised,
             * so the finding belongs to that moment's window however old the
             * first order is — which is what stops September re-reporting
             * April's duplicates.
             *
             * THERE IS NO ESCAPE HATCH. An earlier version kept an out-of-window
             * finding alive while it stayed unanswered, and the result was a
             * scan headed "7 Sept" citing purchase orders from May 2025 as
             * though they were news. Age is not a reason to re-date something.
             * If a line matters after its window it belongs in an open-items
             * report, not in today's scan.
             */
            if (ctx.window && !inWindow(ctx.window, newestRaisedAt(matched) ?? undefined)) {
                rejected.outsideWindow++;
                continue;
            }

            const billed = matched.filter(isBilled);
            const anyBilled = billed.length > 0;
            const allBilled = billed.length === matched.length;

            /**
             * TWO ORDERS CAN SHARE A NUMBER. Zoho does not enforce uniqueness on
             * purchaseorder_number and this org has pairs that collide — the RVN
             * finding printed "PO-26/27-0609" twice, on two different orders,
             * with no way for a reader to tell which was which.
             *
             * The label stays as it is: it is what someone types in a reply and
             * what the collector matches on. The DISPLAY line gets Zoho's own id
             * appended, but only where the number is genuinely ambiguous.
             */
            const shown = matched.slice(0, 6);
            const labelCount = new Map<string, number>();
            for (const r of shown) {
                const l = r.po_number ?? r.id;
                labelCount.set(l, (labelCount.get(l) ?? 0) + 1);
            }
            const evidence: Evidence[] = shown.map((r) => {
                const ambiguous = (labelCount.get(r.po_number ?? r.id) ?? 0) > 1;
                const zohoId = String(r.raw?.purchaseorder_id ?? '');
                return {
                    ref: ctx.poRef(r),
                    facts: [
                        shortDate(r.po_date ?? r.created_at),
                        inr(num(r.po_amount)),
                        String(r.status ?? 'unknown status'),
                        isBilled(r) ? 'billed' : 'not billed',
                        siteName(ctx, r) ?? '',
                        ambiguous && zohoId ? `Zoho id …${zohoId.slice(-6)}` : '',
                    ].filter(Boolean).join(' · '),
                };
            });

            findings.push({
                key,
                // Money that may already be out ranks above money still stoppable.
                priority: anyBilled || dupValue >= 100_000 ? 'critical' : 'action',
                title: anyBilled
                    ? `${vendor} — same invoice on ${matched.length} POs, ${allBilled ? 'all' : `${billed.length} of them`} already billed`
                    : `${vendor} — same invoice on ${matched.length} live POs`,
                vendor,
                property: site,
                amount: dupValue,
                exposure: anyBilled ? 'billed' : 'stoppable',
                problem: anyBilled
                    ? `Invoice reference "${ref}" appears on ${matched.length} purchase orders for effectively the same amount, and ` +
                      `${allBilled ? 'every one of them has' : `${billed.length} of them have`} been billed. ` +
                      `Cancelling no longer fixes this: if the bills were also paid, ${inr(dupValue)} has already left the building ` +
                      `and comes back only as a debit note.`
                    : `Invoice reference "${ref}" appears on ${matched.length} purchase orders that are all still live, each for ` +
                      `effectively the same amount. None of them is billed yet, so this can still be stopped outright.`,
                refs: evidence.map((e) => e.ref),
                evidence,
                reconcile: [{
                    what: 'Orders carrying this one reference',
                    expected: '1',
                    actual: String(matched.length),
                    gap: `${inr(dupValue)} ordered beyond the first`,
                }],
                counter: anyBilled
                    ? 'The fair counter is a genuine second supply against one proforma — a repeat delivery billed separately. The vendor ledger settles it; a matching pair of goods receipts would close this line.'
                    : 'The fair counter is two real deliveries raised under one reference by habit. If so, correct the reference on one of them and this stops recurring.',
                ask: anyBilled
                    ? `Confirm against ${vendor}'s ledger whether this was paid once or twice. If twice, name an owner and a date for a debit note of ${inr(dupValue)}.`
                    : `Cancel the duplicate or say which of the ${matched.length} is the real order — ${inr(dupValue)} is still stoppable.`,
                stats: [
                    { label: 'POs', value: String(matched.length) },
                    { label: 'Each', value: inr(num(matched[0].po_amount)) },
                    { label: 'Billed', value: anyBilled ? `${billed.length} of ${matched.length}` : 'none yet' },
                ],
                actions: anyBilled
                    ? [
                        { recipient: 'ceo', action: `Confirm one supply or two against ${vendor}'s ledger, and if one, approve a debit note for ${inr(dupValue)} with a named owner and a date.`, deadline: 'This week' },
                        { recipient: 'procurement', action: `Pull the payment entries behind ${billed.map((r) => r.po_number ?? '?').join(' and ')} and say which supply each covers. A comment on the order does not recover cash — the debit note does.`, deadline: 'This week' },
                    ]
                    : [
                        { recipient: 'ceo', action: `Approve cancelling the duplicate, or say which of the ${matched.length} is the real order.`, deadline: 'This week' },
                        { recipient: 'procurement', action: `Short-close or cancel the duplicate against ${vendor} before it is billed, and say which one you kept.`, deadline: 'This week' },
                    ],
            });
        }

        findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

        return {
            findings,
            cleared: {
                looked: groups,
                unit: 'reference groups across ' + new Set(ctx.live.map((r) => normaliseVendor(r.vendor_name ?? ''))).size + ' vendors',
                note: findings.length
                    ? `${groups - findings.length} of ${groups} shared references cleared on amount or shape`
                    : `zero survivors across ${groups} shared references`,
            },
            rejected: {
                'reference is a date or too short': rejected.refShape,
                'amounts do not match — part-billing': rejected.amountMismatch,
                'below the ₹10,000 floor': rejected.belowFloor,
                'raised outside the last 24 hours': rejected.outsideWindow,
            },
        };
    },
};

export { AMOUNT_TOLERANCE, MIN_DUPLICATE_INR };
