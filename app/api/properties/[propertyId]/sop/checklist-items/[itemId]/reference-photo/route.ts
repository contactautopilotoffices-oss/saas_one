import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import sharp from 'sharp';

/**
 * POST /api/properties/[propertyId]/sop/checklist-items/[itemId]/reference-photo
 * Upload a clean reference photo for a checklist step.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; itemId: string }> }
) {
    const { propertyId, itemId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify checklist item belongs to property via template
        const { data: item, error: itemError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, template:sop_templates!inner(property_id)')
            .eq('id', itemId)
            .maybeSingle();

        if (itemError || !item) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        const templatePropertyId = (item as any).template?.property_id;
        if (templatePropertyId !== propertyId) {
            return NextResponse.json({ error: 'Checklist item does not belong to this property' }, { status: 403 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Only image files are supported' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Compress and convert to WebP
        const compressedBuffer = await sharp(buffer)
            .resize({ width: 1280, withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();

        const timestamp = Date.now();
        const filePath = `sop-reference-photos/${propertyId}/${itemId}-${timestamp}.webp`;

        // Ensure storage bucket exists
        await ensureBucket('sop-reference-photos');

        const { error: uploadError } = await supabaseAdmin.storage
            .from('sop-reference-photos')
            .upload(filePath, compressedBuffer, {
                contentType: 'image/webp',
                upsert: false,
            });

        if (uploadError) {
            return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }

        const { data: publicData } = supabaseAdmin.storage
            .from('sop-reference-photos')
            .getPublicUrl(filePath);

        // Update checklist item
        const { error: updateError } = await supabaseAdmin
            .from('sop_checklist_items')
            .update({
                reference_photo_url: publicData.publicUrl,
                reference_photo_source: 'uploaded',
            })
            .eq('id', itemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            referencePhotoUrl: publicData.publicUrl,
        }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; itemId: string }> }
) {
    const { propertyId, itemId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify checklist item belongs to property via template
        const { data: item, error: itemError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, template:sop_templates!inner(property_id)')
            .eq('id', itemId)
            .maybeSingle();

        if (itemError || !item) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        const templatePropertyId = (item as any).template?.property_id;
        if (templatePropertyId !== propertyId) {
            return NextResponse.json({ error: 'Checklist item does not belong to this property' }, { status: 403 });
        }

        const { error: updateError } = await supabaseAdmin
            .from('sop_checklist_items')
            .update({
                reference_photo_url: null,
                reference_photo_source: null,
            })
            .eq('id', itemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

async function ensureBucket(bucketName: string) {
    try {
        const { data: bucket } = await supabaseAdmin.storage.getBucket(bucketName);
        if (!bucket) {
            await supabaseAdmin.storage.createBucket(bucketName, { public: true });
        }
    } catch {
        await supabaseAdmin.storage.createBucket(bucketName, { public: true }).catch(() => {});
    }
}
