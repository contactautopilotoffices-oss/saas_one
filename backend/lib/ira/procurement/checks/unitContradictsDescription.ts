/**
 * CHECK — the quantity field disagrees with the words next to it.
 * -----------------------------------------------------------------------------
 * MH-PO-26/27-0759, Omprakash Chauhan. Line 2 reads:
 *
 *   "MR plywood 12 mm fixing 4' x 9'6" | 38.4 Sq. Ft. @ 140 | Bill no. 62 line 2"
 *   quantity 38.4 · unit "nos" · rate ₹140 · ₹5,376
 *
 * The number is right. The unit is a lie. Nobody ordered 38.4 pieces of anything
 * — they ordered 38.4 square feet at ₹140 a square foot, and the column that is
 * supposed to say so says "nos". The same order books "26 RFT @ 45" as `nos`
 * too. Header totals are correct, the arithmetic is correct, and the scan passed
 * it as clean — but every per-unit comparison across orders is now meaningless,
 * because ₹140 "per nos" and ₹140 per square foot look identical in a rate
 * history and are not the same number.
 *
 * ── WHAT MAKES A CONTRADICTION GENUINE, AND WHAT MAKES ONE IMAGINARY ────────
 * The naive reading — "the description mentions a unit, the column says another"
 * — fires 83 times in this corpus and most of them are PACK SIZES:
 *
 *   "5 LTR" · quantity 5 · unit "can"   — five cans of five litres.
 *   "4ft"   · quantity 4 · unit "nos"   — four items, each four feet long.
 *
 * In both, the number in the words is a coincidence, not the order quantity, and
 * raising them would be exactly the over-flagging this scan is meant to avoid.
 * So two things must hold before a line is raised:
 *
 *   1. the number in front of the unit in the description EQUALS the line
 *      quantity — the words are talking about this order's quantity, not a pack;
 *   2. it is corroborated, either because the description also states this line's
 *      own RATE ("@ 140", rate = 140 — the words carry the whole calculation),
 *      or because the quantity is FRACTIONAL, and nobody buys 38.4 pieces.
 *
 * Across 5,501 orders that leaves three findings. Two-thirds of one per thousand
 * orders is the right density for something a person is asked to read.
 *
 * Only a measured unit booked as a counted one is raised (sq.ft, RFT, kg, litre,
 * hours, persons → nos, pcs, set, box). The reverse — "3 Nos" booked as `ls` —
 * is untidy but it does not corrupt a rate comparison, and it is common enough
 * to bury the cases that do.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: does a line's own description name a
 *                   different unit for the SAME quantity than the unit column [BAA p.104]
 *   Tools           none — line-item rows in, findings out; no model call     [BAA p.94]
 *   Failure mode    skipped WITH A REASON when line items are not synced;
 *                   never reports "clear" on data it cannot see               [BAA p.94]
 *   Memory          NONE by design — the finding belongs to the window the
 *                   order was RAISED in, and age never re-dates it.           [BAA p.103]
 *   Evaluation      the description is quoted VERBATIM in the evidence beside
 *                   the quantity, unit and rate columns, so a reader can
 *                   overrule the reading without opening Zoho                 [BAA p.95]
 *   Known deviation `billedAgainst` from lineDetailMissing replaces the shared
 *                   `isBilled`, which answers true for every order in this org
 *                   because "to_be_billed" contains "billed". Named, not silent. [BAA p.96]
 *                   The unit reader is a heuristic over free text. It is
 *                   deliberately narrow — quantity match plus rate or a
 *                   fractional quantity — and every rejection is counted and
 *                   reported rather than hidden.                              [BAA p.96]
 */

import type { Check, CheckContext, CheckOutcome, PoLine } from './contract';
import { inr, newestRaisedAt, num, raisedAt, shortDate, siteName } from './contract';
import { inWindow } from '../cadence';
import { billedAgainst, lineValue } from './lineDetailMissing';
import type { Evidence, Finding } from '../types';

/**
 * Unit spellings this org actually uses, grouped into families. Two units
 * contradict when their FAMILIES differ — "pcs" and "nos" are the same claim
 * spelled two ways and must never be raised against each other.
 *
 * Keys are letters only: the caller strips digits, spaces and punctuation, so
 * one entry covers "sq. ft.", "sq ft", "Sqft" and "SQ.FT.".
 */
export const UNIT_FAMILY: ReadonlyMap<string, string> = new Map(Object.entries({
    sqft: 'area', sft: 'area', sqfeet: 'area', squarefeet: 'area', sqm: 'area', sqmt: 'area', sqmtr: 'area',
    rft: 'length', runningfeet: 'length', rmt: 'length', mtr: 'length', mtrs: 'length', meter: 'length',
    meters: 'length', metre: 'length', metres: 'length', m: 'length', ft: 'length', feet: 'length', foot: 'length',
    kg: 'weight', kgs: 'weight', kilogram: 'weight', kilograms: 'weight', gm: 'weight', gms: 'weight',
    gram: 'weight', grams: 'weight', ton: 'weight', tons: 'weight',
    ltr: 'volume', ltrs: 'volume', litre: 'volume', litres: 'volume', liter: 'volume', liters: 'volume', l: 'volume',
    nos: 'count', no: 'count', nog: 'count', pcs: 'count', pc: 'count', piece: 'count', pieces: 'count',
    unit: 'count', units: 'count', each: 'count', ea: 'count', qty: 'count',
    box: 'box', boxes: 'box', carton: 'box', cartons: 'box', pkt: 'box', packet: 'box', packets: 'box',
    pack: 'box', packs: 'box',
    set: 'set', sets: 'set', lot: 'set', job: 'set', ls: 'set',
    can: 'container', cans: 'container', jar: 'container', jars: 'container', bottle: 'container',
    bottles: 'container', bundle: 'container', bundles: 'container', roll: 'container', rolls: 'container',
    bag: 'container', bags: 'container', drum: 'container', drums: 'container',
    sheet: 'sheet', sheets: 'sheet', coil: 'coil', coils: 'coil',
    month: 'time', months: 'time', day: 'time', days: 'time', year: 'time', years: 'time',
    hr: 'time', hrs: 'time', hour: 'time', hours: 'time', week: 'time', weeks: 'time',
    person: 'people', persons: 'people', manpower: 'people', head: 'people',
    visit: 'visit', visits: 'visit', service: 'visit', services: 'visit', trip: 'visit',
    kwh: 'energy', mbps: 'bandwidth',
}));

/** The family a unit belongs to, or null when we do not recognise the word. */
export function unitFamily(raw: string | null | undefined): string | null {
    const key = String(raw ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!key) return null;
    return UNIT_FAMILY.get(key) ?? null;
}

/**
 * Families that are a MEASUREMENT — the ones where a per-unit rate means
 * something and losing the unit destroys the comparison.
 */
export const MEASURED_FAMILIES: ReadonlySet<string> = new Set(['area', 'length', 'weight', 'volume', 'time', 'people']);

/** Unit words as they appear inside a description. Longest first, so "mtr" wins over "m". */
const DESC_UNITS = [
    'sq. ft.', 'sq.ft.', 'sq.ft', 'sq ft', 'square feet', 'sq. feet', 'sqft', 'sft', 'sq.m', 'sq m', 'sqm',
    'r.ft', 'rft', 'running feet', 'rmt', 'mtr', 'metres', 'metre', 'meters', 'meter',
    'kgs', 'kg', 'gms', 'gm', 'grams', 'gram', 'ltrs', 'ltr', 'litres', 'litre', 'liters', 'liter',
    'pcs', 'pc', 'nos', 'no.', 'pieces', 'piece', 'units', 'unit', 'each',
    'boxes', 'box', 'packets', 'packet', 'pkt', 'sets', 'set', 'lot',
    'coils', 'coil', 'bundle', 'rolls', 'roll', 'sheets', 'sheet', 'can', 'jar', 'bottles', 'bottle',
    'months', 'month', 'days', 'day', 'hours', 'hrs', 'visits', 'visit', 'persons', 'person',
    'feet', 'ft', 'm',
].sort((a, b) => b.length - a.length);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "38.4 Sq. Ft." — a number immediately followed by a unit word. */
const QTY_UNIT = new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)\s*(${DESC_UNITS.map(esc).join('|')})(?![a-z])`, 'gi');

/** "@ 140", "@ Rs.94.50", "₹45" — a price stated in the line's own words. */
const STATED_RATE = /(?:@|₹|rs\.?)\s*(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)/gi;

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ''));

/** What the words call this line's quantity, when they name it at all. */
export function unitStatedFor(text: string | null | undefined, quantity: number): { family: string; phrase: string } | null {
    if (!text || !(quantity > 0)) return null;
    for (const m of String(text).replace(/\s+/g, ' ').matchAll(QTY_UNIT)) {
        const stated = toNumber(m[1]);
        if (!Number.isFinite(stated) || Math.abs(stated - quantity) > 0.005) continue;
        const family = unitFamily(m[2]);
        if (family) return { family, phrase: m[0] };
    }
    return null;
}

/** The line's own rate, quoted back in its description. Corroboration, not decoration. */
function rateStatedIn(text: string | null | undefined, rate: number): string | null {
    if (!text || !(rate > 0)) return null;
    for (const m of String(text).matchAll(STATED_RATE)) {
        if (Math.abs(toNumber(m[1]) - rate) < 0.005) return m[0].trim();
    }
    return null;
}

/** The description, cleaned of newlines and trimmed to something a mail can print. */
function quote(l: PoLine): string {
    const text = String(l.description ?? '').replace(/\s+/g, ' ').trim() || String(l.name ?? '').trim();
    return text.length > 130 ? `${text.slice(0, 127)}…` : text;
}

interface Contradiction { line: PoLine; stated: { family: string; phrase: string }; column: string; rateEcho: string | null; value: number }

export const unitContradictsDescription: Check = {
    id: 'unit-contradicts-desc',
    question: 'Does a line description name a different unit for the same quantity than the unit column records?',
    nature: 'event',
    needs: ['pos', 'lines'],

    run(ctx: CheckContext): CheckOutcome {
        // A check that cannot see its data says so. It never reports "clear".
        if (!ctx.lines.size) {
            return {
                findings: [],
                skipped: 'purchase-order line items are not synced yet — the unit and the words that contradict it are both on the line',
            };
        }

        const findings: Finding[] = [];
        const rejected = { noUnitColumn: 0, wordsSilent: 0, agrees: 0, notMeasureVsCount: 0, uncorroborated: 0, outsideWindow: 0 };
        let looked = 0;

        for (const po of ctx.live) {
            const all = ctx.lines.get(String(po.raw?.purchaseorder_id ?? '')) ?? [];
            if (!all.length) continue;

            const bad: Contradiction[] = [];
            for (const line of all) {
                looked++;

                // A blank unit is a different problem, and lineDetailMissing owns it.
                const column = unitFamily(line.unit);
                if (!column) { rejected.noUnitColumn++; continue; }

                const quantity = num(line.quantity);
                const stated = unitStatedFor(line.description, quantity) ?? unitStatedFor(line.name, quantity);
                if (!stated) { rejected.wordsSilent++; continue; }
                if (stated.family === column) { rejected.agrees++; continue; }

                // A measured thing booked as a counted one destroys the rate
                // comparison. The reverse is untidy and not worth a mail.
                if (!MEASURED_FAMILIES.has(stated.family) || MEASURED_FAMILIES.has(column)) {
                    rejected.notMeasureVsCount++;
                    continue;
                }

                // The pack-size trap: "5 LTR" on a can, quantity 5. Corroboration
                // is what separates the order's quantity from a coincidence.
                const rateEcho = rateStatedIn(line.description, num(line.rate));
                if (!rateEcho && Number.isInteger(quantity)) { rejected.uncorroborated++; continue; }

                bad.push({ line, stated, column: String(line.unit ?? '').trim(), rateEcho, value: lineValue(line) });
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
            const key = `unit-contradicts-desc:${po.raw?.purchaseorder_id ?? po.po_number ?? po.id}`;

            const worst = [...bad].sort((a, b) => b.value - a.value)[0];
            const spellings = [...new Set(bad.map((b) => b.stated.phrase.replace(/^[\d,.]+\s*/, '').trim()))].join(', ');
            const columns = [...new Set(bad.map((b) => b.column))].join(', ');

            const evidence: Evidence[] = bad.slice(0, 6).map((b) => ({
                ref: ctx.poRef(po),
                facts: [
                    `"${quote(b.line)}"`,
                    `quantity ${b.line.quantity} recorded as "${b.column}"`,
                    `the words say ${b.stated.phrase}`,
                    b.rateEcho ? `rate ${inr(num(b.line.rate))} matches "${b.rateEcho}"` : `quantity is fractional`,
                    inr(b.value),
                ].join(' · '),
            }));

            findings.push({
                key,
                priority: billed || value >= 100_000 ? 'critical' : 'action',
                title: `${vendor} — ${bad.length === 1 ? 'a line' : `${bad.length} lines`} measured in ${spellings} but ordered as "${columns}"`,
                vendor,
                property: site,
                amount: value,
                exposure: billed ? 'billed' : 'stoppable',
                problem:
                    `On ${label}, ${bad.length === 1 ? 'a line reads' : `${bad.length} lines read`} one way and ${bad.length === 1 ? 'is' : 'are'} booked another. ` +
                    `"${quote(worst.line)}" carries quantity ${worst.line.quantity} against unit "${worst.column}", ` +
                    `while the description calls the same ${worst.line.quantity} ${worst.stated.phrase.replace(/^[\d,.]+\s*/, '').trim()}` +
                    (worst.rateEcho ? ` and states the rate as "${worst.rateEcho}", which is exactly the ${inr(num(worst.line.rate))} on the line.` : `, and ${worst.line.quantity} is not a whole number of anything you can count.`) +
                    ` The total is right and the arithmetic is right — but the unit column is what a rate history compares on, ` +
                    `so ${inr(value)} of work is now recorded at a price per unit that does not exist. ` +
                    (billed
                        ? 'It has been billed, so the correction has to be agreed with the vendor rather than typed.'
                        : 'Nothing is billed yet, so the unit can still be corrected on the order.'),
                refs: [ctx.poRef(po)],
                evidence,
                reconcile: bad.slice(0, 4).map((b) => ({
                    what: `Unit for "${quote(b.line)}"`,
                    expected: b.stated.phrase.replace(/^[\d,.]+\s*/, '').trim(),
                    actual: b.column,
                    gap: `${inr(num(b.line.rate))} per ${b.column} is not ${inr(num(b.line.rate))} per ${b.stated.phrase.replace(/^[\d,.]+\s*/, '').trim()}`,
                })),
                counter:
                    `The fair counter is that "${columns}" is this vendor's house style for every line and everyone reading the bill knows the ` +
                    'description is authoritative. If so nobody was overcharged — but the unit column is then unusable for comparing this rate ' +
                    'against the next quote, which is the only thing it is for.',
                ask: `Correct the unit on ${bad.length === 1 ? 'this line' : `these ${bad.length} lines`} to what the description already says (${spellings}), or tell us the description is wrong — one of the two is.`,
                stats: [
                    { label: 'Lines', value: `${bad.length} of ${all.length}` },
                    { label: 'Value', value: inr(value) },
                    { label: 'Recorded as', value: columns },
                ],
                actions: [
                    {
                        recipient: 'ceo',
                        action: `Note that ${inr(value)} on ${label} is booked per "${columns}" while the bill measures it in ${spellings}. Rate comparisons against this vendor are unreliable until it is fixed.`,
                        deadline: 'This week',
                    },
                    {
                        recipient: 'procurement',
                        action: `Change the unit on ${bad.length === 1 ? 'the line' : `the ${bad.length} lines`} of ${label} to ${spellings} to match the description, and use the measured unit when raising this vendor next — raised ${shortDate(raisedAt(po))}.`,
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
                unit: 'live purchase-order lines read against their own description',
                note: findings.length
                    ? `${rejected.agrees} lines named a unit in the words and it agreed with the column`
                    : `no line names a different unit for its own quantity across ${looked} lines`,
            },
            rejected: {
                'unit column is blank — a different problem': rejected.noUnitColumn,
                'the words do not name this line\'s quantity': rejected.wordsSilent,
                'the words and the column agree': rejected.agrees,
                'a counted unit written as a set or lot — untidy, not a rate error': rejected.notMeasureVsCount,
                'the number could be a pack size, not the order quantity': rejected.uncorroborated,
                'raised outside the window': rejected.outsideWindow,
            },
        };
    },
};
