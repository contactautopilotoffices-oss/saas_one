/**
 * CHECK — priced work with the measurement left out of the order.
 * -----------------------------------------------------------------------------
 * MH-PO-26/27-0757, Omprakash Chauhan, line 4:
 *
 *   "POP aluminium partition removal 18'3" x 7'6" (bill shows 139.08 sq. ft.)
 *    | Lump sum (L.M.S) | Bill no. 60 line 4"
 *   quantity 1 · unit "nos" · ₹6,500
 *
 * The description does the measuring — 18 foot 3 by 7 foot 6, 139.08 square feet
 * — and then the order throws it away and books the work as one of something.
 * ₹6,500 for "1 nos" cannot be checked against anything. ₹46.74 per square foot
 * can be checked against every other partition removal this org has ever paid
 * for, and the number to do it with was sitting in the same sentence.
 *
 * This is not the same fault as a unit that contradicts the words: here the
 * quantity column is not wrong, it is empty of information. And it is not the
 * same as a genuine lump sum either — a survey, a design fee, a call-out charge
 * are all properly priced as one job, and this check must not chase them.
 *
 * ── FOUR THINGS MUST HOLD, WHICH IS WHY THIS RAISES ONCE IN 5,501 ORDERS ────
 *   1. the description calls it a lump sum — "Lump sum", "L.M.S", "LS",
 *      "as per bill", "as per actual". The unit column saying "ls" is NOT
 *      enough: 875 lines carry that unit and most of them are honest AMCs;
 *   2. quantity is exactly 1 and the unit is generic or blank — the measurement
 *      genuinely did not reach the order;
 *   3. the line is worth ₹5,000 or more. The same order has a ₹1,850 lump-sum
 *      line and it is deliberately not raised: that is the difference between a
 *      finding and a spreadsheet;
 *   4. the description CONTAINS the measurement. That is the whole point — the
 *      number exists, somebody typed it, and it did not make it into the field
 *      that a rate history reads. Work with no measurement anywhere is priced as
 *      a job, and that is a legitimate way to buy it.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: is a line priced as a lump sum when its own
 *                   description carries the measurement it should be priced on [BAA p.104]
 *   Tools           none — line-item rows in, findings out; no model call      [BAA p.94]
 *   Failure mode    skipped WITH A REASON when line items are not synced;
 *                   never reports "clear" on data it cannot see                [BAA p.94]
 *   Memory          NONE by design — the finding belongs to the window the
 *                   order was RAISED in, and age never re-dates it.            [BAA p.103]
 *   Evaluation      the description is quoted VERBATIM beside the quantity,
 *                   unit and amount, and the implied per-unit rate is plain
 *                   division a reader can redo in their head                   [BAA p.95]
 *   Known deviation `billedAgainst` from lineDetailMissing replaces the shared
 *                   `isBilled`, which answers true for every order in this org
 *                   because "to_be_billed" contains "billed". Named, not silent. [BAA p.96]
 *                   The lump-sum and measurement readers are heuristics over
 *                   free text. Both are deliberately narrow, the quote travels
 *                   with the finding, and every rejection is counted.          [BAA p.96]
 */

import type { Check, CheckContext, CheckOutcome, PoLine } from './contract';
import { inr, newestRaisedAt, num, raisedAt, shortDate, siteName } from './contract';
import { inWindow } from '../cadence';
import { billedAgainst, lineValue, perUnit } from './lineDetailMissing';
import { unitFamily } from './unitContradictsDescription';
import type { Evidence, Finding } from '../types';

/** Below this, a lump-sum line is not worth an executive's morning. */
const MIN_LUMP_INR = 5_000;

/** The words a lump sum is written with here. */
const LUMP_PHRASES: readonly RegExp[] = [
    /lump\s*sum/i,
    /lumpsum/i,
    /\bl\.?\s*m\.?\s*s\.?\b/i,
    /as\s+per\s+bill/i,
    /as\s+per\s+actual/i,
];

/**
 * A bare "LS" as its own token. Case-SENSITIVE and boundary-guarded on purpose:
 * lowercase "ls" appears inside ordinary words, and a two-letter match that is
 * wrong reads as carelessness in a mail an executive is asked to act on.
 */
const LS_TOKEN = /(^|[\s(|,])L\.?\s?S\.?([\s)|,.]|$)/;

/** Units that carry no measurement: blank, a count, or a set/lot/job. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set(['count', 'set']);

/**
 * A measurement stated in the words. `[ \t]` and not `\s` deliberately — these
 * descriptions are multi-line, and "600\nMeter Charges" is a line item on a
 * water bill, not six hundred metres of anything.
 */
const MEASURE_PHRASE = /(\d[\d,]*(?:\.\d+)?)[ \t]*(sq\.?[ \t]*ft\.?|sq\.?[ \t]*feet|sqft|sft|sq\.?[ \t]*m\b|rft|r\.ft|rmt|mtr|metres?|meters?|feet|ft|kgs?|ltrs?|litres?)(?![a-z])/i;

/** Feet and inches, the way a site engineer writes them: 18'3" x 7'6". */
const FEET_INCHES = /\d+[ \t]*'[ \t]*(?:\d+[ \t]*")?/;

/** What the description measured, when it measured anything. */
interface Measurement { phrase: string; size: number | null; unit: string | null }

export function measurementIn(text: string | null | undefined): Measurement | null {
    if (!text) return null;
    const explicit = MEASURE_PHRASE.exec(text);
    if (explicit) {
        const size = Number(explicit[1].replace(/,/g, ''));
        return {
            phrase: explicit[0].replace(/\s+/g, ' ').trim(),
            size: Number.isFinite(size) && size > 0 ? size : null,
            unit: explicit[2].replace(/\s+/g, ' ').trim(),
        };
    }
    const dims = FEET_INCHES.exec(text);
    if (dims) return { phrase: dims[0].replace(/\s+/g, ' ').trim(), size: null, unit: null };
    return null;
}

/** True when the line's own words call it a lump sum. */
export function readsAsLumpSum(l: PoLine): boolean {
    const description = String(l.description ?? '');
    const both = `${description} ${String(l.name ?? '')}`;
    return LUMP_PHRASES.some((r) => r.test(both)) || LS_TOKEN.test(description);
}

/** The description, cleaned of newlines and trimmed to something a mail can print. */
function quote(l: PoLine): string {
    const text = String(l.description ?? '').replace(/\s+/g, ' ').trim() || String(l.name ?? '').trim();
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

interface LumpLine { line: PoLine; value: number; measure: Measurement }

export const lumpSumNoMeasure: Check = {
    id: 'lump-sum-no-measure',
    question: 'Is work priced as a lump sum when its own description already carries the measurement it should be priced on?',
    nature: 'event',
    needs: ['pos', 'lines'],

    run(ctx: CheckContext): CheckOutcome {
        // A check that cannot see its data says so. It never reports "clear".
        if (!ctx.lines.size) {
            return {
                findings: [],
                skipped: 'purchase-order line items are not synced yet — the lump-sum wording and the measurement are both in the line description',
            };
        }

        const findings: Finding[] = [];
        const rejected = { notLumpSum: 0, quantityCarriesIt: 0, unitIsMeasured: 0, belowFloor: 0, nothingMeasured: 0, outsideWindow: 0 };
        let looked = 0;

        for (const po of ctx.live) {
            const all = ctx.lines.get(String(po.raw?.purchaseorder_id ?? '')) ?? [];
            if (!all.length) continue;

            const bad: LumpLine[] = [];
            for (const line of all) {
                looked++;

                if (!readsAsLumpSum(line)) { rejected.notLumpSum++; continue; }
                // Quantity 2 of a lump sum still says how many. Quantity 1 says nothing.
                if (num(line.quantity) !== 1) { rejected.quantityCarriesIt++; continue; }

                const family = unitFamily(line.unit);
                const blank = !String(line.unit ?? '').trim();
                if (!blank && family !== null && !GENERIC_FAMILIES.has(family)) { rejected.unitIsMeasured++; continue; }

                const value = lineValue(line);
                if (value < MIN_LUMP_INR) { rejected.belowFloor++; continue; }

                // The measurement must EXIST in the words. Work that was never
                // measured anywhere is legitimately bought as one job.
                const measure = measurementIn(String(line.description ?? ''));
                if (!measure) { rejected.nothingMeasured++; continue; }

                bad.push({ line, value, measure });
            }

            if (!bad.length) continue;

            // Same rule as every other event check: the finding belongs to the
            // window the order was RAISED in. Never `created_at`.
            if (ctx.window && !inWindow(ctx.window, newestRaisedAt([po]) ?? undefined)) {
                rejected.outsideWindow++;
                continue;
            }

            const vendor = po.vendor_name ?? 'Unknown vendor';
            const site = siteName(ctx, po);
            const billed = billedAgainst(po);
            const label = po.po_number ?? po.id;
            const value = bad.reduce((s, b) => s + b.value, 0);
            const key = `lump-sum-no-measure:${po.raw?.purchaseorder_id ?? po.po_number ?? po.id}`;

            const worst = [...bad].sort((a, b) => b.value - a.value)[0];
            /** ₹6,500 over 139.08 sq. ft. is ₹46.74 — the number the order should have carried. */
            const implied = worst.measure.size && worst.measure.size > 0
                ? { rate: worst.value / worst.measure.size, unit: worst.measure.unit ?? 'unit' }
                : null;

            const evidence: Evidence[] = bad.slice(0, 5).map((b) => ({
                ref: ctx.poRef(po),
                facts: [
                    `"${quote(b.line)}"`,
                    `quantity 1 · unit ${String(b.line.unit ?? '').trim() || '(blank)'}`,
                    inr(b.value),
                    `the words measure it: ${b.measure.phrase}`,
                    b.measure.size ? `implies ${perUnit(b.value / b.measure.size)} per ${b.measure.unit ?? 'unit'}` : 'dimensions given, no total',
                ].join(' · '),
            }));

            findings.push({
                key,
                priority: billed || value >= 100_000 ? 'critical' : 'action',
                title: `${vendor} — ${inr(value)} priced as a lump sum with the measurement left off the order`,
                vendor,
                property: site,
                amount: value,
                exposure: billed ? 'billed' : 'stoppable',
                problem:
                    `${label} prices "${quote(worst.line)}" at ${inr(worst.value)} as quantity 1, unit ${String(worst.line.unit ?? '').trim() || 'blank'}. ` +
                    `The description measures the work itself — ${worst.measure.phrase} — and that number never reached the order. ` +
                    (implied
                        ? `${inr(worst.value)} over ${worst.measure.phrase} is ${perUnit(implied.rate)} per ${implied.unit}, which is a figure the next quote can be tested against; "1 nos at ${inr(worst.value)}" is not. `
                        : `Without it there is no rate to compare with the next quote, and nothing to measure the finished work against. `) +
                    (bad.length > 1 ? `${bad.length} lines on this order are written the same way, ${inr(value)} in total. ` : '') +
                    (billed
                        ? 'It has already been billed, so the measured rate has to come off the vendor bill rather than the order.'
                        : 'Nothing is billed yet, so the line can still be restated at the measured quantity.'),
                refs: [ctx.poRef(po)],
                evidence,
                reconcile: [
                    {
                        what: `Quantity recorded for "${quote(worst.line)}"`,
                        expected: worst.measure.phrase,
                        actual: `1 ${String(worst.line.unit ?? '').trim() || '(blank)'}`,
                        gap: implied ? `${perUnit(implied.rate)} per ${implied.unit} never recorded` : 'no measured rate recorded',
                    },
                    ...(bad.length > 1
                        ? [{
                            what: 'Lump-sum lines on this order carrying a measurement in the words',
                            expected: '0',
                            actual: String(bad.length),
                            gap: `${inr(value)} priced without a measured rate`,
                        }]
                        : []),
                ],
                counter:
                    'The fair counter is that removal work genuinely is priced as one job and the measurement in the description is only context — ' +
                    'the vendor quoted a number to clear the partition, not a rate per square foot. If that is so, say it once and the same wording ' +
                    'can stand every time; but then the measurement on the bill is decoration, and the two should not be able to disagree.',
                ask: implied
                    ? `Restate this line as ${worst.measure.phrase} at ${perUnit(implied.rate)} per ${implied.unit}, or confirm it is a true lump sum and the ${worst.measure.phrase} on the bill is not what was priced.`
                    : `Put the measured quantity on this line, or confirm it is a true lump sum and the dimensions in the description are not what was priced.`,
                stats: [
                    { label: 'Lines', value: `${bad.length} of ${all.length}` },
                    { label: 'Value', value: inr(value) },
                    { label: 'Measured in the words', value: worst.measure.phrase },
                ],
                actions: [
                    {
                        recipient: 'ceo',
                        action: implied
                            ? `Decide whether ${perUnit(implied.rate)} per ${implied.unit} is the rate you want to hold ${vendor} to on ${label}, or accept ${inr(worst.value)} as a one-off job price.`
                            : `Decide whether ${inr(worst.value)} on ${label} is a job price or a measured rate — as written it can be neither compared nor checked.`,
                        deadline: 'This week',
                    },
                    {
                        recipient: 'procurement',
                        action: `Re-raise ${bad.length === 1 ? 'the line' : `the ${bad.length} lines`} on ${label} with the measured quantity and unit from the bill instead of "1 ${String(worst.line.unit ?? '').trim() || 'blank'}", so the rate lands in the history — raised ${shortDate(raisedAt(po))}.`,
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
                unit: 'live purchase-order lines read for lump-sum wording',
                note: findings.length
                    ? `${rejected.nothingMeasured} lump-sum lines cleared because nothing in them was ever measured`
                    : `no lump-sum line hides a measurement across ${looked} lines`,
            },
            rejected: {
                'the words do not call it a lump sum': rejected.notLumpSum,
                'the quantity column still says how many': rejected.quantityCarriesIt,
                'the unit is a real measure, so the rate survives': rejected.unitIsMeasured,
                [`below the ${inr(MIN_LUMP_INR)} floor`]: rejected.belowFloor,
                'a genuine lump sum — nothing measured in the words either': rejected.nothingMeasured,
                'raised outside the window': rejected.outsideWindow,
            },
        };
    },
};

export { MIN_LUMP_INR };
