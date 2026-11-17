/**
 * Reads a PO's payment terms (free text) into a payment schedule: a list of milestones,
 * each with a percentage, an amount and the event that makes it payable.
 *
 * Why text and not Zoho's own "payment terms" field: on the live data that field is wrong
 * where it matters. DL-PO-26/27-0086 is labelled "100% Advance" while its terms say 30% on
 * order, 20% on delivery, 20% at 90% completion, 30% at 100% completion. 676 of the first
 * 1,000 POs are just "Custom". The real terms are in the `terms` / `notes` text.
 *
 * Pure function: no database, no model, no clock. A parse is only a PROPOSAL. The caller
 * stores it as a draft and a person confirms it, so the checks here exist to tell that
 * person how much to trust it, not to replace them:
 *   - percentages of the basic value must add to 100
 *   - a stated amount must equal percent x value (within rounding)
 *   - anything the reader was unsure of becomes a warning, never a silent guess
 */

export type MilestoneTrigger = 'on_po' | 'on_delivery' | 'on_progress' | 'on_completion' | 'on_invoice' | 'gst_on_portal' | 'other';
/** basic = before GST, gst = the tax part, total = percent of the whole PO value (terms silent on GST). */
export type MilestoneBasis = 'basic' | 'gst' | 'total';

export interface ParsedMilestone {
    seq: number;
    label: string;
    basis: MilestoneBasis;
    percent: number;
    amount: number | null;
    /** true when the text printed the amount; false when it was worked out from the percentage. */
    amount_stated: boolean;
    trigger: MilestoneTrigger;
    /** For on_progress: the completion % that makes it payable (e.g. 25, 90). */
    progress_pct: number | null;
    due_within_days: number | null;
    source_line: string;
}

export interface ParsedSchedule {
    status: 'ok' | 'check' | 'none';
    milestones: ParsedMilestone[];
    /** Things a person should check before confirming. Any warning makes the status 'check'. */
    warnings: string[];
    /** Plain facts worth showing, that do not need a decision. */
    notes: string[];
}

export interface ParseValues {
    /** PO value before GST: the sum of the line totals. */
    basic: number | null;
    /** PO value as Zoho holds it, GST included. */
    total: number | null;
    gstRatePct?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseAmount(s: string): number {
    return Number(s.replace(/,/g, ''));
}

/** The last "(43,000)" or "Rs 60,030" on the line, if any. */
function statedAmount(line: string): number | null {
    const paren = [...line.matchAll(/\(\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)\s*\)/gi)].pop();
    if (paren) return parseAmount(paren[1]);
    const rs = [...line.matchAll(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)/gi)].pop();
    return rs ? parseAmount(rs[1]) : null;
}

const PROGRESS_RE = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(?:work\s+)?(?:completion|completed|complete|progress|done)/i;

function triggerOf(text: string): MilestoneTrigger {
    const t = text.toLowerCase();
    if (/portal|gstr|2b|reflect/.test(t)) return 'gst_on_portal';
    if (/advance|against\s+(the\s+)?(po|purchase\s+order)|along\s+with\s+(the\s+)?po|with\s+(the\s+)?po\b|on\s+order|booking/.test(t)) return 'on_po';
    if (/deliver|dispatch|at\s+site|receipt\s+of\s+(material|goods)/.test(t)) return 'on_delivery';
    if (/complet|handover|hand\s+over|commission|go[\s-]?live/.test(t)) return 'on_completion';
    if (/invoice|bill/.test(t)) return 'on_invoice';
    return 'other';
}

/** Split "a (CGST + SGST) + b" on the " + " that is not inside brackets. */
function splitOutsideBrackets(line: string): string[] {
    const out: string[] = [];
    let depth = 0, cur = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (depth === 0 && ch === '+' && /\s/.test(line[i - 1] ?? '') && /\s|\d/.test(line[i + 1] ?? '')) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out;
}

const STOP_HEADINGS = /^(delivery|mobili[sz]ation|warranty|loading|bank\s+details|timelines?|terms\s+and\s+conditions|scope|penalt|liquidated|retention)/i;
const SUMMARY_LINE = /^(\(?\s*all\s+milestone|basic\s+value|grand\s+total|sub\s*total|total\b|note\s*:|tax\b|gst\s*(rate|applicable|extra)|\d+\s*%\s*gst\s*(applicable|extra|as applicable))/i;

/** The lines under a "Payment Terms" heading, up to the next section. Null when there is no heading. */
function paymentBlock(lines: string[]): string[] | null {
    const start = lines.findIndex((l) => /^payment\s*terms?\b/i.test(l.replace(/^\d+[.)]\s*/, '')));
    if (start < 0) return null;
    const block: string[] = [];
    const first = lines[start].replace(/^\d+[.)]\s*/, '').replace(/^payment\s*terms?\s*[:\-–]*\s*/i, '');
    if (first.trim()) block.push(first);
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (STOP_HEADINGS.test(l.replace(/^\d+[.)]\s*/, ''))) break;
        block.push(l);
    }
    return block;
}

export function parsePaymentTerms(text: string | null | undefined, v: ParseValues): ParsedSchedule {
    const warnings: string[] = [];
    const notes: string[] = [];
    const gstRate = v.gstRatePct ?? 18;
    const lines = (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);

    const block = paymentBlock(lines);
    // No heading: fall back to lines that read like a payment term, and nothing else, so a
    // penalty or retention clause is never mistaken for a milestone.
    const candidates = (block ?? lines.filter((l) => /%/.test(l) && /advance|against|upon|after|completion|delivery|balance|payable|payment/i.test(l) && !/retention|penalt|liquidated|per\s+(week|day)|discount|gst\s*@/i.test(l)))
        .map((l) => l.replace(/^\s*\(?\d{1,2}[.)]\s+/, ''))
        .filter((l) => !SUMMARY_LINE.test(l));

    const hasBasicWording = /basic\s+value|on\s+basic|excluding\s+gst|ex[\s-]gst|\+\s*\d*%?\s*gst|gst\s+(is\s+)?(payable\s+)?separately/i.test(text ?? '');

    type Raw = Omit<ParsedMilestone, 'seq' | 'basis' | 'amount'> & { basis: MilestoneBasis | null; amount: number | null };
    const raws: Raw[] = [];
    let lastTrigger: MilestoneTrigger = 'other';

    for (const line of candidates) {
        // "50% after delivery (62500) + 100% GST (22500)": two milestones on one line.
        const parts = splitOutsideBrackets(line).map((p) => p.trim()).filter(Boolean);
        parts.forEach((part, idx) => {
            const isGst = /\bGST\b/i.test(part) && /(payable|payment|paid|processed|\+)/i.test(part) || (idx > 0 && /\bGST\b/i.test(part));
            const amount = statedAmount(part);
            const days = part.match(/within\s+(\d+)\s*days?/i);
            if (isGst) {
                const pct = part.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*GST/i);
                const own = triggerOf(part);
                raws.push({
                    label: part.slice(0, 140), basis: 'gst', percent: pct ? Number(pct[1]) : 100, amount, amount_stated: amount != null,
                    // GST with no timing of its own follows the payment it was written beside.
                    trigger: own !== 'other' ? own : idx > 0 ? lastTrigger : 'on_invoice',
                    progress_pct: null, due_within_days: days ? Number(days[1]) : null, source_line: line,
                });
                return;
            }
            const first = part.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
            if (!first) return;
            const percent = Number(first[1]);
            const rest = part.slice((first.index ?? 0) + first[0].length);
            const prog = rest.match(PROGRESS_RE);
            const progress = prog ? Number(prog[1]) : null;
            let trigger: MilestoneTrigger;
            if (progress != null && progress < 100) trigger = 'on_progress';
            else if (progress === 100) trigger = 'on_completion';
            else trigger = triggerOf(rest);
            if (progress != null && progress < 100 && /deliver|dispatch/i.test(rest)) {
                warnings.push(`"${part.slice(0, 80)}" names both delivery and ${progress}% completion. Check which one releases it.`);
            }
            lastTrigger = trigger;
            raws.push({
                label: part.slice(0, 140), basis: null, percent, amount, amount_stated: amount != null, trigger,
                progress_pct: progress, due_within_days: days ? Number(days[1]) : null, source_line: line,
            });
        });
    }

    // "30 days against tax invoice": credit terms with no percentage mean the whole amount, on invoice.
    if (!raws.length) {
        const credit = candidates.map((l) => l.match(/(\d{1,3})\s*days?\b.*\b(invoice|bill)/i)).find(Boolean);
        if (credit) {
            raws.push({
                label: credit.input!.slice(0, 140), basis: null, percent: 100, amount: statedAmount(credit.input!), amount_stated: statedAmount(credit.input!) != null,
                trigger: 'on_invoice', progress_pct: null, due_within_days: Number(credit[1]), source_line: credit.input!,
            });
        }
    }

    const hasGst = raws.some((r) => r.basis === 'gst');
    let payBasis: MilestoneBasis = hasGst || hasBasicWording ? 'basic' : 'total';

    const refFor = (basis: MilestoneBasis) => (basis === 'gst' ? (v.basic != null ? v.basic * gstRate / 100 : null) : basis === 'basic' ? v.basic : v.total);
    const fits = (r: Raw, basis: MilestoneBasis) => {
        const ref = refFor(basis);
        return r.amount != null && ref != null && Math.abs(ref * r.percent / 100 - r.amount) <= Math.max(2, ref * r.percent / 100 * 0.002);
    };
    // The text says nothing about GST but its printed amounts only add up on the basic value:
    // the percentages are on basic, and the GST payment is simply undescribed.
    const stated = raws.filter((r) => r.basis === null && r.amount != null);
    if (payBasis === 'total' && stated.length && stated.every((r) => fits(r, 'basic')) && !stated.every((r) => fits(r, 'total'))) {
        payBasis = 'basic';
        notes.push('The amounts printed in the terms match the basic value, so the percentages are treated as before GST.');
    }
    const base = refFor(payBasis);

    const milestones: ParsedMilestone[] = raws.map((r, i) => {
        const basis = r.basis ?? payBasis;
        const ref = refFor(basis);
        const worked = ref != null ? round2(ref * r.percent / 100) : null;
        return { ...r, seq: i + 1, basis, amount: r.amount ?? worked };
    });

    if (!milestones.length) return { status: 'none', milestones: [], warnings: ['No payment terms with percentages were found in the PO text.'], notes };

    // 1. The payment percentages must add to 100.
    const paySum = milestones.filter((m) => m.basis !== 'gst').reduce((s, m) => s + m.percent, 0);
    if (Math.abs(paySum - 100) > 0.01) warnings.push(`Payment percentages add to ${Math.round(paySum * 100) / 100}%, not 100%.`);

    // 2. A printed amount must agree with percent x value.
    for (const m of milestones) {
        if (!m.amount_stated || m.amount == null) continue;
        const ref = m.basis === 'gst' ? (v.basic != null ? v.basic * gstRate / 100 : null) : m.basis === 'basic' ? v.basic : v.total;
        if (ref == null) continue;
        const expected = ref * m.percent / 100;
        if (Math.abs(expected - m.amount) > Math.max(2, expected * 0.002)) {
            warnings.push(`Milestone ${m.seq}: the text says ${m.amount.toLocaleString('en-IN')}, but ${m.percent}% of ${Math.round(ref).toLocaleString('en-IN')} is ${Math.round(expected).toLocaleString('en-IN')}.`);
        }
    }

    // 3. Terms silent on GST while the PO carries tax: say so rather than assume.
    if (payBasis === 'total' && v.basic != null && v.total != null && v.total - v.basic > 1) {
        notes.push('The terms do not mention GST, so the percentages are applied to the whole PO value including GST.');
    }
    if (payBasis === 'basic' && !hasGst && v.basic != null && v.total != null && v.total - v.basic > 1) {
        warnings.push('The percentages are on the basic value but no GST payment is described. Add one.');
    }
    if (base == null) warnings.push('The PO value is not known, so amounts could not be worked out.');

    return { status: warnings.length ? 'check' : 'ok', milestones, warnings, notes };
}

/** Presets for a PO whose text says nothing: a person picks one, then edits. */
export const SCHEDULE_PRESETS: { key: string; label: string; milestones: { label: string; percent: number; trigger: MilestoneTrigger; progress_pct?: number }[] }[] = [
    { key: '100-advance', label: '100% advance', milestones: [{ label: '100% advance against PO', percent: 100, trigger: 'on_po' }] },
    { key: '50-50', label: '50% advance, 50% on completion', milestones: [{ label: '50% advance against PO', percent: 50, trigger: 'on_po' }, { label: '50% on completion', percent: 50, trigger: 'on_completion' }] },
    { key: '50-50-delivery', label: '50% against PO, 50% on delivery', milestones: [{ label: '50% against PO', percent: 50, trigger: 'on_po' }, { label: '50% on delivery', percent: 50, trigger: 'on_delivery' }] },
    { key: '25-25-25-25', label: '25% at order, then 25 / 50 / 100% progress', milestones: [{ label: '25% against PO', percent: 25, trigger: 'on_po' }, { label: '25% at 25% completion', percent: 25, trigger: 'on_progress', progress_pct: 25 }, { label: '25% at 50% completion', percent: 25, trigger: 'on_progress', progress_pct: 50 }, { label: '25% on completion', percent: 25, trigger: 'on_completion' }] },
    { key: '30-20-20-30', label: '30% advance, 20% delivery, 20% at 90%, 30% on completion', milestones: [{ label: '30% advance against PO', percent: 30, trigger: 'on_po' }, { label: '20% on delivery', percent: 20, trigger: 'on_delivery' }, { label: '20% at 90% completion', percent: 20, trigger: 'on_progress', progress_pct: 90 }, { label: '30% on completion', percent: 30, trigger: 'on_completion' }] },
];

export const TRIGGER_LABEL: Record<MilestoneTrigger, string> = {
    on_po: 'On PO', on_delivery: 'On delivery', on_progress: 'At % complete', on_completion: 'On completion',
    on_invoice: 'Against invoice', gst_on_portal: 'GST on portal', other: 'Other',
};
