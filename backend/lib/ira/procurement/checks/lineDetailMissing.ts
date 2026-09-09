/**
 * CHECK — a line nobody can price-check.
 * -----------------------------------------------------------------------------
 * DL-PO-26/27-0061, Dev Electricals Solution Pvt Ltd, ₹1,63,254, twenty-three
 * lines, and not one of them says what the quantity is counted in. The line that
 * makes the point:
 *
 *   "1.5 sq.mm FRLS wire, 300 mtr coil, Red, Polycab make" — quantity 1,
 *   rate ₹7,172.50, unit (blank).
 *
 * One coil, or one metre? The order does not say. At coil rates that line is
 * ordinary; at metre rates it is ₹21 lakh of wire. Nobody approving it can tell,
 * nobody can compare the rate against the last purchase, and a goods receipt has
 * nothing to match against. The scan passed the order as clean because every
 * header-level fact about it is fine — the hole is in the line detail.
 *
 * ── WHY THE FLOOR IS THE WHOLE DESIGN ───────────────────────────────────────
 * 765 live orders in this org have at least one line with no unit. Raising all
 * of them would be a spreadsheet, not a finding. So this raises ONE finding PER
 * ORDER, weighted by money: the value of the lines that cannot be priced has to
 * clear ₹50,000, one of them has to be worth ₹2,500 on its own, and they have to
 * be a quarter of the order. A ₹450 screw line with no unit is not a problem
 * anyone should be mailed about; ₹39,249 of cable is.
 *
 * ── WHY DRAFTS ARE IN SCOPE HERE, AND ONLY HERE ─────────────────────────────
 * `ctx.live` drops draft orders along with cancelled and rejected ones, which is
 * right for every money check: a draft has committed nothing. It is exactly
 * wrong for this one. A missing unit costs nothing to fix and everything to fix
 * late — before approval it is a typing job, after approval it is a variation.
 * DL-PO-26/27-0061 is a draft, so under `ctx.live` this check would have watched
 * ₹1.38 lakh of unpriceable wire go past and reported "clear".
 *
 * So the scope is built from `ctx.pos` minus cancelled and rejected — the
 * contract calls `live` "what most checks want", not what all of them must use.
 * The finding says which state the order is in, because "hold this before you
 * approve it" and "this is already approved" are different asks.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: is money committed on lines that state no
 *                   unit, no rate or no quantity, so the price cannot be
 *                   checked by anyone                                       [BAA p.104]
 *   Tools           none — line-item rows in, findings out; no model call    [BAA p.94]
 *   Failure mode    skipped WITH A REASON when line items are not synced; it
 *                   never reports "clear" on data it cannot see             [BAA p.94]
 *   Memory          NONE by design. The finding belongs to the window the
 *                   order was RAISED in and is never re-dated by age.       [BAA p.103]
 *   Evaluation      every figure is a column: unit, quantity, rate,
 *                   item_total. The evidence prints the line's own words so
 *                   a reader can see what is missing without opening Zoho.   [BAA p.95]
 *   Known deviation scope is `ctx.pos` minus cancelled/rejected rather than
 *                   `ctx.live`, deliberately including drafts — reason above.
 *                   And `billedAgainst` below replaces the shared `isBilled`,
 *                   which reports every order as billed. Both named here
 *                   rather than done silently, per CLAUDE.md.                [BAA p.96]
 */

import type { Check, CheckContext, CheckOutcome, PoLine, PoRow } from './contract';
import { inr, newestRaisedAt, num, raisedAt, shortDate, siteName } from './contract';
import { inWindow } from '../cadence';
import type { Evidence, Finding } from '../types';

/** What a line is worth. item_total is Zoho's own figure; rate × quantity is the fallback. */
export function lineValue(l: PoLine): number {
    const total = num(l.item_total);
    if (total > 0) return total;
    return num(l.rate) * num(l.quantity);
}

/**
 * WHETHER A BILL ACTUALLY EXISTS AGAINST THIS ORDER.
 *
 * This duplicates `isBilled` in contract.ts on purpose, and the reason is a live
 * defect rather than taste. That helper asks:
 *
 *     String(raw.billed_status ?? status).toLowerCase().includes('billed')
 *
 * and Zoho's word for "no bill yet" is `to_be_billed`, which CONTAINS "billed".
 * So it answers true for all 5,501 orders in this org — 5,056 of which have
 * never been billed at all. Every finding that reads it says "already billed",
 * takes the 'billed' exposure, and escalates itself to critical.
 *
 * Three states, and only two of them mean a bill exists:
 *     to_be_billed → no.  billed → yes.  partially_billed → yes.
 *
 * contract.ts belongs to another change in flight, so the fix cannot go there
 * yet. This local reader is deliberately narrow — exact matches, no substring —
 * and exists so these three checks do not tell an executive that a draft order
 * raised yesterday has already been paid for.
 */
export function billedAgainst(r: PoRow): boolean {
    const state = String(r.raw?.billed_status ?? '').trim().toLowerCase();
    if (state) return state === 'billed' || state === 'partially_billed';
    const status = String(r.status ?? '').trim().toLowerCase();
    return status === 'billed' || status === 'partially_billed';
}

/** ₹46.74 — an implied per-unit rate keeps its paise, because that is what gets compared. */
export function perUnit(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n >= 1000 ? inr(n) : `₹${n.toFixed(2)}`;
}

/** Orders a draft has not committed, but a draft is where this is still free to fix. */
const CANCELLED = new Set(['cancelled', 'rejected']);

/** Below this much unpriceable money, an order is not worth an executive's morning. */
const MIN_OPAQUE_INR = 50_000;
/** And at least one line has to be substantial on its own — not fifty screws. */
const MIN_WORST_LINE_INR = 2_500;
/** A stray blank unit on a mostly-complete order is a typo, not a finding. */
const MIN_OPAQUE_SHARE = 0.25;

/** Why one line cannot be priced. Empty means it can. */
function missingOn(l: PoLine): string[] {
    const why: string[] = [];
    if (!String(l.unit ?? '').trim()) why.push('no unit');
    if (l.rate === null || num(l.rate) <= 0) why.push('no rate');
    if (l.quantity === null || num(l.quantity) <= 0) why.push('no quantity');
    return why;
}

/** The line in its own words, trimmed to something a mail can print. */
function lineWords(l: PoLine): string {
    const text = String(l.description ?? '').replace(/\s+/g, ' ').trim() || String(l.name ?? '').trim();
    return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

interface Opaque { line: PoLine; why: string[]; value: number }

export const lineDetailMissing: Check = {
    id: 'line-detail-missing',
    question: 'Is money committed on purchase-order lines that state no unit, no rate or no quantity?',
    nature: 'event',
    needs: ['pos', 'lines'],

    run(ctx: CheckContext): CheckOutcome {
        // A check that cannot see its data says so. It never reports "clear".
        if (!ctx.lines.size) {
            return {
                findings: [],
                skipped: 'purchase-order line items are not synced yet — the unit, rate and quantity live on the line, not the header',
            };
        }

        const scope: PoRow[] = ctx.pos.filter((r) => !CANCELLED.has(String(r.status ?? '').toLowerCase()));

        const findings: Finding[] = [];
        const rejected = { noLines: 0, allPriceable: 0, belowFloor: 0, smallShare: 0, outsideWindow: 0 };
        let looked = 0;

        for (const po of scope) {
            const all = ctx.lines.get(String(po.raw?.purchaseorder_id ?? '')) ?? [];
            if (!all.length) { rejected.noLines++; continue; }
            looked++;

            const opaque: Opaque[] = [];
            for (const line of all) {
                const why = missingOn(line);
                if (why.length) opaque.push({ line, why, value: lineValue(line) });
            }
            if (!opaque.length) { rejected.allPriceable++; continue; }

            const opaqueValue = opaque.reduce((s, o) => s + o.value, 0);
            const orderValue = all.reduce((s, l) => s + lineValue(l), 0);
            const worst = opaque.reduce((m, o) => Math.max(m, o.value), 0);

            // Weighted by money, not by count: a ₹450 screw line with no unit is
            // not news; ₹39,249 of cable with no unit is.
            if (opaqueValue < MIN_OPAQUE_INR || worst < MIN_WORST_LINE_INR) { rejected.belowFloor++; continue; }
            if (orderValue > 0 && opaqueValue / orderValue < MIN_OPAQUE_SHARE) { rejected.smallShare++; continue; }

            // Same rule as every other event check: the finding belongs to the
            // window the order was RAISED in. Never `created_at`, which is our
            // sync's clock, and never re-dated because it went unanswered.
            if (ctx.window && !inWindow(ctx.window, newestRaisedAt([po]) ?? undefined)) {
                rejected.outsideWindow++;
                continue;
            }

            const vendor = po.vendor_name ?? 'Unknown vendor';
            const site = siteName(ctx, po);
            const billed = billedAgainst(po);
            const isDraft = String(po.status ?? '').toLowerCase() === 'draft';
            const label = po.po_number ?? po.id;
            /** "all 1 lines" is how a machine writes. Say it the way a person would. */
            const scale = all.length === 1
                ? 'its only line'
                : opaque.length === all.length
                    ? `all ${all.length} lines`
                    : `${opaque.length} of ${all.length} lines`;

            // Stable and derived from the order, never from row order or a date,
            // so an answered line stays answered next week.
            const key = `line-detail-missing:${po.raw?.purchaseorder_id ?? po.po_number ?? po.id}`;

            const ranked = [...opaque].sort((a, b) => b.value - a.value);
            const headline = ranked[0];
            const missingUnit = opaque.filter((o) => o.why.includes('no unit')).length;

            const evidence: Evidence[] = ranked.slice(0, 5).map((o) => ({
                ref: ctx.poRef(po),
                facts: [
                    lineWords(o.line),
                    `quantity ${o.line.quantity ?? '—'}`,
                    `unit ${String(o.line.unit ?? '').trim() || '(blank)'}`,
                    `rate ${o.line.rate === null ? '—' : inr(num(o.line.rate))}`,
                    inr(o.value),
                    o.why.join(' + '),
                ].join(' · '),
            }));

            findings.push({
                key,
                priority: billed || opaqueValue >= 500_000 ? 'critical' : 'action',
                title: `${vendor} — ${inr(opaqueValue)} ordered on ${scale}, which cannot be price-checked`,
                vendor,
                property: site,
                amount: opaqueValue,
                exposure: billed ? 'billed' : 'stoppable',
                problem:
                    `${label} prices ${scale} — ${inr(opaqueValue)} — ` +
                    `with ${missingUnit === opaque.length ? (opaque.length === 1 ? 'no unit on it' : 'no unit on any of them') : 'the unit, rate or quantity missing'}. ` +
                    `The largest is "${lineWords(headline.line)}" at ${inr(headline.value)}: quantity ${headline.line.quantity ?? '—'}, ` +
                    `unit ${String(headline.line.unit ?? '').trim() || 'blank'}. ` +
                    `One coil or one metre, one box or one piece — the order does not say, so the rate cannot be compared with the last purchase ` +
                    `and a goods receipt has nothing to match against. ` +
                    (billed
                        ? 'It has already been billed, so the answer now has to come from the vendor invoice rather than the order.'
                        : isDraft
                            ? 'It is still a draft, so the unit column can be filled in before anyone approves it.'
                            : 'Nothing is billed yet, so the lines can still be corrected on the order itself.'),
                refs: [ctx.poRef(po)],
                evidence,
                reconcile: [
                    {
                        what: 'Lines stating a unit, a rate and a quantity',
                        expected: `${all.length} of ${all.length}`,
                        actual: `${all.length - opaque.length} of ${all.length}`,
                        gap: `${inr(opaqueValue)} that cannot be rate-checked`,
                    },
                    {
                        what: 'Largest unpriceable line',
                        expected: `a rate per stated unit`,
                        actual: `${inr(num(headline.line.rate))} × ${headline.line.quantity ?? '—'} ${String(headline.line.unit ?? '').trim() || '(blank)'}`,
                        gap: inr(headline.value),
                    },
                ],
                counter:
                    'The fair counter is that the vendor quotation carries the units and only the Zoho line lost them — a copy-paste, not a pricing ' +
                    'problem. If so, attaching that quotation and typing the unit column closes this in minutes and changes nothing about the order.',
                ask: isDraft
                    ? `Fill the unit in on ${opaque.length === 1 ? 'the line' : `all ${opaque.length} lines`} before ${label} is submitted for approval, and say what "${lineWords(headline.line)}" is priced per.`
                    : `Say what ${inr(headline.value)} of "${lineWords(headline.line)}" was priced per — coil, metre or piece — and correct the unit on ${opaque.length === 1 ? 'the line' : `all ${opaque.length} lines`}.`,
                stats: [
                    { label: 'Lines', value: `${opaque.length} of ${all.length}` },
                    { label: 'Unpriceable', value: inr(opaqueValue) },
                    { label: 'Status', value: isDraft ? 'draft — not yet approved' : String(po.status ?? 'unknown') },
                ],
                actions: [
                    {
                        recipient: 'ceo',
                        action: isDraft
                            ? `Hold approval on ${label} until the units are on the lines — ${inr(opaqueValue)} cannot be rate-checked as written.`
                            : `Ask for the unit basis behind ${inr(opaqueValue)} on ${label} before the bill is passed; as written the rate cannot be compared with anything.`,
                        deadline: 'This week',
                    },
                    {
                        recipient: 'procurement',
                        // Dated by when the order was RAISED, never by our sync clock.
                        action: `Type the unit on ${opaque.length === 1 ? 'the line' : `the ${opaque.length} lines`} of ${label} (coil, metre, box) and attach the vendor quotation the rates came from — raised ${shortDate(raisedAt(po))}.`,
                        deadline: 'This week',
                    },
                ],
            });
        }

        findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

        return {
            findings,
            cleared: {
                looked,
                unit: 'orders with line detail synced',
                note: findings.length
                    ? `${looked - findings.length} of ${looked} orders priced every line, or the gaps were too small to matter`
                    : `every line that carries money also carries a unit, a rate and a quantity across ${looked} orders`,
            },
            rejected: {
                'line items not synced for that order': rejected.noLines,
                'every line states its unit, rate and quantity': rejected.allPriceable,
                [`below the ${inr(MIN_OPAQUE_INR)} floor, or no single line worth ${inr(MIN_WORST_LINE_INR)}`]: rejected.belowFloor,
                'a stray blank on a mostly-complete order': rejected.smallShare,
                'raised outside the window': rejected.outsideWindow,
            },
        };
    },
};

export { MIN_OPAQUE_INR, MIN_WORST_LINE_INR, MIN_OPAQUE_SHARE };
