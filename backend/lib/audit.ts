import { createAdminClient } from '@/frontend/utils/supabase/admin';

interface AuditParams {
    eventBy: string;
    objectType: string;
    objectId: string;
    action: string;
    payload?: Record<string, unknown>;
}

/**
 * Write a record to audit_logs.
 * Uses the admin client so it always succeeds regardless of the caller's RLS permissions.
 * Failures are swallowed — audit logging must never break the main request flow.
 */
export async function logAudit({ eventBy, objectType, objectId, action, payload = {} }: AuditParams): Promise<void> {
    try {
        const adminSupabase = createAdminClient();
        await adminSupabase.from('audit_logs').insert({
            event_by: eventBy,
            object_type: objectType,
            object_id: objectId,
            action,
            payload,
        });
    } catch (err) {
        console.error('[audit] Failed to write audit log:', err);
    }
}
