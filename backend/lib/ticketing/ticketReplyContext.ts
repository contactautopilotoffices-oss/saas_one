import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface TicketReplyContext {
    ticketId: string | null;
    ticketNumber: string;
    title: string;
    organizationId: string | null;
    propertyId: string | null;
    senderId: string | null;
    requesterId: string | null;
    assigneeId: string | null;
}

const asId = (value: unknown): string | null => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    return text ? text : null;
};

/**
 * One reading of a TICKET_REPLY outbox payload, shared by WhatsApp, email and in-app/push,
 * so all three channels agree on who the two sides of the conversation are.
 *
 * Also reads the pre-2026-11-16 payload shape, where the DB trigger had already picked a single
 * recipient (`recipient_id` + `recipient_role`): an outbox row written before the migration and
 * retried after it still reaches the right person.
 */
export async function resolveTicketReplyContext(payload: any): Promise<TicketReplyContext> {
    const ticketId = asId(payload?.ticket_id);
    const senderId = asId(payload?.sender_id);

    let requesterId = asId(payload?.requester_id);
    let assigneeId = asId(payload?.assignee_id);
    let organizationId = asId(payload?.organization_id);
    let propertyId = asId(payload?.property_id);
    let ticketNumber = asId(payload?.ticket_number);
    let title = asId(payload?.title);

    if (!requesterId && !assigneeId && payload?.recipient_id) {
        if (payload.recipient_role === 'requester') requesterId = asId(payload.recipient_id);
        else assigneeId = asId(payload.recipient_id);
    }

    const incomplete = !organizationId || !propertyId || (!requesterId && !assigneeId) || !ticketNumber || !title;
    if (ticketId && incomplete) {
        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('id, ticket_number, title, property_id, organization_id, raised_by, assigned_to, property:properties(organization_id)')
            .eq('id', ticketId)
            .maybeSingle();

        if (ticket) {
            requesterId = requesterId || asId(ticket.raised_by);
            assigneeId = assigneeId || asId(ticket.assigned_to);
            propertyId = propertyId || asId(ticket.property_id);
            organizationId = organizationId
                || asId(ticket.organization_id)
                || asId((ticket.property as any)?.organization_id);
            ticketNumber = ticketNumber || asId(ticket.ticket_number);
            title = title || asId(ticket.title);
        }
    }

    return {
        ticketId,
        ticketNumber: ticketNumber || 'N/A',
        title: title || 'Support Request',
        organizationId,
        propertyId,
        senderId,
        requesterId,
        assigneeId
    };
}
