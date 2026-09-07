/**
 * CHECK — the same service ordered twice for overlapping periods.
 * -----------------------------------------------------------------------------
 * The first check built on line items, and the case that proved the header-only
 * sync was the ceiling on this agent.
 *
 * Four quarterly AMC orders went to Metro Airconditioner on 07-Apr-2026, each
 * line reading "Period - 01.04.2026 to 31.06.2026". Four annual orders followed
 * on 25-Jun-2026 reading "Contract 01/04/2026 to 31/03/2027" — the same start
 * date, for a year that fully contains the quarter already bought. Nothing is
 * billed on any of the eight, so it is entirely reversible; and it is invisible
 * to every header-level check, because the totals differ, the references differ
 * and the dates differ. The overlap exists only in the line DESCRIPTION.
 *
 * WHAT COUNTS AS AN OVERLAP HERE
 *   same vendor, same site, and one period CONTAINING another. Not merely
 *   touching: a Q1 order followed by a Q2 order is normal procurement and must
 *   never be raised. Containment is the signal — you have bought a window you
 *   already owned.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: has a period already bought been bought again
 *                   inside a longer one, from the same vendor for the same site [BAA p.104]
 *   Tools           none — line-item rows in, findings out; no model call      [BAA p.94]
 *   Failure mode    skipped WITH A REASON when line items are not yet synced;
 *                   never reports "clear" on data it cannot see                [BAA p.94]
 *   Memory          NONE by design — the window is the whole contract. An
 *                   overlap raised outside the last 24 hours is not news.       [BAA p.103]
 *   Evaluation      every date is parsed from a stored description and quoted
 *                   back verbatim in the evidence, so a reader can see exactly
 *                   what the line said and disagree with the reading           [BAA p.95]
 *   Known deviation the period parser is a heuristic over free text. It is
 *                   deliberately narrow — an explicit "<date> to <date>" only —
 *                   and quotes the source text so a misread is visible rather
 *                   than silent.                                               [BAA p.96]
 */

import type { Check, CheckContext, CheckOutcome, PoLine, PoRow } from './contract';
import { inr, isBilled, newestRaisedAt, num, shortDate } from './contract';
import { inWindow } from '../cadence';
import { normaliseVendor } from './duplicateInvoiceRef';
import type { Evidence, Finding } from '../types';

/** A period read out of a line description, with the text it came from. */
interface Period { from: Date; to: Date; source: string }

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy and dd-Mon-yyyy.
 *
 * DAY-FIRST, because that is what this org writes and because the corpus proves
 * it: "31.06.2026" appears verbatim on a real order. June has 30 days, so that
 * is not a date at all — somebody meant the end of the quarter. A parser that
 * rejects it loses the finding; one that silently accepts it invents a day. It
 * is CLAMPED to the last real day of the month, and the original text travels
 * with the period so the reader sees what was actually typed.
 */
function parseDate(raw: string): Date | null {
    const s = raw.trim();
    const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
    if (numeric) {
        const day = Number(numeric[1]);
        const month = Number(numeric[2]) - 1;
        let year = Number(numeric[3]);
        if (year < 100) year += 2000;
        if (month < 0 || month > 11 || day < 1 || day > 31) return null;
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
    }
    const named = /^(\d{1,2})[\s.-]([A-Za-z]{3,9})[\s.-](\d{2,4})$/.exec(s);
    if (named) {
        const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
        if (month === undefined) return null;
        let year = Number(named[3]);
        if (year < 100) year += 2000;
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return new Date(Date.UTC(year, month, Math.min(Number(named[1]), lastDay)));
    }
    return null;
}

const DATE = String.raw`\d{1,2}(?:[./-]\d{1,2}[./-]\d{2,4}|[\s.-][A-Za-z]{3,9}[\s.-]\d{2,4})`;
const RANGE = new RegExp(`(${DATE})\\s*(?:to|-|–|—|till|until|thru)\\s*(${DATE})`, 'i');

/** The first explicit "<date> to <date>" in a line's own words. */
export function periodFrom(text: string | null | undefined): Period | null {
    if (!text) return null;
    const m = RANGE.exec(String(text).replace(/\s+/g, ' '));
    if (!m) return null;
    const from = parseDate(m[1]);
    const to = parseDate(m[2]);
    if (!from || !to || to.getTime() <= from.getTime()) return null;
    return { from, to, source: m[0] };
}

const DAY = 86_400_000;
const spanDays = (p: Period) => Math.round((p.to.getTime() - p.from.getTime()) / DAY);
/** Strictly contains, with a week of slack so 31-Mar vs 01-Apr is not a miss. */
const contains = (outer: Period, inner: Period) =>
    outer.from.getTime() <= inner.from.getTime() + 7 * DAY &&
    outer.to.getTime() >= inner.to.getTime() - 7 * DAY &&
    spanDays(outer) > spanDays(inner) * 1.5;

interface Ordered { po: PoRow; line: PoLine; period: Period }

export const contractPeriodOverlap: Check = {
    id: 'period-overlap',
    question: 'Has a service period already ordered been ordered again inside a longer one, same vendor and same site?',
    nature: 'event',
    needs: ['pos', 'lines'],

    run(ctx: CheckContext): CheckOutcome {
        // A check that cannot see its data says so. It never reports "clear".
        if (!ctx.lines.size) {
            return {
                findings: [],
                skipped: 'purchase-order line items are not synced yet — periods live in the line description',
            };
        }

        // Every line that states a period, grouped by vendor + site.
        const byGroup = new Map<string, Ordered[]>();
        let dated = 0;
        for (const po of ctx.live) {
            const zohoId = String(po.raw?.purchaseorder_id ?? '');
            for (const line of ctx.lines.get(zohoId) ?? []) {
                const period = periodFrom(line.description) ?? periodFrom(line.name);
                if (!period) continue;
                dated++;
                const site = po.property_id ?? String(po.raw?.cf_site ?? '') ?? '';
                const key = `${normaliseVendor(po.vendor_name ?? '')}::${site}`;
                byGroup.set(key, [...(byGroup.get(key) ?? []), { po, line, period }]);
            }
        }

        const findings: Finding[] = [];
        const rejected = { singleOrder: 0, noContainment: 0, outsideWindow: 0 };

        for (const [, ordered] of byGroup) {
            if (ordered.length < 2) { rejected.singleOrder++; continue; }

            // The longest period first: it is the one that swallows the others.
            const sorted = [...ordered].sort((a, b) => spanDays(b.period) - spanDays(a.period));
            const outer = sorted[0];
            const swallowed = sorted.slice(1).filter((o) => contains(outer.period, o.period));
            if (!swallowed.length) { rejected.noContainment++; continue; }

            const vendor = outer.po.vendor_name ?? 'Unknown vendor';
            const site = outer.po.property_id ? ctx.propName.get(outer.po.property_id) ?? null : null;
            const doubled = swallowed.reduce((s, o) => s + num(o.line.item_total ?? o.po.po_amount), 0);
            const outerValue = num(outer.line.item_total ?? outer.po.po_amount);

            // Keyed on the containing order, so re-ordering the same overlap
            // tomorrow resolves to the same line and stays closed once answered.
            const key = `period-overlap:${normaliseVendor(vendor)}:${outer.po.raw?.purchaseorder_id ?? outer.po.po_number}`;

            // Same rule as every other check: the overlap belongs to the window
            // in which the later order was RAISED, and nothing re-dates it.
            const involved = [outer, ...swallowed].map((o) => o.po);
            if (ctx.window && !inWindow(ctx.window, newestRaisedAt(involved) ?? undefined)) {
                rejected.outsideWindow++;
                continue;
            }

            const anyBilled = [outer, ...swallowed].some((o) => isBilled(o.po));

            const evidence: Evidence[] = [outer, ...swallowed].slice(0, 8).map((o) => ({
                ref: ctx.poRef(o.po),
                facts: [
                    shortDate(o.po.po_date ?? o.po.created_at),
                    inr(num(o.line.item_total ?? o.po.po_amount)),
                    `${spanDays(o.period)} days`,
                    `"${o.period.source}"`,
                    isBilled(o.po) ? 'billed' : 'not billed',
                ].join(' · '),
            }));

            const overlapDays = swallowed.reduce((s, o) => s + spanDays(o.period), 0);

            findings.push({
                key,
                priority: doubled >= 100_000 || anyBilled ? 'critical' : 'action',
                title: `${vendor} — ${swallowed.length === 1 ? 'a period' : `${swallowed.length} periods`} already ordered, bought again inside a longer contract`,
                vendor,
                property: site,
                amount: doubled,
                exposure: anyBilled ? 'billed' : 'stoppable',
                problem:
                    `${outer.po.po_number ?? 'The longer order'} covers ${outer.period.source} — ${spanDays(outer.period)} days — ` +
                    `and fully contains ${swallowed.length === 1 ? 'a period' : `${swallowed.length} periods`} this vendor was already ordered for at the same site. ` +
                    `${overlapDays} days of service are committed twice, worth ${inr(doubled)}. ` +
                    (anyBilled
                        ? 'At least one of these has been billed, so part of it is past the point where cancelling fixes it.'
                        : 'Nothing here is billed, so it is fully reversible today.'),
                refs: evidence.map((e) => e.ref),
                evidence,
                reconcile: [
                    {
                        what: 'Days of cover bought for this period',
                        expected: `${spanDays(outer.period)} (the longer contract alone)`,
                        actual: `${spanDays(outer.period) + overlapDays}`,
                        gap: `${overlapDays} days ordered twice`,
                    },
                    {
                        what: 'Value committed for the overlapping window',
                        expected: inr(outerValue),
                        actual: inr(outerValue + doubled),
                        gap: inr(doubled),
                    },
                ],
                counter:
                    'The fair counter is that these cover different equipment or different floors under one site — in which case the ' +
                    'periods are not duplicated at all. The machine or asset schedule per line settles it, and attaching it closes this line.',
                ask: `Short-close the shorter ${swallowed.length === 1 ? 'order' : 'orders'} or reduce the long one by ${overlapDays} days — say which, and attach the asset schedule per line.`,
                stats: [
                    { label: 'Orders', value: String(1 + swallowed.length) },
                    { label: 'Days doubled', value: String(overlapDays) },
                    { label: 'Billed', value: anyBilled ? 'yes — partly' : 'none yet' },
                ],
                actions: [
                    { recipient: 'ceo', action: `Decide which stands: the ${spanDays(outer.period)}-day contract or the shorter ${swallowed.length === 1 ? 'order' : 'orders'} already placed. ${inr(doubled)} is committed twice.`, deadline: 'This week' },
                    { recipient: 'procurement', action: `Short-close or cancel the overlapping ${swallowed.length === 1 ? 'order' : 'orders'} against ${vendor}, and attach the per-line asset schedule so the next scan can tell these apart.`, deadline: 'This week' },
                ],
            });
        }

        findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

        return {
            findings,
            cleared: {
                looked: dated,
                unit: 'contract lines carrying an explicit period',
                note: findings.length
                    ? `${byGroup.size - findings.length} of ${byGroup.size} vendor-site groups showed no containment`
                    : `no period was found inside a longer one across ${byGroup.size} vendor-site groups`,
            },
            rejected: {
                'only one dated order for that vendor and site': rejected.singleOrder,
                'periods run consecutively, not inside one another': rejected.noContainment,
                'raised outside the last 24 hours': rejected.outsideWindow,
            },
        };
    },
};
