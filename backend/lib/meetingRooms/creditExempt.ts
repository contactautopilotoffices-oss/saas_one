import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isCreditFreeBookingRole } from '@/frontend/lib/meetingRooms/creditFreeRoles';

/**
 * True when the user holds an HR or CRM role in the organization, so their meeting-room
 * bookings are free (no credit check, no deduction, no refund).
 *
 * The role is read from organization_memberships, never from auth user_metadata: the
 * user can edit their own user_metadata, which would let anyone book for free.
 */
export async function isCreditExemptBooker(
    userId: string | null | undefined,
    organizationId: string | null | undefined,
): Promise<boolean> {
    if (!userId || !organizationId) return false;

    const { data, error } = await supabaseAdmin
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true);

    if (error) {
        console.error('[MeetingRooms] Credit-exempt role lookup failed:', error);
        return false;
    }

    return (data || []).some(m => isCreditFreeBookingRole(m.role));
}
