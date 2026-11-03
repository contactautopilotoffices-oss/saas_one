/**
 * Turns an invoice's check results into the reasons a person needs, in plain words and with the
 * actual figures: "The invoice total ₹4,96,780 is ₹1,03,250 more than what is left on the PO
 * (₹3,93,530)", never "po balance check".
 *
 * Used wherever an invoice is judged for a human: the Align screen, the upload progress view and
 * the PO's Documents tab. Pure: it reads the stored rule rows and invents nothing. A rule it has no
 * wording for falls back to the engine's own sentence, so nothing is ever dropped.
 */

export interface ReasonRow {
    rule_code: string;
    severity?: string;
    outcome: 'pass' | 'fail' | 'unknown' | string;
    invoice_line_no?: number | null;
    expected_value?: unknown;
    actual_value?: unknown;
    difference_amount?: number | string | null;
    explanation?: string | null;
    resolved_at?: string | null;
}

export type InvoiceStage = 'received' | 'reading' | 'checking' | 'done' | 'failed';

export interface Reasons {
    /** One line: what the invoice's standing is. */
    headline: string;
    /** Each reason, most important first. Empty when it matches. */
    reasons: string[];
    /** What to do about it, in one sentence. Null when nothing is needed. */
    next: string | null;
}

const inr = (n: unknown) => {
    const v = Number(n);
    return Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
};
const quoted = (s: string | null | undefined) => (s ?? '').match(/"([^"]+)"/)?.[1] ?? null;
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const isGstin = (s: unknown) => typeof s === 'string' && /^[0-9A-Z]{15}$/.test(s);
const statusWords = (s: unknown) => String(s ?? '').replace(/_/g, ' ');

const FIELD_WORDS: Record<string, string> = {
    invoice_number: 'the invoice number', invoice_date: 'the date', taxable_amount: 'the taxable amount', invoice_total: 'the total', vendor: 'the vendor',
};

// Most decisive first: a PO that cannot take an invoice outranks a rate difference.
/** The flow a reviewer reads top to bottom. Most decisive first. */
export const CHECK_ORDER = ['PO_ELIGIBLE', 'VENDOR_MATCH', 'DUPLICATE_CHECK', 'EXTRACTION_CONFIDENCE', 'INVOICE_IDENTITY', 'TOTAL_CHECK', 'PO_BALANCE_CHECK', 'LINE_ITEM_MAPPING', 'UNIT_RATE_CHECK', 'QUANTITY_CHECK', 'TAX_CHECK', 'EXTRA_CHARGES_CHECK'];

/** One stored check result as a plain sentence with its figures. */
export function reasonFor(r: ReasonRow): string {
    const exp = r.expected_value, act = r.actual_value;
    const name = quoted(r.explanation);
    const at = r.invoice_line_no ? `Line ${r.invoice_line_no}` : 'A line';
    switch (r.rule_code) {
        case 'PO_ELIGIBLE':
            return String(act ?? '').toLowerCase().includes('pending')
                ? 'This PO has not been approved yet, so no invoice can be accepted against it. It needs the founder\'s approval first.'
                : `This PO is "${statusWords(act) || 'not open'}", so it cannot take an invoice.`;
        case 'PO_BALANCE_CHECK': {
            // Nothing left (or less than nothing): earlier invoices already cover the PO. Saying
            // "more than the ₹-16,166 left" reads as nonsense, so say what is actually true.
            const used = Number(r.explanation?.match(/([\d.]+)\s+already invoiced/)?.[1]);
            if (Number(exp) <= 0) {
                return `Nothing is left on this PO: earlier invoices${Number.isFinite(used) ? ` (${inr(used)})` : ''} already use up its value. This invoice adds ${inr(act)}. If an earlier invoice was a mistake, reject it first.`;
            }
            return `The invoice total ${inr(act)} is ${inr(r.difference_amount)} more than what is left on the PO (${inr(exp)}).`;
        }
        case 'TOTAL_CHECK':
            return r.outcome === 'unknown'
                ? 'The taxable amount, tax or total could not be read, so the total could not be checked.'
                : `The invoice total does not add up: it should be ${inr(exp)}, but the invoice says ${inr(act)}.`;
        case 'UNIT_RATE_CHECK':
            return r.outcome === 'unknown'
                ? (r.explanation ?? 'A rate could not be compared with the PO.')
                : `${at}${name ? ` (${short(name, 40)})` : ''}: the invoice charges ${inr(act)} per unit, but the PO rate is ${inr(exp)}.`;
        case 'QUANTITY_CHECK':
            return r.outcome === 'unknown'
                ? (r.explanation ?? 'A quantity could not be checked.')
                : `${name ? `"${short(name, 40)}"` : at}: ${act} billed in total against ${exp} ordered on the PO.`;
        case 'VENDOR_MATCH':
            if (r.outcome === 'unknown') return 'Could not confirm which vendor issued this invoice.';
            return isGstin(act) && isGstin(exp)
                ? `The GSTIN on the invoice (${act}) is not this vendor's GSTIN on record (${exp}). Either it is the wrong vendor, or the number was misread.`
                : `The vendor on the invoice ("${act}") does not look like the PO vendor ("${exp}").`;
        case 'DUPLICATE_CHECK':
            return r.outcome === 'unknown'
                ? 'Could not check whether this invoice was already received, because it has no invoice number.'
                : (r.explanation?.includes('file') ? 'This exact file was already submitted.' : 'An invoice with the same number from this vendor was already received.');
        case 'INVOICE_IDENTITY':
            return r.outcome === 'unknown' ? (r.explanation ?? 'The invoice number or date could not be found.').replace(/^Missing:\s*/i, 'Could not find: ').replace(/\.$/, '') + ' on the document.' : (r.explanation ?? 'The invoice details look wrong.');
        case 'EXTRACTION_CONFIDENCE': {
            if (!Array.isArray(act)) return 'The invoice could not be read, so none of it could be trusted.';
            const fields = act.map((x) => String(x).replace(/\s*\(.*\)$/, '')).map((f) => FIELD_WORDS[f] ?? f.replace(/_/g, ' '));
            return `Could not read ${fields.join(', ')} clearly. A sharper copy of the invoice may help.`;
        }
        case 'EXTRA_CHARGES_CHECK':
            return 'The invoice includes extra charges or a discount that the PO does not mention.';
        case 'DOCUMENT_TRUNCATED':
            return 'Only part of this document was read (it has more pages than the reader takes), so the invoice cannot be fully trusted. Check the PDF by eye, then resolve this with a reason.';
        case 'TAX_CHECK':
            return r.outcome === 'unknown' ? 'The tax details could not be fully read, so tax was not checked.' : (r.explanation ?? 'The tax on the invoice does not add up.');
        default:
            return r.explanation ?? `${statusWords(r.rule_code)} did not pass.`;
    }
}

/** Reasons for every check that has not passed and has not been resolved by a person. */
export function plainReasons(rows: ReasonRow[], matchStatus?: string | null): Reasons {
    const open = rows.filter((r) => r.outcome !== 'pass' && !r.resolved_at);
    const out: { code: string; text: string }[] = [];

    // Several unmatched lines read better as one sentence.
    const unmapped = open.filter((r) => r.rule_code === 'LINE_ITEM_MAPPING');
    if (unmapped.length) {
        const names = unmapped.map((r) => (typeof r.actual_value === 'string' ? r.actual_value : quoted(r.explanation) ?? 'a line')).map((n) => `"${short(n.replace(/\s*\(additional test line[^)]*\)\.?/i, ''), 90)}"`);
        out.push({ code: 'LINE_ITEM_MAPPING', text: unmapped.length === 1 && !unmapped[0].invoice_line_no && unmapped[0].outcome === 'unknown' && !names.length
            ? (unmapped[0].explanation ?? 'The invoice lines could not be matched to the PO.')
            : `${unmapped.length === 1 ? '1 line' : `${unmapped.length} lines`} on the invoice ${unmapped.length === 1 ? 'is' : 'are'} not on the PO: ${names.join(', ')}.` });
    }
    // Rates and quantities: one sentence per line, as written.
    for (const r of open.filter((x) => x.rule_code !== 'LINE_ITEM_MAPPING')) out.push({ code: r.rule_code, text: reasonFor(r) });

    const rank = (c: string) => { const i = CHECK_ORDER.indexOf(c); return i < 0 ? CHECK_ORDER.length : i; };
    out.sort((a, b) => rank(a.code) - rank(b.code));
    const reasons = [...new Set(out.map((o) => o.text))];

    const status = matchStatus ?? (reasons.length ? 'needs_review' : 'matched');
    const headline = status === 'matched' || !reasons.length ? 'Matches the PO'
        : status === 'duplicate_suspected' ? 'Looks like an invoice already received'
        : status === 'mismatched' ? 'Does not match the PO'
        : 'Needs a person to check it';
    const next = !reasons.length ? null
        : status === 'needs_review' ? 'Check the invoice in Invoice Control, or upload a clearer copy.'
        : 'Attach a corrected invoice for this PO, or have each issue resolved in Invoice Control.';
    return { headline, reasons, next };
}

/** Where an invoice is in being read and checked, for the live progress view. No detail, just the step. */
export function invoiceStage(inv: { extraction_status?: string | null; match_status?: string | null }, hasRules = false): InvoiceStage {
    const ex = inv.extraction_status ?? 'pending';
    if (ex === 'pending') return 'received';
    if (ex === 'processing') return 'reading';
    // Reading finished (or failed) but the verdict is not written yet.
    if ((inv.match_status ?? 'pending') === 'pending' && !hasRules) return ex === 'failed' ? 'failed' : 'checking';
    return 'done';
}

export const STAGE_STEPS: { key: InvoiceStage; label: string }[] = [
    { key: 'received', label: 'Received' },
    { key: 'reading', label: 'Reading the invoice' },
    { key: 'checking', label: 'Checking against the PO' },
    { key: 'done', label: 'Done' },
];
