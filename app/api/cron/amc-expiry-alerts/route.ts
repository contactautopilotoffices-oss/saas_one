import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { NotificationService } from '@/backend/services/NotificationService';
import { dailyRunKey, withAgentRun } from '@/backend/lib/agents/instrument';

/**
 * GET /api/cron/amc-expiry-alerts
 * Checks for AMC contracts expiring in 30, 15, or 7 days and sends WhatsApp alerts.
 * Auth: Bearer CRON_SECRET
 * vercel.json schedule: { "path": "/api/cron/amc-expiry-alerts", "schedule": "0 4 * * *" }
 *
 * TELEMETRY — the day's sweep is recorded as one agent run (Ira / vendors) so
 * the OEM console shows contract renewals being chased rather than an empty
 * table. Deliberate:
 *   · one step per expiry window (30d / 15d / 7d) plus a notify step only where
 *     there was actually something to alert on — a window with no contracts
 *     must not leave a "sent" line in the trace;
 *   · a sweep that alerted nobody is 'skipped', not 'succeeded';
 *   · no token counts: this job calls no model. A null reads "not measured".
 * The run is filed under the org the OEM console renders; the sweep itself
 * spans every organization, which the step detail states rather than implies.
 */

/** The org the agents are registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get today's date in IST
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        nowIST.setHours(0, 0, 0, 0);

        const ALERT_DAYS = [30, 15, 7];

        // Hoisted out of the telemetry callback: the response below is built
        // from this counter, exactly as it was before instrumentation.
        let totalAlerts = 0;

        await withAgentRun({
            orgId: DEFAULT_ORG_ID,
            agentKey: 'ira',
            module: 'vendors',
            trigger: 'cron',
            // Daily cadence ("0 4 * * *"): a Vercel retry on the same day
            // re-opens this row rather than logging a second sweep.
            runKey: dailyRunKey('amc-expiry-alerts'),
        }, async (step) => {
            let totalContracts = 0;
            let totalRecipients = 0;
            let noRecipientContracts = 0;
            const windowErrors: string[] = [];
            const perWindow: string[] = [];

            for (const days of ALERT_DAYS) {
                const targetDate = new Date(nowIST);
                targetDate.setDate(targetDate.getDate() + days);
                const targetDateStr = targetDate.toISOString().split('T')[0];

                const scan = await step(`Finding AMC contracts expiring in ${days} days`, 'fetch');

                const { data: contracts, error } = await supabaseAdmin
                    .from('amc_contracts')
                    .select('*')
                    .eq('contract_end_date', targetDateStr)
                    .not('status', 'in', '("expired","renewed")');

                if (error) {
                    console.error(`[AMC Cron] Error fetching contracts for ${days}d alert:`, error.message);
                    windowErrors.push(`${days}d: ${error.message}`);
                    await scan.fail(error, {
                        detail: { window_days: days, expiring_on: targetDateStr, table: 'amc_contracts' },
                    });
                    continue;
                }

                const found = (contracts || []).length;
                totalContracts += found;
                await scan.ok({
                    detail: {
                        window_days: days,
                        expiring_on: targetDateStr,
                        contracts: found,
                        scope: 'all organizations',
                    },
                });

                if (found === 0) {
                    perWindow.push(`${days}d: none expiring`);
                    continue;
                }

                const alert = await step(
                    `Alerting owners of ${found} contract${found === 1 ? '' : 's'} expiring in ${days} days`,
                    'notify',
                );
                let windowAlerts = 0;
                let windowRecipients = 0;
                let windowNoRecipient = 0;

                for (const contract of (contracts || [])) {
                    const recipientIds = new Set<string>();

                    // Org admins
                    const { data: orgAdmins } = await supabaseAdmin
                        .from('organization_memberships')
                        .select('user_id')
                        .eq('organization_id', contract.organization_id)
                        .in('role', ['org_super_admin', 'owner', 'admin', 'org_admin'])
                        .neq('is_active', false);
                    (orgAdmins || []).forEach((m: { user_id: string }) => recipientIds.add(m.user_id));

                    // Property admins
                    if (contract.property_id) {
                        const { data: propAdmins } = await supabaseAdmin
                            .from('property_memberships')
                            .select('user_id')
                            .eq('property_id', contract.property_id)
                            .eq('role', 'property_admin')
                            .eq('is_active', true);
                        (propAdmins || []).forEach((m: { user_id: string }) => recipientIds.add(m.user_id));
                    }

                    if (recipientIds.size === 0) {
                        windowNoRecipient++;
                        continue;
                    }

                    const expiryLabel = new Date(contract.contract_end_date + 'T12:00:00').toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                    });

                    const lines = [
                        `⚠️ *AMC Contract Expiring Soon*`,
                        ``,
                        `📋 *${contract.system_name}*`,
                        `🏭 Vendor: ${contract.vendor_name}`,
                        `📅 Expiry: ${expiryLabel}`,
                        `⏰ Expires in: ${days} days`,
                        contract.scope_of_work ? contract.scope_of_work : '',
                        ``,
                        `Please initiate renewal or replacement before expiry.`,
                    ].filter(l => l !== undefined && (l !== '' || l === '')).join('\n');

                    await WhatsAppQueueService.enqueue({
                        ticketId: '',
                        userIds: [...recipientIds],
                        message: lines,
                        eventType: 'AMC_EXPIRY_ALERT',
                    });

                    // Also send FCM push so recipients get a mobile push alert
                    await NotificationService.sendToMany([...recipientIds], {
                        propertyId: contract.property_id || '',
                        organizationId: contract.organization_id,
                        type: 'AMC_EXPIRY_ALERT',
                        title: `⚠️ AMC Expiring in ${days} Days`,
                        message: `"${contract.system_name}" (${contract.vendor_name}) expires on ${expiryLabel}. Please initiate renewal.`,
                        deepLink: `/amc`,
                        priority: days <= 7 ? 'CRITICAL' : days <= 15 ? 'HIGH' : 'NORMAL',
                    }).catch(err => console.error('[AMC Cron] FCM push error:', err));

                    totalAlerts++;
                    windowAlerts++;
                    windowRecipients += recipientIds.size;
                }

                totalRecipients += windowRecipients;
                noRecipientContracts += windowNoRecipient;
                perWindow.push(`${days}d: ${windowAlerts} of ${found} alerted`);

                await alert.ok({
                    detail: {
                        window_days: days,
                        contracts: found,
                        alerted: windowAlerts,
                        recipients: windowRecipients,
                        skipped_no_admin_resolved: windowNoRecipient,
                        channels: ['whatsapp_queue', 'fcm_push'],
                    },
                });
            }

            const windowsRead = ALERT_DAYS.length - windowErrors.length;
            const errorPrefix = windowErrors.length > 0
                ? `${windowErrors.length} of ${ALERT_DAYS.length} expiry windows could not be read (${windowErrors.join(' | ')}); `
                : '';

            if (totalAlerts === 0) {
                const reason = totalContracts === 0
                    ? `No AMC contracts expire in 30, 15 or 7 days (${windowsRead} window${windowsRead === 1 ? '' : 's'} checked). Nothing sent.`
                    : `${totalContracts} contract${totalContracts === 1 ? '' : 's'} expiring (${perWindow.join(', ')}) but no org or property admin resolved for any of them. Nothing sent.`;
                return { outcome: `${errorPrefix}${reason}`, status: 'skipped' as const };
            }

            const tail = noRecipientContracts > 0
                ? ` ${noRecipientContracts} had no admin to notify.`
                : '';
            return {
                outcome: `${errorPrefix}Alerted ${totalAlerts} of ${totalContracts} expiring AMC contracts `
                    + `(${perWindow.join(', ')}) to ${totalRecipients} recipient${totalRecipients === 1 ? '' : 's'} `
                    + `over WhatsApp and push.${tail}`,
            };
        });

        console.log(`[AMC Cron] Sent ${totalAlerts} expiry alerts`);
        return NextResponse.json({ success: true, alerts_sent: totalAlerts });
    } catch (err) {
        console.error('[AMC Cron] Error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
