import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';
import { getBookingDateTimeIST } from '@/backend/utils/timezone';
import { isCreditExemptBooker } from '@/backend/lib/meetingRooms/creditExempt';

// Moved unchanged from app/api/meeting-room-bookings/[id]/route.ts (2026-11-18) so the WhatsApp brain cancels a
// booking through exactly the same checks, refund and notifications as the app. The route imports it from here.
/**
 * Helper to perform booking cancellation:
 * 1. Permission check
 * 2. Refund credits
 * 3. Update status = 'cancelled' (Does NOT delete entry, preserving audit history)
 * 4. Trigger database event / notifications
 */
export async function cancelBooking(bookingId: string, user: { id: string }) {
    const adminSupabase = createAdminClient();

    // 1. Fetch booking to get property_id and details
    const { data: booking, error: bookingError } = await adminSupabase
        .from('meeting_room_bookings')
        .select('*, meeting_rooms(name), users(full_name, email)')
        .eq('id', bookingId)
        .single();

    if (bookingError || !booking) {
        return { error: 'Booking not found', status: 404 };
    }

    if (booking.status === 'cancelled') {
        return { error: 'Booking is already cancelled', status: 400 };
    }

    // Prevent cancellation if the meeting has already started or is in the past
    const cleanDate = String(booking.booking_date).split('T')[0];
    const bookingStart = getBookingDateTimeIST(cleanDate, booking.start_time);
    if (isNaN(bookingStart.getTime()) || bookingStart <= new Date()) {
        return { error: 'Cannot cancel a past or already started booking', status: 400 };
    }

    const isOwner = booking.user_id === user.id;

    // 2. Permission Check: Master Admin / Owner / Property Admin / Technical Staff
    const { data: userProfile } = await adminSupabase
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .maybeSingle();

    if (userProfile?.is_master_admin) {
        // Master Admin can cancel anything
    } else if (isOwner) {
        // User can cancel their own booking
    } else {
        // 3. Check Property Permissions
        const { data: membership } = await adminSupabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('property_id', booking.property_id)
            .eq('is_active', true)
            .maybeSingle();

        if (!membership) {
            return { error: 'Forbidden', status: 403 };
        }

        const role = membership.role.toLowerCase();

        if (role === 'property_admin' || role === 'org_super_admin' || role === 'org_admin') {
            // Admin can cancel
        } else if (role === 'staff' || role === 'mst') {
            // Check for technical skill
            const { data: skill } = await adminSupabase
                .from('mst_skills')
                .select('id')
                .eq('user_id', user.id)
                .eq('skill_code', 'technical')
                .maybeSingle();

            if (!skill) {
                return { error: 'Only technical staff or admins can cancel bookings', status: 403 };
            }
        } else {
            return { error: 'Forbidden', status: 403 };
        }
    }

    // 4. Refund credits
    const [startH, startM] = booking.start_time.split(':').map(Number);
    const [endH, endM] = booking.end_time.split(':').map(Number);
    const durationHours = (endH * 60 + endM - startH * 60 - startM) / 60;

    // HR and CRM bookings were free (no deduction), so there is nothing to refund.
    const bookerIsCreditExempt = await isCreditExemptBooker(booking.user_id, booking.organization_id);

    if (!bookerIsCreditExempt) {
        try {
            const { error: refundErr } = await supabaseAdmin.rpc(
                'refund_meeting_room_credit',
                {
                    p_property_id: booking.property_id,
                    p_user_id: booking.user_id,
                    p_company_id: booking.company_id,
                    p_hours: durationHours,
                    p_booking_id: bookingId,
                    p_performed_by: user.id,
                    p_notes: 'Credit refund on booking cancellation'
                }
            );

            if (refundErr) {
                console.error('[Booking Cancel API] Credit refund RPC error:', refundErr);
            } else {
                console.log(`[Booking Cancel API] Successfully refunded ${durationHours}h credit for booking ${bookingId}`);
            }
        } catch (creditErr) {
            console.error('[Booking Cancel API] Failed to refund credits:', creditErr);
        }
    }

    // 5. Update booking status to 'cancelled' (DO NOT delete row, triggers Postgres outbox event)
    const { error: updateError } = await adminSupabase
        .from('meeting_room_bookings')
        .update({ 
            status: 'cancelled',
            updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

    if (updateError) {
        console.error('Booking cancellation update error:', updateError);
        return { error: 'Failed to cancel booking', status: 500 };
    }

    // 6. Log activity (non-blocking)
    try {
        const { data: prop } = await adminSupabase
            .from('properties')
            .select('organization_id, name')
            .eq('id', booking.property_id)
            .single();

        await adminSupabase.from('property_activities').insert({
            organization_id: prop?.organization_id,
            property_id: booking.property_id,
            created_by: user.id,
            type: 'booking_cancelled',
            status: 'completed',
        });

        // Note: Attendee, booker, and property admin cancellation emails are handled asynchronously
        // via the Event Outbox pattern (tr_meeting_room_booking_outbox_insert_update_delete -> EventProcessor)
        // to prevent duplicate emails and avoid blocking HTTP cancellation requests.
    } catch (err) {
        console.error('Activity log recording failed:', err);
    }

    // 7. Trigger cancellation notifications asynchronously
    NotificationService.afterRoomCancelled(bookingId).catch(err => {
        console.error('[Booking Cancel API] Notification trigger error:', err);
    });

    return { success: true, message: 'Booking cancelled and credits refunded successfully' };
}
