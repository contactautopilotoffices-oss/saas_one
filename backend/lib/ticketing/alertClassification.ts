export const CLIENT_TICKET_ROLES = new Set([
    'tenant',
    'super_tenant',
    'tenant_admin',
    'client',
]);

export function isClientRole(role?: string | null): boolean {
    if (!role) return false;
    return CLIENT_TICKET_ROLES.has(String(role).trim().toLowerCase());
}

export function isCriticalPriority(priority?: string | null): boolean {
    return String(priority || '').trim().toLowerCase() === 'critical';
}

/**
 * Returns true only when an update transitions a non-critical ticket to critical.
 * Requires `oldPriority` to be explicitly provided so unrelated status/assignee updates
 * do not re-trigger critical alerts.
 */
export function isTicketEscalatedToCritical(
    priority?: string | null,
    oldPriority?: string | null
): boolean {
    if (oldPriority === undefined || oldPriority === null) return false;
    return !isCriticalPriority(oldPriority) && isCriticalPriority(priority);
}

export function isInternalTicket(ticket: any, payload?: any): boolean {
    return Boolean(
        ticket?.internal ??
        ticket?.is_internal ??
        payload?.internal ??
        payload?.is_internal
    );
}

export function normalizePhoneKey(phone?: string | null): string {
    const raw = phone ? String(phone).replace(/[^0-9]/g, '') : '';
    return raw.length > 10 && raw.startsWith('91') ? raw.slice(-10) : raw;
}

export interface ClientTicketCheckInput {
    supabase: any;
    raisedBy?: string | null;
    propertyId?: string | null;
    organizationId?: string | null;
    isInternal?: boolean;
    strictReads?: boolean;
}

/**
 * Determines whether a ticket was raised by a client/tenant user.
 * Internal tickets are excluded. Checks property membership first (most specific),
 * then active organization membership (for super_tenant), then user profile role.
 */
export async function isTicketRaisedByClient({
    supabase,
    raisedBy,
    propertyId,
    organizationId,
    isInternal = false,
    strictReads = false,
}: ClientTicketCheckInput): Promise<boolean> {
    if (isInternal || !raisedBy) return false;

    if (propertyId) {
        const { data: propMembership, error: propError } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', raisedBy)
            .eq('is_active', true)
            .maybeSingle();

        if (propError && strictReads) throw propError;
        if (propMembership?.role) {
            return isClientRole(propMembership.role);
        }
    }

    if (organizationId) {
        const { data: orgMembership, error: orgError } = await supabase
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', organizationId)
            .eq('user_id', raisedBy)
            .eq('is_active', true)
            .maybeSingle();

        if (orgError && strictReads) throw orgError;
        if (orgMembership?.role) {
            return isClientRole(orgMembership.role);
        }
    }

    const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', raisedBy)
        .maybeSingle();

    if (userError && strictReads) throw userError;
    return isClientRole(userRow?.role);
}

