import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Storage for PO paperwork (tax invoices, challans, GRNs, work-completion notes).
 *
 * WHY A PRIVATE BUCKET, UNLIKE `payment_proofs`
 * app/api/accounts/upload/route.ts writes to a PUBLIC bucket, so anyone holding the URL can
 * read the file forever, with no login. That is survivable for a payment screenshot; it is
 * not for a tax invoice, which carries the vendor's GSTIN, line items and pricing — a
 * competitor's whole commercial position in one PDF. This bucket is private and every read
 * is a short-lived signed URL minted for a caller who has already passed
 * resolveAccountsAccess.
 *
 * CONSEQUENCE FOR CALLERS: po_documents.file_url holds the STORAGE PATH, not a browsable
 * URL. Render `signed_url` from the API response instead.
 */

export const PO_DOCS_BUCKET = 'po_documents';

/** One hour: long enough to open and print, short enough that a forwarded link dies. */
export const SIGNED_URL_TTL_SECONDS = 3600;

/** Create the bucket on first use, mirroring app/api/accounts/upload/route.ts. */
export async function ensurePoDocsBucket(): Promise<void> {
    const { error } = await supabaseAdmin.storage.getBucket(PO_DOCS_BUCKET);
    if (error && (error as { status?: number }).status === 400) {
        await supabaseAdmin.storage.createBucket(PO_DOCS_BUCKET, {
            public: false,
            allowedMimeTypes: ['application/pdf', 'image/*'],
        });
    }
}

/**
 * Mint a signed URL for one stored object. Returns null rather than throwing: a document
 * whose file has gone missing must still appear in the list, with its metadata intact and
 * an honest empty link, instead of taking the whole detail page down.
 */
export async function signPoDocument(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
        const { data, error } = await supabaseAdmin.storage
            .from(PO_DOCS_BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error) {
            console.error('[po documents] sign failed:', error.message);
            return null;
        }
        return data?.signedUrl ?? null;
    } catch (e) {
        console.error('[po documents] sign threw:', e);
        return null;
    }
}

/**
 * Sign a batch. Anything that is already an absolute URL is passed through untouched —
 * rows written before this bucket existed (or by /api/accounts/upload) hold a public URL,
 * and re-signing one would produce a dead link.
 */
export async function signPoDocuments(paths: (string | null | undefined)[]): Promise<(string | null)[]> {
    return Promise.all(paths.map((p) => (p && /^https?:\/\//i.test(p) ? Promise.resolve(p) : signPoDocument(p))));
}
