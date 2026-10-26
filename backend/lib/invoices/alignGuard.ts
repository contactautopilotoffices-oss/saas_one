/**
 * What the Payment Tracker is allowed to know about an invoice.
 *
 * The two tracks stay separate: this NEVER changes an invoice, and it never blocks a
 * payment. It answers one question for the person aligning money — "does the invoice
 * for this PO agree with it?" — so that an override is a decision on record rather than
 * an accident.
 *
 * A PO with no invoice yet is `none`, not a pass. Silence is not agreement.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { invoiceStage, plainReasons, type InvoiceStage } from './plainReasons';

export type AlignInvoiceState = 'reading' | 'matched' | 'mismatched' | 'needs_review' | 'duplicate_suspected' | 'none' | 'unavailable';

export interface AlignInvoiceVerdict {
    state: AlignInvoiceState;
    /** True when the aligner must give a reason to proceed. */
    needsReason: boolean;
    invoiceId: string | null;
    invoiceNumber: string | null;
    failedRules: string[];
    message: string;
    /** The same findings in plain words with the real figures, most important first. */
    reasons: string[];
    headline: string;
    /** What to do about it. */
    next: string | null;
    /** Where the invoice is in being read and checked. */
    stage: InvoiceStage | null;
}

const MESSAGE: Record<AlignInvoiceState, string> = {
    reading: 'The invoice is still being read and checked. This takes a few seconds.',
    matched: 'The invoice for this PO was checked and agrees with it.',
    mismatched: 'The invoice for this PO does not agree with it.',
    needs_review: 'The invoice for this PO has not been settled by a person yet.',
    duplicate_suspected: 'The invoice for this PO looks like one already received.',
    none: 'No invoice has been received for this PO yet.',
    unavailable: 'Invoice Control is not set up, so no invoice check was made.',
};

const NO_DETAIL = { reasons: [] as string[], headline: '', next: null as string | null, stage: null as InvoiceStage | null };

/** Missing invoice tables must not break alignment — the tracker predates Invoice Control. */
const MISSING_TABLE = (code?: string, message?: string) =>
    code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message ?? '');

export async function invoiceVerdictForPo(orgId: string, poId: string): Promise<AlignInvoiceVerdict> {
    const { data, error } = await supabaseAdmin
        .from('invoices')
        .select('id, invoice_number, match_status, review_status, extraction_status, created_at')
        .eq('organization_id', orgId).eq('po_id', poId)
        .neq('review_status', 'rejected')
        .order('created_at', { ascending: false });

    if (error) {
        if (MISSING_TABLE(error.code, error.message)) {
            return { state: 'unavailable', needsReason: false, invoiceId: null, invoiceNumber: null, failedRules: [], message: MESSAGE.unavailable, ...NO_DETAIL };
        }
        // A lookup failure must not stop a payment; say so rather than inventing a pass.
        return { state: 'unavailable', needsReason: false, invoiceId: null, invoiceNumber: null, failedRules: [], message: MESSAGE.unavailable, ...NO_DETAIL };
    }

    const rows = data ?? [];
    if (!rows.length) {
        return {
            state: 'none', needsReason: true, invoiceId: null, invoiceNumber: null, failedRules: [], message: MESSAGE.none,
            reasons: ["No invoice has been uploaded for this PO. Upload the tax invoice in this PO's Documents tab, or from Invoice Control."],
            headline: 'No invoice attached', next: 'Attach the vendor\'s invoice for this PO before aligning payment.', stage: null,
        };
    }

    // One clean, accepted invoice is enough: part-billing means several invoices sit on
    // one PO, and the PO_BALANCE_CHECK rule already stops them over-billing between them.
    const clean = rows.find((r) => r.match_status === 'matched');
    const chosen = clean ?? rows[0];
    const stage = invoiceStage(chosen);
    const inFlight = !clean && (stage === 'received' || stage === 'reading' || stage === 'checking');
    const state = clean ? 'matched' : inFlight ? 'reading' : ((chosen.match_status as AlignInvoiceState) ?? 'needs_review');

    let failedRules: string[] = [];
    let detail = { reasons: [] as string[], headline: '', next: null as string | null };
    if (state !== 'matched' && state !== 'reading') {
        const { data: results } = await supabaseAdmin
            .from('invoice_validation_results')
            .select('rule_code, severity, outcome, invoice_line_no, expected_value, actual_value, difference_amount, explanation, resolved_at')
            .eq('invoice_id', chosen.id).eq('is_current', true);
        failedRules = [...new Set((results ?? [])
            .filter((r) => r.outcome !== 'pass' && !r.resolved_at)
            .map((r) => r.rule_code))];
        detail = plainReasons(results ?? [], chosen.match_status);
    }

    return {
        state,
        needsReason: state !== 'matched',
        invoiceId: chosen.id,
        invoiceNumber: chosen.invoice_number ?? null,
        failedRules,
        message: MESSAGE[state] ?? MESSAGE.needs_review,
        ...detail,
        stage,
    };
}
