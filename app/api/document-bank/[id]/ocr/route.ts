import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkDocumentBankAccess } from '@/backend/lib/documentBank/access';
import { DOCUMENT_BANK_BUCKET, signDocumentBankFiles } from '@/backend/lib/documentBank/storage';
import { parseDocument } from '@/backend/lib/documentBank/ocr';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/document-bank/[id]/ocr
 * Re-runs OCR on an already-uploaded document (initial pass failed, or a scanned PDF was
 * re-uploaded with a text layer). Only updates ocr_* columns — never overwrites a field the
 * uploader has already set; use PATCH with apply_ocr_fields to pull a suggestion in.
 */
export async function POST(request: NextRequest, { params }: Params) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { data: doc, error } = await supabaseAdmin.from('document_bank').select('*').eq('id', id).single();
    if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { allowed } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(DOCUMENT_BANK_BUCKET)
        .download(doc.file_path);
    if (downloadError || !fileData) {
        return NextResponse.json({ error: downloadError?.message || 'Could not read stored file' }, { status: 500 });
    }
    const buffer = Buffer.from(await fileData.arrayBuffer());

    const needsSignedUrl = doc.file_type && !doc.file_type.includes('pdf');
    const signedUrlForOcr = needsSignedUrl
        ? (await supabaseAdmin.storage.from(DOCUMENT_BANK_BUCKET).createSignedUrl(doc.file_path, 300)).data?.signedUrl ?? null
        : null;

    const ocrResult = await parseDocument(buffer, doc.file_type || 'application/octet-stream', signedUrlForOcr);
    const patch: Record<string, unknown> = {
        ocr_status: ocrResult.extracted ? 'processed' : 'failed',
        ocr_text: ocrResult.text,
        ocr_confidence: ocrResult.extracted?.confidence ?? null,
        ocr_extracted: ocrResult.extracted ? { ...ocrResult.extracted, error: null } : { error: ocrResult.error ?? 'OCR failed' },
        updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await supabaseAdmin
        .from('document_bank')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const [signedUrl] = await signDocumentBankFiles([updated.file_path]);
    return NextResponse.json({ document: { ...updated, signed_url: signedUrl }, ocr_error: ocrResult.error ?? null });
}
