import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface WhatsAppAnomalyItem {
    id: string;
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
    status: 'healthy' | 'degraded' | 'failing' | 'idle';
    primaryError?: string | null;
    suggestedFix?: string | null;
    errorSamples?: string[];
}

/**
 * Known Meta / AiSensy approved campaign parameter signatures and diagnostic causes
 */
const KNOWN_TEMPLATE_DIAGNOSTICS: Record<string, { expectedCampaign: string; paramCount: number; fix: string }> = {
    'checklist_started': {
        expectedCampaign: 'checklist_started_v1',
        paramCount: 4,
        fix: 'Meta approved campaign name is "checklist_started_v1" (4 parameters: user_name, checklist_name, property, start_time).'
    },
    'ticket_assigned_v1': {
        expectedCampaign: 'ticket_assigned_v1',
        paramCount: 7,
        fix: 'Requires exactly 7 parameters (user_name, ticket_number, title, property, priority, raised_by, raised_by_phone).'
    },
    'ticket_completed_v1': {
        expectedCampaign: 'ticket_completed_v1',
        paramCount: 5,
        fix: 'Requires exactly 5 parameters (user_name, ticket_number, title, property, resolved_by).'
    },
    'checklist_completed': {
        expectedCampaign: 'checklist_completed_v1',
        paramCount: 5,
        fix: 'Requires approved Meta campaign "checklist_completed_v1".'
    },
    'checklist_overdue_alert': {
        expectedCampaign: 'checklist_overdue_alert_v2',
        paramCount: 3,
        fix: 'Meta approved campaign name is "checklist_overdue_alert_v2" (3 parameters: checklist_name, property, slot_time).'
    }
};

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

        // 2. Meta Template Health Matrix with Error Diagnostics
        const templateMap = new Map<string, {
            total: number;
            sent: number;
            failed: number;
            pending: number;
            lastSentAt: string | null;
            eventKey: string;
            errors: Set<string>;
        }>();

        queueRows.forEach(row => {
            const tName = row.template_name || 'raw_text_message';
            if (!templateMap.has(tName)) {
                templateMap.set(tName, {
                    total: 0,
                    sent: 0,
                    failed: 0,
                    pending: 0,
                    lastSentAt: null,
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
                status,
                primaryError,
                suggestedFix,
                errorSamples: errorList.slice(0, 3)
            };
        }).sort((a, b) => b.total - a.total);

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
