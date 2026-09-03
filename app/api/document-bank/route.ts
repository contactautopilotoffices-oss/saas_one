import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkDocumentBankAccess } from '@/backend/lib/documentBank/access';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { DOCUMENT_BANK_BUCKET, ensureDocumentBankBucket, signDocumentBankFiles } from '@/backend/lib/documentBank/storage';
import { FIELD_REVIEW_THRESHOLD, parseDocument } from '@/backend/lib/documentBank/ocr';

const CATEGORIES = [
    'amc_contract', 'warranty_certificate', 'calibration_certificate', 'statutory_certificate',
    'consent_approval', 'oem_manual', 'sld_drawing', 'load_schedule', 'sop',
    'training_record', 'insurance', 'kyc', 'invoice', 'test_report', 'other',
] as const;

/**
 * GET /api/document-bank?organization_id=...&property_id=...&category=...&equipment=...
 *   &status=valid|expiring|expired&q=search+term&linked_master_item_id=...
 * Search is a plain ILIKE across title/vendor_name/doc_number/ocr_text/equipment — matches
 * this repo's existing search convention (app/api/search/route.ts), no tsvector.
 */
export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organization_id');
    const propertyId = searchParams.get('property_id');
    if (!organizationId) return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });

    const { allowed } = await checkDocumentBankAccess(user.id, organizationId, propertyId);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const category = searchParams.get('category');
    const equipment = searchParams.get('equipment');
    const status = searchParams.get('status'); // valid | expiring | expired
    const q = searchParams.get('q')?.trim();
    const linkedMasterItemId = searchParams.get('linked_master_item_id');

    let query = supabaseAdmin
        .from('document_bank')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

    if (propertyId) query = query.eq('property_id', propertyId);
    if (category) query = query.eq('category', category);
    if (equipment) query = query.eq('equipment', equipment);
    if (linkedMasterItemId) query = query.eq('linked_master_item_id', linkedMasterItemId);
    if (q) {
        const like = `%${q.replace(/[%_]/g, '')}%`;
        query = query.or(`title.ilike.${like},vendor_name.ilike.${like},doc_number.ilike.${like},equipment.ilike.${like},ocr_text.ilike.${like}`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (status === 'expired') query = query.lt('valid_to', today);
    else if (status === 'expiring') query = query.gte('valid_to', today).lte('valid_to', in30);
    else if (status === 'valid') query = query.or(`valid_to.is.null,valid_to.gt.${in30}`);

    const { data, error } = await query;
    // 20260827000001_document_bank.sql may not be applied yet. An empty list here would
    // render as "no documents match your filters", i.e. a compliance vault reporting itself
    // clean when it does not exist — say unprovisioned instead, the way the electricity
    // routes do (backend/lib/aop/access.ts isMissingRelation).
    if (isMissingRelation(error)) {
        return NextResponse.json({
            provisioned: false,
            documents: [],
            reason: 'Document Bank is not set up yet — apply 20260827000001_document_bank.sql.',
        });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const signedUrls = await signDocumentBankFiles((data || []).map((d) => d.file_path));
    const documents = (data || []).map((d, i) => ({ ...d, signed_url: signedUrls[i] }));

    return NextResponse.json({ provisioned: true, documents });
}

/**
 * POST /api/document-bank
 * FormData: file (File, required), organization_id, title, category — required.
 * Optional: property_id, equipment, vendor_name, doc_number, issue_date, valid_from,
 *   valid_to, tags (comma-separated), linked_master_item_id, linked_contract_id.
 *
 * Runs OCR synchronously (bounded to 30s by parseDocument) and auto-fills any of
 * doc_number/vendor_name/equipment/valid_from/valid_to the uploader left blank, but only
 * when the model's confidence for that field clears FIELD_REVIEW_THRESHOLD — otherwise the
 * suggestion is left in ocr_extracted for the UI to offer as a one-click "Apply" instead of
 * silently trusting a low-confidence read on a compliance date.
 *
 * When linked_master_item_id + property_id are supplied, also upserts
 * property_audit_submissions so the upload satisfies that Digital Audit checklist point —
 * the same table/upsert shape as PATCH /api/audit/submissions.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const organizationId = formData.get('organization_id') as string | null;
        const title = formData.get('title') as string | null;
        const category = formData.get('category') as string | null;
        const propertyId = (formData.get('property_id') as string | null) || null;

        if (!file || !organizationId || !title || !category) {
            return NextResponse.json({ error: 'file, organization_id, title and category are required' }, { status: 400 });
        }
        if (!(CATEGORIES as readonly string[]).includes(category)) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }

        const { allowed } = await checkDocumentBankAccess(user.id, organizationId, propertyId);
        if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const equipment = (formData.get('equipment') as string | null) || null;
        const vendorName = (formData.get('vendor_name') as string | null) || null;
        const docNumber = (formData.get('doc_number') as string | null) || null;
        const issueDate = (formData.get('issue_date') as string | null) || null;
        const validFrom = (formData.get('valid_from') as string | null) || null;
        const validTo = (formData.get('valid_to') as string | null) || null;
        const tagsRaw = (formData.get('tags') as string | null) || '';
        const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
        const linkedMasterItemId = (formData.get('linked_master_item_id') as string | null) || null;
        const linkedContractId = (formData.get('linked_contract_id') as string | null) || null;

        await ensureDocumentBankBucket();

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${organizationId}/${propertyId || 'org'}/${category}/${Date.now()}_${safeName}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { error: uploadError } = await supabaseAdmin.storage
            .from(DOCUMENT_BANK_BUCKET)
            .upload(path, buffer, { contentType: file.type || undefined, upsert: false });
        if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

        const { data: inserted, error: insertError } = await supabaseAdmin
            .from('document_bank')
            .insert({
                organization_id: organizationId,
                property_id: propertyId,
                category,
                equipment,
                title,
                vendor_name: vendorName,
                doc_number: docNumber,
                issue_date: issueDate,
                valid_from: validFrom,
                valid_to: validTo,
                linked_master_item_id: linkedMasterItemId,
                linked_contract_id: linkedContractId,
                file_path: path,
                file_name: file.name,
                file_type: file.type || null,
                file_size_bytes: buffer.byteLength,
                tags,
                uploaded_by: user.id,
            })
            .select()
            .single();

        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

        // OCR — bounded, never fails the upload itself.
        let ocrExtracted: Record<string, unknown> | null = null;
        try {
            const needsSignedUrl = file.type && !file.type.includes('pdf');
            const signedUrlForOcr = needsSignedUrl
                ? (await supabaseAdmin.storage.from(DOCUMENT_BANK_BUCKET).createSignedUrl(path, 300)).data?.signedUrl ?? null
                : null;

            const ocrResult = await parseDocument(buffer, file.type || 'application/octet-stream', signedUrlForOcr);
            const patch: Record<string, unknown> = {
                ocr_status: ocrResult.extracted ? 'processed' : 'failed',
                ocr_text: ocrResult.text,
                ocr_confidence: ocrResult.extracted?.confidence ?? null,
            };

            if (ocrResult.extracted) {
                const conf = ocrResult.extracted.fieldConfidence;
                ocrExtracted = { ...ocrResult.extracted, error: ocrResult.error ?? null };
                patch.ocr_extracted = ocrExtracted;

                // Auto-fill only fields the uploader left blank, and only above threshold.
                if (!docNumber && conf.doc_number >= FIELD_REVIEW_THRESHOLD) patch.doc_number = ocrResult.extracted.docNumber;
                if (!vendorName && conf.vendor_name >= FIELD_REVIEW_THRESHOLD) patch.vendor_name = ocrResult.extracted.vendorName;
                if (!equipment && conf.equipment >= FIELD_REVIEW_THRESHOLD) patch.equipment = ocrResult.extracted.equipment;
                if (!issueDate && conf.issue_date >= FIELD_REVIEW_THRESHOLD) patch.issue_date = ocrResult.extracted.issueDate;
                if (!validFrom && conf.valid_from >= FIELD_REVIEW_THRESHOLD) patch.valid_from = ocrResult.extracted.validFrom;
                if (!validTo && conf.valid_to >= FIELD_REVIEW_THRESHOLD) patch.valid_to = ocrResult.extracted.validTo;
            } else {
                ocrExtracted = { error: ocrResult.error ?? 'OCR failed' };
                patch.ocr_extracted = ocrExtracted;
            }

            const { data: updated } = await supabaseAdmin
                .from('document_bank')
                .update(patch)
                .eq('id', inserted.id)
                .select()
                .single();
            if (updated) Object.assign(inserted, updated);
        } catch (e) {
            console.error('[document-bank] OCR pass threw:', e);
            await supabaseAdmin.from('document_bank').update({ ocr_status: 'failed', ocr_extracted: { error: 'OCR threw unexpectedly' } }).eq('id', inserted.id);
        }

        // Connect to Digital Audit: satisfy the linked checklist point, same shape as
        // PATCH /api/audit/submissions.
        if (linkedMasterItemId && propertyId) {
            await supabaseAdmin.from('property_audit_submissions').upsert({
                master_item_id: linkedMasterItemId,
                property_id: propertyId,
                organization_id: organizationId,
                status: 'compliant',
                remark: `Uploaded via Document Bank: ${title}`,
                proof_url: path,
                document_id: inserted.id,
                submitted_by: user.id,
                submitted_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'master_item_id,property_id,audit_period_year' });
        }

        const [signedUrl] = await signDocumentBankFiles([inserted.file_path]);
        return NextResponse.json({ document: { ...inserted, signed_url: signedUrl } }, { status: 201 });
    } catch (err) {
        console.error('[document-bank] upload error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
