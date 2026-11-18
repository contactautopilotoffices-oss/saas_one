import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@lib/supabase/admin';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';
import { resolveGuestFormFields } from '@/backend/lib/ticketing/guestFormConfig';
import { visibleGuestFormFields } from '@/frontend/lib/guestTicketForm';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const zoneId = searchParams.get('zoneId');
        const sig = searchParams.get('sig');

        if (!zoneId || !sig) {
            return NextResponse.json({ error: 'Missing zoneId or sig' }, { status: 400 });
        }

        const ip = getClientIP(req);
        // Rate limit: 30 requests per minute
        const limit = checkRateLimit(ip, { maxRequests: 30, windowMs: 60 * 1000 });
        if (!limit.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        const { data: zone, error: zoneError } = await supabaseAdmin
            .from('qr_facility_zones')
            .select(`
                id,
                floor,
                zone_name,
                qr_signature,
                property_id,
                properties (
                    id,
                    name
                )
            `)
            .eq('id', zoneId)
            .single();

        if (zoneError || !zone || zone.qr_signature !== sig) {
            return NextResponse.json({ error: 'Invalid or expired QR code' }, { status: 404 });
        }

        const propertyData = Array.isArray(zone.properties) ? zone.properties[0] : zone.properties;

        // Which fields this property's form asks for. Served here so the public page needs one
        // round trip to render, and only the switched-on fields ever reach the browser.
        const fields = await resolveGuestFormFields(zone.property_id);

        return NextResponse.json({
            success: true,
            zone: {
                id: zone.id,
                zoneName: zone.zone_name,
                floor: zone.floor || null,
                propertyName: (propertyData as any)?.name || null
            },
            formFields: visibleGuestFormFields(fields)
        });
    } catch (error: any) {
        console.error('zone-info API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
