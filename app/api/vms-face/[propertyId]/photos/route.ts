import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

// Same bucket as the live VMS, but under its own face-test/ folder so test photos never mix with live ones.
const BUCKET_NAME = 'visitor-photos';
const FOLDER = 'face-test';

/**
 * POST /api/vms-face/[propertyId]/photos
 * Upload a visitor photo for a VMS Face (testing) visit.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    try {
        const { propertyId } = await params;

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await request.formData();
        const file = formData.get('file') as File;
        const visitorCode = formData.get('visitor_id') as string;

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (!visitorCode) return NextResponse.json({ error: 'visitor_id required' }, { status: 400 });
        if (file.size > 100 * 1024) {
            return NextResponse.json({ error: 'File too large. Max 100KB' }, { status: 400 });
        }

        const fileExt = file.type === 'image/webp' ? 'webp' : 'jpg';
        const filePath = `${FOLDER}/${propertyId}/${visitorCode}.${fileExt}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(filePath, file, { cacheControl: '3600', upsert: true, contentType: file.type });

        if (uploadError) {
            console.error('[VMS Face] Upload error:', uploadError);
            return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
        }

        const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(filePath);

        const { error: updateError } = await supabaseAdmin
            .from('vms_face_visits')
            .update({ photo_url: publicUrl })
            .eq('visitor_code', visitorCode)
            .eq('property_id', propertyId);

        if (updateError) console.error('[VMS Face] Photo URL update error:', updateError);

        return NextResponse.json({ success: true, url: publicUrl, path: filePath });
    } catch (error) {
        console.error('[VMS Face] Photo upload error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
