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

            const slotTime = completion.due_at;

            // ── 3. Deduplicate Alerts ──────────────────────────────────────────
            const { error: insertError } = await supabaseAdmin
                .from('sop_missed_alerts')
                .insert({ 
                    template_id: template.id, 
                    slot_time: slotTime 
                });

            if (insertError) continue; // Already alerted

            // ── 4. Build Recipient List ───────────────────────────────────────
            const recipientIds = new Set<string>();

            if (Array.isArray(template.assigned_to)) {
                template.assigned_to.forEach((uid: string) => recipientIds.add(uid));
            }

            const { data: propMembers } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id')
                .eq('property_id', template.property_id)
                .in('role', ['property_admin', 'manager'])
                .eq('is_active', true);
            propMembers?.forEach(m => recipientIds.add(m.user_id));

            if (template.organization_id) {
                const { data: orgMembers } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id')
                    .eq('organization_id', template.organization_id)
                    .in('role', ['org_admin', 'org_super_admin', 'owner'])
                    .eq('is_active', true);
                orgMembers?.forEach(m => recipientIds.add(m.user_id));
            }

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
