import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';

/**
 * GET /api/cron/check-sop-missed
 * Runs every minute (Vercel Cron). Detects checklist slots that were missed
 * (not completed in time) and fires a WhatsApp + in-app alert to:
 *   – Staff assigned to the checklist (if assigned_to is set)
 *   – All property_admin / manager members of the property
 *   – All org_admin / org_super_admin / owner members of the organisation
 *
 * Deduplication: a row is inserted into `sop_missed_alerts(template_id, slot_time)`.
 * The unique constraint ensures each missed slot triggers at most one alert batch.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // ── 1. Mark overdue checklists as 'missed' ────────────────────────────
        await supabaseAdmin.rpc('update_missed_sop_completions');

        // ── 2. Fetch checklists that are missed but NOT YET alerted ──────────
        const { data: missedCompletions, error: fetchError } = await supabaseAdmin
            .from('sop_completions')
            .select(`
                id,
                due_at,
                template:sop_templates(
                    id, 
                    title, 
                    frequency,
                    assigned_to, 
                    property_id, 
                    organization_id
                )
            `)
            .eq('status', 'missed')
            .gte('due_at', new Date(Date.now() - 86400000).toISOString())
            .order('due_at', { ascending: false });

        if (fetchError) throw fetchError;
        if (!missedCompletions || missedCompletions.length === 0) {
            return NextResponse.json({ success: true, checked: 0, alerts_sent: 0 });
        }

        let alertsSent = 0;

        for (const completion of missedCompletions) {
            const template = completion.template as any;
            if (!template) continue;

            const freq = (template.frequency || '').toLowerCase();
            // Skip hourly checklist missed alerts to avoid repetitive spam; alert on daily, weekly, etc.
            if (freq === 'hourly' || freq.startsWith('every_') || freq.includes('hour')) {
                continue;
            }

            const slotTime = completion.due_at;

            // ── 3. Deduplicate Alerts ──────────────────────────────────────────
            const { error: insertError } = await supabaseAdmin
                .from('sop_missed_alerts')
                .insert({ 
                    template_id: template.id, 
                    slot_time: slotTime 
                });

            if (insertError) continue; // Already alerted

            // ── 4. Build Recipient List via Omnichannel Matrix ────────────────
            const assignedUsers = Array.isArray(template.assigned_to) ? template.assigned_to : [];
            const { WhatsAppRecipientResolver } = await import('@/backend/services/WhatsAppRecipientResolver');
            const { users: waUsers } = await WhatsAppRecipientResolver.resolveRecipients({
                organizationId: template.organization_id || '',
                propertyId: template.property_id,
                featureKey: 'checklist_overdue_alert',
                contextualUserIds: assignedUsers
            });

            const recipientIds = new Set<string>(waUsers.map(u => u.id));

            // ── 5. Send Notifications ─────────────────────────────────────────
            const slotLabel = new Date(slotTime).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });

            const title = '⚠️ Missed Checklist';
            const message = `"${template.title}" scheduled for ${slotLabel} was NOT completed on time.`;

            for (const userId of recipientIds) {
                try {
                    await NotificationService.send({
                        userId,
                        propertyId: template.property_id,
                        organizationId: template.organization_id ?? undefined,
                        type: 'SOP_MISSED',
                        title,
                        message,
                        deepLink: `/properties/${template.property_id}/sop?via=missed-alert`,
                    });
                    alertsSent++;
                } catch (notifErr: any) {
                    console.error(`[SOP Missed] Failed to notify user ${userId}:`, notifErr);
                }
            }

            // WhatsApp dispatch
            try {
                const { WhatsAppEventProcessor } = await import('@/backend/services/WhatsAppEventProcessor');
                await WhatsAppEventProcessor.processEvent({
                    event_type: 'SOP_OVERDUE',
                    payload: {
                        organization_id: template.organization_id,
                        property_id: template.property_id,
                        template_id: template.id,
                        template_title: template.title,
                        slot_time: slotLabel,
                        assigned_to: assignedUsers[0] || null
                    }
                });
            } catch (waErr) {
                console.error('[SOP Missed] WhatsApp dispatch error:', waErr);
            }
        }

        return NextResponse.json({ 
            success: true, 
            checked: missedCompletions.length, 
            alerts_sent: alertsSent 
        });
    } catch (error) {
        console.error('[SOP Missed Cron] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
