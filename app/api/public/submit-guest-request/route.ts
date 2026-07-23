import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@lib/supabase/admin';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';
import { z } from 'zod';

const guestRequestSchema = z.object({
    zoneId: z.string().min(1),
    sig: z.string().min(1),
    guestName: z.string().min(1).max(100),
    guestPhone: z.string().max(50).optional().nullable().or(z.literal('')),
    guestEmail: z.string().email().max(255).optional().nullable().or(z.literal('')),
    description: z.string().min(1).max(1000),
    photoUrls: z.array(z.string().min(1)).max(3).optional().default([]),
    deviceInfo: z.object({
        userAgent: z.string().max(300).optional(),
        platform: z.string().max(100).optional(),
        language: z.string().max(50).optional(),
        screenResolution: z.string().max(50).optional()
    }).strict().optional().default({}),
    locationData: z.object({
        lat: z.number().optional(),
        lng: z.number().optional(),
        accuracy: z.number().optional()
    }).strict().optional().default({})
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // --- 1. Rate Limiting ---
        const ip = getClientIP(req);
        // Max 5 requests per minute for submitting guest requests
        const limit = checkRateLimit(ip, { maxRequests: 5, windowMs: 60 * 1000 });
        if (!limit.allowed) {
            return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
        }

        // --- 2. Payload Validation ---
        const parseResult = guestRequestSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ error: 'Invalid payload data', details: parseResult.error.flatten() }, { status: 400 });
        }
        
        const { zoneId, sig, guestName, guestPhone, guestEmail, description, photoUrls, deviceInfo, locationData } = parseResult.data;

        // 3. Verify the signature matches the zone in the database
        const { data: zone, error: zoneError } = await supabaseAdmin
            .from('qr_facility_zones')
            .select('id, property_id, qr_signature')
            .eq('id', zoneId)
            .single();

        if (zoneError || !zone) {
            return NextResponse.json({ error: 'Invalid zone' }, { status: 404 });
        }

        if (zone.qr_signature !== sig) {
            return NextResponse.json({ error: 'Invalid QR signature' }, { status: 401 });
        }

        // 2. Perform AI Categorization (Placeholder for now)
        // In the future, send 'description' to OpenAI or GROQ to get category
        const aiCategory = 'General'; 

        // 3. Insert the guest request using Service Role to bypass RLS
        const { data: request, error: insertError } = await supabaseAdmin
            .from('guest_requests')
            .insert({
                property_id: zone.property_id,
                qr_zone_id: zone.id,
                guest_name: guestName,
                guest_phone: guestPhone,
                guest_email: guestEmail,
                description,
                photo_urls: photoUrls || [],
                device_info: deviceInfo || {},
                location_data: locationData || {},
                ai_category: aiCategory,
                status: 'PENDING'
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error inserting guest request:', insertError);
            return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: request });
    } catch (error: any) {
        console.error('submit-guest-request API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
