import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    contentTypeOfUploadId, detectContentType, downloadObject, removeObject, safeFilename, sha256,
} from './storage';
import { isPoEligible } from './types';

/**
 * The one place a stored upload becomes an invoice. Used by the vendor link route and by
 * the internal "attach an invoice received elsewhere" route, so both go through the same
 * checks and the same atomic SQL function (invoice_register_submission).
 *
 * The file is re-read from storage and judged on its own bytes: size, real type and a
 * SHA-256. The browser's claims were only used to issue the upload slot.
 */

export type SubmissionResult =
    | { ok: true; invoiceId: string; orgId: string; poId: string; submissionReference: string; replay: boolean }
    | { ok: false; reason: 'unavailable' | 'missing_file' | 'too_large' | 'bad_type' | 'ineligible_po' | 'failed'; message: string };

export interface SubmissionInput {
    /** Vendor path: SHA-256 of the link token. Internal path: omit and pass org/po/user. */
    tokenHash?: string;
    orgId?: string;
    poId?: string;
    userId?: string;
    objectPath: string;
    uploadId: string;
    filename: string;
    maxBytes: number;
    invoiceNumberHint?: string | null;
    invoiceDateHint?: string | null;
    idempotencyKey?: string | null;
}

export async function registerSubmission(i: SubmissionInput): Promise<SubmissionResult> {
    const bytes = await downloadObject(i.objectPath);
    if (!bytes) return { ok: false, reason: 'missing_file', message: 'The file did not arrive. Please upload it again.' };

    const bad = (reason: 'too_large' | 'bad_type', message: string): SubmissionResult => {
        void removeObject(i.objectPath);
        return { ok: false, reason, message };
    };
    if (bytes.length > i.maxBytes) return bad('too_large', `The file is larger than ${Math.round(i.maxBytes / 1048576)} MB.`);
    const real = detectContentType(bytes);
    if (!real || real !== contentTypeOfUploadId(i.uploadId)) return bad('bad_type', 'Only PDF, JPEG or PNG files are accepted.');

    const hintNumber = i.invoiceNumberHint?.trim().slice(0, 60) || null;
    const hintDate = i.invoiceDateHint && /^\d{4}-\d{2}-\d{2}$/.test(i.invoiceDateHint) && !Number.isNaN(Date.parse(i.invoiceDateHint)) ? i.invoiceDateHint : null;
    const ref = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const { data, error } = await supabaseAdmin.rpc('invoice_register_submission', {
        p_token_hash: i.tokenHash ?? null,
        p_org: i.orgId ?? null,
        p_po: i.poId ?? null,
        p_user: i.userId ?? null,
        p_storage_path: i.objectPath,
        p_filename: safeFilename(i.filename),
        p_content_type: real,
        p_size: bytes.length,
        p_sha256: sha256(bytes),
        p_invoice_number: hintNumber,
        p_invoice_date: hintDate,
        p_submission_ref: ref,
        p_idempotency_key: i.idempotencyKey ?? null,
    });
    if (error) {
        console.error('[invoices] register submission failed:', error.message);
        void removeObject(i.objectPath);
        return { ok: false, reason: 'failed', message: 'We could not record the submission. Please try again.' };
    }
    const r = data as { outcome: string; invoice_id?: string; organization_id?: string; po_id?: string; submission_reference?: string };
    if (r.outcome === 'unavailable') {
        void removeObject(i.objectPath);
        return { ok: false, reason: 'unavailable', message: 'This link is not available.' };
    }
    if (r.outcome === 'duplicate_request') {
        // The same request arrived twice: hand back the first answer, keep the first file.
        void removeObject(i.objectPath);
        return { ok: true, invoiceId: r.invoice_id!, orgId: i.orgId ?? '', poId: i.poId ?? '', submissionReference: r.submission_reference!, replay: true };
    }
    return { ok: true, invoiceId: r.invoice_id!, orgId: r.organization_id!, poId: r.po_id!, submissionReference: r.submission_reference!, replay: false };
}

/** PO eligibility for a new link or upload (INV-002). */
export async function checkPoForInvoicing(orgId: string, poId: string): Promise<
    { ok: true; po: { id: string; po_number: string; vendor_name: string | null; status: string | null; po_amount: number | null } } | { ok: false; status: number; message: string }
> {
    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, status, po_amount').eq('id', poId).eq('organization_id', orgId).maybeSingle();
    if (!po) return { ok: false, status: 404, message: 'PO not found.' };
    if (!isPoEligible(po.status)) return { ok: false, status: 422, message: `This PO is "${po.status ?? 'blank'}" and cannot take an invoice.` };
    return { ok: true, po: { ...po, po_amount: po.po_amount == null ? null : Number(po.po_amount) } };
}
