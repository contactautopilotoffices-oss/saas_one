import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { NotificationService } from '@/backend/services/NotificationService';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';
import { dailyRunKey, withAgentRun } from '@/backend/lib/agents/instrument';

const LOCAL_TIMEZONE = 'Asia/Kolkata';

/** The org the agents are registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/**
 * GET /api/cron/ppm-reminders
 * Runs daily via Vercel Cron (e.g. 9:00 AM IST).
 * Manages Preventive Maintenance (PPM) schedule reminders:
 * 1. Dynamically reads reminder lead time (days/minutes) from Omnichannel Settings & property overrides.
 * 2. Finds all pending PPM tasks due on the target date.
 * 3. Consolidates multiple tasks for the same property into ONE clean WhatsApp message & In-App notification.
 * 4. Resolves recipients (roles & specific users) directly from Omnichannel Notification Matrix.
 * 5. Dispatches automated Voice Calls if voice channel is enabled in Omnichannel matrix.
 * 6. Deduplicates so no property receives multiple reminders on the same day.
 *
 * vercel.json schedule: { "path": "/api/cron/ppm-reminders", "schedule": "30 3 * * *" }
 *
 * TELEMETRY — the day's sweep is recorded as one agent run (Pratiksha / ppm) so
 * the OEM console shows maintenance being chased rather than an empty table.
 * Deliberate:
 *   · every counter the response reports is computed by the job and read back
 *     out here, so the wrapper cannot change what the cron returns;
 *   · a sweep that sent nothing is 'skipped', not 'succeeded' — a no-op must
 *     not read as work, and this job legitimately no-ops on quiet days;
 *   · no token counts: this job calls no model. A null reads "not measured";
 *     a zero would claim we measured and it was free.
 * The run is filed under the org the OEM console renders; the sweep itself
 * spans every organization, which the step detail states rather than implies.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Hoisted out of the telemetry callback: the responses below are built
        // from these, exactly as they were before instrumentation.
        let checkedDates: string[] = [];
        let noPendingTasks = false;
        let tasksEvaluated = 0;
        let groupsProcessed = 0;
        let totalRemindersSent = 0;
        let totalRecipientsNotified = 0;

        await withAgentRun({
            orgId: DEFAULT_ORG_ID,
            agentKey: 'pratiksha',
            module: 'ppm',
            trigger: 'cron',
            // Daily cadence ("30 3 * * *"): a Vercel retry on the same day
            // re-opens this row rather than logging a second sweep.
            runKey: dailyRunKey('ppm-reminders'),
        }, async (step) => {
            const now = new Date();
            const istFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: LOCAL_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            const parts = istFormatter.formatToParts(now);
            const partMap: Record<string, string> = {};
            parts.forEach(p => { partMap[p.type] = p.value; });

            const istYear = parseInt(partMap.year, 10);
            const istMonth = parseInt(partMap.month, 10) - 1;
            const istDay = parseInt(partMap.day, 10);
            const todayDateKey = `${partMap.year}-${partMap.month}-${partMap.day}`;

            // 1. Fetch organization settings for dynamic lead time & matrix
            const settingsStep = await step('Reading omnichannel notification matrices', 'fetch');
            const { data: orgSettings, error: orgErr } = await supabaseAdmin
                .from('organization_settings')
                .select('organization_id, notification_matrix, whatsapp_service_config');

            if (orgErr) {
                await settingsStep.fail(orgErr, { detail: { table: 'organization_settings' } });
                throw orgErr;
            }
            await settingsStep.ok({
                detail: {
                    organizations: (orgSettings || []).length,
                    today_ist: todayDateKey,
                    scope: 'all organizations',
                },
            });

            // Build target dates set covering upcoming 1 to 7 days
            const targetDatesSet = new Set<string>();
            for (let d = 1; d <= 7; d++) {
                const targetDateObj = new Date(istYear, istMonth, istDay + d);
                const tYear = targetDateObj.getFullYear();
                const tMonth = String(targetDateObj.getMonth() + 1).padStart(2, '0');
                const tDay = String(targetDateObj.getDate()).padStart(2, '0');
                targetDatesSet.add(`${tYear}-${tMonth}-${tDay}`);
            }

            const targetDates = Array.from(targetDatesSet);
            checkedDates = targetDates;

            // 2. Fetch pending PPM tasks due on any target date
            const tasksStep = await step('Finding pending PPM tasks due in the next 7 days', 'fetch');
            const { data: tasks, error: tasksError } = await supabaseAdmin
                .from('ppm_schedules')
                .select('id, organization_id, property_id, system_name, detail_name, scope_of_work, vendor_name, location, frequency, planned_date')
                .in('planned_date', targetDates)
                .eq('status', 'pending');

            if (tasksError) {
                await tasksStep.fail(tasksError, { detail: { table: 'ppm_schedules', window_dates: targetDates.length } });
                throw tasksError;
            }
            await tasksStep.ok({
                detail: {
                    window_dates: targetDates.length,
                    window: `${targetDates[0]} → ${targetDates[targetDates.length - 1]}`,
                    pending_tasks: (tasks || []).length,
                },
            });

            if (!tasks || tasks.length === 0) {
                noPendingTasks = true;
                return {
                    outcome: `No pending PPM tasks fall in the next 7 days (${targetDates.length} dates checked). Nothing sent.`,
                    status: 'skipped' as const,
                };
            }

            tasksEvaluated = tasks.length;

            // 3. Deduplication: Fetch recent PPM reminders enqueued today
            const dedupStep = await step('Reading PPM reminders already queued today', 'fetch');
            const startOfTodayIST = new Date(`${todayDateKey}T00:00:00+05:30`).toISOString();
            const { data: queuedReminders } = await supabaseAdmin
                .from('whatsapp_queue')
                .select('entity_id')
                .in('event_type', ['REMINDER_PPM', 'PPM_REMINDER'])
                .gte('created_at', startOfTodayIST);

            const alreadySentEntityIds = new Set((queuedReminders || []).map(r => r.entity_id).filter(Boolean));
            await dedupStep.ok({
                detail: { queued_today: alreadySentEntityIds.size, since: startOfTodayIST },
            });

            // 4. Group tasks by (property_id, planned_date) for Consolidated Messaging
            const groupStep = await step('Matching each task to its configured lead time', 'think');
            let outsideLeadTime = 0;
            const groupedTasks = new Map<string, typeof tasks>();
            for (const t of tasks) {
                const orgId = t.organization_id || '';
                const propId = t.property_id || 'global';

                // Resolve property override or global matrix lead days
                const orgData = (orgSettings || []).find(os => os.organization_id === orgId);
                const matrix = orgData?.notification_matrix || {};
                const ppmRule = matrix?.ppm?.reminder_ppm || (orgData as any)?.whatsapp_service_config?.reminder_ppm;
                const activePpmRule = ppmRule?.property_overrides?.[propId] || ppmRule;
                const minutes = activePpmRule?.reminder_minutes;
                const requiredLeadDays = typeof minutes === 'number' && minutes > 0 ? Math.max(1, Math.round(minutes / 1440)) : 1;

                // Check if this task's planned_date matches the configured lead days
                const expectedDateObj = new Date(istYear, istMonth, istDay + requiredLeadDays);
                const expDateKey = `${expectedDateObj.getFullYear()}-${String(expectedDateObj.getMonth() + 1).padStart(2, '0')}-${String(expectedDateObj.getDate()).padStart(2, '0')}`;

                if (t.planned_date !== expDateKey) {
                    // Task is due on a different date than this property's configured alert lead time
                    outsideLeadTime++;
                    continue;                }

                const groupKey = `${propId}__${t.planned_date}`;
                if (!groupedTasks.has(groupKey)) {
                    groupedTasks.set(groupKey, []);
                }
                groupedTasks.get(groupKey)!.push(t);
            }

            groupsProcessed = groupedTasks.size;
            const tasksInWindow = tasks.length - outsideLeadTime;
            await groupStep.ok({
                detail: {
                    pending_tasks: tasks.length,
                    due_at_configured_lead_time: tasksInWindow,
                    outside_lead_time: outsideLeadTime,
                    property_date_groups: groupedTasks.size,
                },
            });

            let skippedAlreadySent = 0;
            let skippedNoRecipients = 0;
            let groupsErrored = 0;

            const dispatchStep = await step(
                `Dispatching consolidated reminders for ${groupedTasks.size} property/date group${groupedTasks.size === 1 ? '' : 's'}`,
                'notify',
            );

            for (const [groupKey, propTasks] of groupedTasks.entries()) {
                if (propTasks.length === 0) continue;

                const firstTask = propTasks[0];
                const orgId = firstTask.organization_id || '';
                const propId = firstTask.property_id || '';
                const plannedDate = firstTask.planned_date;

                // Group Entity ID for deduplication
                const dedupEntityId = `ppm_${propId}_${plannedDate}`;
                if (alreadySentEntityIds.has(dedupEntityId)) {
                    skippedAlreadySent++;
                    continue; // Already sent today for this property and date
                }

                // Resolve property override active rule for Voice and channels
                const orgData = (orgSettings || []).find(os => os.organization_id === orgId);
                const matrix = orgData?.notification_matrix || {};
                const ppmRule = matrix?.ppm?.reminder_ppm || (orgData as any)?.whatsapp_service_config?.reminder_ppm;
                const activePpmRule = ppmRule?.property_overrides?.[propId] || ppmRule;

                // 5. Resolve Recipients via Omnichannel Matrix
                const { users: resolvedUsers } = await WhatsAppRecipientResolver.resolveRecipients({
                    organizationId: orgId,
                    propertyId: propId,
                    featureKey: 'reminder_ppm'
                });

                const recipientIds = Array.from(new Set(resolvedUsers.map(u => u.id)));
                if (recipientIds.length === 0) {
                    skippedNoRecipients++;
                    console.log(`[PPM Cron] No recipients resolved via Omnichannel for property ${propId}`);
                    continue;
                }

                // Format clean consolidated strings
                const count = propTasks.length;
                let consolidatedSystem = '';
                if (count === 1) {
                    consolidatedSystem = propTasks[0].system_name + (propTasks[0].detail_name ? ` (${propTasks[0].detail_name})` : '');
                } else if (count === 2) {
                    consolidatedSystem = `${propTasks[0].system_name}, ${propTasks[1].system_name} (2 Tasks)`;
                } else {
                    consolidatedSystem = `${propTasks[0].system_name}, ${propTasks[1].system_name} & ${count - 2} more (${count} Tasks)`;
                }

                const uniqueVendors = Array.from(new Set(propTasks.map(t => t.vendor_name).filter(Boolean)));
                const vendorLabel = uniqueVendors.length > 0 ? uniqueVendors.slice(0, 2).join(', ') : 'Assigned Vendors';

                const uniqueLocations = Array.from(new Set(propTasks.map(t => t.location).filter(Boolean)));
                const locationLabel = uniqueLocations.length > 0 ? uniqueLocations.slice(0, 2).join(', ') : 'Site Equipment Areas';

                const formattedDateLabel = new Date(plannedDate).toLocaleDateString('en-IN', {
                    timeZone: LOCAL_TIMEZONE,
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                });

                try {
                    // A. Dispatch Push Notifications to all resolved Omnichannel recipients
                    await NotificationService.sendToMany(recipientIds, {
                        propertyId: propId,
                        organizationId: orgId,
                        type: 'PPM_REMINDER',
                        title: count > 1 ? `Upcoming Maintenance Tasks (${count}) 🔧` : `Upcoming PPM: ${propTasks[0].system_name} 🔧`,
                        message: `${consolidatedSystem} maintenance is due on ${formattedDateLabel}. Please arrange vendors and site clearance.`,
                        deepLink: `/ppm?date=${plannedDate}`,
                        priority: 'HIGH',
                    });

                    // B. Dispatch WhatsApp Notification (1 consolidated template message)
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'REMINDER_PPM',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            entity_id: dedupEntityId,
                            system_name: consolidatedSystem,
                            due_date: formattedDateLabel,
                            vendor_name: vendorLabel,
                            location: locationLabel
                        }
                    });

// C. Dispatch Voice Call if voice channel is enabled in Omnichannel matrix
                    try {
                        const isVoiceEnabled = (activePpmRule?.channels?.voice !== undefined)
                            ? (activePpmRule.channels.voice === true)
                            : (ppmRule?.channels?.voice === true);
                        if (isVoiceEnabled && resolvedUsers.length > 0) {
                            const { data: propData } = await supabaseAdmin.from('properties').select('name').eq('id', propId).maybeSingle();
                            const propertyName = propData?.name || 'Site Property';

                            const seenVoicePhones = new Set<string>();
                            for (const u of resolvedUsers) {
                                const cleanPhone = u.phone ? VoiceCallingService.formatPhone(u.phone) : '';
                                if (cleanPhone && cleanPhone.length >= 10 && !seenVoicePhones.has(cleanPhone)) {
                                    seenVoicePhones.add(cleanPhone);
                                    await VoiceCallingService.triggerCall({
                                        organizationId: orgId,
                                        propertyId: propId,
                                        recipientPhone: cleanPhone,
                                        recipientUserId: u.id,
                                        eventType: 'REMINDER_PPM',
                                        customTemplate: activePpmRule?.voice_template || ppmRule?.voice_template,
                                        voiceId: activePpmRule?.voice_id || ppmRule?.voice_id,
                                        speechSpeed: activePpmRule?.speech_speed || ppmRule?.speech_speed,
                                        variables: {
                                            userName: u.name || 'Staff',
                                            systemName: consolidatedSystem,
                                            propertyName: propertyName,
                                            dueDate: formattedDateLabel
                                        }
                                    });
                                }
                            }
                        }
                    } catch (voiceErr: any) {
                        console.error('[PPM Reminders] Voice call error for group:', voiceErr.message);
                        console.error('[PPM Reminders] Voice call error for group:', voiceErr.message);
                    }

                    alreadySentEntityIds.add(dedupEntityId);
                    totalRemindersSent++;
                    totalRecipientsNotified += recipientIds.length;
                    console.log(`[PPM Reminders] Sent consolidated reminder for property ${propId} (${count} tasks due on ${formattedDateLabel})`);
                } catch (err: any) {
                    groupsErrored++;
                    console.error(`[PPM Reminders] Error for group ${groupKey}:`, err.message);
                }
            }

            await dispatchStep.end(groupsErrored > 0 ? 'failed' : 'ok', {
                detail: {
                    groups: groupedTasks.size,
                    reminders_sent: totalRemindersSent,
                    recipients_notified: totalRecipientsNotified,
                    skipped_already_reminded_today: skippedAlreadySent,
                    skipped_no_recipient_configured: skippedNoRecipients,
                    groups_errored: groupsErrored,
                    channels: ['fcm_push', 'whatsapp', 'voice_if_enabled'],
                },
            });

            const errorTail = groupsErrored > 0
                ? ` ${groupsErrored} group${groupsErrored === 1 ? '' : 's'} errored mid-dispatch.`
                : '';

            if (totalRemindersSent === 0) {
                return {
                    outcome: `${tasks.length} pending PPM task${tasks.length === 1 ? '' : 's'} in the next 7 days, `
                        + `${tasksInWindow} at their configured lead time in ${groupedTasks.size} group${groupedTasks.size === 1 ? '' : 's'} — `
                        + `${skippedAlreadySent} already reminded today, ${skippedNoRecipients} with no recipient configured. `
                        + `Nothing sent.${errorTail}`,
                    status: 'skipped' as const,
                };
            }

            return {
                outcome: `Reminded ${totalRemindersSent} of ${groupedTasks.size} property/date group${groupedTasks.size === 1 ? '' : 's'} `
                    + `about ${tasksInWindow} upcoming PPM task${tasksInWindow === 1 ? '' : 's'}, reaching `
                    + `${totalRecipientsNotified} recipient${totalRecipientsNotified === 1 ? '' : 's'}; `
                    + `${skippedAlreadySent} already reminded today, ${skippedNoRecipients} had no recipient configured.${errorTail}`,
            };
        });

        if (noPendingTasks) {
            return NextResponse.json({ success: true, message: 'No pending PPM tasks due on target dates', checkedDates });
        }

        return NextResponse.json({
            success: true,
            tasksEvaluated,
            groupsProcessed,
            remindersSent: totalRemindersSent,
            recipientsNotified: totalRecipientsNotified,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[PPM Reminders Cron] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
