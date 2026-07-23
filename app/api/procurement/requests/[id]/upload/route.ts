import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const adminSupabase = createAdminClient();

    // Ensure bucket exists
    const { data: bucket, error: bucketErr } = await adminSupabase.storage.getBucket('procurement_quotations');
    if (bucketErr && (bucketErr as any).code === '404') {
      const { error: createErr } = await adminSupabase.storage.createBucket('procurement_quotations', {
        public: true,
        allowedMimeTypes: ['application/pdf', 'image/*'],
      });
      if (createErr) throw createErr;
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }
    const filePath = `${id}/${Date.now()}_${file.name}`;

    // Convert File to Buffer for Supabase storage upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { data: uploadData, error: uploadError } = await adminSupabase.storage
      .from('procurement_quotations')
      .upload(filePath, buffer, { upsert: false, contentType: file.type });
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Upload failed', details: uploadError.message }, { status: 500 });
    }
    const publicUrl = adminSupabase.storage.from('procurement_quotations').getPublicUrl(uploadData.path).data.publicUrl;
    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
