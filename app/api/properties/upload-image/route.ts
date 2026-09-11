import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import sharp from 'sharp';

const BUCKET_NAME = 'property-photos';

async function ensureBucket() {
    try {
        const { data: bucket } = await supabaseAdmin.storage.getBucket(BUCKET_NAME);
        if (!bucket) {
            await supabaseAdmin.storage.createBucket(BUCKET_NAME, { public: true });
        }
    } catch {
        await supabaseAdmin.storage.createBucket(BUCKET_NAME, { public: true }).catch(() => {});
    }
}

/**
 * POST /api/properties/upload-image
 * Upload a property photo to Supabase Storage (property-photos)
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const base64Data = formData.get('base64') as string | null;

        let buffer: Buffer;
        let originalName = 'property-image';

        if (file) {
            if (!file.type.startsWith('image/')) {
                return NextResponse.json({ error: 'Only image files are supported' }, { status: 400 });
            }
            const bytes = await file.arrayBuffer();
            buffer = Buffer.from(bytes);
            originalName = file.name || 'property-image';
        } else if (base64Data && base64Data.startsWith('data:image/')) {
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return NextResponse.json({ error: 'Invalid base64 image data' }, { status: 400 });
            }
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            return NextResponse.json({ error: 'File or base64 image data is required' }, { status: 400 });
        }

        // Compress and convert to WebP using sharp
        let compressedBuffer: Buffer;
        try {
            compressedBuffer = await sharp(buffer)
                .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();
        } catch (sharpErr) {
            console.warn('[PropertyImageUpload] Sharp compression failed, using original buffer:', sharpErr);
            compressedBuffer = buffer;
        }

        // Ensure storage bucket exists
        await ensureBucket();

        const timestamp = Date.now();
        const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `${timestamp}-${safeName}.webp`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(filePath, compressedBuffer, {
                contentType: 'image/webp',
                cacheControl: '3600',
                upsert: true,
            });

        if (uploadError) {
            console.error('[PropertyImageUpload] Upload error:', uploadError);
            return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }

        // Get public URL
        const { data: { publicUrl } } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(filePath);

        return NextResponse.json({
            success: true,
            url: publicUrl,
            path: filePath
        });
    } catch (err: any) {
        console.error('[PropertyImageUpload] Internal error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
