/**
 * Webhook Utility for Ticket Categorization
 * 
 * Emits events for observability, audit logs, and analytics:
 * - ticket.categorized
 * - llm.invoked
 * - rule.low_confidence
 */

export interface WebhookPayload {
    event: 'ticket.categorized' | 'llm.invoked' | 'rule.low_confidence';
    timestamp: string;
    ticket_id: string;
    data: any;
}

const WEBHOOK_URL = process.env.CATEGORIZATION_WEBHOOK_URL;

/**
 * Emit a webhook event (fire-and-forget)
 */
export async function emitWebhook(event: WebhookPayload['event'], ticketId: string, data: any): Promise<void> {
    const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        ticket_id: ticketId,
        data
    };

    console.log(`[Webhook] Emitting ${event} for ticket ${ticketId}`);

    if (!WEBHOOK_URL) {
        console.warn('[Webhook] No WEBHOOK_URL configured, skipping emission');
        return;
    }

    try {
        // Simple fetch for fire-and-forget
        fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => {
            console.error(`[Webhook] Failed to emit ${event}:`, err);
        });
    } catch (err) {
        console.error(`[Webhook] Error preparing ${event}:`, err);
    }
}
