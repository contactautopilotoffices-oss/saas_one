/**
 * The matching engine: a pure function from (PO, PO lines, invoice, history, policy)
 * to a list of rule outcomes. No database, no model, no clock.
 *
 * OCR reads the invoice; THIS decides whether it agrees with the PO. Keeping the two
 * apart means a wrong read can be corrected by a person and re-run, and the same
 * inputs always give the same verdict.
 *
 * Rules this file will not break:
 *   - A value that is missing is UNKNOWN. It is never zero and never a pass.
 *   - Money is compared in whole paise (integers), never as floats.
 *   - A line that cannot be mapped to a PO line is UNKNOWN, not "no difference".
 *   - Cumulative billing: every invoice is checked against what is LEFT on the PO after
 *     the other invoices, not against the original total each time.
 */

import type { InvoiceSettings, MatchStatus, RuleResult, SummarisableResult } from './types';
import { isPoEligible } from './types';

// --- inputs -----------------------------------------------------------------

export interface MatchPoLine {
    id: string;
    item_id: string | null;
    name: string | null;
    description: string | null;
    hsn_or_sac: string | null;
    unit: string | null;
    quantity: number | null;
    rate: number | null;
    tax_percentage: number | null;
}

export interface MatchInvoiceLine {
    line_no: number;
    description: string;
    item_code: string | null;
    hsn_or_sac: string | null;
    quantity: number | null;
    unit: string | null;
    unit_rate: number | null;
    taxable_amount: number | null;
    tax_rate: number | null;
    tax_amount: number | null;
    line_total: number | null;
}

export interface MatchInput {
    po: { status: string | null; amount: number | null; vendor_name: string | null };
    poLines: MatchPoLine[];
    /** From vendor_profiles, when the vendor has one. */
    vendorGstin: string | null;
    invoice: {
        invoice_number: string | null;
        invoice_date: string | null;          // YYYY-MM-DD
        vendor_name_read: string | null;
        vendor_gstin_read: string | null;
        taxable_amount: number | null;
        tax_amount: number | null;
        other_charges: number | null;
        discount_amount: number | null;
        invoice_total: number | null;
        /** 0-100 per header field, as the reader reported it. */
        field_confidence: Record<string, number>;
        extraction_ok: boolean;
    };
    lines: MatchInvoiceLine[];
    /** Other invoices on this PO that still count against it (not rejected). */
    priorInvoices: { id: string; invoice_total: number | null }[];
    /** Quantity already invoiced per PO line by those other invoices. */
    priorLineQty: Record<string, number>;
    /** Other invoices from this vendor with the same normalised number, or the same file. */
    duplicates: { id: string; reason: 'same_number' | 'same_file'; invoice_number: string | null; invoice_total: number | null }[];
    settings: Pick<InvoiceSettings, 'amount_tolerance' | 'rate_tolerance_pct' | 'qty_tolerance_pct' | 'min_confidence'>;
    /** Today, YYYY-MM-DD. Injected so the function stays pure. */
    today: string;
}

export interface MatchOutput {
    results: RuleResult[];
    /** invoice line_no -> PO line id (null = could not be mapped). */
    lineMapping: Record<number, string | null>;
    status: MatchStatus;
}

// --- money ------------------------------------------------------------------

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;
const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

// --- text similarity ----------------------------------------------------------

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'a', 'an', 'as', 'per', 'qty', 'nos', 'no', 'pcs']);
const COMPANY_NOISE = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'corp', 'corporation', 'inc', 'india', 'and', 'the', 'enterprises', 'enterprise']);

function tokens(s: string | null | undefined, drop: Set<string> = STOP): string[] {
    return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !drop.has(t) && (t.length > 1 || /\d/.test(t)));
}

function jaccard(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
}

const normCode = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normUnit = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');

// --- line mapping -------------------------------------------------------------

const MAP_THRESHOLD = 0.6;
const AMBIGUITY_GAP = 0.05;

interface Mapped { poLineId: string | null; score: number; ambiguous: boolean }

function mapLine(line: MatchInvoiceLine, poLines: MatchPoLine[]): Mapped {
    const code = normCode(line.item_code);
    const lineTokens = tokens(line.description);
    const scored = poLines.map((pl) => {
        let score = 0;
        if (code && (code === normCode(pl.item_id) || code === normCode(pl.name))) score = 1;
        const byName = jaccard(lineTokens, tokens(pl.name));
        const byFull = jaccard(lineTokens, tokens(`${pl.name ?? ''} ${pl.description ?? ''}`));
        score = Math.max(score, byName, byFull);
        // A matching HSN/SAC on top of a partial description match is real evidence.
        if (line.hsn_or_sac && pl.hsn_or_sac && normCode(line.hsn_or_sac) === normCode(pl.hsn_or_sac) && score >= 0.35) score = Math.min(1, score + 0.2);
        return { id: pl.id, score };
    }).sort((x, y) => y.score - x.score);

    const best = scored[0];
    if (!best || best.score < MAP_THRESHOLD) return { poLineId: null, score: best?.score ?? 0, ambiguous: false };
    const next = scored[1];
    if (next && best.score - next.score < AMBIGUITY_GAP && best.score < 1) return { poLineId: null, score: best.score, ambiguous: true };
    return { poLineId: best.id, score: best.score, ambiguous: false };
}

// --- the engine -------------------------------------------------------------

const CHARGE_WORDS = /freight|transport|delivery|packing|packaging|loading|unloading|cartage|courier|handling|installation|labou?r/i;

export function matchInvoice(input: MatchInput): MatchOutput {
    const { po, poLines, invoice: inv, lines, settings } = input;
    const results: RuleResult[] = [];
    const tolP = paise(settings.amount_tolerance);
    const add = (r: RuleResult) => results.push(r);

    // EXTRACTION_CONFIDENCE ------------------------------------------------------
    {
        if (!inv.extraction_ok) {
            add({ rule_code: 'EXTRACTION_CONFIDENCE', severity: 'blocking', outcome: 'unknown',
                explanation: 'The invoice could not be read automatically, so nothing below can be trusted. A person must enter the values.' });
        } else {
            const fields: [string, unknown][] = [
                ['invoice_number', inv.invoice_number], ['invoice_date', inv.invoice_date],
                ['taxable_amount', inv.taxable_amount], ['invoice_total', inv.invoice_total],
                ['vendor', inv.vendor_gstin_read ?? inv.vendor_name_read],
            ];
            const weak: string[] = [];
            for (const [name, value] of fields) {
                const conf = inv.field_confidence[name];
                if (value == null || value === '') weak.push(`${name} (not read)`);
                else if (typeof conf === 'number' && conf < settings.min_confidence) weak.push(`${name} (${conf}%)`);
            }
            add(weak.length
                ? { rule_code: 'EXTRACTION_CONFIDENCE', severity: 'blocking', outcome: 'unknown',
                    expected: `each field at least ${settings.min_confidence}% sure`, actual: weak,
                    explanation: `These fields are missing or were read with low confidence: ${weak.join(', ')}. Check them against the document.` }
                : { rule_code: 'EXTRACTION_CONFIDENCE', severity: 'blocking', outcome: 'pass', explanation: 'All mandatory fields were read with enough confidence.' });
        }
    }

    // PO_ELIGIBLE ---------------------------------------------------------------
    add(isPoEligible(po.status)
        ? { rule_code: 'PO_ELIGIBLE', severity: 'blocking', outcome: 'pass', explanation: `PO status "${po.status}" can take an invoice.` }
        : { rule_code: 'PO_ELIGIBLE', severity: 'blocking', outcome: 'fail', actual: po.status,
            explanation: `PO status "${po.status ?? 'blank'}" cannot take an invoice.` });

    // VENDOR_MATCH --------------------------------------------------------------
    {
        const poGst = normCode(input.vendorGstin);
        const invGst = normCode(inv.vendor_gstin_read);
        if (poGst && invGst) {
            add(poGst === invGst
                ? { rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'pass', explanation: 'GSTIN on the invoice matches the vendor on record.' }
                : { rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'fail', expected: poGst, actual: invGst,
                    explanation: `Invoice GSTIN ${invGst} is not the vendor's GSTIN on record (${poGst}).` });
        } else if (inv.vendor_name_read) {
            const sim = jaccard(tokens(inv.vendor_name_read, COMPANY_NOISE), tokens(po.vendor_name, COMPANY_NOISE));
            if (sim >= 0.6) add({ rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'pass', expected: po.vendor_name, actual: inv.vendor_name_read, explanation: 'Vendor name on the invoice matches the PO vendor (no GSTIN on one side to confirm).' });
            else if (sim < 0.3) add({ rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'fail', expected: po.vendor_name, actual: inv.vendor_name_read, explanation: `Invoice vendor "${inv.vendor_name_read}" does not look like the PO vendor "${po.vendor_name ?? ''}".` });
            else add({ rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'unknown', expected: po.vendor_name, actual: inv.vendor_name_read, explanation: 'Vendor names are similar but not clearly the same, and there is no GSTIN to settle it.' });
        } else {
            add({ rule_code: 'VENDOR_MATCH', severity: 'blocking', outcome: 'unknown', explanation: 'No vendor name or GSTIN was read from the invoice.' });
        }
    }

    // INVOICE_IDENTITY ----------------------------------------------------------
    {
        const missing = [!inv.invoice_number && 'invoice number', !inv.invoice_date && 'invoice date'].filter(Boolean) as string[];
        if (missing.length) add({ rule_code: 'INVOICE_IDENTITY', severity: 'blocking', outcome: 'unknown', explanation: `Missing: ${missing.join(' and ')}.` });
        else if (inv.invoice_date! > input.today) add({ rule_code: 'INVOICE_IDENTITY', severity: 'warning', outcome: 'fail', actual: inv.invoice_date, explanation: `Invoice date ${inv.invoice_date} is in the future.` });
        else add({ rule_code: 'INVOICE_IDENTITY', severity: 'blocking', outcome: 'pass', explanation: 'Invoice number and date are present.' });
    }

    // DUPLICATE_CHECK -----------------------------------------------------------
    {
        if (input.duplicates.length) {
            add({ rule_code: 'DUPLICATE_CHECK', severity: 'blocking', outcome: 'fail',
                actual: input.duplicates.map((d) => ({ invoice_id: d.id, reason: d.reason, invoice_number: d.invoice_number, invoice_total: d.invoice_total })),
                explanation: input.duplicates.some((d) => d.reason === 'same_file')
                    ? 'This exact file was already submitted. Hold for a person to decide.'
                    : 'Another invoice from this vendor carries the same number. Hold for a person to decide.' });
        } else if (!inv.invoice_number) {
            add({ rule_code: 'DUPLICATE_CHECK', severity: 'blocking', outcome: 'unknown', explanation: 'Cannot check for duplicates without an invoice number.' });
        } else {
            add({ rule_code: 'DUPLICATE_CHECK', severity: 'blocking', outcome: 'pass', explanation: 'No earlier invoice from this vendor has this number or this file.' });
        }
    }

    // LINE_ITEM_MAPPING ---------------------------------------------------------
    const lineMapping: Record<number, string | null> = {};
    const poById = new Map(poLines.map((p) => [p.id, p]));
    {
        if (!lines.length) {
            add({ rule_code: 'LINE_ITEM_MAPPING', severity: 'blocking', outcome: 'unknown', explanation: 'No line items were read from the invoice.' });
        } else if (!poLines.length) {
            for (const l of lines) lineMapping[l.line_no] = null;
            add({ rule_code: 'LINE_ITEM_MAPPING', severity: 'blocking', outcome: 'unknown', explanation: 'The PO has no line items on file, so lines cannot be compared.' });
        } else {
            let unmapped = 0;
            for (const l of lines) {
                const m = mapLine(l, poLines);
                lineMapping[l.line_no] = m.poLineId;
                if (!m.poLineId) {
                    unmapped++;
                    add({ rule_code: 'LINE_ITEM_MAPPING', severity: 'blocking', outcome: 'unknown', invoice_line_no: l.line_no, actual: l.description,
                        explanation: m.ambiguous
                            ? `Line ${l.line_no} "${l.description}" fits two PO lines about equally. Pick the right one.`
                            : `Line ${l.line_no} "${l.description}" does not match any PO line.` });
                }
            }
            if (!unmapped) add({ rule_code: 'LINE_ITEM_MAPPING', severity: 'blocking', outcome: 'pass', explanation: `All ${lines.length} invoice lines map to PO lines.` });
        }
    }

    // QUANTITY_CHECK ------------------------------------------------------------
    {
        const billedNow: Record<string, number> = {};
        const unreadable: number[] = [];
        for (const l of lines) {
            const poId = lineMapping[l.line_no];
            if (!poId) continue;
            if (!has(l.quantity)) { unreadable.push(l.line_no); continue; }
            billedNow[poId] = (billedNow[poId] ?? 0) + l.quantity;
        }
        for (const lineNo of unreadable) {
            add({ rule_code: 'QUANTITY_CHECK', severity: 'blocking', outcome: 'unknown', invoice_line_no: lineNo, explanation: `Line ${lineNo} has no quantity.` });
        }
        for (const [poId, qty] of Object.entries(billedNow)) {
            const pl = poById.get(poId)!;
            if (!has(pl.quantity)) { add({ rule_code: 'QUANTITY_CHECK', severity: 'blocking', outcome: 'unknown', po_line_item_id: poId, explanation: `PO line "${pl.name}" has no quantity to compare with.` }); continue; }
            const before = input.priorLineQty[poId] ?? 0;
            const cumulative = before + qty;
            const allowed = pl.quantity * (1 + settings.qty_tolerance_pct / 100);
            if (cumulative > allowed + 1e-6) {
                add({ rule_code: 'QUANTITY_CHECK', severity: 'blocking', outcome: 'fail', po_line_item_id: poId,
                    expected: pl.quantity, actual: cumulative, difference: Math.round((cumulative - pl.quantity) * 10000) / 10000,
                    explanation: `"${pl.name}": ${cumulative} billed in total (${before} earlier + ${qty} here) against ${pl.quantity} ordered.` });
            } else {
                add({ rule_code: 'QUANTITY_CHECK', severity: 'blocking', outcome: 'pass', po_line_item_id: poId, expected: pl.quantity, actual: cumulative,
                    explanation: `"${pl.name}": ${cumulative} of ${pl.quantity} ordered.` });
            }
        }
    }

    // UNIT_RATE_CHECK -----------------------------------------------------------
    for (const l of lines) {
        const poId = lineMapping[l.line_no];
        if (!poId) continue;
        const pl = poById.get(poId)!;
        if (!has(l.unit_rate) || !has(pl.rate)) {
            add({ rule_code: 'UNIT_RATE_CHECK', severity: 'blocking', outcome: 'unknown', invoice_line_no: l.line_no, po_line_item_id: poId,
                explanation: `Line ${l.line_no}: ${!has(l.unit_rate) ? 'no rate on the invoice' : 'no rate on the PO line'}.` });
            continue;
        }
        if (l.unit && pl.unit && normUnit(l.unit) !== normUnit(pl.unit)) {
            add({ rule_code: 'UNIT_RATE_CHECK', severity: 'blocking', outcome: 'unknown', invoice_line_no: l.line_no, po_line_item_id: poId, expected: pl.unit, actual: l.unit,
                explanation: `Line ${l.line_no}: invoice is priced per "${l.unit}", the PO per "${pl.unit}". The rates are not comparable.` });
            continue;
        }
        const diff = l.unit_rate - pl.rate;
        const allowed = Math.abs(pl.rate) * settings.rate_tolerance_pct / 100 + 0.005;
        if (Math.abs(diff) > allowed) {
            add({ rule_code: 'UNIT_RATE_CHECK', severity: 'blocking', outcome: 'fail', invoice_line_no: l.line_no, po_line_item_id: poId,
                expected: pl.rate, actual: l.unit_rate, difference: has(l.quantity) ? rupees(paise(diff * l.quantity)) : null,
                explanation: `Line ${l.line_no} "${pl.name}": invoiced at ${l.unit_rate}, PO rate is ${pl.rate} (${diff > 0 ? '+' : ''}${Math.round(diff * 100) / 100} per unit).` });
        } else {
            add({ rule_code: 'UNIT_RATE_CHECK', severity: 'blocking', outcome: 'pass', invoice_line_no: l.line_no, po_line_item_id: poId, expected: pl.rate, actual: l.unit_rate,
                explanation: `Line ${l.line_no}: rate ${l.unit_rate} agrees with the PO.` });
        }
    }

    // TAX_CHECK -----------------------------------------------------------------
    {
        let checked = 0;
        for (const l of lines) {
            if (has(l.taxable_amount) && has(l.tax_rate) && has(l.tax_amount)) {
                checked++;
                const expected = paise(l.taxable_amount * l.tax_rate / 100);
                if (Math.abs(expected - paise(l.tax_amount)) > tolP) {
                    add({ rule_code: 'TAX_CHECK', severity: 'warning', outcome: 'fail', invoice_line_no: l.line_no,
                        expected: rupees(expected), actual: l.tax_amount, difference: rupees(paise(l.tax_amount) - expected),
                        explanation: `Line ${l.line_no}: ${l.tax_rate}% of ${l.taxable_amount} is ${rupees(expected)}, but the invoice shows ${l.tax_amount} tax.` });
                }
            }
            const poId = lineMapping[l.line_no];
            const pl = poId ? poById.get(poId) : null;
            if (pl && has(pl.tax_percentage) && has(l.tax_rate) && Math.abs(pl.tax_percentage - l.tax_rate) > 0.01) {
                add({ rule_code: 'TAX_CHECK', severity: 'warning', outcome: 'fail', invoice_line_no: l.line_no, po_line_item_id: poId,
                    expected: pl.tax_percentage, actual: l.tax_rate,
                    explanation: `Line ${l.line_no}: tax rate ${l.tax_rate}% differs from the PO's ${pl.tax_percentage}%.` });
            }
        }
        const lineTax = lines.filter((l) => has(l.tax_amount));
        if (has(inv.tax_amount) && lineTax.length === lines.length && lines.length) {
            checked++;
            const sum = lineTax.reduce((s, l) => s + paise(l.tax_amount!), 0);
            if (Math.abs(sum - paise(inv.tax_amount)) > tolP * Math.max(1, lines.length)) {
                add({ rule_code: 'TAX_CHECK', severity: 'warning', outcome: 'fail', expected: rupees(sum), actual: inv.tax_amount, difference: rupees(paise(inv.tax_amount) - sum),
                    explanation: `Tax on the lines adds to ${rupees(sum)}, but the invoice header says ${inv.tax_amount}.` });
            }
        }
        const failedTax = results.some((r) => r.rule_code === 'TAX_CHECK');
        if (!checked) add({ rule_code: 'TAX_CHECK', severity: 'warning', outcome: 'unknown', explanation: 'Not enough tax detail was read (rate, taxable amount and tax) to check it.' });
        else if (!failedTax) add({ rule_code: 'TAX_CHECK', severity: 'warning', outcome: 'pass', explanation: 'Tax figures are consistent.' });
    }

    // TOTAL_CHECK ---------------------------------------------------------------
    {
        if (has(inv.invoice_total) && has(inv.taxable_amount) && has(inv.tax_amount)) {
            const expected = paise(inv.taxable_amount) + paise(inv.tax_amount) + paise(inv.other_charges ?? 0) - paise(inv.discount_amount ?? 0);
            const diff = paise(inv.invoice_total) - expected;
            add(Math.abs(diff) > tolP
                ? { rule_code: 'TOTAL_CHECK', severity: 'blocking', outcome: 'fail', expected: rupees(expected), actual: inv.invoice_total, difference: rupees(diff),
                    explanation: `Taxable ${inv.taxable_amount} + tax ${inv.tax_amount}${inv.other_charges ? ` + charges ${inv.other_charges}` : ''}${inv.discount_amount ? ` − discount ${inv.discount_amount}` : ''} is ${rupees(expected)}, but the invoice total is ${inv.invoice_total}.` }
                : { rule_code: 'TOTAL_CHECK', severity: 'blocking', outcome: 'pass', expected: rupees(expected), actual: inv.invoice_total, explanation: 'Header total reconciles with taxable value, tax and charges.' });
        } else {
            add({ rule_code: 'TOTAL_CHECK', severity: 'blocking', outcome: 'unknown', explanation: 'Taxable amount, tax or total is missing, so the total cannot be reconciled.' });
        }
        if (lines.length && lines.every((l) => has(l.taxable_amount)) && has(inv.taxable_amount)) {
            const sum = lines.reduce((s, l) => s + paise(l.taxable_amount!), 0);
            if (Math.abs(sum - paise(inv.taxable_amount)) > tolP * Math.max(1, lines.length)) {
                add({ rule_code: 'TOTAL_CHECK', severity: 'blocking', outcome: 'fail', expected: rupees(sum), actual: inv.taxable_amount, difference: rupees(paise(inv.taxable_amount) - sum),
                    explanation: `Line values add to ${rupees(sum)}, but the invoice taxable amount is ${inv.taxable_amount}.` });
            }
        }
    }

    // PO_BALANCE_CHECK ----------------------------------------------------------
    {
        if (!has(inv.invoice_total)) {
            add({ rule_code: 'PO_BALANCE_CHECK', severity: 'blocking', outcome: 'unknown', explanation: 'No invoice total, so the PO balance cannot be checked.' });
        } else if (!has(po.amount) || po.amount <= 0) {
            add({ rule_code: 'PO_BALANCE_CHECK', severity: 'blocking', outcome: 'unknown', explanation: 'The PO has no value on file.' });
        } else {
            const earlier = input.priorInvoices.reduce((s, p) => s + (has(p.invoice_total) ? paise(p.invoice_total) : 0), 0);
            const remaining = paise(po.amount) - earlier;
            const over = paise(inv.invoice_total) - remaining;
            add(over > tolP
                ? { rule_code: 'PO_BALANCE_CHECK', severity: 'blocking', outcome: 'fail', expected: rupees(remaining), actual: inv.invoice_total, difference: rupees(over),
                    explanation: `Invoice ${inv.invoice_total} exceeds the ${rupees(remaining)} left on the PO (PO ${po.amount}, ${rupees(earlier)} already invoiced).` }
                : { rule_code: 'PO_BALANCE_CHECK', severity: 'blocking', outcome: 'pass', expected: rupees(remaining), actual: inv.invoice_total,
                    explanation: `Within the ${rupees(remaining)} left on the PO.` });
        }
    }

    // EXTRA_CHARGES_CHECK -------------------------------------------------------
    {
        const other = inv.other_charges ?? 0;
        const disc = inv.discount_amount ?? 0;
        const chargeLines = lines.filter((l) => CHARGE_WORDS.test(l.description) && !lineMapping[l.line_no]);
        if (other > 0 || disc > 0 || chargeLines.length) {
            const poHasCharge = poLines.some((p) => CHARGE_WORDS.test(`${p.name ?? ''} ${p.description ?? ''}`));
            if (!poHasCharge) {
                add({ rule_code: 'EXTRA_CHARGES_CHECK', severity: 'warning', outcome: 'fail', actual: { other_charges: other, discount: disc, charge_lines: chargeLines.map((l) => l.description) },
                    explanation: 'The invoice carries freight, a discount or another charge that the PO does not mention.' });
            } else {
                add({ rule_code: 'EXTRA_CHARGES_CHECK', severity: 'warning', outcome: 'pass', explanation: 'The PO includes a matching charge line.' });
            }
        } else {
            add({ rule_code: 'EXTRA_CHARGES_CHECK', severity: 'warning', outcome: 'pass', explanation: 'No extra charges or discounts.' });
        }
    }

    return { results, lineMapping, status: summariseMatch(results) };
}

/**
 * The invoice's match status from a set of rule results. Also run on STORED rows, so a
 * resolved row (a person overrode it) stops counting without the original outcome being
 * touched.
 *
 *   duplicate fail            -> duplicate_suspected
 *   any blocking fail         -> mismatched
 *   any unknown / soft fail   -> needs_review   (the engine cannot decide alone)
 *   otherwise                 -> matched
 */
export function summariseMatch(results: SummarisableResult[]): MatchStatus {
    const live = results.filter((r) => !r.resolved);
    if (live.some((r) => r.rule_code === 'DUPLICATE_CHECK' && r.outcome === 'fail')) return 'duplicate_suspected';
    if (live.some((r) => r.severity === 'blocking' && r.outcome === 'fail')) return 'mismatched';
    if (live.some((r) => r.outcome === 'unknown' || r.outcome === 'fail')) return 'needs_review';
    return 'matched';
}
