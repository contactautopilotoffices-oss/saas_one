import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { guardProperty, resolveCaller, isCallerError } from '@/backend/lib/auth/callerAccess';
import {
    DEFAULT_GUEST_FORM_FIELDS,
    normalizeGuestFormFields,
    visibleGuestFormFields,
} from '@/frontend/lib/guestTicketForm';

/**
 * Which fields this property's public QR client-support form shows.
 *
 * GET  - the stored field list, or the default list when the property has never been configured.
 * PUT  - replace the field list. Writes go through here (service role) rather than from the
 *        browser, so only a guarded caller can change what a QR code asks for.
 */

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> },
) {
    try {
        const { propertyId } = await params;
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;

        const supabase = createAdminClient();
        const { data, error } = await supabase
            .from('property_ticket_form_configs')
            .select('fields, updated_at, updated_by')
            .eq('property_id', propertyId)
            .maybeSingle();

        if (error) {
            console.error('ticket-form-config GET error:', error);
            return NextResponse.json({ error: 'Failed to load form configuration' }, { status: 500 });
        }

        return NextResponse.json({
            fields: data ? normalizeGuestFormFields(data.fields) : [...DEFAULT_GUEST_FORM_FIELDS],
            isDefault: !data,
            updatedAt: data?.updated_at ?? null,
        });
    } catch (err) {
        console.error('ticket-form-config GET error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> },
) {
    try {
        const { propertyId } = await params;
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;

        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const fields = normalizeGuestFormFields((body as { fields?: unknown }).fields);
        if (visibleGuestFormFields(fields).length === 0) {
            return NextResponse.json({ error: 'Keep at least one field switched on.' }, { status: 400 });
        }

        const supabase = createAdminClient();
        const { data, error } = await supabase
            .from('property_ticket_form_configs')
            .upsert({
                property_id: propertyId,
                fields,
                updated_at: new Date().toISOString(),
                updated_by: caller.userId,
            }, { onConflict: 'property_id' })
            .select('fields, updated_at')
            .single();

        if (error) {
            console.error('ticket-form-config PUT error:', error);
            return NextResponse.json({ error: 'Failed to save form configuration' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            fields: normalizeGuestFormFields(data.fields),
            isDefault: false,
            updatedAt: data.updated_at,
        });
    } catch (err) {
        console.error('ticket-form-config PUT error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
