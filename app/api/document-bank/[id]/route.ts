import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkDocumentBankAccess } from '@/backend/lib/documentBank/access';
import { DOCUMENT_BANK_BUCKET, signDocumentBankFiles } from '@/backend/lib/documentBank/storage';

type Params = { params: Promise<{ id: string }> };

const EDITABLE_FIELDS = [
    'title', 'category', 'equipment', 'vendor_name', 'doc_number',
    'issue_date', 'valid_from', 'valid_to', 'tags', 'linked_master_item_id', 'linked_contract_id',
] as const;

/** OCR field key -> document_bank column it can be applied into. */
const APPLICABLE_OCR_FIELDS: Record<string, string> = {
    doc_number: 'doc_number',
    vendor_name: 'vendor_name',
    equipment: 'equipment',
    issue_date: 'issue_date',
    valid_from: 'valid_from',
    valid_to: 'valid_to',
};

async function loadDoc(id: string) {
    return supabaseAdmin.from('document_bank').select('*').eq('id', id).single();
}

export async function GET(request: NextRequest, { params }: Params) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { data: doc, error } = await loadDoc(id);
    if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { allowed } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [signedUrl] = await signDocumentBankFiles([doc.file_path]);
    return NextResponse.json({ document: { ...doc, signed_url: signedUrl } });
}

/**
 * PATCH /api/document-bank/[id]
 * Body (all optional): editable metadata fields, `verify: true` (admin-only — marks the
 * document reviewed), `apply_ocr_fields: string[]` (copies those fields from ocr_extracted
 * into the real columns — the explicit "Apply" action for a low-confidence OCR suggestion
 * the auto-fill in POST left untouched).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { data: doc, error } = await loadDoc(id);
    if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { allowed, isAdmin } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
    const isOwner = doc.uploaded_by === user.id;
    if (!allowed || (!isOwner && !isAdmin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const patch: Record<string, unknown> = {};

    for (const field of EDITABLE_FIELDS) {
        if (body[field] !== undefined) patch[field] = body[field];
    }

    if (body.apply_ocr_fields && Array.isArray(body.apply_ocr_fields)) {
        const extracted = (doc.ocr_extracted || {}) as Record<string, unknown>;
        for (const key of body.apply_ocr_fields) {
            const column = APPLICABLE_OCR_FIELDS[key];
            const camelKey = key.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
            if (column && extracted[camelKey] !== undefined) patch[column] = extracted[camelKey];
        }
    }

    if (body.verify === true) {
        if (!isAdmin) return NextResponse.json({ error: 'Only an org/property admin can verify a document' }, { status: 403 });
        patch.verified_by = user.id;
        patch.verified_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
        .from('document_bank')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const [signedUrl] = await signDocumentBankFiles([updated.file_path]);
    return NextResponse.json({ document: { ...updated, signed_url: signedUrl } });
}

/** DELETE /api/document-bank/[id] — admin-only, see the migration's delete policy comment. */
export async function DELETE(request: NextRequest, { params }: Params) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { data: doc, error } = await loadDoc(id);
    if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { isAdmin } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
    if (!isAdmin) return NextResponse.json({ error: 'Only an org/property admin can delete a document' }, { status: 403 });

    if (doc.file_path) {
        const { error: removeError } = await supabaseAdmin.storage.from(DOCUMENT_BANK_BUCKET).remove([doc.file_path]);
        if (removeError) console.error('[document-bank] storage remove failed:', removeError.message);
    }

    const { error: deleteError } = await supabaseAdmin.from('document_bank').delete().eq('id', id);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    return NextResponse.json({ success: true });
}
