import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { WhatsAppService } from '@/backend/services/WhatsAppService';

export interface WhatsAppQueuePayload {
    ticketId?: string;
    propertyId?: string;
    userIds: string[];
    customPhones?: string[];
    message: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video';
    eventType: string;
    organizationId?: string;
    templateName?: string;
    templateParams?: string[];
    entityId?: string;
}

export class WhatsAppQueueService {
    /**
     * Batch-enqueue WhatsApp messages for multiple users or custom phone numbers.
     * Fetches all phone numbers in one query, then inserts all rows in one INSERT.
     * The Supabase DB webhook fires per-row and sends each message independently.
     */
    static async enqueue(payload: WhatsAppQueuePayload): Promise<void> {
        // Map eventType to moduleName
        let moduleName: string | null = null;
        if (payload.eventType.startsWith('TICKET_') || payload.eventType === 'SLA_BREACH' || payload.eventType === 'REMINDER_TICKET_SLA') {
            moduleName = 'ticketing';
        } else if (payload.eventType.startsWith('MEETING_ROOM_') || payload.eventType.startsWith('ROOM_') || payload.eventType === 'REMINDER_MEETING_ROOM') {
            moduleName = 'meeting_room';
        } else if (payload.eventType.startsWith('MATERIAL_') || payload.eventType.startsWith('PROCUREMENT_') || payload.eventType.startsWith('REQUISITION_') || payload.eventType.startsWith('MONTHLY_') || payload.eventType.startsWith('COMPARATIVE_') || payload.eventType.startsWith('VENDOR_')) {
            moduleName = 'procurement';
        } else if (payload.eventType.startsWith('SOP_') || payload.eventType.startsWith('PPM_') || payload.eventType.startsWith('CHECKLIST_') || payload.eventType === 'REMINDER_PPM' || payload.eventType.startsWith('DAILY_') || payload.eventType.startsWith('AI_')) {
            moduleName = 'ppm';
        } else if (payload.eventType.startsWith('CRM_') || payload.eventType.startsWith('LEAD_') || payload.eventType === 'REMINDER_LEAD_FOLLOWUP') {
            moduleName = 'crm';
        }

        const keys = ['whatsapp_notifications_enabled'];
        if (moduleName) keys.push(`whatsapp_${moduleName}_enabled`);

        const { data: configs } = await supabaseAdmin
            .from('system_config')
            .select('key, value')
            .in('key', keys);

        const configMap = (configs || []).reduce((acc, row) => ({ ...acc, [row.key]: row.value === true }), {} as Record<string, boolean>);
        
        const isGlobalEnabled = configMap['whatsapp_notifications_enabled'] !== false;
        if (!isGlobalEnabled) {
            console.log('[WhatsAppQueue] Service is globally disabled via system_config. Skipping enqueue for:', payload.eventType);
            return;
        }

        if (moduleName) {
            const isModuleEnabled = configMap[`whatsapp_${moduleName}_enabled`] !== false;
            if (!isModuleEnabled) {
                console.log(`[WhatsAppQueue] Module ${moduleName} disabled via system_config. Skipping enqueue for:`, payload.eventType);
                return;
            }
        }
        
        const recipientsToEnqueue: { id: string | null; phone: string }[] = [];
        const usersWithoutPhone: string[] = [];

        if (payload.userIds && payload.userIds.length > 0) {
            const { data: users } = await supabaseAdmin
                .from('users')
                .select('id, phone')
                .in('id', payload.userIds);

            (users || []).forEach(u => {
                if (u.phone && String(u.phone).trim()) {
                    recipientsToEnqueue.push({ id: u.id, phone: String(u.phone).trim() });
                } else {
                    usersWithoutPhone.push(u.id);
                }
            });
        }

        if (payload.customPhones && payload.customPhones.length > 0) {
            payload.customPhones.forEach(p => {
                if (p && String(p).trim()) {
                    recipientsToEnqueue.push({ id: null, phone: String(p).trim() });
                }
            });
        }

        if (recipientsToEnqueue.length > 0) {
            // 1. Enqueue WhatsApp messages for recipients with phone numbers
            const rows = recipientsToEnqueue.map(u => ({
                ticket_id: payload.ticketId || null,
                user_id: u.id,
                phone: u.phone,
                message: payload.message,
                media_url: payload.mediaUrl ?? null,
                media_type: payload.mediaType ?? null,
                event_type: payload.eventType,
                status: 'pending',
                organization_id: payload.organizationId ?? null,
                template_name: payload.templateName ?? null,
                template_params: payload.templateParams ?? null,
                entity_id: payload.entityId ?? null,
            }));

            const { data: insertedRows, error } = await supabaseAdmin
                .from('whatsapp_queue')
                .insert(rows)
                .select('id, phone, template_name, template_params, media_url, message, media_type');

            if (error) {
                // Reminder events are deduped by a unique index (event_type, entity_id, user_id) —
                // a unique violation just means the reminder is already queued, so skip silently.
                if (payload.eventType.startsWith('REMINDER_') && error.code === '23505') {
                    console.log(`[WhatsAppQueue] Reminder already queued for event: ${payload.eventType}, skipping duplicate.`);
                } else {
                    console.error('[WhatsAppQueue] Failed to insert queue rows:', error.message);
                }
            } else {
                console.log(`[WhatsAppQueue] Enqueued ${rows.length} messages for event: ${payload.eventType}`);

                // Immediate async dispatch for instant delivery with atomic lock
                if (insertedRows && insertedRows.length > 0) {
                    (async () => {
                        const { AiSensyService } = await import('@/backend/services/AiSensyService');
                        const { WhatsAppService } = await import('@/backend/services/WhatsAppService');

                        for (const r of insertedRows) {
                            try {
                                // Atomic Claim: Only proceed if status is still 'pending'
                                const { data: claimed } = await supabaseAdmin
                                    .from('whatsapp_queue')
                                    .update({ status: 'processing' })
                                    .eq('id', r.id)
                                    .eq('status', 'pending')
                                    .select('id')
                                    .maybeSingle();

                                if (!claimed) {
                                    // Row was already claimed/processed by webhook
                                    continue;
                                }

                                let sent = false;
                                let sendError: string | undefined;

                                if (r.template_name) {
                                    let campaignName = r.template_name;
                                    let templateParams = Array.isArray(r.template_params) ? [...r.template_params] : [];

                                    // Auto-heal legacy unapproved campaign names or parameter counts
                                    if (campaignName === 'checklist_started') campaignName = 'checklist_started_v1';
                                    if (campaignName === 'checklist_completed') campaignName = 'checklist_completed_v1';
                                    if (campaignName === 'checklist_overdue_alert') campaignName = 'checklist_overdue_alert_v2';
                                    if (campaignName === 'material_request_created') campaignName = 'material_request_created_v3';
                                    if (campaignName === 'material_request_created_v3' && templateParams.length > 6) templateParams = templateParams.slice(0, 6);
                                    if (campaignName === 'comparative_approval_requested_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
                                    if (campaignName === 'comparative_uploaded_info_v1' && templateParams.length > 8) templateParams = templateParams.slice(0, 8);
                                    if (campaignName === 'comparative_approved_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
                                    if (campaignName === 'comparative_rejected_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
                                    if (campaignName === 'ticket_assigned_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
                                    if (campaignName === 'ticket_completed_v1' && templateParams.length > 5) templateParams = templateParams.slice(0, 5);
                                    if (campaignName === 'ticket_completed_v1_media' && templateParams.length > 5) templateParams = templateParams.slice(0, 5);
                                    if (campaignName === 'ticket_created_v3' && templateParams.length > 10) templateParams = templateParams.slice(0, 10);
                                    if (campaignName === 'ticket_created_v3_media' && templateParams.length > 9) templateParams = templateParams.slice(0, 9);

                                    const res = await AiSensyService.sendTemplate({
                                        phone: r.phone,
                                        campaignName,
                                        templateParams,
                                        mediaUrl: r.media_url || undefined,
                                    });
                                    sent = res.success;
                                    sendError = res.error;
                                } else {
                                    sent = await WhatsAppService.sendAsync(r.phone, {
                                        message: r.message,
                                        mediaUrl: r.media_url || undefined,
                                        mediaType: r.media_type || undefined,
                                    });
                                }

                                await supabaseAdmin
                                    .from('whatsapp_queue')
                                    .update({
                                        status: sent ? 'sent' : 'failed',
                                        sent_at: sent ? new Date().toISOString() : null,
                                        error_message: sendError || null,
                                        retry_count: sent ? 0 : 1,
                                    })
                                    .eq('id', r.id);

                                console.log(`[WhatsAppQueue] Immediate dispatch for row ${r.id} (${r.phone}) result: ${sent ? 'SUCCESS' : 'FAILED: ' + sendError}`);
                            } catch (err: any) {
                                console.error(`[WhatsAppQueue] Error in immediate dispatch for row ${r.id}:`, err);
                            }
                        }
                    })().catch(e => console.error('[WhatsAppQueue] Background worker error:', e));
                }
            }
        }

        // 2. Channel Fallback: Fall back ONLY to Push Notification for users missing a phone number
        if (usersWithoutPhone.length > 0) {
            try {
                const { NotificationService } = await import('@/backend/services/NotificationService');
                await NotificationService.sendToMany(usersWithoutPhone, {
                    propertyId: payload.propertyId,
                    organizationId: payload.organizationId,
                    ticketId: payload.ticketId,
                    type: payload.eventType,
                    title: payload.eventType.replace(/_/g, ' '),
                    message: payload.message,
                    deepLink: payload.ticketId ? `/tickets/${payload.ticketId}` : '/dashboard',
                    priority: 'HIGH'
                });
                console.log(`[WhatsAppQueue] Fallback: dispatched Push notification to ${usersWithoutPhone.length} user(s) lacking phone numbers.`);
            } catch (pushErr: any) {
                console.error('[WhatsAppQueue] Push fallback failed:', pushErr?.message);
            }
        }
    }
}
