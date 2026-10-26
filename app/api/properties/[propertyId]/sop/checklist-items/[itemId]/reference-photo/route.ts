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

        // Fetch existing reference photos
        const { data: existingItem } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('reference_photos, reference_photo_url')
            .eq('id', itemId)
            .maybeSingle();

        const label = (formData.get('label') as string) || (file.name ? file.name.replace(/\.[^/.]+$/, "") : 'Clean Standard');
        const existingPhotos: any[] = Array.isArray(existingItem?.reference_photos) ? existingItem.reference_photos : (
            existingItem?.reference_photo_url ? [{ id: 'ref_1', label: 'Primary Standard', url: existingItem.reference_photo_url, source: 'uploaded' }] : []
        );

        const newPhotoObj = {
            id: `ref_${timestamp}`,
            label: label,
            url: publicData.publicUrl,
            source: 'uploaded',
            created_at: new Date().toISOString(),
        };

        const updatedPhotos = [...existingPhotos, newPhotoObj];

        // Update checklist item: keep primary reference_photo_url pointing to the first benchmark
        const { error: updateError } = await supabaseAdmin
            .from('sop_checklist_items')
            .update({
                reference_photo_url: updatedPhotos[0]?.url || publicData.publicUrl,
                reference_photos: updatedPhotos,
                reference_photo_source: 'uploaded',
            })
            .eq('id', itemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            referencePhotoUrl: publicData.publicUrl,
            referencePhotos: updatedPhotos,
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
    const { searchParams } = new URL(request.url);
    const photoId = searchParams.get('photoId');
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify checklist item belongs to property via template
        const { data: item, error: itemError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, reference_photos, reference_photo_url, template:sop_templates!inner(property_id)')
            .eq('id', itemId)
            .maybeSingle();

        if (itemError || !item) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        const templatePropertyId = (item as any).template?.property_id;
        if (templatePropertyId !== propertyId) {
            return NextResponse.json({ error: 'Checklist item does not belong to this property' }, { status: 403 });
        }

        const existingPhotos: any[] = Array.isArray(item.reference_photos) ? item.reference_photos : (
            item.reference_photo_url ? [{ id: 'ref_1', label: 'Primary Standard', url: item.reference_photo_url }] : []
        );

        let remainingPhotos: any[] = [];
        if (photoId) {
            remainingPhotos = existingPhotos.filter((p: any) => p.id !== photoId && p.url !== photoId);
        }

        const newPrimaryUrl = remainingPhotos.length > 0 ? remainingPhotos[0].url : null;

        const { error: updateError } = await supabaseAdmin
            .from('sop_checklist_items')
            .update({
                reference_photo_url: newPrimaryUrl,
                reference_photos: remainingPhotos,
                reference_photo_source: remainingPhotos.length > 0 ? 'uploaded' : null,
            })
            .eq('id', itemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, referencePhotos: remainingPhotos, referencePhotoUrl: newPrimaryUrl });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function PATCH(
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

        const body = await request.json().catch(() => ({}));
        const { photoId, label } = body;

        if (!photoId || !label || !label.trim()) {
            return NextResponse.json({ error: 'photoId and label are required' }, { status: 400 });
        }

        const { data: item, error: itemError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, reference_photos, reference_photo_url, template:sop_templates!inner(property_id)')
            .eq('id', itemId)
            .maybeSingle();

        if (itemError || !item) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        const templatePropertyId = (item as any).template?.property_id;
        if (templatePropertyId !== propertyId) {
            return NextResponse.json({ error: 'Checklist item does not belong to this property' }, { status: 403 });
        }

        const existingPhotos: any[] = Array.isArray(item.reference_photos) ? item.reference_photos : (
            item.reference_photo_url ? [{ id: 'ref_1', label: 'Primary Standard', url: item.reference_photo_url }] : []
        );

        const updatedPhotos = existingPhotos.map((p: any) =>
            (p.id === photoId || p.url === photoId) ? { ...p, label: label.trim() } : p
        );

        const { error: updateError } = await supabaseAdmin
            .from('sop_checklist_items')
            .update({
                reference_photos: updatedPhotos,
            })
            .eq('id', itemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, referencePhotos: updatedPhotos });
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
