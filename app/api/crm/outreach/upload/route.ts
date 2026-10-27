import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { CampaignOutreachConfigService } from '@/backend/services/CampaignOutreachConfigService';

// POST /api/crm/outreach/upload — Upload property showcase photo and save to database
export async function POST(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    try {
        const formData = await request.formData().catch(() => null);
        if (!formData) {
            return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
        }

        const file = formData.get('file');
        const campaign = (formData.get('campaign') as string) || '';

        if (!(file instanceof File) || !file.size) {
            return NextResponse.json({ error: 'Please choose an image file to upload' }, { status: 400 });
        }

        // Limit file size to 10MB
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: 'Image must be under 10MB' }, { status: 400 });
        }

        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            return NextResponse.json({ error: 'Only JPG, PNG, and WebP images are supported' }, { status: 400 });
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const ext = file.name.split('.').pop() || 'jpg';
        const cleanCampaignName = campaign.replace(/[^a-zA-Z0-9_-]/g, '_') || 'centre';
        const fileName = `${access.organizationId}/outreach/${cleanCampaignName}_${Date.now()}.${ext}`;

        // Upload to public 'property-photos' bucket
        const { error: uploadError } = await supabaseAdmin.storage
            .from('property-photos')
            .upload(fileName, bytes, {
                contentType: file.type,
                upsert: true,
            });

        if (uploadError) {
            console.error('[OutreachUpload] Supabase storage upload error:', uploadError);
            return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
        }

        // Retrieve the public CDN URL
        const { data: publicData } = supabaseAdmin.storage
            .from('property-photos')
            .getPublicUrl(fileName);

        const publicUrl = publicData.publicUrl;

        // If a campaign was specified, persist directly to the database
        if (campaign) {
            await CampaignOutreachConfigService.updateCampaignConfig(
                access.organizationId,
                campaign,
                { property_photo_url: publicUrl },
                access.user.id
            );
        }

        return NextResponse.json({
            success: true,
            url: publicUrl,
            message: 'Photo uploaded and saved to database successfully!',
        });
    } catch (err: any) {
        console.error('[OutreachUpload] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
