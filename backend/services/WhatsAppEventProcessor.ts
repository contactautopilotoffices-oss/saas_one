import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver, ResolvedWhatsAppUser } from '@/backend/services/WhatsAppRecipientResolver';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';

interface DispatchOptions {
    featureKey: string;
    templateEventKey: string;
    organizationId: string;
    propertyId?: string | null;
    entityId?: string | null;
    paramValues: Record<string, string>;
    summaryMessage: string;
    mediaUrl?: string | null;
    mediaType?: 'image' | 'video';
    contextualUserIds?: {
        assigneeId?: string | null;
        requesterId?: string | null;
        approverId?: string | null;
    };
    excludeUserIds?: string[];
}

const LOCAL_TIMEZONE = 'Asia/Kolkata';

/** Formats any date into strict DD/MM/YYYY (e.g. 21/08/2026) */
export function formatWhatsAppDate(dateInput?: string | number | Date | null): string {
    if (!dateInput) return new Date().toLocaleDateString('en-GB', { timeZone: LOCAL_TIMEZONE });
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString('en-GB', { timeZone: LOCAL_TIMEZONE });
}

/** Formats time into local 12-hour format (e.g. 02:30 PM) */
export function formatWhatsAppTime(dateInput?: string | number | Date | null): string {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleTimeString('en-IN', {
        timeZone: LOCAL_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

/** Formats date and time into DD/MM/YYYY, hh:mm A (e.g. 21/08/2026, 02:30 PM) */
export function formatWhatsAppDateTime(dateInput?: string | number | Date | null): string {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const datePart = d.toLocaleDateString('en-GB', { timeZone: LOCAL_TIMEZONE });
    const timePart = d.toLocaleTimeString('en-IN', {
        timeZone: LOCAL_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    return `${datePart}, ${timePart}`;
}

/** Formats a time string (e.g. "14:30:00" or Date) into local 12-hour format (e.g. 02:30 PM) */
export function formatTimeString(timeStr?: string | null): string {
    if (!timeStr) return 'N/A';
    if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        const h = parseInt(parts[0], 10);
        const m = parts[1] || '00';
        if (!isNaN(h)) {
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${String(h12).padStart(2, '0')}:${m.padStart(2, '0')} ${period}`;
        }
    }
    return formatWhatsAppTime(timeStr) || timeStr;
}


/**
 * WhatsApp (AiSensy) event dispatcher.
 * Resolves recipients from notification_matrix / whatsapp_service_config,
 * reads the org's whatsapp_templates map, and enqueues one whatsapp_queue row per recipient.
 */
export const WhatsAppEventProcessor = {
    async processEvent(event: { event_type: string; payload: any }): Promise<void> {
        const { event_type, payload } = event;

        switch (event_type) {
            // Tickets
            case 'TICKET_CREATED':
                await this.handleTicketCreated(payload);
                break;
            case 'TICKET_ASSIGNED':
                await this.handleTicketAssigned(payload);
                break;
            case 'TICKET_COMPLETED':
            case 'TICKET_RESOLVED':
                await this.handleTicketCompleted(payload);
                break;
            case 'TICKET_UPDATED':
                // Only dispatch reassignment if assigned_to actually changed to a new user
                if (payload.assigned_to && payload.old_assigned_to !== undefined && payload.assigned_to !== payload.old_assigned_to) {
                    await this.handleTicketAssigned(payload);
                }
                // Only dispatch completion if status transitioned into resolved/closed
                if ((payload.status === 'resolved' || payload.status === 'closed') && payload.old_status && payload.status !== payload.old_status) {
                    await this.handleTicketCompleted(payload);
                }
                break;

            // CRM Leads
            case 'LEAD_CREATED':
                await this.handleLeadCreated(payload);
                break;
            case 'LEAD_ASSIGNED':
                await this.handleLeadAssigned(payload);
                break;

            // Meeting Rooms
            case 'MEETING_ROOM_BOOKED':
            case 'ROOM_BOOKED':
                await this.handleMeetingRoomEvent(payload, false);
                break;
            case 'MEETING_ROOM_CANCELLED':
            case 'ROOM_CANCELLED':
            case 'ROOM_BOOKING_CANCELLED':
                await this.handleMeetingRoomEvent(payload, true);
                break;

            // Procurement & Materials
            case 'MATERIAL_REQUEST_CREATED':
                await this.handleMaterialRequestCreated(payload);
                break;
            case 'COMPARATIVE_UPLOADED':
                await this.handleComparativeUploaded(payload);
                break;
            case 'COMPARATIVE_APPROVED':
                await this.handleComparativeApproved(payload);
                break;
            case 'COMPARATIVE_REJECTED':
                await this.handleComparativeRejected(payload);
                break;
            case 'MATERIAL_DELIVERED':
                await this.handleMaterialDelivered(payload);
                break;
            case 'REQUISITION_UPLOADED':
            case 'MONTHLY_REQUISITION_UPLOADED':
                await this.handleRequisitionUploaded(payload);
                break;
            case 'REQUISITION_APPROVAL_REQUESTED':
                await this.handleRequisitionApprovalRequested(payload);
                break;
            case 'REQUISITION_STATUS_UPDATED':
            case 'REQUISITION_APPROVED':
            case 'REQUISITION_REJECTED':
                await this.handleRequisitionStatusUpdated(payload);
                break;
            case 'REQUISITION_PO_ISSUED':
                await this.handleRequisitionPoIssued(payload);
                break;
            case 'VENDOR_PROCUREMENT_REQUESTED':
                await this.handleVendorProcurementRequested(payload);
                break;
            case 'VENDOR_PROCUREMENT_ARRANGED':
                await this.handleVendorProcurementArranged(payload);
                break;

            // SOP Checklists
            case 'CHECKLIST_SLOT_REMINDER':
            case 'SOP_REMINDER':
                await this.handleChecklistSlotReminder(payload);
                break;
            case 'SOP_STARTED':
            case 'CHECKLIST_STARTED':
                await this.handleSOPStarted(payload);
                break;
            case 'SOP_COMPLETED':
            case 'CHECKLIST_COMPLETED':
                await this.handleSOPCompleted(payload);
                break;
            case 'SOP_OVERDUE':
            case 'SOP_MISSED':
            case 'CHECKLIST_OVERDUE':
            case 'CHECKLIST_MISSED':
                await this.handleSOPOverdue(payload);
                break;
            case 'SOP_RATED':
            case 'CHECKLIST_RATED':
                await this.handleSOPRated(payload);
                break;

            // PPM
            case 'REMINDER_PPM':
            case 'PPM_REMINDER':
                await this.handlePpmReminder(payload);
                break;

            default:
                break;
        }
    },

    /**
     * Shared dispatch: resolve recipients → read template → map ordered params → enqueue.
     */
    async dispatch(options: DispatchOptions): Promise<void> {
        const { featureKey, templateEventKey, organizationId, propertyId, entityId, paramValues, summaryMessage, contextualUserIds } = options;

        if (!organizationId) {
            console.warn(`[WhatsAppEventProcessor] ${templateEventKey}: missing organizationId, skipping`);
            return;
        }

        const { enabled, users, config } = await WhatsAppRecipientResolver.resolveRecipients({
            organizationId,
            propertyId,
            featureKey,
            contextualUserIds: contextualUserIds ? [
                contextualUserIds.assigneeId,
                contextualUserIds.requesterId,
                contextualUserIds.approverId
            ].filter(Boolean) as string[] : []
        });

        if (!enabled) {
            console.log(`[WhatsAppEventProcessor] ${featureKey} WhatsApp disabled for org ${organizationId}`);
            return;
        }

        const userMap = new Map<string, ResolvedWhatsAppUser>(users.map(u => [u.id, u]));

        const contextualIds: string[] = [];
        if (config.notify_assignee && contextualUserIds?.assigneeId) contextualIds.push(contextualUserIds.assigneeId);
        if (config.notify_requester && contextualUserIds?.requesterId) contextualIds.push(contextualUserIds.requesterId);
        if (contextualUserIds?.approverId) contextualIds.push(contextualUserIds.approverId);

        const missingIds = contextualIds.filter(id => !userMap.has(id));
        if (missingIds.length > 0) {
            const { data: contextualUsers } = await supabaseAdmin
                .from('users')
                .select('id, phone, full_name')
                .in('id', missingIds);
            (contextualUsers || [])
                .filter((u: any) => u?.phone && String(u.phone).trim())
                .forEach((u: any) => {
                    userMap.set(u.id, { id: u.id, phone: String(u.phone).trim(), name: u.full_name || null });
                });
        }

        // Strictly deduplicate by cleaned 10+ digit phone number so 1 phone number never receives multiple copies of the same alert
        const seenPhones = new Set<string>();
        const recipients: ResolvedWhatsAppUser[] = [];
        for (const u of userMap.values()) {
            if (options.excludeUserIds?.includes(u.id)) continue;
            const rawPhone = u.phone ? String(u.phone).replace(/[^0-9]/g, '') : '';
            const normalizedPhone = rawPhone.length > 10 && rawPhone.startsWith('91') ? rawPhone.slice(-10) : rawPhone;
            if (normalizedPhone && normalizedPhone.length >= 10 && !seenPhones.has(normalizedPhone)) {
                seenPhones.add(normalizedPhone);
                recipients.push(u);
            }
        }

        if (recipients.length === 0) {
            console.log(`[WhatsAppEventProcessor] ${templateEventKey}: no recipients for org ${organizationId}`);
            return;
        }

        // Read the org's template map
        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('whatsapp_templates')
            .eq('organization_id', organizationId)
            .maybeSingle();

        const templatesMap = (orgData as any)?.whatsapp_templates || {};

        const DEFAULT_TEMPLATES: Record<string, { campaign_name: string; params: string[] }> = {
            monthly_requisition_uploaded: { campaign_name: 'requisition_submitted_v1', params: ['user_name', 'property', 'month', 'year', 'items_count', 'total_amount', 'requested_by'] },
            requisition_submitted: { campaign_name: 'requisition_submitted_v1', params: ['user_name', 'property', 'month', 'year', 'items_count', 'total_amount', 'requested_by'] },
            requisition_approval_requested: { campaign_name: 'requisition_approval_requested_v1', params: ['approver_name', 'property', 'month', 'year', 'vendor_name', 'total_amount', 'notes'] },
            requisition_status_updated: { campaign_name: 'requisition_status_updated_v1', params: ['user_name', 'property', 'month', 'year', 'status', 'approver_name', 'total_amount', 'remarks'] },
            requisition_po_issued: { campaign_name: 'requisition_po_issued_v1', params: ['user_name', 'month', 'year', 'property', 'vendor_name', 'po_number', 'total_amount'] },
            meeting_room_booked: { campaign_name: 'meeting_room_booked_v3', params: ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker', 'booker_phone'] },
            meeting_room_cancelled: { campaign_name: 'meeting_room_cancelled_v2', params: ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker'] },
            lead_created: { campaign_name: 'crm_lead_created_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'source', 'property_interest'] },
            crm_lead_created: { campaign_name: 'crm_lead_created_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'source', 'property_interest'] },
            lead_assigned: { campaign_name: 'crm_lead_assigned_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'property_interest', 'next_followup'] },
            crm_lead_assigned: { campaign_name: 'crm_lead_assigned_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'property_interest', 'next_followup'] },
            ticket_created: { campaign_name: 'ticket_created_v3', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'] },
            ticket_created_media: { campaign_name: 'ticket_created_v3_media', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'] },
            ticket_assigned: { campaign_name: 'ticket_assigned_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone'] },
            ticket_completed: { campaign_name: 'ticket_completed_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'] },
            ticket_completed_media: { campaign_name: 'ticket_completed_v1_media', params: ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'] },
            daily_property_report: { campaign_name: 'ai_property_report_v1', params: ['user_name', 'org_name', 'date', 'critical_count', 'open_count', 'resolved_count', 'electricity_kwh', 'dg_liters', 'ppm_completed', 'ppm_missed', 'sop_compliance', 'property_summary', 'ai_insights'] },
            ai_property_report: { campaign_name: 'ai_property_report_v1', params: ['user_name', 'org_name', 'date', 'critical_count', 'open_count', 'resolved_count', 'electricity_kwh', 'dg_liters', 'ppm_completed', 'ppm_missed', 'sop_compliance', 'property_summary', 'ai_insights'] },
            material_request_created: { campaign_name: 'material_request_created_v3', params: ['user_name', 'ticket_number', 'property', 'requested_by', 'requester_phone', 'items_summary', 'ticket_id'] },
            comparative_uploaded: { campaign_name: 'comparative_approval_requested_v1', params: ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'] },
            comparative_approval_requested: { campaign_name: 'comparative_approval_requested_v1', params: ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'] },
            comparative_uploaded_info: { campaign_name: 'comparative_uploaded_info_v1', params: ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'approver_name', 'notes', 'ticket_id'] },
            comparative_approved: { campaign_name: 'comparative_approved_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'approved_by', 'total_cost', 'approver_comment', 'ticket_id'] },
            comparative_rejected: { campaign_name: 'comparative_rejected_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'total_cost', 'action_by', 'rejection_reason', 'ticket_id'] },
            material_delivered: { campaign_name: 'material_delivered_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'delivered_items', 'verified_by', 'ticket_id'] },
            procurement_vendor_tag: { campaign_name: 'procurement_vendor_tag_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'tagged_by', 'note', 'assigned_procurement'] },
            procurement_vendor_aligned: { campaign_name: 'procurement_vendor_aligned_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'vendor_details', 'arranged_by'] },
            reminder_ppm: { campaign_name: 'reminder_ppm_v2', params: ['user_name', 'system_name', 'property', 'due_date', 'vendor_name', 'location'] },
            ppm_reminder: { campaign_name: 'reminder_ppm_v2', params: ['user_name', 'system_name', 'property', 'due_date', 'vendor_name', 'location'] },
            reminder_ticket_sla: { campaign_name: 'reminder_ticket_sla_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'sla_time'] },
            reminder_lead_followup: { campaign_name: 'reminder_lead_followup_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'followup_time', 'lead_id'] },
            checklist_slot_reminder: { campaign_name: 'checklist_slot_reminder_v2', params: ['user_name', 'checklist_name', 'property', 'due_time'] },
            checklist_started: { campaign_name: 'checklist_started_v1', params: ['user_name', 'checklist_name', 'property', 'start_time'] },
            checklist_completed: { campaign_name: 'checklist_completed_v1', params: ['user_name', 'checklist_name', 'property', 'completed_by', 'time'] },
            checklist_overdue_alert: { campaign_name: 'checklist_overdue_alert_v2', params: ['checklist_name', 'property', 'slot_time'] },
            checklist_rated: { campaign_name: 'checklist_rated', params: ['user_name', 'checklist_name', 'property', 'rating', 'rater_name'] }
        };

        // Intelligent routing: if media exists and org or system default has a media-specific template, use it; otherwise standard template
        const hasMediaTemplate = Boolean(templatesMap[`${templateEventKey}_media`] || DEFAULT_TEMPLATES[`${templateEventKey}_media`]);
        const resolvedTemplateKey = (options.mediaUrl && hasMediaTemplate)
            ? `${templateEventKey}_media`
            : templateEventKey;

        const template = templatesMap[resolvedTemplateKey] || templatesMap[templateEventKey] || DEFAULT_TEMPLATES[resolvedTemplateKey] || DEFAULT_TEMPLATES[templateEventKey];
        if (!template?.campaign_name) {
            console.warn(`[WhatsAppEventProcessor] No whatsapp_templates entry for "${resolvedTemplateKey}" in org ${organizationId}, skipping`);
            return;
        }

        // Canonical parameter signatures for Meta / AiSensy approved templates
        const CANONICAL_CAMPAIGN_PARAMS: Record<string, string[]> = {
            'requisition_submitted_v1': ['user_name', 'property', 'month', 'year', 'items_count', 'total_amount', 'requested_by'],
            'monthly_requisition_uploaded': ['user_name', 'property', 'month', 'year', 'items_count', 'total_amount', 'requested_by'],

            'requisition_approval_requested_v1': ['approver_name', 'property', 'month', 'year', 'vendor_name', 'total_amount', 'notes'],
            'requisition_approval_requested': ['approver_name', 'property', 'month', 'year', 'vendor_name', 'total_amount', 'notes'],

            'requisition_status_updated_v1': ['user_name', 'property', 'month', 'year', 'status', 'approver_name', 'total_amount', 'remarks'],
            'requisition_status_updated': ['user_name', 'property', 'month', 'year', 'status', 'approver_name', 'total_amount', 'remarks'],

            'requisition_po_issued_v1': ['user_name', 'month', 'year', 'property', 'vendor_name', 'po_number', 'total_amount'],
            'requisition_po_issued': ['user_name', 'month', 'year', 'property', 'vendor_name', 'po_number', 'total_amount'],

            'meeting_room_booked_v3': ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker', 'booker_phone'],
            'meeting_room_booked': ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker', 'booker_phone'],

            'meeting_room_cancelled_v2': ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker'],
            'meeting_room_cancelled': ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker'],

            'crm_lead_created_v1': ['user_name', 'company_name', 'contact_person', 'phone', 'source', 'property_interest'],
            'lead_created': ['user_name', 'company_name', 'contact_person', 'phone', 'source', 'property_interest'],

            'crm_lead_assigned_v1': ['user_name', 'company_name', 'contact_person', 'phone', 'property_interest', 'next_followup'],
            'lead_assigned': ['user_name', 'company_name', 'contact_person', 'phone', 'property_interest', 'next_followup'],

            'ticket_created_v3': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'],
            'ticket_created_v3_media': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'],
            'ticket_created': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'],
            'ticket_created_media': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'],

            'ticket_assigned_v1': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone'],
            'ticket_assigned': ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone'],

            'ticket_completed_v1': ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'],
            'ticket_completed_v1_media': ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'],
            'ticket_completed': ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'],
            'ticket_completed_media': ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'],

            'ai_property_report_v1': ['user_name', 'org_name', 'date', 'critical_count', 'open_count', 'resolved_count', 'electricity_kwh', 'dg_liters', 'ppm_completed', 'ppm_missed', 'sop_compliance', 'property_summary', 'ai_insights'],
            'daily_property_report': ['user_name', 'org_name', 'date', 'critical_count', 'open_count', 'resolved_count', 'electricity_kwh', 'dg_liters', 'ppm_completed', 'ppm_missed', 'sop_compliance', 'property_summary', 'ai_insights'],

            'material_request_created_v3': ['user_name', 'ticket_number', 'property', 'requested_by', 'requester_phone', 'items_summary', 'ticket_id'],
            'material_request_created': ['user_name', 'ticket_number', 'property', 'requested_by', 'requester_phone', 'items_summary', 'ticket_id'],

            'comparative_approval_requested_v1': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'],
            'comparative_approval_requested': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'],
            'comparative_uploaded_v1': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'],
            'comparative_uploaded': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'notes', 'ticket_id'],

            'comparative_uploaded_info_v1': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'approver_name', 'notes', 'ticket_id'],
            'comparative_uploaded_info': ['user_name', 'uploaded_by', 'ticket_number', 'title', 'property', 'total_cost', 'approver_name', 'notes', 'ticket_id'],

            'comparative_approved_v1': ['user_name', 'ticket_number', 'title', 'property', 'approved_by', 'total_cost', 'approver_comment', 'ticket_id'],
            'comparative_approved': ['user_name', 'ticket_number', 'title', 'property', 'approved_by', 'total_cost', 'approver_comment', 'ticket_id'],

            'comparative_rejected_v1': ['user_name', 'ticket_number', 'title', 'property', 'total_cost', 'action_by', 'rejection_reason', 'ticket_id'],
            'comparative_rejected': ['user_name', 'ticket_number', 'title', 'property', 'total_cost', 'action_by', 'rejection_reason', 'ticket_id'],

            'material_delivered_v1': ['user_name', 'ticket_number', 'title', 'property', 'delivered_items', 'verified_by', 'ticket_id'],
            'material_delivered_v': ['user_name', 'ticket_number', 'title', 'property', 'delivered_items', 'verified_by', 'ticket_id'],
            'material_delivered': ['user_name', 'ticket_number', 'title', 'property', 'delivered_items', 'verified_by', 'ticket_id'],

            'procurement_vendor_tag_v1': ['user_name', 'ticket_number', 'title', 'property', 'tagged_by', 'note', 'assigned_procurement'],
            'procurement_vendor_tag': ['user_name', 'ticket_number', 'title', 'property', 'tagged_by', 'note', 'assigned_procurement'],

            'procurement_vendor_aligned_v1': ['user_name', 'ticket_number', 'title', 'property', 'vendor_details', 'arranged_by'],
            'procurement_vendor_aligned': ['user_name', 'ticket_number', 'title', 'property', 'vendor_details', 'arranged_by'],

            'reminder_ppm_v2': ['user_name', 'system_name', 'property', 'due_date', 'vendor_name', 'location'],
            'reminder_ppm': ['user_name', 'system_name', 'property', 'due_date', 'vendor_name', 'location'],
            'ppm_reminder': ['user_name', 'system_name', 'property', 'due_date', 'vendor_name', 'location'],

            'reminder_ticket_sla_v1': ['user_name', 'ticket_number', 'title', 'property', 'sla_deadline', 'priority', 'assignee_name'],
            'reminder_ticket_sla': ['user_name', 'ticket_number', 'title', 'property', 'sla_deadline', 'priority', 'assignee_name'],

            'reminder_lead_followup_v1': ['user_name', 'company_name', 'contact_person', 'phone', 'followup_time', 'lead_id'],
            'reminder_lead_followup': ['user_name', 'company_name', 'contact_person', 'phone', 'followup_time', 'lead_id'],

            'fms_welcome_onboarding_v1': ['user_name', 'helpdesk_contact'],

            'checklist_slot_reminder_v1': ['user_name', 'checklist_name', 'property', 'due_time'],
            'checklist_slot_reminder_v2': ['user_name', 'checklist_name', 'property', 'due_time'],
            'checklist_slot_reminder': ['user_name', 'checklist_name', 'property', 'due_time'],

            'checklist_started_v1': ['user_name', 'checklist_name', 'property', 'start_time'],
            'checklist_started': ['user_name', 'checklist_name', 'property', 'start_time'],

            'checklist_completed_v1': ['user_name', 'checklist_name', 'property', 'completed_by', 'time'],
            'checklist_completed': ['user_name', 'checklist_name', 'property', 'completed_by', 'time'],

            'checklist_overdue_alert_v1': ['user_name', 'checklist_name', 'property', 'slot_time'],
            'checklist_overdue_alert_v2': ['checklist_name', 'property', 'slot_time'],
            'checklist_overdue_alert': ['checklist_name', 'property', 'slot_time'],

            'checklist_rated_v1': ['user_name', 'checklist_name', 'property', 'rating', 'rater_name'],
            'checklist_rated': ['user_name', 'checklist_name', 'property', 'rating', 'rater_name']
        };

        const paramKeys = CANONICAL_CAMPAIGN_PARAMS[template.campaign_name]
            || CANONICAL_CAMPAIGN_PARAMS[templateEventKey]
            || template.params
            || [];

        // If using a text-only template, do not pass mediaUrl to prevent Meta API template mismatch
        const isMediaTemplate = template.campaign_name.includes('media') || !!template.is_media;
        const effectiveMediaUrl = isMediaTemplate ? (options.mediaUrl || undefined) : undefined;
        const effectiveMediaType = isMediaTemplate ? options.mediaType : undefined;

        // Dispatch per recipient to personalize `user_name` / `approver_name` with recipient's actual name
        for (const recipient of recipients) {
            const recipientName = recipient.name?.trim() || paramValues['user_name'] || 'Team';

            const recipientParamValues: Record<string, string> = {
                ...paramValues,
                user_name: recipientName,
                approver_name: recipient.name?.trim() || paramValues['approver_name'] || 'Approver'
            };

            const orderedParams: string[] = paramKeys.map((key: string) => {
                let value = recipientParamValues[key];
                // Resolve aliases if direct key is empty
                if (value === undefined || value === null || value === '') {
                    if (key === 'approver_name') value = recipientParamValues['user_name'] || recipientParamValues['action_by'] || 'Approver';
                    else if (key === 'user_name') value = recipientParamValues['approver_name'] || recipientParamValues['requested_by'] || recipientParamValues['uploaded_by'] || 'Procurement Team';
                    else if (key === 'requested_by') value = recipientParamValues['uploaded_by'] || recipientParamValues['user_name'] || 'Site Admin';
                    else if (key === 'remarks') value = recipientParamValues['notes'] || recipientParamValues['approver_comment'] || recipientParamValues['rejection_reason'] || 'No remarks';
                    else if (key === 'notes') value = recipientParamValues['remarks'] || recipientParamValues['approver_comment'] || 'Vendor quote attached';
                    else if (key === 'total_amount') value = recipientParamValues['total_cost'] || recipientParamValues['total_po_amount'] || recipientParamValues['amount'] || '0';
                    else if (key === 'vendor_name') value = recipientParamValues['vendor'] || recipientParamValues['selected_vendor'] || 'Selected Vendor';
                }
                return value !== undefined && value !== null && value !== '' ? String(value) : 'N/A';
            });

            await WhatsAppQueueService.enqueue({
                userIds: [recipient.id],
                message: summaryMessage,
                eventType: templateEventKey.toUpperCase(),
                organizationId,
                propertyId: propertyId || undefined,
                templateName: template.campaign_name,
                templateParams: orderedParams,
                entityId: entityId || undefined,
                mediaUrl: effectiveMediaUrl,
                mediaType: effectiveMediaType
            });
        }
    },


    async handleTicketCreated(payload: any): Promise<void> {
        const ticketId = payload.ticket_id || payload.id;
        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('*, property:properties(id, name, organization_id), raised_by_user:users!tickets_raised_by_fkey(id, full_name, phone, email), assigned_to_user:users!tickets_assigned_to_fkey(id, full_name, phone, email)')
            .eq('id', ticketId)
            .maybeSingle();

        const propertyName = ticket?.property?.name || await this.getPropertyName(payload.property_id);
        const orgId = ticket?.property?.organization_id || payload.organization_id;
        const propId = ticket?.property_id || payload.property_id;

        const raiser = ticket?.raised_by_user?.full_name
            ? { name: ticket.raised_by_user.full_name, phone: ticket.raised_by_user.phone }
            : await this.getUserDetails(payload.raised_by);

        const assignee = ticket?.assigned_to_user?.full_name
            ? { name: ticket.assigned_to_user.full_name, phone: ticket.assigned_to_user.phone }
            : await this.getUserDetails(payload.assigned_to);

        const assigneeId = ticket?.assigned_to || payload.assigned_to;
        const photoBeforeUrl = ticket?.photo_before_url || payload.photo_before_url || null;

        // 1. Dispatch "ticket_created" to Admins & Requester (excluding the assigned person)
        await this.dispatch({
            featureKey: 'ticket_created',
            templateEventKey: 'ticket_created',
            organizationId: orgId,
            propertyId: propId,
            entityId: ticketId,
            mediaUrl: photoBeforeUrl,
            mediaType: photoBeforeUrl ? 'image' : undefined,
            paramValues: {
                user_name: 'Team',
                ticket_number: ticket?.ticket_number || payload.ticket_number || 'N/A',
                title: ticket?.title || payload.title || 'Support Request',
                property: propertyName,
                priority: ticket?.priority || payload.priority || 'Medium',
                raised_by: raiser.name,
                raised_by_phone: raiser.phone || 'N/A',
                assigned_to: assignee.name || 'Unassigned',
                assigned_to_phone: assignee.phone || 'N/A',
                ticket_id: ticketId || ''
            },
            summaryMessage: `New ticket #${ticket?.ticket_number || payload.ticket_number || 'N/A'} (${ticket?.title || payload.title}) at ${propertyName} — Raised by ${raiser.name} (${raiser.phone || 'N/A'})`,
            contextualUserIds: { requesterId: ticket?.raised_by || payload.raised_by },
            excludeUserIds: assigneeId ? [assigneeId] : []
        });

        // 2. If ticket has an assigned person upon creation, send the dedicated "ticket_assigned_v1" template ONLY to the assigned technician
        if (assigneeId) {
            await this.handleTicketAssigned(payload);
        }
    },

    async handleTicketAssigned(payload: any): Promise<void> {
        const ticketId = payload.ticket_id || payload.id;
        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('*, property:properties(id, name, organization_id), raised_by_user:users!tickets_raised_by_fkey(id, full_name, phone, email), assigned_to_user:users!tickets_assigned_to_fkey(id, full_name, phone, email)')
            .eq('id', ticketId)
            .maybeSingle();

        const assignedToId = ticket?.assigned_to || payload.assigned_to;
        if (!assignedToId) return;

        const propertyName = ticket?.property?.name || await this.getPropertyName(payload.property_id);
        const orgId = ticket?.property?.organization_id || payload.organization_id;
        const propId = ticket?.property_id || payload.property_id;

        const raiser = ticket?.raised_by_user?.full_name
            ? { name: ticket.raised_by_user.full_name, phone: ticket.raised_by_user.phone }
            : await this.getUserDetails(payload.raised_by);

        const assignee = ticket?.assigned_to_user?.full_name
            ? { name: ticket.assigned_to_user.full_name, phone: ticket.assigned_to_user.phone }
            : await this.getUserDetails(assignedToId);

        await this.dispatch({
            featureKey: 'ticket_assigned',
            templateEventKey: 'ticket_assigned',
            organizationId: orgId,
            propertyId: propId,
            entityId: ticketId,
            paramValues: {
                user_name: assignee.name || 'Technician',
                ticket_number: ticket?.ticket_number || payload.ticket_number || 'N/A',
                title: ticket?.title || payload.title || 'Support Request',
                property: propertyName,
                priority: ticket?.priority || payload.priority || 'Medium',
                raised_by: raiser.name,
                raised_by_phone: raiser.phone || 'N/A',
                requester: raiser.name,
                requester_phone: raiser.phone || 'N/A',
                target_sla: (ticket?.sla_deadline || payload.sla_deadline) ? formatWhatsAppDateTime(ticket?.sla_deadline || payload.sla_deadline) : 'Standard SLA',
                ticket_id: ticketId || ''
            },
            summaryMessage: `Ticket #${ticket?.ticket_number || payload.ticket_number || 'N/A'} (${ticket?.title || payload.title}) assigned to ${assignee.name}`,
            contextualUserIds: { assigneeId: assignedToId, requesterId: ticket?.raised_by || payload.raised_by }
        });
    },

    async handleTicketCompleted(payload: any): Promise<void> {
        const ticketId = payload.ticket_id || payload.id;
        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('*, property:properties(id, name, organization_id), raised_by_user:users!tickets_raised_by_fkey(id, full_name, phone, email), assigned_to_user:users!tickets_assigned_to_fkey(id, full_name, phone, email)')
            .eq('id', ticketId)
            .maybeSingle();

        const propertyName = ticket?.property?.name || await this.getPropertyName(payload.property_id);
        const orgId = ticket?.property?.organization_id || payload.organization_id;
        const propId = ticket?.property_id || payload.property_id;

        const raiser = ticket?.raised_by_user?.full_name
            ? { name: ticket.raised_by_user.full_name, phone: ticket.raised_by_user.phone }
            : await this.getUserDetails(payload.raised_by);

        const completer = ticket?.assigned_to_user?.full_name
            ? { name: ticket.assigned_to_user.full_name, phone: ticket.assigned_to_user.phone }
            : await this.getUserDetails(payload.assigned_to || payload.updated_by || payload.action_by);

        const photoAfterUrl = ticket?.photo_after_url || payload.photo_after_url || null;

        await this.dispatch({
            featureKey: 'ticket_completed',
            templateEventKey: 'ticket_completed',
            organizationId: orgId,
            propertyId: propId,
            entityId: ticketId,
            mediaUrl: photoAfterUrl,
            mediaType: photoAfterUrl ? 'image' : undefined,
            paramValues: {
                user_name: raiser.name || 'Requester',
                ticket_number: ticket?.ticket_number || payload.ticket_number || 'N/A',
                title: ticket?.title || payload.title || 'Support Request',
                property: propertyName,
                resolved_by: completer.name || 'Technician',
                work_note: payload.resolution_note || payload.resolution_notes || ticket?.resolution_notes || ticket?.description || 'Service completed successfully.',
                ticket_id: ticketId || ''
            },
            summaryMessage: `Ticket #${ticket?.ticket_number || payload.ticket_number || 'N/A'} (${ticket?.title || payload.title}) resolved at ${propertyName} by ${completer.name}`,
            contextualUserIds: { requesterId: ticket?.raised_by || payload.raised_by }
        });
    },


    async handleMeetingRoomEvent(payload: any, isCancellation: boolean): Promise<void> {
        let propertyId = payload.property_id;
        const meetingRoomId = payload.meeting_room_id;

        if (!propertyId && meetingRoomId) {
            const { data: room } = await supabaseAdmin
                .from('meeting_rooms')
                .select('property_id')
                .eq('id', meetingRoomId)
                .maybeSingle();
            if (room?.property_id) {
                propertyId = room.property_id;
            }
        }

        if (!propertyId) return;

        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('organization_id, name')
            .eq('id', propertyId)
            .maybeSingle();

        if (!property?.organization_id) return;

        const roomName = await this.getRoomName(meetingRoomId);
        const booker = await this.getUserDetails(payload.user_id);
        const formattedDate = formatWhatsAppDate(payload.booking_date);
        const formattedStartTime = formatTimeString(payload.start_time);
        const formattedEndTime = formatTimeString(payload.end_time);

        const paramValues: Record<string, string> = {
            user_name: 'Front Desk / Admin',
            room_name: roomName,
            property: property.name || 'Site Property',
            date: formattedDate,
            start_time: formattedStartTime,
            end_time: formattedEndTime,
            booker: booker.name,
            booker_phone: booker.phone || 'N/A',
            cancelled_by: booker.name
        };

        const summaryMessage = isCancellation
            ? `Meeting room cancelled: ${roomName} on ${formattedDate} at ${formattedStartTime}`
            : `Meeting room booked: ${roomName} at ${property.name} on ${formattedDate} (${formattedStartTime} - ${formattedEndTime}) by ${booker.name}`;

        await this.dispatch({
            featureKey: isCancellation ? 'meeting_room_cancelled' : 'meeting_room_booked',
            templateEventKey: isCancellation ? 'meeting_room_cancelled' : 'meeting_room_booked',
            organizationId: property.organization_id,
            propertyId,
            entityId: payload.id,
            contextualUserIds: { requesterId: payload.user_id },
            paramValues,
            summaryMessage
        });
    },

    async handleMaterialRequestCreated(payload: any): Promise<void> {
        const requestId = payload.id;
        const ticketId = payload.ticket_id;

        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('id, ticket_number, property_id, organization_id, property:properties(name)')
            .eq('id', ticketId)
            .maybeSingle();

        const organizationId = payload.organization_id || ticket?.organization_id;
        const propertyId = payload.property_id || ticket?.property_id;
        const propertyName = (ticket as any)?.property?.name
            || (Array.isArray((ticket as any)?.property) ? (ticket as any).property[0]?.name : null)
            || await this.getPropertyName(propertyId);

        let itemsList: any[] = [];
        if (Array.isArray(payload.items) && payload.items.length > 0) {
            itemsList = payload.items;
        } else if (requestId) {
            const { data: mr } = await supabaseAdmin
                .from('material_requests')
                .select('items')
                .eq('id', requestId)
                .maybeSingle();
            if (mr && Array.isArray(mr.items)) {
                itemsList = mr.items;
            } else {
                const { data: separateItems } = await supabaseAdmin
                    .from('material_request_items')
                    .select('name, quantity')
                    .eq('request_id', requestId);
                if (separateItems) itemsList = separateItems;
            }
        }

        const itemsSummary = (itemsList || []).length > 0
            ? (itemsList || []).map((i: any) => `${i.name} x${i.quantity || 1}`).join(', ')
            : 'Requested items';

        const requester = await this.getUserDetails(payload.requested_by);

        await this.dispatch({
            featureKey: 'material_request_created',
            templateEventKey: 'material_request_created',
            organizationId,
            propertyId,
            entityId: requestId,
            paramValues: {
                user_name: 'Procurement Team',
                property: propertyName,
                property_name: propertyName,
                ticket_number: ticket?.ticket_number || 'N/A',
                requester: requester.name,
                requested_by: requester.name,
                requester_phone: requester.phone || 'N/A',
                items_summary: itemsSummary,
                ticket_id: ticket?.id || ticketId || requestId
            },
            summaryMessage: `Material request created at ${propertyName} for ticket #${ticket?.ticket_number || 'N/A'} by ${requester.name} (${requester.phone || 'N/A'}): ${itemsSummary}`
        });
    },

    async handleComparativeUploaded(payload: any): Promise<void> {
        const requestId = payload.request_id || payload.id;
        const { data: request } = await supabaseAdmin
            .from('material_requests')
            .select(`
                id,
                requested_by,
                ticket:tickets(id, ticket_number, title, property_id, organization_id, property:properties(name)),
                requester:users!requested_by(full_name),
                assignee:users!assignee_uid(full_name)
            `)
            .eq('id', requestId)
            .maybeSingle();

        if (!request) return;

        const ticket = Array.isArray(request.ticket) ? request.ticket[0] : (request.ticket as any);
        const orgId = ticket?.organization_id;
        const propId = ticket?.property_id;
        const propName = ticket?.property?.name || 'Site Property';
        const uploaderName = (request.assignee as any)?.full_name || 'Procurement User';
        const approver = await this.getUserDetails(payload.approver_uid);

        // 1. Send Action Required Approval Notification to the Assigned Approver
        if (payload.approver_uid) {
            await this.dispatch({
                featureKey: 'comparative_uploaded',
                templateEventKey: 'comparative_approval_requested',
                organizationId: orgId,
                propertyId: propId,
                entityId: payload.id || requestId,
                paramValues: {
                    user_name: approver.name || 'Approver',
                    total_cost: String(payload.total_cost || '0'),
                    uploaded_by: uploaderName,
                    ticket_number: ticket?.ticket_number || 'N/A',
                    title: ticket?.title || 'Maintenance Request',
                    property: propName,
                    notes: payload.notes || 'Comparative quotes attached',
                    ticket_id: ticket?.id || requestId
                },
                summaryMessage: `Action Required: Comparative quote of ₹${(payload.total_cost || 0).toLocaleString()} uploaded for Ticket #${ticket?.ticket_number || 'N/A'} (Awaiting Approval)`,
                contextualUserIds: { approverId: payload.approver_uid }
            });
        }

        // 2. Send Informational Notice to Other Team Members & Requester
        await this.dispatch({
            featureKey: 'comparative_uploaded',
            templateEventKey: 'comparative_uploaded_info',
            organizationId: orgId,
            propertyId: propId,
            entityId: payload.id || requestId,
            paramValues: {
                user_name: 'Team Member',
                total_cost: String(payload.total_cost || '0'),
                uploaded_by: uploaderName,
                ticket_number: ticket?.ticket_number || 'N/A',
                title: ticket?.title || 'Maintenance Request',
                property: propName,
                approver_name: approver.name || 'Assigned Approver',
                notes: payload.notes || 'Comparative quotes attached',
                ticket_id: ticket?.id || requestId
            },
            summaryMessage: `Comparative quote of ₹${(payload.total_cost || 0).toLocaleString()} uploaded for Ticket #${ticket?.ticket_number || 'N/A'} (Assigned to ${approver.name})`,
            contextualUserIds: { requesterId: request.requested_by }
        });
    },

    async handleComparativeApproved(payload: any): Promise<void> {
        const requestId = payload.request_id || payload.id;
        const { data: request } = await supabaseAdmin
            .from('material_requests')
            .select(`
                id,
                ticket:tickets(id, ticket_number, title, property_id, organization_id, property:properties(name))
            `)
            .eq('id', requestId)
            .maybeSingle();

        if (!request) return;

        const ticket = Array.isArray(request.ticket) ? request.ticket[0] : (request.ticket as any);
        const approver = await this.getUserDetails(payload.action_by);

        await this.dispatch({
            featureKey: 'comparative_approved',
            templateEventKey: 'comparative_approved',
            organizationId: ticket?.organization_id,
            propertyId: ticket?.property_id,
            entityId: payload.id || requestId,
            paramValues: {
                user_name: 'Procurement Team',
                total_cost: String(payload.total_cost || '0'),
                ticket_number: ticket?.ticket_number || 'N/A',
                title: ticket?.title || 'Maintenance Request',
                property: ticket?.property?.name || 'Property',
                approved_by: approver.name,
                approver_comment: payload.approver_comment || 'Approved',
                ticket_id: ticket?.id || requestId
            },
            summaryMessage: `Comparative quote approved for Ticket #${ticket?.ticket_number || 'N/A'} by ${approver.name}`
        });
    },

    async handleComparativeRejected(payload: any): Promise<void> {
        const requestId = payload.request_id || payload.id;
        const { data: request } = await supabaseAdmin
            .from('material_requests')
            .select(`
                id,
                ticket:tickets(id, ticket_number, title, property_id, organization_id, property:properties(name))
            `)
            .eq('id', requestId)
            .maybeSingle();

        if (!request) return;

        const ticket = Array.isArray(request.ticket) ? request.ticket[0] : (request.ticket as any);
        const actionBy = await this.getUserDetails(payload.action_by);

        await this.dispatch({
            featureKey: 'comparative_rejected',
            templateEventKey: 'comparative_rejected',
            organizationId: ticket?.organization_id,
            propertyId: ticket?.property_id,
            entityId: payload.id || requestId,
            paramValues: {
                user_name: 'Procurement Team',
                total_cost: String(payload.total_cost || '0'),
                ticket_number: ticket?.ticket_number || 'N/A',
                title: ticket?.title || 'Maintenance Request',
                property: ticket?.property?.name || 'Property',
                action_by: actionBy.name,
                rejection_reason: payload.approver_comment || 'Revision required',
                ticket_id: ticket?.id || requestId
            },
            summaryMessage: `Comparative quote marked for revision on Ticket #${ticket?.ticket_number || 'N/A'}`
        });
    },

    async handleMaterialDelivered(payload: any): Promise<void> {
        const requestId = payload.request_id || payload.id;
        const { data: request } = await supabaseAdmin
            .from('material_requests')
            .select(`
                id,
                requested_by,
                ticket:tickets(id, ticket_number, title, property_id, organization_id, property:properties(name)),
                items:material_request_items(name, quantity)
            `)
            .eq('id', requestId)
            .maybeSingle();

        if (!request) return;

        const ticket = Array.isArray(request.ticket) ? request.ticket[0] : (request.ticket as any);
        const items = (request.items as any[]) || [];
        const itemsSummary = items.map(i => `${i.name} x${i.quantity}`).join(', ') || 'Delivered materials';
        const verifier = await this.getUserDetails(payload.delivered_by || payload.action_by);

        await this.dispatch({
            featureKey: 'material_delivered',
            templateEventKey: 'material_delivered',
            organizationId: ticket?.organization_id,
            propertyId: ticket?.property_id,
            entityId: requestId,
            paramValues: {
                user_name: 'Site Team',
                ticket_number: ticket?.ticket_number || 'N/A',
                title: ticket?.title || 'Maintenance Request',
                property: ticket?.property?.name || 'Property',
                items_summary: itemsSummary,
                delivered_items: itemsSummary,
                verified_by: verifier.name || 'Store Incharge',
                ticket_id: ticket?.id || requestId
            },
            summaryMessage: `Materials delivered for Ticket #${ticket?.ticket_number || 'N/A'}: ${itemsSummary}`,
            contextualUserIds: { requesterId: request.requested_by }
        });
    },

    async handleRequisitionUploaded(payload: any): Promise<void> {
        const { organization_id, property_id, requisition_month, requisition_year, file_name, uploaded_by } = payload;
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[(requisition_month || 1) - 1] || 'Month';
        const propertyName = await this.getPropertyName(property_id);
        const uploader = await this.getUserDetails(uploaded_by);

        let floorTag = payload.floor_tag && payload.floor_tag !== 'All Floors' ? ` (${payload.floor_tag})` : '';
        let itemsCount = payload.items_count || payload.items?.length;
        let totalAmount = payload.total_amount || payload.total_estimated_amount;
        let isOverBudget = !!payload.is_over_budget;
        let overBudgetAmount = Number(payload.over_budget_amount) || 0;
        let budgetLimit = Number(payload.budget_limit) || 0;

        // If itemsCount, totalAmount, or budget info is missing, query the record
        if (payload.requisition_id && (!itemsCount || !totalAmount || !isOverBudget)) {
            try {
                const { data: req } = await supabaseAdmin
                    .from('property_monthly_requisitions')
                    .select('notes, floor_tag, total_estimated_amount, is_over_budget, budget_limit, over_budget_amount')
                    .eq('id', payload.requisition_id)
                    .maybeSingle();

                if (req) {
                    if (req.floor_tag && req.floor_tag !== 'All Floors' && !floorTag) {
                        floorTag = ` (${req.floor_tag})`;
                    }
                    if (req.total_estimated_amount && !totalAmount) {
                        totalAmount = Number(req.total_estimated_amount);
                    }
                    if (req.is_over_budget) isOverBudget = true;
                    if (req.over_budget_amount && !overBudgetAmount) overBudgetAmount = Number(req.over_budget_amount);
                    if (req.budget_limit && !budgetLimit) budgetLimit = Number(req.budget_limit);

                    let parsedNotes: any = null;
                    if (typeof req.notes === 'object' && req.notes !== null) {
                        parsedNotes = req.notes;
                    } else if (typeof req.notes === 'string' && req.notes.trim().length > 0) {
                        try {
                            parsedNotes = JSON.parse(req.notes);
                        } catch {}
                    }

                    if (parsedNotes) {
                        if (!itemsCount && parsedNotes.requested_items_count) {
                            itemsCount = parsedNotes.requested_items_count;
                        } else if (!itemsCount && parsedNotes.total_items_count) {
                            itemsCount = parsedNotes.total_items_count;
                        } else if (!itemsCount && Array.isArray(parsedNotes.items)) {
                            const reqCount = parsedNotes.items.filter((i: any) => (i.requested_qty || 0) > 0).length;
                            itemsCount = reqCount > 0 ? reqCount : parsedNotes.items.length;
                        }
                        if (!totalAmount && parsedNotes.total_estimated_amount) {
                            totalAmount = Number(parsedNotes.total_estimated_amount);
                        }
                        if (!isOverBudget && parsedNotes.is_over_budget) {
                            isOverBudget = true;
                        }
                        if (!overBudgetAmount && parsedNotes.over_budget_amount) {
                            overBudgetAmount = Number(parsedNotes.over_budget_amount);
                        }
                        if (!budgetLimit && parsedNotes.budget_limit) {
                            budgetLimit = Number(parsedNotes.budget_limit);
                        }
                    }
                }
            } catch (err) {
                console.warn('[Requisition Hydrate Error]:', err);
            }
        }

        const propertyDisplay = isOverBudget
            ? `${propertyName}${floorTag} [⚠️ OVER BUDGET]`
            : `${propertyName}${floorTag}`;

        const itemsCountDisplay = itemsCount ? `${itemsCount} line items` : 'Multiple line items';
        
        let totalAmountDisplay = totalAmount ? `${Number(totalAmount).toLocaleString('en-IN')}` : '0';
        if (isOverBudget && overBudgetAmount > 0) {
            totalAmountDisplay = `${totalAmountDisplay} (⚠️ Over Budget +₹${overBudgetAmount.toLocaleString('en-IN')})`;
        } else if (isOverBudget) {
            totalAmountDisplay = `${totalAmountDisplay} (⚠️ Over Budget)`;
        }

        await this.dispatch({
            featureKey: 'monthly_requisition_uploaded',
            templateEventKey: 'monthly_requisition_uploaded',
            organizationId: organization_id,
            propertyId: property_id,
            entityId: payload.requisition_id,
            contextualUserIds: { requesterId: uploaded_by },
            paramValues: {
                user_name: 'Procurement Team',
                property: propertyDisplay,
                month: monthName,
                year: String(requisition_year || new Date().getFullYear()),
                items_count: itemsCountDisplay,
                total_amount: totalAmountDisplay,
                requested_by: uploader.name || 'Site Admin',
                file_name: file_name || 'Requisition_Sheet.xlsx',
                uploaded_by: uploader.name
            },
            summaryMessage: `Monthly requisition sheet uploaded for ${propertyDisplay} (${monthName} ${requisition_year})${isOverBudget ? ` ⚠️ OVER BUDGET: Total ₹${totalAmount ? Number(totalAmount).toLocaleString('en-IN') : '0'} exceeds limit by +₹${overBudgetAmount.toLocaleString('en-IN')}` : ''}`
        });
    },

    async handleRequisitionApprovalRequested(payload: any): Promise<void> {
        let { organization_id, property_id, requisition_month, requisition_year, target_approver_id, vendor_name, total_final_amount, vendor_notes } = payload;
        let isOverBudget = !!payload.is_over_budget;
        let overBudgetAmount = Number(payload.over_budget_amount) || 0;
        let budgetLimit = Number(payload.budget_limit) || 0;

        if (payload.requisition_id) {
            try {
                const { data: req } = await supabaseAdmin
                    .from('property_monthly_requisitions')
                    .select('notes, floor_tag, property_id, organization_id, requisition_month, requisition_year, is_over_budget, budget_limit, over_budget_amount')
                    .eq('id', payload.requisition_id)
                    .maybeSingle();

                if (req) {
                    if (!organization_id) organization_id = req.organization_id;
                    if (!property_id) property_id = req.property_id;
                    if (!requisition_month) requisition_month = req.requisition_month;
                    if (!requisition_year) requisition_year = req.requisition_year;
                    if (req.is_over_budget) isOverBudget = true;
                    if (req.over_budget_amount && !overBudgetAmount) overBudgetAmount = Number(req.over_budget_amount);
                    if (req.budget_limit && !budgetLimit) budgetLimit = Number(req.budget_limit);

                    let parsedNotes: any = null;
                    if (typeof req.notes === 'object' && req.notes !== null) {
                        parsedNotes = req.notes;
                    } else if (typeof req.notes === 'string' && req.notes.trim().length > 0) {
                        try {
                            parsedNotes = JSON.parse(req.notes);
                        } catch {}
                    }

                    if (parsedNotes?.vendor_quotation) {
                        if (!vendor_name) vendor_name = parsedNotes.vendor_quotation.vendor_name;
                        if (!total_final_amount) total_final_amount = parsedNotes.vendor_quotation.total_quoted_amount;
                        if (!vendor_notes) vendor_notes = parsedNotes.vendor_quotation.notes;
                    }
                    if (parsedNotes?.approver_info && !target_approver_id) {
                        target_approver_id = parsedNotes.approver_info.id;
                    }
                    if (!isOverBudget && parsedNotes?.is_over_budget) isOverBudget = true;
                    if (!overBudgetAmount && parsedNotes?.over_budget_amount) overBudgetAmount = Number(parsedNotes.over_budget_amount);
                }
            } catch (err) {
                console.warn('[Requisition Approval Hydrate Error]:', err);
            }
        }

        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[(requisition_month || 1) - 1] || 'Month';
        const propertyName = await this.getPropertyName(property_id);
        const floorTag = payload.floor_tag && payload.floor_tag !== 'All Floors' ? ` (${payload.floor_tag})` : '';
        const propertyDisplay = isOverBudget
            ? `${propertyName}${floorTag} [⚠️ OVER BUDGET]`
            : `${propertyName}${floorTag}`;
        const approver = await this.getUserDetails(target_approver_id);

        let totalAmountDisplay = Number(total_final_amount || 0).toLocaleString('en-IN');
        if (isOverBudget && overBudgetAmount > 0) {
            totalAmountDisplay = `${totalAmountDisplay} (⚠️ Over Budget +₹${overBudgetAmount.toLocaleString('en-IN')})`;
        }

        let notesDisplay = vendor_notes || 'Vendor quotes attached for approval';
        if (isOverBudget && overBudgetAmount > 0) {
            notesDisplay = `⚠️ Note: Exceeds monthly budget limit by +₹${overBudgetAmount.toLocaleString('en-IN')}. ${notesDisplay}`;
        }

        await this.dispatch({
            featureKey: 'requisition_approval_requested',
            templateEventKey: 'requisition_approval_requested',
            organizationId: organization_id,
            propertyId: property_id,
            entityId: payload.requisition_id,
            contextualUserIds: { approverId: target_approver_id },
            paramValues: {
                approver_name: approver.name || 'Director',
                property: propertyDisplay,
                month: monthName,
                year: String(requisition_year || new Date().getFullYear()),
                vendor_name: vendor_name || 'Selected Vendor',
                total_amount: totalAmountDisplay,
                notes: notesDisplay
            },
            summaryMessage: `Approval requested for ${propertyDisplay} requisition (${monthName} ${requisition_year})`
        });
    },

    async handleRequisitionStatusUpdated(payload: any): Promise<void> {
        const { organization_id, property_id, requisition_month, requisition_year, status, approved_by, rejected_by, total_final_amount, rejection_reason, submitted_by } = payload;
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[(requisition_month || 1) - 1] || 'Month';
        const propertyName = await this.getPropertyName(property_id);
        const floorTag = payload.floor_tag && payload.floor_tag !== 'All Floors' ? ` (${payload.floor_tag})` : '';
        
        let isOverBudget = !!payload.is_over_budget;
        if (payload.requisition_id && !isOverBudget) {
            try {
                const { data: req } = await supabaseAdmin
                    .from('property_monthly_requisitions')
                    .select('is_over_budget')
                    .eq('id', payload.requisition_id)
                    .maybeSingle();
                if (req?.is_over_budget) isOverBudget = true;
            } catch {}
        }

        const propertyDisplay = isOverBudget
            ? `${propertyName}${floorTag} [⚠️ OVER BUDGET]`
            : `${propertyName}${floorTag}`;
        const actorId = approved_by || rejected_by;
        const actor = await this.getUserDetails(actorId);

        await this.dispatch({
            featureKey: 'requisition_status_updated',
            templateEventKey: 'requisition_status_updated',
            organizationId: organization_id,
            propertyId: property_id,
            entityId: payload.requisition_id,
            contextualUserIds: { requesterId: submitted_by },
            paramValues: {
                user_name: 'Procurement Team',
                property: propertyDisplay,
                month: monthName,
                year: String(requisition_year || new Date().getFullYear()),
                status: String(status || 'APPROVED').toUpperCase(),
                approver_name: actor.name || 'Approver',
                total_amount: Number(total_final_amount || 0).toLocaleString('en-IN'),
                remarks: rejection_reason || 'Approved as per comparative sheet'
            },
            summaryMessage: `Requisition for ${propertyDisplay} has been ${status} by ${actor.name}`
        });
    },

    async handleRequisitionPoIssued(payload: any): Promise<void> {
        const { organization_id, property_id, requisition_month, requisition_year, po_number, vendor_name, total_po_amount, submitted_by } = payload;
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[(requisition_month || 1) - 1] || 'Month';
        const propertyName = await this.getPropertyName(property_id);
        const floorTag = payload.floor_tag && payload.floor_tag !== 'All Floors' ? ` (${payload.floor_tag})` : '';
        const propertyDisplay = `${propertyName}${floorTag}`;
        const requester = await this.getUserDetails(submitted_by);

        await this.dispatch({
            featureKey: 'requisition_po_issued',
            templateEventKey: 'requisition_po_issued',
            organizationId: organization_id,
            propertyId: property_id,
            entityId: payload.requisition_id,
            contextualUserIds: { requesterId: submitted_by },
            paramValues: {
                user_name: requester.name || 'Site Admin',
                month: monthName,
                year: String(requisition_year || new Date().getFullYear()),
                property: propertyDisplay,
                vendor_name: vendor_name || 'Vendor',
                po_number: po_number || 'PO-1001',
                total_amount: Number(total_po_amount || 0).toLocaleString('en-IN')
            },
            summaryMessage: `PO issued for ${propertyDisplay} requisition (${monthName} ${requisition_year})`
        });
    },

    async handleVendorProcurementRequested(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const tagger = await this.getUserDetails(payload.tagged_by);
        const procurement = await this.getUserDetails(payload.assigned_procurement_user_id);

        await this.dispatch({
            featureKey: 'procurement_vendor_tag',
            templateEventKey: 'procurement_vendor_tag',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.ticket_id,
            paramValues: {
                user_name: procurement.name || 'Procurement Team',
                ticket_number: payload.ticket_number || 'N/A',
                title: payload.title || 'Site Issue',
                property: propertyName,
                tagged_by: tagger.name,
                note: payload.note || 'Vendor arrangement requested',
                assigned_procurement: procurement.name || 'Procurement Team'
            },
            summaryMessage: `Vendor procurement tagged on Ticket #${payload.ticket_number} at ${propertyName}`,
            contextualUserIds: { assigneeId: payload.assigned_procurement_user_id }
        });
    },

    async handleVendorProcurementArranged(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const arranger = await this.getUserDetails(payload.arranged_by);
        const requesterId = payload.tagged_by || payload.raised_by;

        await this.dispatch({
            featureKey: 'procurement_vendor_aligned',
            templateEventKey: 'procurement_vendor_aligned',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.ticket_id,
            paramValues: {
                user_name: 'Site Staff',
                ticket_number: payload.ticket_number || 'N/A',
                title: payload.title || 'Site Issue',
                property: propertyName,
                vendor_details: payload.details || 'Vendor visit aligned',
                arranged_by: arranger.name || 'Procurement Team'
            },
            summaryMessage: `Vendor arranged for Ticket #${payload.ticket_number} at ${propertyName}`,
            contextualUserIds: { requesterId, assigneeId: payload.assigned_to },
            excludeUserIds: payload.arranged_by ? [payload.arranged_by] : []
        });
    },

    async handleLeadCreated(payload: any): Promise<void> {
        const leadId = payload.lead_id || payload.id;
        const { data: lead } = await supabaseAdmin
            .from('crm_leads')
            .select('*, source_info:crm_lead_sources(id, name), property:properties(name), assignee:users!assigned_to(id, full_name, email, phone)')
            .eq('id', leadId)
            .maybeSingle();

        const organizationId = lead?.organization_id || payload.organization_id || await this.resolveLeadOrganizationId(payload);
        if (!organizationId) return;

        const leadData = lead || payload;
        const sourceName = lead?.source_info?.name || leadData.lead_source || await this.getLeadSourceName(payload.lead_source);
        const propName = lead?.property?.name || await this.getPropertyName(payload.property_interest);
        
        // Resolve location, campaign, and market for clear tracking in WhatsApp
        const location = (leadData.location || payload.location || '').trim();
        const campaign = (leadData.campaign || payload.campaign || '').trim();
        const city = (leadData.city || payload.city || '').trim();
        const requirement = (leadData.requirement || payload.requirement || '').trim();

        let locationLabel = '';
        if (propName) {
            locationLabel = propName;
            if (location && !propName.toLowerCase().includes(location.toLowerCase())) {
                locationLabel += ` (${location})`;
            } else if (campaign && !propName.toLowerCase().includes(campaign.toLowerCase())) {
                locationLabel += ` (${campaign})`;
            }
        } else if (location) {
            locationLabel = location;
            if (campaign && !location.toLowerCase().includes(campaign.toLowerCase())) {
                locationLabel += ` • ${campaign}`;
            } else if (city && !location.toLowerCase().includes(city.toLowerCase())) {
                locationLabel += ` (${city})`;
            }
        } else if (campaign) {
            locationLabel = campaign;
            if (city && !campaign.toLowerCase().includes(city.toLowerCase())) {
                locationLabel += ` (${city})`;
            }
        } else if (city) {
            locationLabel = city;
        } else {
            locationLabel = 'Direct / All';
        }

        const propertyInterestWithReq = requirement 
            ? `${locationLabel} | Req: ${requirement}` 
            : locationLabel;

        const enrichedSource = (campaign && sourceName && !sourceName.toLowerCase().includes(campaign.toLowerCase()))
            ? `${sourceName} (${campaign})`
            : (sourceName || campaign || 'Direct');

        await this.dispatch({
            featureKey: 'lead_created',
            templateEventKey: 'lead_created',
            organizationId,
            propertyId: leadData.property_interest,
            entityId: leadId,
            paramValues: {
                user_name: 'Sales Team',
                company_name: leadData.company_name || 'New Company',
                contact_person: leadData.contact_person || 'N/A',
                phone: leadData.contact_number || leadData.phone || 'N/A',
                source: enrichedSource,
                property_interest: propertyInterestWithReq
            },
            summaryMessage: `New CRM lead: ${leadData.company_name} (${leadData.contact_person || 'N/A'}) [📍 ${locationLabel}${requirement ? ` | Req: ${requirement}` : ''}]`
        });
    },

    async handleLeadAssigned(payload: any): Promise<void> {
        const leadId = payload.lead_id || payload.id;
        const { data: lead } = await supabaseAdmin
            .from('crm_leads')
            .select('*, source_info:crm_lead_sources(id, name), property:properties(name), assignee:users!assigned_to(id, full_name, email, phone)')
            .eq('id', leadId)
            .maybeSingle();

        const organizationId = lead?.organization_id || payload.organization_id || await this.resolveLeadOrganizationId(payload);
        if (!organizationId) return;

        const assigneeId = lead?.assigned_to || payload.assigned_to;
        const assignee = lead?.assignee?.full_name 
            ? { name: lead.assignee.full_name, phone: lead.assignee.phone } 
            : await this.getUserDetails(assigneeId);

        const leadData = lead || payload;
        const propName = lead?.property?.name || await this.getPropertyName(payload.property_interest);
        
        // Resolve location, campaign, and market for clear tracking in WhatsApp
        const location = (leadData.location || payload.location || '').trim();
        const campaign = (leadData.campaign || payload.campaign || '').trim();
        const city = (leadData.city || payload.city || '').trim();
        const requirement = (leadData.requirement || payload.requirement || '').trim();

        let locationLabel = '';
        if (propName) {
            locationLabel = propName;
            if (location && !propName.toLowerCase().includes(location.toLowerCase())) {
                locationLabel += ` (${location})`;
            } else if (campaign && !propName.toLowerCase().includes(campaign.toLowerCase())) {
                locationLabel += ` (${campaign})`;
            }
        } else if (location) {
            locationLabel = location;
            if (campaign && !location.toLowerCase().includes(campaign.toLowerCase())) {
                locationLabel += ` • ${campaign}`;
            } else if (city && !location.toLowerCase().includes(city.toLowerCase())) {
                locationLabel += ` (${city})`;
            }
        } else if (campaign) {
            locationLabel = campaign;
            if (city && !campaign.toLowerCase().includes(city.toLowerCase())) {
                locationLabel += ` (${city})`;
            }
        } else if (city) {
            locationLabel = city;
        } else {
            locationLabel = 'Direct / All';
        }

        const propertyInterestWithReq = requirement 
            ? `${locationLabel} | Req: ${requirement}` 
            : locationLabel;

        const followupDate = lead?.next_followup_date || payload.next_followup_date;
        const formattedFollowup = followupDate
            ? formatWhatsAppDateTime(followupDate)
            : (requirement ? `TAT: Immediate | Req: ${requirement}` : 'Immediate Follow-up');

        await this.dispatch({
            featureKey: 'lead_assigned',
            templateEventKey: 'lead_assigned',
            organizationId,
            propertyId: leadData.property_interest,
            entityId: leadId,
            paramValues: {
                user_name: assignee.name || 'Sales Agent',
                company_name: leadData.company_name || 'Company',
                contact_person: leadData.contact_person || 'N/A',
                phone: leadData.contact_number || leadData.phone || 'N/A',
                property_interest: propertyInterestWithReq,
                next_followup: formattedFollowup
            },
            summaryMessage: `Lead ${leadData.company_name} assigned to ${assignee.name} [📍 ${locationLabel}${requirement ? ` | Req: ${requirement}` : ''}]`,
            contextualUserIds: { assigneeId }
        });
    },

    async handleChecklistSlotReminder(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const assignedUser = await this.getUserDetails(payload.assigned_to);

        await this.dispatch({
            featureKey: 'checklist_slot_reminder',
            templateEventKey: 'checklist_slot_reminder',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.entity_id || payload.template_id,
            paramValues: {
                user_name: assignedUser.name || 'Technician',
                checklist_name: payload.template_title || 'SOP Checklist',
                property: propertyName,
                due_time: payload.due_time || '30 mins'
            },
            summaryMessage: `Checklist "${payload.template_title}" at ${propertyName} is due at ${payload.due_time || 'soon'}`,
            contextualUserIds: { assigneeId: payload.assigned_to }
        });
    },

    async handleSOPStarted(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const assignedUser = await this.getUserDetails(payload.assigned_to);

        await this.dispatch({
            featureKey: 'checklist_started',
            templateEventKey: 'checklist_started',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.entity_id || payload.template_id,
            paramValues: {
                user_name: assignedUser.name || 'Technician',
                checklist_name: payload.template_title || 'SOP Checklist',
                property: propertyName,
                start_time: payload.start_time || 'Now'
            },
            summaryMessage: `Checklist "${payload.template_title}" shift started at ${propertyName} (${payload.start_time || 'Now'})`,
            contextualUserIds: { assigneeId: payload.assigned_to }
        });
    },

    async handleSOPCompleted(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const completedBy = await this.getUserDetails(payload.completed_by);

        await this.dispatch({
            featureKey: 'checklist_completed',
            templateEventKey: 'checklist_completed',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.completion_id,
            paramValues: {
                user_name: 'Operations Team',
                checklist_name: payload.template_title || 'SOP Checklist',
                property: propertyName,
                completed_by: completedBy.name,
                time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
            },
            summaryMessage: `Checklist "${payload.template_title}" completed at ${propertyName} by ${completedBy.name}`,
            contextualUserIds: { requesterId: payload.completed_by }
        });
    },

    async handleSOPOverdue(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const assignedUser = await this.getUserDetails(payload.assigned_to);

        await this.dispatch({
            featureKey: 'checklist_overdue_alert',
            templateEventKey: 'checklist_overdue_alert',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.entity_id || payload.template_id,
            paramValues: {
                user_name: assignedUser.name || 'Technician',
                checklist_name: payload.template_title || 'SOP Checklist',
                property: propertyName,
                slot_time: payload.slot_time || 'Scheduled Slot',
                scheduled_time: payload.slot_time || 'Scheduled Slot'
            },
            summaryMessage: `⚠️ Overdue Checklist: "${payload.template_title}" was missed at ${propertyName}`,
            contextualUserIds: { assigneeId: payload.assigned_to }
        });
    },

    async handleSOPRated(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);
        const rater = await this.getUserDetails(payload.rated_by);
        const completedBy = await this.getUserDetails(payload.completed_by);

        await this.dispatch({
            featureKey: 'checklist_rated',
            templateEventKey: 'checklist_rated',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.completion_id,
            paramValues: {
                user_name: completedBy.name || 'Technician',
                checklist_name: payload.template_title || 'SOP Checklist',
                property: propertyName,
                rating: `${payload.rating}/3`,
                rater_name: rater.name || 'Supervisor'
            },
            summaryMessage: `SOP Completion "${payload.template_title}" rated ${payload.rating}/3 by ${rater.name}`,
            contextualUserIds: { requesterId: payload.completed_by }
        });
    },

    async handlePpmReminder(payload: any): Promise<void> {
        const propertyName = await this.getPropertyName(payload.property_id);

        await this.dispatch({
            featureKey: 'reminder_ppm',
            templateEventKey: 'reminder_ppm',
            organizationId: payload.organization_id,
            propertyId: payload.property_id,
            entityId: payload.entity_id || payload.schedule_id,
            paramValues: {
                user_name: payload.user_name || 'Operations Team',
                system_name: payload.system_name || 'Facility Equipment',
                property: propertyName,
                due_date: payload.due_date || 'Upcoming Date',
                vendor_name: payload.vendor_name || 'Assigned Vendor',
                location: payload.location || 'Site Plant Room'
            },
            summaryMessage: `🔧 PPM Reminder: ${payload.system_name} maintenance due on ${payload.due_date} at ${propertyName}`,
            contextualUserIds: payload.assigned_to ? { assigneeId: payload.assigned_to } : {}
        });
    },

    async getPropertyName(propertyId?: string | null): Promise<string> {
        if (!propertyId) return 'N/A';
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('name')
            .eq('id', propertyId)
            .maybeSingle();
        return property?.name || 'N/A';
    },

    async getUserDetails(userId?: string | string[] | null): Promise<{ name: string; phone: string | null }> {
        const cleanId = Array.isArray(userId) ? userId[0] : userId;
        if (!cleanId || typeof cleanId !== 'string' || !cleanId.trim()) return { name: 'Staff', phone: null };
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('full_name, phone')
            .eq('id', cleanId.trim())
            .maybeSingle();
        return {
            name: user?.full_name || 'Staff',
            phone: user?.phone || null
        };
    },

    async getRoomName(meetingRoomId?: string | null): Promise<string> {
        if (!meetingRoomId) return 'Meeting Room';
        const { data: room } = await supabaseAdmin
            .from('meeting_rooms')
            .select('name')
            .eq('id', meetingRoomId)
            .maybeSingle();
        return room?.name || 'Meeting Room';
    },

    async getLeadSourceName(leadSourceId?: string | null): Promise<string> {
        if (!leadSourceId) return 'Direct';
        try {
            const { data: source } = await supabaseAdmin
                .from('crm_lead_sources')
                .select('name')
                .eq('id', leadSourceId)
                .maybeSingle();
            return source?.name || 'Direct';
        } catch {
            return 'Direct';
        }
    },

    async resolveLeadOrganizationId(payload: any): Promise<string | null> {
        if (payload.organization_id) return payload.organization_id;
        const leadId = payload.lead_id || payload.id;
        if (leadId) {
            const { data: lead } = await supabaseAdmin
                .from('crm_leads')
                .select('organization_id, property_interest, created_by')
                .eq('id', leadId)
                .maybeSingle();
            if (lead?.organization_id) return lead.organization_id;
            if (lead?.property_interest) {
                const { data: property } = await supabaseAdmin
                    .from('properties')
                    .select('organization_id')
                    .eq('id', lead.property_interest)
                    .maybeSingle();
                if (property?.organization_id) return property.organization_id;
            }
        }
        if (payload.property_interest) {
            const { data: property } = await supabaseAdmin
                .from('properties')
                .select('organization_id')
                .eq('id', payload.property_interest)
                .maybeSingle();
            if (property?.organization_id) return property.organization_id;
        }

        if (payload.created_by) {
            const { data: membership } = await supabaseAdmin
                .from('organization_memberships')
                .select('organization_id')
                .eq('user_id', payload.created_by)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
            if (membership?.organization_id) return membership.organization_id;
        }

        const { data: defaultOrg } = await supabaseAdmin
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
        return defaultOrg?.id || null;
    }
};
