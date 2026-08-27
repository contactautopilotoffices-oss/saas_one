import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';

const BUCKET = 'petty_cash_documents';

// POST /api/petty-cash/upload — store a supporting file, return its public URL.
// The URL is then included in the create / settle payload, which writes the
// petty_cash_documents row. Keeps upload decoupled from request creation.
export async function POST(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'File exceeds 15MB' }, { status: 400 });

    // Ensure the bucket exists (mirrors the procurement upload pattern).
    const { error: bucketErr } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (bucketErr && (bucketErr as { status?: number }).status === 400) {
        await supabaseAdmin.storage.createBucket(BUCKET, {
            public: true,
            allowedMimeTypes: ['application/pdf', 'image/*', 'text/csv',
                'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        });
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${access.organizationId}/${Date.now()}_${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data: up, error: upErr } = await supabaseAdmin.storage
        .from(BUCKET).upload(path, buffer, { upsert: false, contentType: file.type });
    if (upErr) {
        console.error('Petty cash upload error:', upErr);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(up.path).data.publicUrl;
    return NextResponse.json({ url, file_name: file.name, file_type: file.type });
}
