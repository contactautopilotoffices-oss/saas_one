/**
 * PUBLIC — vendor upload link, step 2: the file is in storage; register it.
 *
 * invoice_register_submission locks the link row, checks it is still active, creates the
 * invoice + document + audit event and burns the link, all in one transaction. Two
 * simultaneous submits cannot both win. The PO and vendor come from the LINK; anything the
 * request body says about them is ignored.
 *
 * Reading the invoice (OCR) happens after the response, so the vendor is not kept waiting.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { clientKey, hashToken, looksLikeToken, tooManyRequests } from '@/backend/lib/invoices/links';
import { loadInvoiceSettings } from '@/backend/lib/invoices/settings';
import { isUploadId, linkObjectPath } from '@/backend/lib/invoices/storage';
import { registerSubmission, checkPoForInvoicing } from '@/backend/lib/invoices/submission';
import { processInvoice } from '@/backend/lib/invoices/process';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const NO_STORE = { 'Cache-Control': 'no-store' };
const UNAVAILABLE = (status = 409) => NextResponse.json({ error: 'This link is not available.' }, { status, headers: NO_STORE });

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    if (tooManyRequests(clientKey(request, 'inv-submit'), 10)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
    const { token } = await params;
    const body = await request.json().catch(() => null) as { upload_id?: string; filename?: string; invoice_number?: string; invoice_date?: string } | null;
    if (!looksLikeToken(token) || !body || !isUploadId(body.upload_id)) return UNAVAILABLE(400);

    const tokenHash = hashToken(token);
    const { data: link } = await supabaseAdmin.from('invoice_intake_links')
        .select('id, organization_id, po_id, status, expires_at, submission_count').eq('token_hash', tokenHash).maybeSingle();
    if (!link || link.status !== 'active' || link.submission_count >= 1 || new Date(link.expires_at).getTime() <= Date.now()) return UNAVAILABLE();

    const eligible = await checkPoForInvoicing(link.organization_id, link.po_id);
    if (!eligible.ok) return UNAVAILABLE();

    const settings = await loadInvoiceSettings(link.organization_id);
    const result = await registerSubmission({
        tokenHash,
        objectPath: linkObjectPath(link.organization_id, link.po_id, link.id, body.upload_id),
        uploadId: body.upload_id,
        filename: body.filename ?? 'invoice',
        maxBytes: settings.max_file_mb * 1024 * 1024,
        invoiceNumberHint: body.invoice_number,
        invoiceDateHint: body.invoice_date,
        idempotencyKey: request.headers.get('idempotency-key')?.slice(0, 120) || null,
    });

    if (!result.ok) {
        const status = result.reason === 'unavailable' ? 409 : result.reason === 'too_large' ? 413 : result.reason === 'bad_type' ? 415 : result.reason === 'missing_file' ? 422 : 500;
        return NextResponse.json({ error: result.message }, { status, headers: NO_STORE });
    }

    if (!result.replay) {
        after(async () => {
            await syncDocumentationState(link.organization_id, link.po_id);
            await processInvoice(result.invoiceId);
        });
    }
    // The vendor gets a receipt, nothing internal: no ids, no PO values, no verdict.
    return NextResponse.json({ status: 'received', submission_reference: result.submissionReference, message: 'Invoice received for validation.' }, { status: 201, headers: NO_STORE });
}
