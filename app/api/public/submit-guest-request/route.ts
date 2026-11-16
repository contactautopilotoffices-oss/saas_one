import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@lib/supabase/admin';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';
import { z } from 'zod';
import { resolveGuestFormFields } from '@/backend/lib/ticketing/guestFormConfig';
import {
    BUILTIN_FIELDS,
    MAX_GUEST_PHOTOS,
    isBuiltinFieldKey,
    validateGuestFormAnswer,
    visibleGuestFormFields,
} from '@/frontend/lib/guestTicketForm';

/**
 * Public submission of a client support request from a facility QR code.
 *
 * Which fields are accepted (and which are required) is configured per property, so this validates
 * the posted answers against that property's own field list rather than a fixed schema. `answers`
 * is the current shape; the older named fields are still accepted so a QR page cached on someone's
 * phone keeps working.
 */

const guestRequestSchema = z.object({
    zoneId: z.string().min(1),
    sig: z.string().min(1),
    /** Answers keyed by field key, e.g. { guest_name: 'Asha', client_id: 'E-1042' }. */
    answers: z.record(z.string(), z.string()).optional(),
    // Legacy named fields, kept so an already-loaded form still submits.
    guestName: z.string().max(200).optional().nullable(),
    processName: z.string().max(200).optional().nullable(),
    guestPhone: z.string().max(50).optional().nullable(),
    guestEmail: z.string().max(255).optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
    photoUrls: z.array(z.string().min(1)).max(MAX_GUEST_PHOTOS).optional().default([]),
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

/** Legacy payload keys, mapped onto the field keys they correspond to. */
const LEGACY_KEYS: Record<string, string> = {
    guestName: 'guest_name',
    processName: 'process_name',
    guestPhone: 'guest_phone',
    guestEmail: 'guest_email',
    description: 'description',
};

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

        // --- 2. Payload shape ---
        const parseResult = guestRequestSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ error: 'Invalid payload data', details: parseResult.error.flatten() }, { status: 400 });
        }

        const { zoneId, sig, answers, photoUrls, deviceInfo, locationData } = parseResult.data;

        // --- 3. Verify the signature matches the zone in the database ---
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

        // --- 4. Collect the answers, newest shape first, legacy keys as a fallback ---
        const submitted: Record<string, string> = {};
        for (const [legacyKey, fieldKey] of Object.entries(LEGACY_KEYS)) {
            const value = (parseResult.data as Record<string, unknown>)[legacyKey];
            if (typeof value === 'string' && value.trim()) submitted[fieldKey] = value;
        }
        for (const [key, value] of Object.entries(answers || {})) {
            if (typeof value === 'string') submitted[key] = value;
        }

        // --- 5. Validate against this property's configured form ---
        const fields = visibleGuestFormFields(await resolveGuestFormFields(zone.property_id));
        const photosField = fields.find(f => f.key === 'photos');
        const uploadedPhotos = (photoUrls || []).slice(0, MAX_GUEST_PHOTOS);

        for (const field of fields) {
            if (field.key === 'photos') {
                if (field.required && uploadedPhotos.length === 0) {
                    return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 });
                }
                continue;
            }
            const message = validateGuestFormAnswer(field, submitted[field.key] ?? '');
            if (message) {
                return NextResponse.json({ error: message }, { status: 400 });
            }
        }

        // --- 6. Split the answers between real columns and form_data ---
        const answerFor = (key: string): string | null => {
            const field = fields.find(f => f.key === key);
            if (!field) return null;
            const value = (submitted[key] ?? '').trim();
            return value || null;
        };

        const formData: Record<string, string> = {};
        for (const field of fields) {
            if (field.key === 'photos') continue;
            const isColumnBacked = isBuiltinFieldKey(field.key) && BUILTIN_FIELDS[field.key].column !== null;
            if (isColumnBacked) continue;
            const value = (submitted[field.key] ?? '').trim();
            if (value) formData[field.key] = value;
        }

        // guest_name and description are NOT NULL in the database. A property may switch either
        // field off, so fall back to something readable rather than failing the insert.
        const guestName = answerFor('guest_name')
            || (formData.client_id ? `ID ${formData.client_id}` : null)
            || 'Guest';
        const processName = answerFor('process_name');
        const description = answerFor('description')
            || processName
            || 'Reported via QR code — no description provided.';

        // --- 7. Insert using the service role to bypass RLS ---
        const insertPayload: Record<string, unknown> = {
            property_id: zone.property_id,
            qr_zone_id: zone.id,
            guest_name: guestName,
            guest_phone: answerFor('guest_phone'),
            guest_email: answerFor('guest_email'),
            description,
            photo_urls: photosField ? uploadedPhotos : [],
            device_info: deviceInfo || {},
            location_data: locationData || {},
            ai_category: processName || 'General',
            status: 'PENDING',
            form_data: formData,
        };

        let { data: request, error: insertError } = await supabaseAdmin
            .from('guest_requests')
            .insert(insertPayload)
            .select()
            .single();

        // 42703 = undefined_column: `form_data` has not been added yet (the migration is applied by
        // hand). Retry without it so submissions keep working; the extra answers are then dropped.
        if (insertError?.code === '42703') {
            console.warn('guest_requests.form_data missing — retrying insert without extra answers');
            const { form_data: _dropped, ...withoutFormData } = insertPayload;
            ({ data: request, error: insertError } = await supabaseAdmin
                .from('guest_requests')
                .insert(withoutFormData)
                .select()
                .single());
        }

        if (insertError) {
            console.error('Error inserting guest request:', insertError);
            return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
        }

        // Notification is handled automatically via DB event_outbox trigger (trg_facility_requests_outbox)

        return NextResponse.json({ success: true, data: request });
    } catch (error: any) {
        console.error('submit-guest-request API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
