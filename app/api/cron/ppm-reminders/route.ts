import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { NotificationService } from '@/backend/services/NotificationService';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';

const LOCAL_TIMEZONE = 'Asia/Kolkata';

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
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
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
        const { data: orgSettings, error: orgErr } = await supabaseAdmin
            .from('organization_settings')
            .select('organization_id, notification_matrix, whatsapp_service_config');

        if (orgErr) throw orgErr;

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

        // 2. Fetch pending PPM tasks due on any target date
        const { data: tasks, error: tasksError } = await supabaseAdmin
            .from('ppm_schedules')
            .select('id, organization_id, property_id, system_name, detail_name, scope_of_work, vendor_name, location, frequency, planned_date')
            .in('planned_date', targetDates)
            .eq('status', 'pending');

        if (tasksError) throw tasksError;
        if (!tasks || tasks.length === 0) {
            return NextResponse.json({ success: true, message: 'No pending PPM tasks due on target dates', checkedDates: targetDates });
        }

        // 3. Deduplication: Fetch recent PPM reminders enqueued today
        const startOfTodayIST = new Date(`${todayDateKey}T00:00:00+05:30`).toISOString();
        const { data: queuedReminders } = await supabaseAdmin
            .from('whatsapp_queue')
            .select('entity_id')
            .in('event_type', ['REMINDER_PPM', 'PPM_REMINDER'])
            .gte('created_at', startOfTodayIST);

        const alreadySentEntityIds = new Set((queuedReminders || []).map(r => r.entity_id).filter(Boolean));

        // 4. Group tasks by (property_id, planned_date) for Consolidated Messaging
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
                continue;
            }

            const groupKey = `${propId}__${t.planned_date}`;
            if (!groupedTasks.has(groupKey)) {
                groupedTasks.set(groupKey, []);
            }
            groupedTasks.get(groupKey)!.push(t);
        }

        let totalRemindersSent = 0;
        let totalRecipientsNotified = 0;

        for (const [groupKey, propTasks] of groupedTasks.entries()) {
            if (propTasks.length === 0) continue;

            const firstTask = propTasks[0];
            const orgId = firstTask.organization_id || '';
            const propId = firstTask.property_id || '';
            const plannedDate = firstTask.planned_date;

            // Group Entity ID for deduplication
            const dedupEntityId = `ppm_${propId}_${plannedDate}`;
            if (alreadySentEntityIds.has(dedupEntityId)) {
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

                        for (const u of resolvedUsers) {
                            if (u.phone) {
                                await VoiceCallingService.triggerCall({
                                    organizationId: orgId,
                                    propertyId: propId,
                                    recipientPhone: u.phone,
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
                }

                alreadySentEntityIds.add(dedupEntityId);
                totalRemindersSent++;
                totalRecipientsNotified += recipientIds.length;
                console.log(`[PPM Reminders] Sent consolidated reminder for property ${propId} (${count} tasks due on ${formattedDateLabel})`);
            } catch (err: any) {
                console.error(`[PPM Reminders] Error for group ${groupKey}:`, err.message);
            }
        }

        return NextResponse.json({
            success: true,
            tasksEvaluated: tasks.length,
            groupsProcessed: groupedTasks.size,
            remindersSent: totalRemindersSent,
            recipientsNotified: totalRecipientsNotified,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[PPM Reminders Cron] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
