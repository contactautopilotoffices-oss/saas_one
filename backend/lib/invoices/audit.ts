import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Append one row to invoice_audit_events.
 *
 * Logged AFTER the write it describes, and a failure here never fails the request (a
 * payment decision that succeeded must not 500 because its diary entry did not).
 * The exceptions are the two writes that must be atomic with their audit row, the
 * submission and the fast-track decision: those write their own event inside the SQL
 * function, in the same transaction.
 *
 * The actor's name and role are copied in at write time so the trail still reads after
 * someone changes role or leaves.
 */
export interface InvoiceEvent {
    organizationId: string;
    eventType: string;
    invoiceId?: string | null;
    requestId?: string | null;
    linkId?: string | null;
    poId?: string | null;
    actorUserId?: string | null;
    actorType?: 'user' | 'vendor_link' | 'system';
    actorRole?: string | null;
    correlationId?: string | null;
    details?: Record<string, unknown>;
}

export async function logInvoiceEvent(e: InvoiceEvent): Promise<void> {
    try {
        let actorName: string | null = null;
        if (e.actorUserId) {
            const { data } = await supabaseAdmin.from('users').select('full_name').eq('id', e.actorUserId).maybeSingle();
            actorName = data?.full_name ?? null;
        }
        const { error } = await supabaseAdmin.from('invoice_audit_events').insert({
            organization_id: e.organizationId,
            invoice_id: e.invoiceId ?? null,
            request_id: e.requestId ?? null,
            link_id: e.linkId ?? null,
            po_id: e.poId ?? null,
            actor_user_id: e.actorUserId ?? null,
            actor_type: e.actorType ?? (e.actorUserId ? 'user' : 'system'),
            actor_name: actorName,
            actor_role: e.actorRole ?? null,
            event_type: e.eventType,
            correlation_id: e.correlationId ?? null,
            details: e.details ?? {},
        });
        if (error) console.error('[invoices] audit write failed:', error.message);
    } catch (err) {
        console.error('[invoices] audit write threw:', err);
    }
}
