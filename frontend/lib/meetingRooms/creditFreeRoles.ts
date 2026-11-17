// Internal teams (HR, CRM/BD, IT, Design and Tech) book meeting rooms for company work, not as tenants.
// Their bookings never draw from, or refund to, a meeting-room credit balance.
// Shared by the sidebar (who sees "Book Meeting Room") and the booking API (who skips credits).

export const HR_BOOKING_ROLES = ['hr', 'hr_head', 'hr_manager', 'hr_ops'];
export const CRM_BOOKING_ROLES = ['bd_rep', 'bd_admin', 'bd_super_admin'];
export const IT_DESIGN_BOOKING_ROLES = ['it', 'design'];
// Owner 2026-11-17: the Tech console's Meeting Room tab (same booking screen, same no-credit rule)
export const TECH_BOOKING_ROLES = ['tech'];

export const CREDIT_FREE_BOOKING_ROLES = [...HR_BOOKING_ROLES, ...CRM_BOOKING_ROLES, ...IT_DESIGN_BOOKING_ROLES, ...TECH_BOOKING_ROLES];

export function isCreditFreeBookingRole(role?: string | null): boolean {
    return !!role && CREDIT_FREE_BOOKING_ROLES.includes(role.toLowerCase());
}
