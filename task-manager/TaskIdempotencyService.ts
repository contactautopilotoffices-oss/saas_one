import { supabaseAdmin } from '@/backend/lib/supabase/admin';

// In-memory sliding LRU cache for high-frequency duplicate webhook deduplication (within single instance)
const processedMessageIds = new Map<string, number>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class TaskIdempotencyService {
    /**
     * Checks if an inbound WhatsApp messageId has already been processed recently.
     * Prevents double-execution from provider webhook retries.
     */
    static async isDuplicateWebhook(messageId?: string): Promise<boolean> {
        if (!messageId) return false;

        const now = Date.now();
        // 1. Fast memory check
        const cachedAt = processedMessageIds.get(messageId);
        if (cachedAt && now - cachedAt < CACHE_TTL_MS) {
            return true;
        }

        // 2. Persistent audit check across distributed instances
        try {
            const { data } = await supabaseAdmin
                .from('task_audit_logs')
                .select('id')
                .eq('event_type', 'whatsapp_received')
                .contains('details', { messageId })
                .limit(1);

            if (data && data.length > 0) {
                processedMessageIds.set(messageId, now);
                return true;
            }
        } catch (err) {
            console.warn('[TaskIdempotencyService] Error checking duplicate webhook:', err);
        }

        return false;
    }

    /**
     * Marks a webhook messageId as processed in memory.
     */
    static recordProcessedWebhook(messageId?: string): void {
        if (!messageId) return;
        const now = Date.now();
        processedMessageIds.set(messageId, now);

        // Periodic pruning of stale entries
        if (processedMessageIds.size > 1000) {
            processedMessageIds.forEach((ts, id) => {
                if (now - ts > CACHE_TTL_MS) {
                    processedMessageIds.delete(id);
                }
            });
        }
    }
}
