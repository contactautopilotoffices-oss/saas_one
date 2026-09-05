import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface VoiceAnomalyItem {
    id: string;
    type: 'RAPID_DUPLICATE' | 'PROVIDER_FAILURE' | 'DROPPED_CALL' | 'MALFORMED_PHONE';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    recipient_phone: string;
    event_type: string;
    created_at: string;
    call_status: string;
    duration_seconds?: number;
}

/**
 * GET /api/voice/analytics?organizationId=...&limit=50&status=...&eventType=...
 * Comprehensive Voice Telephony Analytics & Anomaly Detection Gateway.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');
        const filterStatus = searchParams.get('status');
        const filterEventType = searchParams.get('eventType');
        const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);

        let query = supabaseAdmin
            .from('omnichannel_call_logs')
            .select('*')
            .order('created_at', { ascending: false });

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }
        if (filterStatus && filterStatus !== 'all') {
            query = query.eq('call_status', filterStatus);
        }
        if (filterEventType && filterEventType !== 'all') {
            query = query.eq('event_type', filterEventType);
        }

        const { data: rawLogs, error } = await query.limit(limit);
        if (error) throw error;

        const logs = rawLogs || [];

        // 1. Calculate Aggregate Metrics
        const totalCalls = logs.length;
        let completedCount = 0;
        let failedCount = 0;
        let inProgressCount = 0;
        let throttledCount = 0;
        let totalDuration = 0;
        let durationSamples = 0;

        logs.forEach(log => {
            const status = (log.call_status || '').toLowerCase();
            if (status === 'completed') completedCount++;
            else if (status === 'failed' || status === 'busy' || status === 'no_answer') failedCount++;
            else if (status === 'in_progress' || status === 'initiated') inProgressCount++;
            else if (status.includes('throttled')) throttledCount++;

            if (typeof log.duration_seconds === 'number' && log.duration_seconds > 0) {
                totalDuration += log.duration_seconds;
                durationSamples++;
            }
        });

        const successRate = totalCalls > 0 ? Math.round(((completedCount + inProgressCount) / totalCalls) * 100) : 100;
        const avgDuration = durationSamples > 0 ? Math.round(totalDuration / durationSamples) : 0;

        // 2. Anomaly & Issue Detection Engine
        const anomalies: VoiceAnomalyItem[] = [];

        // Detector A: Rapid-fire duplicate calls to same recipient (< 15 mins)
        // Group calls by recipient_phone + event_type
        const phoneEventMap = new Map<string, typeof logs>();
        logs.forEach(log => {
            const key = `${log.recipient_phone}__${log.event_type}`;
            if (!phoneEventMap.has(key)) phoneEventMap.set(key, []);
            phoneEventMap.get(key)!.push(log);
        });

        phoneEventMap.forEach((callList, key) => {
            if (callList.length >= 2) {
                // Sort chronologically
                const sorted = [...callList].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                for (let i = 0; i < sorted.length - 1; i++) {
                    const t1 = new Date(sorted[i].created_at).getTime();
                    const t2 = new Date(sorted[i + 1].created_at).getTime();
                    const diffMins = (t2 - t1) / (1000 * 60);

                    if (diffMins <= 15) {
                        anomalies.push({
                            id: `dup_${sorted[i + 1].id}`,
                            type: 'RAPID_DUPLICATE',
                            severity: 'HIGH',
                            title: '🚨 Rapid Duplicate Dialing Detected',
                            description: `Recipient ${sorted[i + 1].recipient_phone} received duplicate "${sorted[i + 1].event_type}" calls within ${Math.round(diffMins)} minute(s). Throttling guards have been enabled.`,
                            recipient_phone: sorted[i + 1].recipient_phone,
                            event_type: sorted[i + 1].event_type,
                            created_at: sorted[i + 1].created_at,
                            call_status: sorted[i + 1].call_status,
                            duration_seconds: sorted[i + 1].duration_seconds
                        });
                        break; // Avoid flood of anomaly tags for same pair
                    }
                }
            }
        });

        // Detector B: Failed Provider Outbound Calls
        logs.forEach(log => {
            const status = (log.call_status || '').toLowerCase();
            if (status === 'failed' || status === 'busy') {
                anomalies.push({
                    id: `fail_${log.id}`,
                    type: 'PROVIDER_FAILURE',
                    severity: 'MEDIUM',
                    title: '⚠️ Unreached / Provider Call Failure',
                    description: `Call to ${log.recipient_phone} for event "${log.event_type}" failed (Status: ${log.call_status}). Check caller ID and recipient carrier connectivity.`,
                    recipient_phone: log.recipient_phone,
                    event_type: log.event_type,
                    created_at: log.created_at,
                    call_status: log.call_status,
                    duration_seconds: log.duration_seconds
                });
            }
        });

        // Detector C: Dropped Calls (< 3s duration)
        logs.forEach(log => {
            if (log.call_status === 'completed' && typeof log.duration_seconds === 'number' && log.duration_seconds > 0 && log.duration_seconds < 3) {
                anomalies.push({
                    id: `drop_${log.id}`,
                    type: 'DROPPED_CALL',
                    severity: 'LOW',
                    title: '⚠️ Short / Dropped Call (<3s)',
                    description: `Call to ${log.recipient_phone} connected for only ${log.duration_seconds}s before disconnecting (likely immediate decline or voicemail hangup).`,
                    recipient_phone: log.recipient_phone,
                    event_type: log.event_type,
                    created_at: log.created_at,
                    call_status: log.call_status,
                    duration_seconds: log.duration_seconds
                });
            }
        });

        // Detector D: Malformed Phone Numbers
        logs.forEach(log => {
            const clean = (log.recipient_phone || '').replace(/[^0-9]/g, '');
            if (!clean || clean.length < 10) {
                anomalies.push({
                    id: `mal_${log.id}`,
                    type: 'MALFORMED_PHONE',
                    severity: 'HIGH',
                    title: '🚨 Malformed Recipient Phone',
                    description: `Recipient number "${log.recipient_phone}" is incomplete or invalid (<10 digits).`,
                    recipient_phone: log.recipient_phone,
                    event_type: log.event_type,
                    created_at: log.created_at,
                    call_status: log.call_status
                });
            }
        });

        // 3. Event Breakdown
        const eventBreakdown: Record<string, { total: number; success: number; failed: number }> = {};
        logs.forEach(log => {
            const ev = log.event_type || 'UNKNOWN';
            if (!eventBreakdown[ev]) eventBreakdown[ev] = { total: 0, success: 0, failed: 0 };
            eventBreakdown[ev].total++;
            const s = (log.call_status || '').toLowerCase();
            if (s === 'completed' || s === 'in_progress' || s === 'initiated') {
                eventBreakdown[ev].success++;
            } else {
                eventBreakdown[ev].failed++;
            }
        });

        return NextResponse.json({
            success: true,
            metrics: {
                totalCalls,
                completedCount,
                failedCount,
                inProgressCount,
                throttledCount,
                successRate,
                avgDurationSeconds: avgDuration,
                anomalyCount: anomalies.length
            },
            anomalies: anomalies.slice(0, 20),
            eventBreakdown,
            logs
        });
    } catch (err: any) {
        console.error('[Voice Analytics API] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
