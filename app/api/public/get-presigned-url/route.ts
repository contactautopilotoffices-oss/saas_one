import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@lib/supabase/admin';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { zoneId, sig, fileName } = body;

        // Rate Limiting
        const ip = getClientIP(req);
        // Max 10 requests per minute for signed urls
        const limit = checkRateLimit(ip, { maxRequests: 10, windowMs: 60 * 1000 });
        if (!limit.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        if (!zoneId || !sig || !fileName) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the signature matches the zone in the database
        const { data: zone, error: zoneError } = await supabaseAdmin
            .from('qr_facility_zones')
            .select('id, property_id, qr_signature')
            .eq('id', zoneId)
            .single();

        if (zoneError || !zone || zone.qr_signature !== sig) {
            return NextResponse.json({ error: 'Invalid zone or signature' }, { status: 401 });
        }

        // Extract file extension and sanitize
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        
        // Strict file extension whitelist
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        if (!fileExt || !allowedExtensions.includes(fileExt)) {
            return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
        }

        const safeName = `${uuidv4()}.${fileExt}`;
        const filePath = `${zone.property_id}/${safeName}`;

        // Create a signed upload URL
        const { data, error } = await supabaseAdmin
            .storage
            .from('guest-photos')
            .createSignedUploadUrl(filePath);

        if (error) {
            console.error('Error creating signed URL:', error);
            return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            signedUrl: data?.signedUrl,
            token: data?.token,
            path: filePath
        });
    } catch (error: any) {
        console.error('get-presigned-url API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
