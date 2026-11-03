import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { PO_DOCS_BUCKET } from '@/backend/lib/accounts/documents';
import { INVOICE_BUCKET, detectContentType, ensureInvoiceBucket, internalObjectPath, safeFilename, sha256 } from './storage';
import { processInvoice } from './process';
import { syncDocumentationState } from './docState';

/**
 * An invoice uploaded in the PO's own page (the Documents tab, type "tax invoice") must reach
 * Invoice Control, or the Align screen can never judge it: it would say "no invoice" for a PO that
 * has one, and a dummy file would sail through unread.
 *
 * So the file is copied into Invoice Control's private store and registered as an internal
 * upload, then read and matched like any other. The original document row is left exactly as it
 * is. A file that is not a PDF, JPEG or PNG is registered anyway and fails to read, which lands it
 * in the review queue as "could not read" instead of vanishing.
 *
 * Idempotent: keyed on the document row, so a retry cannot create a second invoice.
 */

const MAX_BYTES = 25 * 1024 * 1024;

/** Where the bytes live: a storage path in the private PO bucket, or one of OUR storage URLs. Nothing else is fetched. */
async function readDocument(fileUrl: string): Promise<Buffer | null> {
    if (/^https?:\/\//i.test(fileUrl)) {
        const allowed = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
        let host: string;
        try { host = new URL(fileUrl).host; } catch { return null; }
        // A URL typed into a request body must never make the server fetch an arbitrary address.
        if (!allowed || host !== allowed) return null;
        const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!res?.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    }
    const { data, error } = await supabaseAdmin.storage.from(PO_DOCS_BUCKET).download(fileUrl);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
}

export async function ingestTaxInvoiceDocument(input: {
    orgId: string; poId: string; userId: string; docId: string; fileUrl: string; fileName: string | null; invoiceNo: string | null; invoiceDate: string | null;
}): Promise<{ ok: true; invoiceId: string } | { ok: false; reason: string }> {
    const bytes = await readDocument(input.fileUrl);
    if (!bytes || !bytes.length) return { ok: false, reason: 'The uploaded file could not be read back from storage.' };
    if (bytes.length > MAX_BYTES) return { ok: false, reason: 'The file is larger than 25 MB.' };

    const type = detectContentType(bytes);
    const ext = type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'bin';
    const path = internalObjectPath(input.orgId, input.poId, `${crypto.randomUUID()}.${ext}`);
    await ensureInvoiceBucket();
    const { error: upErr } = await supabaseAdmin.storage.from(INVOICE_BUCKET).upload(path, bytes, { contentType: type ?? 'application/octet-stream', upsert: false });
    if (upErr) return { ok: false, reason: `Could not copy the file for checking: ${upErr.message}` };

    const { data, error } = await supabaseAdmin.rpc('invoice_register_submission', {
        p_token_hash: null, p_org: input.orgId, p_po: input.poId, p_user: input.userId,
        p_storage_path: path, p_filename: safeFilename(input.fileName ?? 'invoice'), p_content_type: type ?? 'application/octet-stream',
        p_size: bytes.length, p_sha256: sha256(bytes), p_invoice_number: input.invoiceNo?.slice(0, 60) ?? null,
        p_invoice_date: input.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate) ? input.invoiceDate : null,
        p_submission_ref: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        p_idempotency_key: `podoc:${input.docId}`,
    });
    if (error) {
        await supabaseAdmin.storage.from(INVOICE_BUCKET).remove([path]).catch(() => undefined);
        return { ok: false, reason: error.message };
    }
    const r = data as { outcome: string; invoice_id?: string };
    if (r.outcome === 'duplicate_request') {
        // Already ingested: drop the second copy and leave the first invoice alone.
        await supabaseAdmin.storage.from(INVOICE_BUCKET).remove([path]).catch(() => undefined);
        return { ok: true, invoiceId: r.invoice_id! };
    }
    if (r.outcome !== 'created' || !r.invoice_id) return { ok: false, reason: 'The invoice could not be registered.' };

    await syncDocumentationState(input.orgId, input.poId);
    await processInvoice(r.invoice_id, input.userId);
    return { ok: true, invoiceId: r.invoice_id };
}
