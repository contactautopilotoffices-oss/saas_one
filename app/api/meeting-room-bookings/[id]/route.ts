import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { cancelBooking } from '@/backend/lib/meetingRooms/cancelBooking';
import { EventProcessor } from '@/backend/services/EventProcessor';

/**
 * DELETE /api/meeting-room-bookings/[id]
 * Delete a booking (Admin/Technical Staff only)
 */

/**
 * PATCH /api/meeting-room-bookings/[id]
 * Cancel a booking (updates status to 'cancelled', does not delete)
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: bookingId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        if (body.status && body.status !== 'cancelled') {
            return NextResponse.json({ error: 'Only cancellation is supported via this endpoint' }, { status: 400 });
        }

        const result = await cancelBooking(bookingId, user);
        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: result.status || 400 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Booking PATCH cancel error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/meeting-room-bookings/[id]
 * Cancels a booking (updates status to 'cancelled' without destroying record)
 */
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: bookingId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await cancelBooking(bookingId, user);
        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: result.status || 400 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Booking DELETE error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
