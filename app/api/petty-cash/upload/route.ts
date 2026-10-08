import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { evidenceType, validateEvidence, EVIDENCE_BUCKET } from '@/backend/lib/pettyCash/evidence';
import { pcError } from '@/backend/lib/pettyCash/api';
export async function POST(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.size || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'Choose a non-empty PDF or image up to 15MB' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = evidenceType(bytes);
    if (!type || type !== file.type) return NextResponse.json({ error: 'File contents do not match a supported PDF or image' }, { status: 400 });
    if (!await validateEvidence(bytes, type)) return NextResponse.json({ error: 'The PDF or image is damaged, encrypted or unreadable' }, { status: 400 });
    const id = crypto.randomUUID();
    const ext = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[type];
    const path = `${access.organizationId}/${access.user.id}/${id}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
    if (error) return pcError(error);
    const { error: metadataError } = await supabaseAdmin.from('petty_cash_uploads').insert({ id, organization_id: access.organizationId, uploaded_by: access.user.id, storage_path: path, file_name: file.name.slice(0, 255), file_type: type });
    if (metadataError) return pcError(metadataError); // Preserve orphan evidence for audit; never delete files.
    return NextResponse.json({ upload_id: id, file_name: file.name, file_type: type });
}
