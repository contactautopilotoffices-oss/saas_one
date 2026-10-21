/**
 * Internal "attach an invoice received elsewhere". Recorded exactly like a vendor
 * submission, but with source 'internal_upload' and the staff member as the actor.
 *
 * POST { org_id, po_id, upload_id, filename, invoice_number?, invoice_date? }
 * Header: Idempotency-Key (a double-click must not create two invoices).
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { internalObjectPath, isUploadId } from '@/backend/lib/invoices/storage';
import { checkPoForInvoicing, registerSubmission } from '@/backend/lib/invoices/submission';
import { processInvoice } from '@/backend/lib/invoices/process';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { po_id?: string; upload_id?: string; filename?: string; invoice_number?: string; invoice_date?: string } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canResolveSoft) return forbidden();
    if (!isUuid(body.po_id) || !isUploadId(body.upload_id)) return NextResponse.json({ error: 'po_id and upload_id are required.' }, { status: 400 });

    const po = await checkPoForInvoicing(a.orgId, body.po_id);
    if (!po.ok) return NextResponse.json({ error: po.message }, { status: po.status });

    const result = await registerSubmission({
        orgId: a.orgId, poId: body.po_id, userId: a.userId,
        objectPath: internalObjectPath(a.orgId, body.po_id, body.upload_id), uploadId: body.upload_id,
        filename: body.filename ?? 'invoice', maxBytes: a.settings.max_file_mb * 1024 * 1024,
        invoiceNumberHint: body.invoice_number, invoiceDateHint: body.invoice_date,
        idempotencyKey: request.headers.get('idempotency-key')?.slice(0, 120) || null,
    });
    if (!result.ok) {
        const status = result.reason === 'too_large' ? 413 : result.reason === 'bad_type' ? 415 : result.reason === 'missing_file' ? 422 : result.reason === 'unavailable' ? 404 : 500;
        return NextResponse.json({ error: result.message }, { status });
    }
    if (!result.replay) {
        after(async () => {
            await syncDocumentationState(a.orgId, body.po_id!);
            await processInvoice(result.invoiceId, a.userId);
        });
    }
    return NextResponse.json({ invoice_id: result.invoiceId, submission_reference: result.submissionReference, status: 'received', replay: result.replay }, { status: result.replay ? 200 : 201 });
}
