import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface WhatsAppAnomalyItem {
    id: string;
    queue_id?: string;
    type: 'DELIVERY_FAILURE' | 'STUCK_QUEUE' | 'PARAMETER_MISMATCH' | 'MALFORMED_PHONE' | 'RAPID_DUPLICATE';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    phone: string;
    template_name?: string | null;
    event_type: string;
    created_at: string;
    status: string;
    error_message?: string | null;
    root_cause?: string;
    suggested_fix?: string;
}

export interface TemplateHealthMetric {
    templateName: string;
    eventKey: string;
    total: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    lastSentAt: string | null;
    lastFailedAt: string | null;
    status: 'healthy' | 'degraded' | 'failing' | 'idle';
    primaryError?: string | null;
    suggestedFix?: string | null;
    errorSamples?: string[];
}

interface MetaTemplateSpec {
    campaignName: string;
    eventKey: string;
    paramCount: number;
    description: string;
    suggestedFix: string;
}

const APPROVED_META_TEMPLATES_REGISTRY: MetaTemplateSpec[] = [
    // 1. Tickets & SLA Management
    {
        campaignName: 'ticket_created_v3',
        eventKey: 'ticket_created',
        paramCount: 10,
        description: 'New ticket notification to property admin & requester (text only).',
        suggestedFix: 'Meta approved campaign "ticket_created_v3" with 10 parameters (including ticket UUID CTA).'
    },
    {
        campaignName: 'ticket_created_v3_media',
        eventKey: 'ticket_created_media',
        paramCount: 10,
        description: 'New ticket notification with issue photo header.',
        suggestedFix: 'Meta approved media campaign "ticket_created_v3_media" with before-photo header.'
    },
    {
        campaignName: 'ticket_assigned_v1',
        eventKey: 'ticket_assigned',
        paramCount: 7,
        description: 'Ticket assignment alert to designated technician / MST.',
        suggestedFix: 'Requires exactly 7 parameters (user_name, ticket_number, title, property, priority, raised_by, raised_by_phone).'
    },
    {
        campaignName: 'ticket_completed_v1',
        eventKey: 'ticket_completed',
        paramCount: 5,
        description: 'Ticket resolution notification (text only).',
        suggestedFix: 'Requires exactly 5 parameters (user_name, ticket_number, title, property, resolved_by).'
    },
    {
        campaignName: 'ticket_completed_v1_media',
        eventKey: 'ticket_completed_media',
        paramCount: 5,
        description: 'Ticket resolution with after-work completion photo.',
        suggestedFix: 'Requires approved Meta campaign "ticket_completed_v1_media" with 5 body parameters.'
    },
    {
        campaignName: 'reminder_ticket_sla_v1',
        eventKey: 'reminder_ticket_sla',
        paramCount: 6,
        description: 'Urgent reminder before ticket SLA breach.',
        suggestedFix: 'Requires approved Meta campaign "reminder_ticket_sla_v1" (6 parameters: user_name, ticket_number, title, property, priority, sla_time).'
    },

    // 2. SOP Checklists & Compliance
    {
        campaignName: 'checklist_slot_reminder_v2',
        eventKey: 'checklist_slot_reminder',
        paramCount: 4,
        description: 'Upcoming checklist slot reminder.',
        suggestedFix: 'Requires approved Meta campaign "checklist_slot_reminder_v2" (4 parameters: user_name, checklist_name, property, due_time).'
    },
    {
        campaignName: 'checklist_started_v1',
        eventKey: 'checklist_started',
        paramCount: 4,
        description: 'Notification when technician starts a checklist.',
        suggestedFix: 'Requires approved Meta campaign "checklist_started_v1" (4 parameters: user_name, checklist_name, property, start_time).'
    },
    {
        campaignName: 'checklist_completed_v1',
        eventKey: 'checklist_completed',
        paramCount: 4,
        description: 'Notification upon checklist completion.',
        suggestedFix: 'Requires approved Meta campaign "checklist_completed_v1" (4 parameters: user_name, checklist_name, property, completed_by, time).'
    },
    {
        campaignName: 'checklist_overdue_alert_v2',
        eventKey: 'checklist_overdue_alert',
        paramCount: 3,
        description: 'Overdue missed checklist alert to admins.',
        suggestedFix: 'Requires approved Meta campaign "checklist_overdue_alert_v2" (3 parameters: checklist_name, property, slot_time).'
    },
    {
        campaignName: 'checklist_rated',
        eventKey: 'checklist_rated',
        paramCount: 5,
        description: 'Auditor rating feedback on completed checklist.',
        suggestedFix: 'Requires approved Meta campaign "checklist_rated" (5 parameters: user_name, checklist_name, property, rating, rater_name).'
    },

    // 3. AI Multi-Property Daily Executive Report
    {
        campaignName: 'ai_property_report_v1',
        eventKey: 'daily_property_report',
        paramCount: 12,
        description: 'Daily executive multi-property operational digest.',
        suggestedFix: 'Requires approved Meta campaign "ai_property_report_v1" with 12 operational parameters.'
    },

    // 4. Procurement & Material Requests Suite
    {
        campaignName: 'material_request_created_v3',
        eventKey: 'material_request_created',
        paramCount: 6,
        description: 'New material request alert to procurement & property admin.',
        suggestedFix: 'Requires exactly 6 parameters (user_name, ticket_number, property, requested_by, requester_phone, items_summary).'
    },
    {
        campaignName: 'comparative_approval_requested_v1',
        eventKey: 'comparative_approval_requested',
        paramCount: 7,
        description: 'Comparative quote upload pending org super admin approval.',
        suggestedFix: 'Requires exactly 7 parameters (user_name, uploaded_by, ticket_number, title, property, total_cost, notes).'
    },
    {
        campaignName: 'comparative_uploaded_info_v1',
        eventKey: 'comparative_uploaded_info',
        paramCount: 8,
        description: 'Informational broadcast of comparative quote submission.',
        suggestedFix: 'Requires exactly 8 parameters (user_name, uploaded_by, ticket_number, title, property, total_cost, approver_name, notes).'
    },
    {
        campaignName: 'comparative_approved_v1',
        eventKey: 'comparative_approved',
        paramCount: 7,
        description: 'Approval confirmation of vendor comparative statement.',
        suggestedFix: 'Requires exactly 7 parameters (user_name, ticket_number, title, property, approved_by, total_cost, approver_comment).'
    },
    {
        campaignName: 'comparative_rejected_v1',
        eventKey: 'comparative_rejected',
        paramCount: 7,
        description: 'Rejection notification with reason.',
        suggestedFix: 'Requires exactly 7 parameters (user_name, ticket_number, title, property, total_cost, action_by, rejection_reason).'
    },
    {
        campaignName: 'material_delivered_v1',
        eventKey: 'material_delivered',
        paramCount: 6,
        description: 'Goods arrival & physical delivery verification at site.',
        suggestedFix: 'Requires approved Meta campaign "material_delivered_v1" (6 parameters: user_name, ticket_number, title, property, delivered_items, verified_by).'
    },

    // 5. Monthly Site Requisitions
    {
        campaignName: 'requisition_submitted_v1',
        eventKey: 'requisition_submitted',
        paramCount: 7,
        description: 'Monthly site stock & inventory requisition submitted.',
        suggestedFix: 'Requires approved Meta campaign "requisition_submitted_v1" (7 parameters: user_name, property, month, year, items_count, total_amount, requested_by).'
    },
    {
        campaignName: 'requisition_approval_requested_v1',
        eventKey: 'requisition_approval_requested',
        paramCount: 7,
        description: 'Monthly requisition escalated for management sign-off.',
        suggestedFix: 'Requires approved Meta campaign "requisition_approval_requested_v1" (7 parameters).'
    },
    {
        campaignName: 'requisition_status_updated_v1',
        eventKey: 'requisition_status_updated',
        paramCount: 8,
        description: 'Requisition approval status update broadcast.',
        suggestedFix: 'Requires approved Meta campaign "requisition_status_updated_v1" (8 parameters).'
    },
    {
        campaignName: 'requisition_po_issued_v1',
        eventKey: 'requisition_po_issued',
        paramCount: 7,
        description: 'Purchase order issued to vendor for monthly items.',
        suggestedFix: 'Requires approved Meta campaign "requisition_po_issued_v1" (7 parameters).'
    },

    // 6. Vendor Procurement Tagging
    {
        campaignName: 'procurement_vendor_tag_v1',
        eventKey: 'procurement_vendor_tag',
        paramCount: 7,
        description: 'Vendor tagged for quotation by site team.',
        suggestedFix: 'Requires approved Meta campaign "procurement_vendor_tag_v1" (7 parameters).'
    },
    {
        campaignName: 'procurement_vendor_aligned_v1',
        eventKey: 'procurement_vendor_aligned',
        paramCount: 6,
        description: 'Vendor aligned and confirmed by procurement team.',
        suggestedFix: 'Requires approved Meta campaign "procurement_vendor_aligned_v1" (6 parameters).'
    },

    // 7. Preventive Maintenance (PPM)
    {
        campaignName: 'reminder_ppm_v2',
        eventKey: 'reminder_ppm',
        paramCount: 6,
        description: 'Upcoming PPM scheduled equipment servicing alert.',
        suggestedFix: 'Requires approved Meta campaign "reminder_ppm_v2" (6 parameters: user_name, system_name, property, due_date, vendor_name, location).'
    },

    // 8. Meeting Room Reservations
    {
        campaignName: 'meeting_room_booked_v3',
        eventKey: 'meeting_room_booked',
        paramCount: 8,
        description: 'Meeting room booking confirmation.',
        suggestedFix: 'Requires approved Meta campaign "meeting_room_booked_v3" (8 parameters: user_name, room_name, property, date, start_time, end_time, booker, booker_phone).'
    },
    {
        campaignName: 'meeting_room_cancelled_v2',
        eventKey: 'meeting_room_cancelled',
        paramCount: 7,
        description: 'Meeting room booking cancellation notice.',
        suggestedFix: 'Requires approved Meta campaign "meeting_room_cancelled_v2" (7 parameters: user_name, room_name, property, date, start_time, end_time, booker).'
    },

    // 9. CRM Sales Leads
    {
        campaignName: 'crm_lead_created_v1',
        eventKey: 'crm_lead_created',
        paramCount: 6,
        description: 'New incoming CRM sales lead generated.',
        suggestedFix: 'Requires approved Meta campaign "crm_lead_created_v1" (6 parameters: user_name, company_name, contact_person, phone, source, property_interest).'
    },
    {
        campaignName: 'crm_lead_assigned_v1',
        eventKey: 'crm_lead_assigned',
        paramCount: 6,
        description: 'CRM lead assignment to sales representative.',
        suggestedFix: 'Requires approved Meta campaign "crm_lead_assigned_v1" (6 parameters: user_name, company_name, contact_person, phone, property_interest, next_followup).'
    },
    {
        campaignName: 'reminder_lead_followup_v1',
        eventKey: 'reminder_lead_followup',
        paramCount: 6,
        description: 'Scheduled follow-up reminder for sales lead.',
        suggestedFix: 'Requires approved Meta campaign "reminder_lead_followup_v1" (6 parameters: user_name, company_name, contact_person, phone, followup_time, lead_id).'
    },

    // 10. Cafeteria & Food Vendor Revenue Suite
    {
        campaignName: 'vendor_revenue_recorded_v1',
        eventKey: 'vendor_revenue_recorded',
        paramCount: 8,
        description: 'Daily revenue submission confirmation for food stall / kiosk.',
        suggestedFix: 'Requires approved Meta campaign "vendor_revenue_recorded_v1" (8 parameters).'
    },
    {
        campaignName: 'vendor_revenue_reminder_v1',
        eventKey: 'vendor_revenue_reminder',
        paramCount: 5,
        description: 'Evening reminder for vendors who have not submitted sales.',
        suggestedFix: 'Requires approved Meta campaign "vendor_revenue_reminder_v1" (5 parameters).'
    },
    {
        campaignName: 'vendor_revenue_pending_digest_v1',
        eventKey: 'vendor_revenue_pending_digest',
        paramCount: 8,
        description: 'Nightly digest to property admin showing pending vendor revenue.',
        suggestedFix: 'Requires approved Meta campaign "vendor_revenue_pending_digest_v1" (8 parameters).'
    }
];

const KNOWN_TEMPLATE_DIAGNOSTICS: Record<string, { expectedCampaign: string; paramCount: number; fix: string }> = {};
APPROVED_META_TEMPLATES_REGISTRY.forEach(t => {
    KNOWN_TEMPLATE_DIAGNOSTICS[t.campaignName] = {
        expectedCampaign: t.campaignName,
        paramCount: t.paramCount,
        fix: t.suggestedFix
    };
    if (t.eventKey !== t.campaignName) {
        KNOWN_TEMPLATE_DIAGNOSTICS[t.eventKey] = {
            expectedCampaign: t.campaignName,
            paramCount: t.paramCount,
            fix: t.suggestedFix
        };
    }
});

/**
 * GET /api/admin/whatsapp/analytics?organizationId=...&status=...&template=...&limit=150
 * WhatsApp Gateway Health, Delivery Telemetry, Root Cause Diagnostics & Meta Template Health.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');
        const filterStatus = searchParams.get('status');
        const filterTemplate = searchParams.get('template');
        const limit = Math.min(parseInt(searchParams.get('limit') || '150', 10), 300);

        let query = supabaseAdmin
            .from('whatsapp_queue')
            .select('*')
            .order('created_at', { ascending: false });

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }
        if (filterStatus && filterStatus !== 'all') {
            query = query.eq('status', filterStatus);
        }
        if (filterTemplate && filterTemplate !== 'all') {
            query = query.eq('template_name', filterTemplate);
        }

        const { data: rawQueue, error } = await query.limit(limit);
        if (error) throw error;

        const queueRows = rawQueue || [];

        // 1. Overall Delivery Metrics
        const totalMessages = queueRows.length;
        let sentCount = 0;
        let failedCount = 0;
        let pendingCount = 0;
        let processingCount = 0;

        queueRows.forEach(row => {
            const s = (row.status || '').toLowerCase();
            if (s === 'sent' || s === 'delivered' || s === 'read') sentCount++;
            else if (s === 'failed') failedCount++;
            else if (s === 'pending') pendingCount++;
            else if (s === 'processing') processingCount++;
        });

        const deliveryRate = totalMessages > 0 ? Math.round((sentCount / totalMessages) * 100) : 100;

        // 2. Pre-populate templateMap with ALL approved Meta templates from the registry
        const templateMap = new Map<string, {
            total: number;
            sent: number;
            failed: number;
            pending: number;
            lastSentAt: string | null;
            lastFailedAt: string | null;
            eventKey: string;
            errors: Set<string>;
        }>();

        APPROVED_META_TEMPLATES_REGISTRY.forEach(t => {
            templateMap.set(t.campaignName, {
                total: 0,
                sent: 0,
                failed: 0,
                pending: 0,
                lastSentAt: null,
                lastFailedAt: null,
                eventKey: t.eventKey,
                errors: new Set()
            });
        });

        queueRows.forEach(row => {
            const tName = row.template_name || 'raw_text_message';
            if (!templateMap.has(tName)) {
                templateMap.set(tName, {
                    total: 0,
                    sent: 0,
                    failed: 0,
                    pending: 0,
                    lastSentAt: null,
                    lastFailedAt: null,
                    eventKey: row.event_type || 'N/A',
                    errors: new Set()
                });
            }
            const stat = templateMap.get(tName)!;
            stat.total++;
            const s = (row.status || '').toLowerCase();
            if (s === 'sent' || s === 'delivered' || s === 'read') {
                stat.sent++;
                if (!stat.lastSentAt || new Date(row.created_at).getTime() > new Date(stat.lastSentAt).getTime()) {
                    stat.lastSentAt = row.created_at;
                }
            } else if (s === 'failed') {
                stat.failed++;
                if (!stat.lastFailedAt || new Date(row.created_at).getTime() > new Date(stat.lastFailedAt).getTime()) {
                    stat.lastFailedAt = row.created_at;
                }
                if (row.error_message) {
                    stat.errors.add(row.error_message);
                }
            } else if (s === 'pending' || s === 'processing') {
                stat.pending++;
            }
        });

        const templateHealthList: TemplateHealthMetric[] = Array.from(templateMap.entries()).map(([tName, stat]) => {
            const rate = stat.total > 0 ? Math.round((stat.sent / stat.total) * 100) : 100;
            let status: TemplateHealthMetric['status'] = 'healthy';
            if (stat.total === 0) status = 'idle';
            else if (rate < 50) status = 'failing';
            else if (rate < 90) status = 'degraded';

            const diag = KNOWN_TEMPLATE_DIAGNOSTICS[tName];
            const errorList = Array.from(stat.errors);
            let primaryError = errorList[0] || null;
            let suggestedFix = diag?.fix || null;

            if (stat.failed > 0 && !primaryError && diag) {
                primaryError = `Campaign name mismatch or parameter count disparity in Meta WhatsApp gateway.`;
            }

            return {
                templateName: tName,
                eventKey: stat.eventKey,
                total: stat.total,
                sent: stat.sent,
                failed: stat.failed,
                pending: stat.pending,
                successRate: rate,
                lastSentAt: stat.lastSentAt,
                lastFailedAt: stat.lastFailedAt,
                status,
                primaryError,
                suggestedFix,
                errorSamples: errorList.slice(0, 3)
            };
        }).sort((a, b) => {
            // Active/dispatched templates first (highest total first), then idle templates alphabetically
            if (a.total > 0 && b.total === 0) return -1;
            if (b.total > 0 && a.total === 0) return 1;
            if (a.total !== b.total) return b.total - a.total;
            return a.templateName.localeCompare(b.templateName);
        });

        // 3. Anomaly & Delivery Failure Detection with Root Causes
        const anomalies: WhatsAppAnomalyItem[] = [];
        const nowMs = Date.now();

        queueRows.forEach(row => {
            const s = (row.status || '').toLowerCase();
            const createdMs = new Date(row.created_at).getTime();
            const diag = row.template_name ? KNOWN_TEMPLATE_DIAGNOSTICS[row.template_name] : undefined;

            // Detector A: Delivery Failure / Rejection
            if (s === 'failed') {
                const causeMsg = row.error_message || diag?.fix || 'Meta API rejected campaign template or invalid destination mobile.';
                anomalies.push({
                    id: `fail_${row.id}`,
                    queue_id: row.id,
                    type: 'DELIVERY_FAILURE',
                    severity: 'HIGH',
                    title: `🚨 Delivery Failed: "${row.template_name || row.event_type}"`,
                    description: `Failed to deliver to ${row.phone}. Root Cause: ${causeMsg}`,
                    phone: row.phone,
                    template_name: row.template_name,
                    event_type: row.event_type,
                    created_at: row.created_at,
                    status: row.status,
                    error_message: row.error_message,
                    root_cause: diag?.fix ? `Template Configuration Disparity` : `Provider Rejection`,
                    suggested_fix: diag?.fix || `Ensure recipient number is active on WhatsApp and retry send.`
                });
            }

            // Detector B: Stuck in Queue > 5 minutes
            if ((s === 'pending' || s === 'processing') && (nowMs - createdMs) > 5 * 60 * 1000) {
                const stuckMins = Math.round((nowMs - createdMs) / (60 * 1000));
                anomalies.push({
                    id: `stuck_${row.id}`,
                    queue_id: row.id,
                    type: 'STUCK_QUEUE',
                    severity: 'MEDIUM',
                    title: '⚠️ Message Stuck in Queue Backlog',
                    description: `Message to ${row.phone} has been waiting in "${row.status}" state for ${stuckMins} minutes without dispatch.`,
                    phone: row.phone,
                    template_name: row.template_name,
                    event_type: row.event_type,
                    created_at: row.created_at,
                    status: row.status,
                    root_cause: 'Network worker bottleneck or database queue delay',
                    suggested_fix: 'Click "Retry" to immediately force immediate API dispatch.'
                });
            }

            // Detector C: Malformed Phone Number
            const cleanPhone = (row.phone || '').replace(/[^0-9]/g, '');
            if (!cleanPhone || cleanPhone.length < 10) {
                anomalies.push({
                    id: `mal_${row.id}`,
                    type: 'MALFORMED_PHONE',
                    severity: 'HIGH',
                    title: '🚨 Malformed Recipient Phone Number',
                    description: `Recipient phone number "${row.phone}" is invalid (<10 digits). Message rejected by Meta WhatsApp gateway.`,
                    phone: row.phone,
                    template_name: row.template_name,
                    event_type: row.event_type,
                    created_at: row.created_at,
                    status: row.status,
                    root_cause: 'Missing standard 10-digit Indian phone number',
                    suggested_fix: 'Update the user profile phone number in Settings.'
                });
            }
        });

        // Detector D: Rapid Duplicate Enqueues to Same Phone
        const phoneTemplateMap = new Map<string, typeof queueRows>();
        queueRows.forEach(r => {
            const key = `${r.phone}__${r.template_name || r.event_type}`;
            if (!phoneTemplateMap.has(key)) phoneTemplateMap.set(key, []);
            phoneTemplateMap.get(key)!.push(r);
        });

        phoneTemplateMap.forEach((rList) => {
            if (rList.length >= 2) {
                const sorted = [...rList].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                for (let i = 0; i < sorted.length - 1; i++) {
                    const diffMins = (new Date(sorted[i + 1].created_at).getTime() - new Date(sorted[i].created_at).getTime()) / (1000 * 60);
                    if (diffMins <= 10) {
                        anomalies.push({
                            id: `dup_${sorted[i + 1].id}`,
                            type: 'RAPID_DUPLICATE',
                            severity: 'MEDIUM',
                            title: '⚠️ Rapid Duplicate Message Enqueued',
                            description: `Duplicate "${sorted[i + 1].template_name || sorted[i + 1].event_type}" queued for ${sorted[i + 1].phone} within ${Math.round(diffMins)} minute(s).`,
                            phone: sorted[i + 1].phone,
                            template_name: sorted[i + 1].template_name,
                            event_type: sorted[i + 1].event_type,
                            created_at: sorted[i + 1].created_at,
                            status: sorted[i + 1].status,
                            root_cause: 'Multiple event triggers dispatched concurrently',
                            suggested_fix: 'Check event triggering rules.'
                        });
                        break;
                    }
                }
            }
        });

        return NextResponse.json({
            success: true,
            metrics: {
                totalMessages,
                sentCount,
                failedCount,
                pendingCount,
                processingCount,
                deliveryRate,
                activeTemplatesCount: templateHealthList.length,
                anomalyCount: anomalies.length
            },
            templateHealth: templateHealthList,
            anomalies: anomalies.slice(0, 25),
            queueRows
        });
    } catch (err: any) {
        console.error('[WhatsApp Analytics API] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
