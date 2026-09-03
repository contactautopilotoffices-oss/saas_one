import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Storage for Document Bank uploads (AMC contracts, statutory/calibration certificates,
 * OEM manuals, SLDs, warranty cards). Private bucket — these carry commercial terms and
 * compliance data, not something to hand out as a bare public URL — mirroring
 * backend/lib/accounts/documents.ts (po_documents) rather than the public `amc-documents`
 * bucket app/api/amc/contracts/[id]/documents/route.ts uses.
 *
 * document_bank.file_path holds the STORAGE PATH, not a browsable URL. Render `signed_url`
 * from the API response instead.
 */

export const DOCUMENT_BANK_BUCKET = 'document-bank';

/** One hour: long enough to view/print a document, short enough that a forwarded link dies. */
export const SIGNED_URL_TTL_SECONDS = 3600;

/** Create the bucket on first use, mirroring ensurePoDocsBucket. */
export async function ensureDocumentBankBucket(): Promise<void> {
    const { error } = await supabaseAdmin.storage.getBucket(DOCUMENT_BANK_BUCKET);
    if (error && (error as { status?: number }).status === 400) {
        await supabaseAdmin.storage.createBucket(DOCUMENT_BANK_BUCKET, {
            public: false,
            allowedMimeTypes: ['application/pdf', 'image/*'],
            fileSizeLimit: '25MB',
        });
    }
}

/**
 * Mint a signed URL for one stored object. Returns null rather than throwing: a document
 * whose file has gone missing must still appear in the list, with its metadata intact and
 * an honest empty link, instead of taking the whole listing down.
 */
export async function signDocumentBankFile(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
        const { data, error } = await supabaseAdmin.storage
            .from(DOCUMENT_BANK_BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error) {
            console.error('[document bank] sign failed:', error.message);
            return null;
        }
        return data?.signedUrl ?? null;
    } catch (e) {
        console.error('[document bank] sign threw:', e);
        return null;
    }
}

export async function signDocumentBankFiles(paths: (string | null | undefined)[]): Promise<(string | null)[]> {
    return Promise.all(paths.map((p) => signDocumentBankFile(p)));
}
