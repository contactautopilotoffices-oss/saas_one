/**
 * PUBLIC — vendor upload link, step 1: check the file's claimed type and size, and get a
 * short-lived slot to upload into. The slot's path is built by the server from the link
 * (never from the request), so a vendor can only ever write inside their own link.
 *
 * This does NOT consume the link. Step 2 (submit) does, atomically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { clientKey, hashToken, looksLikeToken, tooManyRequests } from '@/backend/lib/invoices/links';
import { loadInvoiceSettings } from '@/backend/lib/invoices/settings';
import { INVOICE_BUCKET, createSignedUpload, isAllowedContentType, linkObjectPath, newUploadId } from '@/backend/lib/invoices/storage';
import { ALLOWED_CONTENT_TYPES } from '@/backend/lib/invoices/types';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    if (tooManyRequests(clientKey(request, 'inv-validate'), 20)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
    const { token } = await params;
    const body = await request.json().catch(() => null) as { filename?: string; content_type?: string; file_size_bytes?: number } | null;
    if (!looksLikeToken(token) || !body) return NextResponse.json({ valid: false, error: 'This link is not available.' }, { status: 404, headers: NO_STORE });

    const { data: link } = await supabaseAdmin.from('invoice_intake_links')
        .select('id, organization_id, po_id, status, expires_at, submission_count').eq('token_hash', hashToken(token)).maybeSingle();
    if (!link || link.status !== 'active' || link.submission_count >= 1 || new Date(link.expires_at).getTime() <= Date.now()) {
        return NextResponse.json({ valid: false, error: 'This link is not available.' }, { status: 404, headers: NO_STORE });
    }

    const settings = await loadInvoiceSettings(link.organization_id);
    const maxBytes = settings.max_file_mb * 1024 * 1024;
    const type = String(body.content_type ?? '');
    const size = Number(body.file_size_bytes);

    if (!isAllowedContentType(type)) return NextResponse.json({ valid: false, error: 'Only PDF, JPEG or PNG files are accepted.', allowed_content_types: ALLOWED_CONTENT_TYPES }, { status: 415, headers: NO_STORE });
    if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ valid: false, error: 'The file is empty.' }, { status: 400, headers: NO_STORE });
    if (size > maxBytes) return NextResponse.json({ valid: false, error: `The file is larger than ${settings.max_file_mb} MB.`, max_file_bytes: maxBytes }, { status: 413, headers: NO_STORE });

    const uploadId = newUploadId(type);
    const slot = await createSignedUpload(linkObjectPath(link.organization_id, link.po_id, link.id, uploadId));
    if (!slot) return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500, headers: NO_STORE });

    return NextResponse.json({
        valid: true, upload_id: uploadId, bucket: INVOICE_BUCKET, upload_path: slot.path, upload_token: slot.token,
        allowed_content_types: ALLOWED_CONTENT_TYPES, max_file_bytes: maxBytes,
    }, { headers: NO_STORE });
}
