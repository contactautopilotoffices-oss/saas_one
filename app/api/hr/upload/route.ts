import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Sanitize filename & create unique path
        const fileExt = file.name.split('.').pop() || 'bin';
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${cleanFileName}`;
        const filePath = `tickets/${uniqueFileName}`;

        // Ensure bucket exists or create it
        const bucketName = 'hr-ticket-attachments';
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        const bucketExists = buckets?.some(b => b.name === bucketName);
        if (!bucketExists) {
            await supabaseAdmin.storage.createBucket(bucketName, { public: true });
        }

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(bucketName)
            .upload(filePath, buffer, {
                contentType: file.type || 'application/octet-stream',
                upsert: true
            });

        if (uploadError) {
            console.error('[HR Attachment Upload Error]:', uploadError);
            return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
        }

        const { data: publicUrlData } = supabaseAdmin.storage
            .from(bucketName)
            .getPublicUrl(filePath);

        return NextResponse.json({
            success: true,
            url: publicUrlData.publicUrl,
            fileName: file.name
        });
    } catch (err: any) {
        console.error('[HR Attachment Upload Exception]:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Upload failed' }, { status: 500 });
    }
}
