import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ALLOWED_CONTENT_TYPES, type AllowedContentType } from './types';

/**
 * Private storage for vendor invoices and fast-track evidence.
 *
 * The browser never chooses a path. The server mints an `upload_id`, derives the object
 * path from it plus ids it already trusts (the link, the PO, the org), and on submit
 * re-derives the same path rather than reading one from the request. A forged upload_id
 * can therefore only ever point at an object inside the caller's own link.
 *
 * Reads are short-lived signed URLs, minted only after an access check.
 */

export const INVOICE_BUCKET = 'invoice-docs';
export const SIGNED_URL_TTL_SECONDS = 600;

export async function ensureInvoiceBucket(): Promise<void> {
    const { error } = await supabaseAdmin.storage.getBucket(INVOICE_BUCKET);
    if (error && (error as { status?: number }).status === 400) {
        await supabaseAdmin.storage.createBucket(INVOICE_BUCKET, {
            public: false,
            allowedMimeTypes: [...ALLOWED_CONTENT_TYPES],
            fileSizeLimit: '25MB',
        });
    }
}

const EXT: Record<AllowedContentType, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MIME_BY_EXT: Record<string, AllowedContentType> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

export function isAllowedContentType(t: string): t is AllowedContentType {
    return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(t);
}

/** `<uuid>.<pdf|jpg|png>`. The extension is part of the id so submit can rebuild the path. */
export function newUploadId(contentType: AllowedContentType): string {
    return `${crypto.randomUUID()}.${EXT[contentType]}`;
}

const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;
export const isUploadId = (s: unknown): s is string => typeof s === 'string' && UPLOAD_ID_RE.test(s);
export const contentTypeOfUploadId = (id: string): AllowedContentType => MIME_BY_EXT[id.split('.')[1]];

export const linkObjectPath = (orgId: string, poId: string, linkId: string, uploadId: string) => `${orgId}/${poId}/link-${linkId}/${uploadId}`;
export const internalObjectPath = (orgId: string, poId: string, uploadId: string) => `${orgId}/${poId}/internal/${uploadId}`;
export const evidenceObjectPath = (orgId: string, uploadId: string) => `${orgId}/evidence/${uploadId}`;

export async function createSignedUpload(path: string): Promise<{ signedUrl: string; token: string; path: string } | null> {
    await ensureInvoiceBucket();
    const { data, error } = await supabaseAdmin.storage.from(INVOICE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
        console.error('[invoices] signed upload failed:', error?.message);
        return null;
    }
    return data;
}

export async function downloadObject(path: string): Promise<Buffer | null> {
    const { data, error } = await supabaseAdmin.storage.from(INVOICE_BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
}

export async function removeObject(path: string): Promise<void> {
    await supabaseAdmin.storage.from(INVOICE_BUCKET).remove([path]).catch(() => undefined);
}

/** Returns null (not a throw) so one missing file never takes a whole detail view down. */
export async function signObject(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await supabaseAdmin.storage.from(INVOICE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) { console.error('[invoices] sign failed:', error.message); return null; }
    return data?.signedUrl ?? null;
}

/**
 * The file's own bytes decide its type, not its name or the browser's claim.
 * PDFs start "%PDF-", JPEGs FF D8 FF, PNGs 89 50 4E 47.
 */
export function detectContentType(b: Buffer): AllowedContentType | null {
    if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    return null;
}

export const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

export function safeFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? 'invoice';
    return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'invoice';
}
