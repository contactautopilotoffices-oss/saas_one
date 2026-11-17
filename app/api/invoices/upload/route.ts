/**
 * Internal upload slot — for an invoice that arrived another way (mail, WhatsApp), or for
 * fast-track evidence. Same two-step shape as the vendor link: this issues a short-lived
 * slot (type and size checked on the claim), the file goes straight to storage, then the
 * submit route judges the real bytes.
 *
 * POST { org_id, kind: 'invoice' | 'evidence', po_id?, filename, content_type, file_size_bytes }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { INVOICE_BUCKET, createSignedUpload, evidenceObjectPath, internalObjectPath, isAllowedContentType, newUploadId } from '@/backend/lib/invoices/storage';
import { checkPoForInvoicing } from '@/backend/lib/invoices/submission';
import { isUuid } from '@/backend/lib/invoices/http';
import { ALLOWED_CONTENT_TYPES } from '@/backend/lib/invoices/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { kind?: string; po_id?: string; filename?: string; content_type?: string; file_size_bytes?: number } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;

    const kind = body.kind === 'evidence' ? 'evidence' : 'invoice';
    if (kind === 'invoice' ? !a.canResolveSoft : !a.canRaiseFastTrack) return forbidden();

    const type = String(body.content_type ?? '');
    const size = Number(body.file_size_bytes);
    const maxBytes = a.settings.max_file_mb * 1024 * 1024;
    if (!isAllowedContentType(type)) return NextResponse.json({ error: 'Only PDF, JPEG or PNG files are accepted.', allowed_content_types: ALLOWED_CONTENT_TYPES }, { status: 415 });
    if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
    if (size > maxBytes) return NextResponse.json({ error: `The file is larger than ${a.settings.max_file_mb} MB.` }, { status: 413 });

    const uploadId = newUploadId(type);
    let path: string;
    if (kind === 'invoice') {
        if (!isUuid(body.po_id)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });
        const po = await checkPoForInvoicing(a.orgId, body.po_id);
        if (!po.ok) return NextResponse.json({ error: po.message }, { status: po.status });
        path = internalObjectPath(a.orgId, body.po_id, uploadId);
    } else {
        path = evidenceObjectPath(a.orgId, uploadId);
    }

    const slot = await createSignedUpload(path);
    if (!slot) return NextResponse.json({ error: 'Could not prepare the upload.' }, { status: 500 });
    return NextResponse.json({ upload_id: uploadId, bucket: INVOICE_BUCKET, upload_path: slot.path, upload_token: slot.token, max_file_bytes: maxBytes });
}
