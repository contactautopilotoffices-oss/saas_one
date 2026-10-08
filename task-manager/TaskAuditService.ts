import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export type AuditEventType =
    | 'task_created'
    | 'task_assigned'
    | 'task_completed'
    | 'task_bulk_completed'
    | 'manager_assignment'
    | 'superuser_assignment'
    | 'whatsapp_received'
    | 'whatsapp_sent'
    | 'permission_denied'
    | 'ai_query'
    | 'ai_tool_call';

export interface AuditLogEntry {
    id: string;
    eventType: AuditEventType;
    actorId?: string | null;
    targetEmployeeId?: string | null;
    taskId?: string | null;
    details: Record<string, any>;
    createdAt: string;
}

export class TaskAuditService {
    /**
     * Masks phone numbers for privacy (e.g., 9930368976 -> 9930****76).
     */
    static maskPhone(phone: string): string {
        const clean = phone.replace(/\D/g, '');
        const last10 = clean.slice(-10);
        if (last10.length === 10) {
            return last10.replace(/(\d{4})\d+(\d{2})$/, '$1****$2');
        }
        return '****';
    }

    /**
     * Sanitizes audit details payload by removing sensitive fields (tokens, passwords, keys).
     */
    static sanitizeDetails(details: Record<string, any> = {}): Record<string, any> {
        const cleanDetails: Record<string, any> = {};
        const sensitiveKeys = ['key', 'token', 'secret', 'password', 'pwd', 'credential', 'auth', 'bearer'];

        for (const [k, v] of Object.entries(details)) {
            const lowerK = k.toLowerCase();
            if (sensitiveKeys.some(s => lowerK.includes(s))) {
                cleanDetails[k] = '[REDACTED]';
            } else if (typeof v === 'string' && (lowerK.includes('phone') || lowerK.includes('mobile'))) {
                cleanDetails[k] = this.maskPhone(v);
            } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                cleanDetails[k] = this.sanitizeDetails(v);
            } else {
                cleanDetails[k] = v;
            }
        }
        return cleanDetails;
    }

    /**
     * Records a structured audit event. Non-blocking to protect core transaction flow.
     */
    static async log(params: {
        eventType: AuditEventType;
        actorId?: string;
        targetEmployeeId?: string;
        taskId?: string;
        details?: Record<string, any>;
    }): Promise<void> {
        try {
            const sanitized = this.sanitizeDetails(params.details || {});
            await supabaseAdmin.from('task_audit_logs').insert({
                event_type: params.eventType,
                actor_id: params.actorId || null,
                target_employee_id: params.targetEmployeeId || null,
                task_id: params.taskId || null,
                details: sanitized
            });
        } catch (err) {
            console.warn('[TaskAuditService] Failed to record audit log:', err);
        }
    }

    /**
     * Queries recent audit events with optional filtering.
     */
    static async getLogs(params: {
        eventType?: AuditEventType;
        actorId?: string;
        targetEmployeeId?: string;
        limit?: number;
    } = {}): Promise<AuditLogEntry[]> {
        let query = supabaseAdmin
            .from('task_audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(params.limit || 50);

        if (params.eventType) {
            query = query.eq('event_type', params.eventType);
        }
        if (params.actorId) {
            query = query.eq('actor_id', params.actorId);
        }
        if (params.targetEmployeeId) {
            query = query.eq('target_employee_id', params.targetEmployeeId);
        }

        const { data, error } = await query;
        if (error) {
            console.error('[TaskAuditService] Error querying audit logs:', error);
            throw error;
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            eventType: row.event_type as AuditEventType,
            actorId: row.actor_id,
            targetEmployeeId: row.target_employee_id,
            taskId: row.task_id,
            details: row.details || {},
            createdAt: row.created_at
        }));
    }
}
