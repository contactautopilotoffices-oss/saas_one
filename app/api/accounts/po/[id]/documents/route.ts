import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import { PO_DOCS_BUCKET, ensurePoDocsBucket, signPoDocument } from '@/backend/lib/accounts/documents';
import type { PoDocType, DocumentStatus, PoDocument, PoDocumentCreateResponse } from '@/backend/lib/accounts/trackerTypes';

/**
 * POST /api/accounts/po/[id]/documents — record a document against a PO.
 *
 * Two ways in, because the UI legitimately has both:
 *   multipart/form-data with `file`  — upload and record in one call.
 *   application/json with `file_url` — the file already lives in storage.
 *
 * Storage mirrors app/api/accounts/upload/route.ts (lazy bucket creation, sanitised name,
 * org-scoped path) with one deliberate difference: the bucket is PRIVATE and reads are
 * signed. A tax invoice is not a payment screenshot — see backend/lib/accounts/documents.ts.
 */

const MAX_BYTES = 15 * 1024 * 1024;

const DOC_TYPES: PoDocType[] = [
    'tax_invoice', 'proforma_invoice', 'delivery_challan',
    'grn', 'work_completion', 'payment_proof', 'other',
];

const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contentType = request.headers.get('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');

    let fields: Record<string, any> = {};
    let file: File | null = null;

    if (isMultipart) {
        const form = await request.formData().catch(() => null);
        if (!form) return NextResponse.json({ error: 'Invalid form body' }, { status: 400 });
        for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
        const f = form.get('file');
        file = f && typeof f !== 'string' ? (f as File) : null;
    } else {
        const body = await request.json().catch(() => null);
        if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        fields = body;
    }

    const access = await resolveAccountsAccess(request, readOrgId(request, fields));
    if (isAccountsAccessError(access)) return access;
    // Everyone who can see the tracker can also align on it (VIEW_ROLES === ALIGN_ROLES in
    // access.ts), so this is the tracker's write bar, not a narrower one.
    if (!access.canAlign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const docType = String(fields.doc_type || '').trim() as PoDocType;
    if (!DOC_TYPES.includes(docType)) {
        return NextResponse.json(
            { error: `doc_type is required and must be one of: ${DOC_TYPES.join(', ')}` },
            { status: 400 },
        );
    }

    // Tenancy is asserted, never inferred from the caller's path parameter.
    const { data: po } = await supabaseAdmin
        .from('zoho_purchase_orders').select('id, po_number, vendor_name')
        .eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

    // A document may be pinned to one tranche (an invoice against the 30% advance). That
    // tranche has to belong to THIS PO, or the timeline starts pointing at other people's
    // payments.
    let paymentId: string | null = fields.payment_id ? String(fields.payment_id) : null;
    if (paymentId) {
        const { data: pay } = await supabaseAdmin
            .from('po_payments').select('id')
            .eq('id', paymentId).eq('po_id', id).eq('organization_id', access.organizationId).maybeSingle();
        if (!pay) return NextResponse.json({ error: 'payment_id does not belong to this PO' }, { status: 400 });
    }

    const invoiceDate = fields.invoice_date ? String(fields.invoice_date) : null;
    if (invoiceDate && !DATE_RE.test(invoiceDate)) {
        return NextResponse.json({ error: 'invoice_date must be YYYY-MM-DD' }, { status: 400 });
    }

    // ---------------------------------------------------------------- file
    let fileUrl: string | null = fields.file_url ? String(fields.file_url) : null;
    let fileName: string | null = fields.file_name ? String(fields.file_name) : null;

    if (file) {
        if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 15MB' }, { status: 400 });
        await ensurePoDocsBucket();
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${access.organizationId}/${id}/${Date.now()}_${safeName}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { data: up, error: upErr } = await supabaseAdmin.storage
            .from(PO_DOCS_BUCKET).upload(path, buffer, { upsert: false, contentType: file.type });
        if (upErr) {
            console.error('PO document upload error:', upErr);
            return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
        }
        // The PATH is stored, not a URL: the bucket is private and every read is signed.
        fileUrl = up.path;
        fileName = fileName || file.name;
    }

    // ---------------------------------------------------------------- status
    const requested = String(fields.status || '').trim() as DocumentStatus;
    let status: DocumentStatus = fileUrl ? 'uploaded' : 'pending';
    if (requested === 'pending' || requested === 'uploaded') status = requested;
    if (requested === 'verified' || requested === 'rejected') {
        // Verifying a document is a control, not data entry: it is what readiness is
        // computed from. Same bar as marking a payment done — accounts + admins only.
        if (!access.canComplete && !access.isAdmin) {
            return NextResponse.json({ error: 'Forbidden: only accounts or an org admin may verify a document' }, { status: 403 });
        }
        status = requested;
    }
    // Mirrors the po_documents_has_file CHECK, so the caller gets a sentence instead of a
    // constraint violation.
    if (status !== 'pending' && !fileUrl) {
        return NextResponse.json({ error: 'A file (or file_url) is required unless the document is being recorded as pending' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { data: created, error } = await supabaseAdmin
        .from('po_documents')
        .insert({
            organization_id: access.organizationId,
            po_id: id,
            payment_id: paymentId,
            doc_type: docType,
            file_url: fileUrl,
            file_name: fileName,
            invoice_no: fields.invoice_no ? String(fields.invoice_no).trim() : null,
            invoice_date: invoiceDate,
            invoice_amount: num(fields.invoice_amount),
            gst_amount: num(fields.gst_amount),
            status,
            uploaded_by: access.user.id,
            uploaded_at: fileUrl ? nowIso : null,
            verified_by: status === 'verified' ? access.user.id : null,
            verified_at: status === 'verified' ? nowIso : null,
            notes: fields.notes ? String(fields.notes) : null,
        })
        .select('*')
        .single();

    if (error) {
        if (error.code === '42P01') {
            return NextResponse.json(
                { error: 'Payment Tracker requires a pending database migration (20260805000001). Apply migrations and retry.' },
                { status: 503 },
            );
        }
        console.error('PO document insert error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logPoActivity({
        organizationId: access.organizationId,
        poId: id,
        paymentId,
        action: status === 'verified' ? 'document_verified' : 'document_uploaded',
        toStatus: status,
        actorId: access.user.id,
        note: `${docType.replace(/_/g, ' ')}${fileName ? ` — ${fileName}` : ''}`,
        detail: {
            document_id: created.id,
            doc_type: docType,
            invoice_no: created.invoice_no,
            invoice_amount: created.invoice_amount,
        },
    });

    const document: PoDocument = {
        ...(created as Record<string, any>),
        invoice_amount: num(created.invoice_amount),
        gst_amount: num(created.gst_amount),
        uploaded_by_name: null,
        signed_url: await signPoDocument(created.file_url),
    } as PoDocument;

    const body: PoDocumentCreateResponse = { document };
    return NextResponse.json(body, { status: 201 });
}
