import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

const BUCKET = 'payment_proofs';

// POST /api/accounts/upload — store a payment proof, return its public URL.
export async function POST(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'File exceeds 15MB' }, { status: 400 });

    const { error: bucketErr } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (bucketErr && (bucketErr as { status?: number }).status === 400) {
        await supabaseAdmin.storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ['application/pdf', 'image/*'] });
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${access.organizationId}/${Date.now()}_${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { data: up, error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { upsert: false, contentType: file.type });
    if (upErr) {
        console.error('Payment proof upload error:', upErr);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(up.path).data.publicUrl;
    return NextResponse.json({ url, file_name: file.name, file_type: file.type });
}
