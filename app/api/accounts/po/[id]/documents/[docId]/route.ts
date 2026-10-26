import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import { PO_DOCS_BUCKET } from '@/backend/lib/accounts/documents';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';
import { syncInvoiceMatchFlag } from '@/backend/lib/invoices/flags';

/**
 * DELETE /api/accounts/po/[id]/documents/[docId] — cancel an uploaded document.
 *
 * For the wrong file, a dummy file, or a replaced one. Rules:
 *   - the same bar as uploading (anyone who can align), except that a VERIFIED document can only
 *     be removed by accounts or an admin: verifying it was a control, un-doing it is too;
 *   - a payment proof for a COMPLETED payment stays (it is the evidence for the UTR);
 *   - a tax invoice that Accounts has already ACCEPTED in Invoice Control stays: ask Accounts.
 * A tax invoice that Invoice Control read from this document is WITHDRAWN (rejected, with a note),
 * not erased: its history is an audit trail and must stay. A withdrawn invoice no longer counts at
 * the Align screen. The removal is written to the PO's timeline.
 */

/** The storage path for a document: a private-bucket path, or the tail of one of our public URLs. */
function storageTarget(fileUrl: string): { bucket: string; path: string } | null {
    if (!/^https?:\/\//i.test(fileUrl)) return { bucket: PO_DOCS_BUCKET, path: fileUrl };
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return null;
    try {
        const u = new URL(fileUrl);
        if (u.host !== new URL(base).host) return null;
        const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
        return m ? { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) } : null;
    } catch { return null; }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
    const { id, docId } = await params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: doc } = await supabaseAdmin.from('po_documents').select('*')
        .eq('id', docId).eq('po_id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    if (doc.status === 'verified' && !access.canComplete && !access.isAdmin) {
        return NextResponse.json({ error: 'This document has been verified. Only Accounts or an admin can remove it.' }, { status: 403 });
    }
    if (doc.doc_type === 'payment_proof' && doc.payment_id) {
        const { data: pay } = await supabaseAdmin.from('po_payments').select('status').eq('id', doc.payment_id).maybeSingle();
        if (pay?.status === 'completed') return NextResponse.json({ error: 'This is the proof for a completed payment, so it stays on record.' }, { status: 409 });
    }

    // The invoice Invoice Control read from this document, if any.
    let withdrawn: string | null = null;
    if (doc.doc_type === 'tax_invoice') {
        const { data: inv } = await supabaseAdmin.from('invoices').select('id, review_status, invoice_number')
            .eq('organization_id', access.organizationId).eq('po_id', id).eq('idempotency_key', `podoc:${docId}`).maybeSingle();
        if (inv?.review_status === 'accepted') {
            return NextResponse.json({ error: `Accounts has already accepted this invoice${inv.invoice_number ? ` (${inv.invoice_number})` : ''}. Ask Accounts before removing it.` }, { status: 409 });
        }
        if (inv && inv.review_status !== 'rejected') {
            const now = new Date().toISOString();
            await supabaseAdmin.from('invoices').update({
                review_status: 'rejected', review_note: 'Withdrawn: the document was removed from the PO page.', reviewed_by: access.user.id, reviewed_at: now, updated_at: now,
            }).eq('id', inv.id);
            await logInvoiceEvent({ organizationId: access.organizationId, invoiceId: inv.id, poId: id, actorUserId: access.user.id, actorRole: access.roles[0], eventType: 'invoice_withdrawn', details: { document_id: docId, file_name: doc.file_name } });
            await syncInvoiceMatchFlag({ orgId: access.organizationId, invoiceId: inv.id, matchStatus: 'matched', poNumber: null, vendorName: null, failedRules: [] }).catch(() => undefined);
            await syncDocumentationState(access.organizationId, id);
            withdrawn = inv.id;
        }
    }

    // The file goes first (best effort: a missing file must not keep the row alive), then the row.
    if (doc.file_url) {
        const t = storageTarget(String(doc.file_url));
        if (t) await supabaseAdmin.storage.from(t.bucket).remove([t.path]).catch(() => undefined);
    }
    const { error } = await supabaseAdmin.from('po_documents').delete().eq('id', docId).eq('organization_id', access.organizationId);
    if (error) {
        console.error('PO document delete error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logPoActivity({
        organizationId: access.organizationId, poId: id, paymentId: doc.payment_id ?? null, action: 'comment', actorId: access.user.id,
        note: `Removed ${String(doc.doc_type).replace(/_/g, ' ')}${doc.file_name ? ` — ${doc.file_name}` : ''}`,
        detail: { document_id: docId, doc_type: doc.doc_type, was_status: doc.status, uploaded_by: doc.uploaded_by, withdrawn_invoice_id: withdrawn },
    });
    return NextResponse.json({ ok: true, withdrawn_invoice_id: withdrawn });
}
