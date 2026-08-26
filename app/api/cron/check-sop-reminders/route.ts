import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';

const LOCAL_TIMEZONE = 'Asia/Kolkata';

/** Helper: formats a 24-hr time string (e.g. "09:00:00" or "09:00") into 12-hr format (e.g. "09:00 AM") */
function format12h(timeStr?: string | null): string {
    if (!timeStr) return 'Scheduled Time';
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    if (isNaN(h)) return timeStr;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${m.padStart(2, '0')} ${period}`;
}

/**
 * GET /api/cron/check-sop-reminders
 * Runs every 1-5 minutes via Vercel Cron.
 * Manages the automated SOP Checklist notification lifecycle with group consolidation:
 * 1. Pre-start reminder (X mins before start_time, dynamically configured in Omnichannel settings)
 * 2. Shift started alert (at start_time)
 * 3. Overdue / Missed alert (after end_time if incomplete)
 * 
 * Rules:
 * - Active for Daily, Weekly, and Monthly checklists.
 * - Hourly checklists ('hourly', 'every_1_hour', etc.) and on_demand are strictly EXCLUDED to avoid spam.
 * - Consolidated Grouping: Checklists on the same property with the same shift time are consolidated into 1 message.
 * - Dynamic Recipient Resolution: Resolves target roles & specific users configured in Omnichannel settings.
 * - Plivo Voice Calling: Plivo dials configured recipients directly with natural operational voice prompts.
 * - Deduplication: Uses whatsapp_queue lookback for today's date in IST to guarantee 0 duplicates.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();

        // 1. Calculate current time in IST
        const istFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: LOCAL_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = istFormatter.formatToParts(now);
        const partMap: Record<string, string> = {};
        parts.forEach(p => { partMap[p.type] = p.value; });

        const istYear = partMap.year;
        const istMonth = partMap.month;
        const istDay = partMap.day;
        const dateKey = `${istYear}-${istMonth}-${istDay}`; // e.g. "2026-08-25"
        const currentHour = parseInt(partMap.hour, 10);
        const currentMinute = parseInt(partMap.minute, 10);
        const currentMins = currentHour * 60 + currentMinute; // minutes from midnight IST

        // Start of today in IST as ISO string for querying today's queue/completions
        const startOfTodayIST = new Date(`${dateKey}T00:00:00+05:30`).toISOString();

        // 2. Fetch all active running SOP templates
        const { data: templates, error: templatesError } = await supabaseAdmin
            .from('sop_templates')
            .select('id, title, frequency, start_time, end_time, assigned_to, property_id, organization_id, is_running')
            .eq('is_active', true)
            .neq('frequency', 'on_demand');

        if (templatesError) throw templatesError;
        if (!templates || templates.length === 0) {
            return NextResponse.json({ success: true, checked: 0, dispatched: 0 });
        }

        // Filter out hourly frequencies to prevent spamming
        const validTemplates = templates.filter(t => {
            const freq = (t.frequency || '').toLowerCase();
            const isHourly = freq === 'hourly' || freq.startsWith('every_') || freq.includes('hour');
            return !isHourly;
        });

        if (validTemplates.length === 0) {
            return NextResponse.json({ success: true, checked: 0, dispatched: 0 });
        }

        const templateIds = validTemplates.map(t => t.id);

        // 3. Parallel fetch:
        // A. Today's enqueued WhatsApp reminder events (for deduplication)
        // B. Today's completed checklists in sop_completions
        // C. Organization settings for dynamic reminder_minutes lead times
        const [queueRes, completionsRes, orgSettingsRes] = await Promise.all([
            supabaseAdmin
                .from('whatsapp_queue')
                .select('entity_id, event_type')
                .in('entity_id', templateIds)
                .gte('created_at', startOfTodayIST),
            supabaseAdmin
                .from('sop_completions')
                .select('template_id, status, completed_at, completion_date')
                .in('template_id', templateIds)
                .gte('created_at', startOfTodayIST),
            supabaseAdmin
                .from('organization_settings')
                .select('organization_id, notification_matrix, whatsapp_service_config')
        ]);

        // Build deduplication sets
        const enqueuedEventsMap = new Map<string, Set<string>>(); // templateId -> Set of event_types already queued today
        (queueRes.data || []).forEach(row => {
            if (!row.entity_id) return;
            if (!enqueuedEventsMap.has(row.entity_id)) {
                enqueuedEventsMap.set(row.entity_id, new Set());
            }
            enqueuedEventsMap.get(row.entity_id)!.add(row.event_type);
        });

        // Build completions map for today
        const completedTemplateIds = new Set<string>();
        (completionsRes.data || []).forEach(c => {
            if (c.status === 'completed' || c.completed_at) {
                completedTemplateIds.add(c.template_id);
            }
        });

        // Build org reminder_minutes map
        const orgReminderMinutesMap = new Map<string, number>();
        (orgSettingsRes.data || []).forEach(os => {
            const matrix = os.notification_matrix || {};
            const checklistRule = matrix?.checklists?.checklist_slot_reminder || os?.whatsapp_service_config?.checklist_slot_reminder;
            const minutes = checklistRule?.reminder_minutes;
            if (typeof minutes === 'number' && minutes > 0) {
                orgReminderMinutesMap.set(os.organization_id, minutes);
            }
        });

        // 4. GROUP TEMPLATES by (property_id, rawStartTime, rawEndTime) for Consolidated Messaging
        const groupedTemplates = new Map<string, typeof validTemplates>();
        for (const template of validTemplates) {
            const propId = template.property_id || 'global';
            const rawStartTime = (template.start_time || '09:00:00').slice(0, 5);
            const rawEndTime = (template.end_time || '18:00:00').slice(0, 5);
            const groupKey = `${propId}__${rawStartTime}__${rawEndTime}`;
            if (!groupedTemplates.has(groupKey)) {
                groupedTemplates.set(groupKey, []);
            }
            groupedTemplates.get(groupKey)!.push(template);
        }

        let remindersDispatched = 0;
        let startAlertsDispatched = 0;
        let overdueAlertsDispatched = 0;

        for (const [, group] of groupedTemplates.entries()) {
            if (group.length === 0) continue;

            const firstTemplate = group[0];
            const orgId = firstTemplate.organization_id || '';
            const propId = firstTemplate.property_id || '';

            // Default times for the group
            const rawStartTime = (firstTemplate.start_time || '09:00:00').slice(0, 5);
            const rawEndTime = (firstTemplate.end_time || '18:00:00').slice(0, 5);

            const [sH, sM] = rawStartTime.split(':').map(Number);
            const [eH, eM] = rawEndTime.split(':').map(Number);

            const startMins = sH * 60 + sM;
            const endMins = eH * 60 + eM;

            // Dynamic configured reminder lead time from Omnichannel settings (default 10 mins)
            const configuredLeadMins = orgReminderMinutesMap.get(orgId) || 10;
            const preStartMins = startMins - configuredLeadMins;
            const isOvernight = endMins <= startMins;

            // Fetch property name for friendly voice/text dispatch
            const { data: propData } = await supabaseAdmin.from('properties').select('name').eq('id', propId).maybeSingle();
            const propertyName = propData?.name || 'Site Facility';

            // Format consolidated checklist title
            const count = group.length;
            let groupTitle = '';
            if (count === 1) {
                groupTitle = group[0].title;
            } else if (count === 2) {
                groupTitle = `${group[0].title}, ${group[1].title} (2 Checklists)`;
            } else {
                groupTitle = `${group[0].title}, ${group[1].title} & ${count - 2} more (${count} Checklists)`;
            }

            // Check deduplication across all templates in this group
            const hasSentPreStart = group.some(t => {
                const sent = enqueuedEventsMap.get(t.id);
                return sent && (sent.has('CHECKLIST_SLOT_REMINDER') || sent.has('SOP_REMINDER'));
            });

            const hasSentStarted = group.some(t => {
                const sent = enqueuedEventsMap.get(t.id);
                return sent && (sent.has('CHECKLIST_STARTED') || sent.has('SOP_STARTED'));
            });

            // ─────────────────────────────────────────────────────────────────
            // STAGE 1: PRE-START REMINDER (Consolidated for the shift group)
            // ─────────────────────────────────────────────────────────────────
            const isInPreStartWindow = currentMins >= preStartMins && currentMins < startMins;

            if (isInPreStartWindow && !hasSentPreStart) {
                const formattedStartTime = format12h(rawStartTime);
                const leadTimeText = `${configuredLeadMins} mins`;

                try {
                    // Resolve dynamic recipients from Omnichannel Matrix
                    const { users: reminderRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                        organizationId: orgId,
                        propertyId: propId,
                        featureKey: 'checklist_slot_reminder'
                    });

                    const recipientIds = Array.from(new Set(reminderRecipients.map(u => u.id)));

                    // 1. Dispatch in-app notifications
                    if (recipientIds.length > 0) {
                        await NotificationService.sendToMany(recipientIds, {
                            propertyId: propId,
                            organizationId: orgId,
                            type: 'SOP_REMINDER',
                            title: count > 1 ? `Checklists Starting Soon (${count}) 📋` : 'Checklist Starting Soon 📋',
                            message: `"${groupTitle}" shift starts in ${leadTimeText} at ${formattedStartTime}.`,
                            deepLink: `/properties/${propId}/sop`,
                            priority: 'HIGH',
                        });
                    }

                    // 2. Dispatch WhatsApp notification (1 consolidated message)
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'CHECKLIST_SLOT_REMINDER',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            template_id: firstTemplate.id,
                            template_title: groupTitle,
                            due_time: `${formattedStartTime} (in ${leadTimeText})`,
                            assigned_to: recipientIds[0] || null
                        }
                    });

                    // 3. Dispatch Voice Call if voice channel is enabled in Omnichannel matrix
                    try {
                        const orgMatrix = (orgSettingsRes.data || []).find(os => os.organization_id === orgId)?.notification_matrix || {};
                        const reminderRule = orgMatrix?.checklists?.checklist_slot_reminder;
                        const isVoiceEnabled = reminderRule?.channels?.voice === true;

                        if (isVoiceEnabled && reminderRecipients.length > 0) {
                            for (const u of reminderRecipients) {
                                if (u.phone) {
                                    await VoiceCallingService.triggerCall({
                                        organizationId: orgId,
                                        propertyId: propId,
                                        recipientPhone: u.phone,
                                        recipientUserId: u.id,
                                        eventType: 'CHECKLIST_SLOT_REMINDER',
                                        customTemplate: reminderRule?.voice_template,
                                        voiceId: reminderRule?.voice_id,
                                        speechSpeed: reminderRule?.speech_speed,
                                        variables: {
                                            userName: u.name || 'Staff',
                                            checklistTitle: groupTitle,
                                            propertyName: propertyName,
                                            shiftTime: formattedStartTime
                                        }
                                    });
                                }
                            }
                        }
                    } catch (voiceErr: any) {
                        console.error('[SOP Reminders] Pre-start voice call error:', voiceErr.message);
                    }

                    // Mark all templates in group as sent
                    group.forEach(t => {
                        if (!enqueuedEventsMap.has(t.id)) enqueuedEventsMap.set(t.id, new Set());
                        enqueuedEventsMap.get(t.id)!.add('CHECKLIST_SLOT_REMINDER');
                    });

                    remindersDispatched++;
                    console.log(`[SOP Reminders] Sent consolidated pre-start reminder for "${groupTitle}" (starts in ${leadTimeText} at ${formattedStartTime})`);
                } catch (err: any) {
                    console.error(`[SOP Reminders] Pre-start error for group ${groupTitle}:`, err.message);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // STAGE 2: EXACT START TIME ALERT (Consolidated for the shift group)
            // ─────────────────────────────────────────────────────────────────
            const isInStartedWindow = isOvernight 
                ? (currentMins >= startMins || currentMins < endMins)
                : (currentMins >= startMins && currentMins < endMins);

            if (isInStartedWindow && !hasSentStarted) {
                const formattedStartTime = format12h(rawStartTime);

                try {
                    // Resolve dynamic recipients from Omnichannel Matrix
                    const { users: startedRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                        organizationId: orgId,
                        propertyId: propId,
                        featureKey: 'checklist_started'
                    });

                    const recipientIds = Array.from(new Set(startedRecipients.map(u => u.id)));

                    // 1. Dispatch in-app notifications
                    if (recipientIds.length > 0) {
                        await NotificationService.sendToMany(recipientIds, {
                            propertyId: propId,
                            organizationId: orgId,
                            type: 'SOP_STARTED',
                            title: count > 1 ? `Checklists Shift Started (${count}) 🚀` : 'Checklist Shift Started 🚀',
                            message: `"${groupTitle}" shift has started (${formattedStartTime}). Please begin your inspection rounds.`,
                            deepLink: `/properties/${propId}/sop`,
                            priority: 'HIGH',
                        });
                    }

                    // 2. Dispatch WhatsApp notification (1 consolidated message)
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'CHECKLIST_STARTED',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            template_id: firstTemplate.id,
                            template_title: groupTitle,
                            start_time: formattedStartTime,
                            assigned_to: recipientIds[0] || null
                        }
                    });

                    // 3. Dispatch Voice Call if voice channel is enabled in Omnichannel matrix
                    try {
                        const orgMatrix = (orgSettingsRes.data || []).find(os => os.organization_id === orgId)?.notification_matrix || {};
                        const startedRule = orgMatrix?.checklists?.checklist_started;
                        const isVoiceEnabled = startedRule?.channels?.voice === true;

                        if (isVoiceEnabled && startedRecipients.length > 0) {
                            for (const u of startedRecipients) {
                                if (u.phone) {
                                    await VoiceCallingService.triggerCall({
                                        organizationId: orgId,
                                        propertyId: propId,
                                        recipientPhone: u.phone,
                                        recipientUserId: u.id,
                                        eventType: 'CHECKLIST_STARTED',
                                        customTemplate: startedRule?.voice_template,
                                        voiceId: startedRule?.voice_id,
                                        speechSpeed: startedRule?.speech_speed,
                                        variables: {
                                            userName: u.name || 'Staff',
                                            checklistTitle: groupTitle,
                                            propertyName: propertyName,
                                            shiftTime: formattedStartTime
                                        }
                                    });
                                }
                            }
                        }
                    } catch (voiceErr: any) {
                        console.error('[SOP Reminders] Started voice call error:', voiceErr.message);
                    }

                    // Mark all templates in group as sent
                    group.forEach(t => {
                        if (!enqueuedEventsMap.has(t.id)) enqueuedEventsMap.set(t.id, new Set());
                        enqueuedEventsMap.get(t.id)!.add('CHECKLIST_STARTED');
                    });

                    startAlertsDispatched++;
                    console.log(`[SOP Reminders] Sent consolidated shift started alert for "${groupTitle}" at ${formattedStartTime}`);
                } catch (err: any) {
                    console.error(`[SOP Reminders] Started alert error for group ${groupTitle}:`, err.message);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // STAGE 3: OVERDUE / MISSED ALERT (Consolidated for incomplete items)
            // ─────────────────────────────────────────────────────────────────
            const isAfterEndTime = isOvernight
                ? (currentMins >= endMins && currentMins < startMins)
                : (currentMins >= endMins);

            if (isAfterEndTime) {
                const incompleteTemplates = group.filter(t => !completedTemplateIds.has(t.id));

                if (incompleteTemplates.length > 0) {
                    const hasSentOverdue = incompleteTemplates.some(t => {
                        const sent = enqueuedEventsMap.get(t.id);
                        return sent && (sent.has('CHECKLIST_OVERDUE') || sent.has('CHECKLIST_OVERDUE_ALERT') || sent.has('SOP_OVERDUE') || sent.has('SOP_MISSED'));
                    });

                    if (!hasSentOverdue) {
                        const slotWindowLabel = `${format12h(rawStartTime)} – ${format12h(rawEndTime)}`;
                        const incCount = incompleteTemplates.length;
                        let overdueTitle = '';
                        if (incCount === 1) {
                            overdueTitle = incompleteTemplates[0].title;
                        } else if (incCount === 2) {
                            overdueTitle = `${incompleteTemplates[0].title}, ${incompleteTemplates[1].title} (2 Checklists)`;
                        } else {
                            overdueTitle = `${incompleteTemplates[0].title}, ${incompleteTemplates[1].title} & ${incCount - 2} more (${incCount} Checklists)`;
                        }

                        try {
                            // Resolve dynamic recipients from Omnichannel Matrix (roles + assigned managers)
                            const { users: overdueRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                                organizationId: orgId,
                                propertyId: propId,
                                featureKey: 'checklist_overdue_alert'
                            });

                            const recipientIds = Array.from(new Set(overdueRecipients.map(u => u.id)));

                            // 1. Dispatch in-app notifications
                            if (recipientIds.length > 0) {
                                await NotificationService.sendToMany(recipientIds, {
                                    propertyId: propId,
                                    organizationId: orgId,
                                    type: 'SOP_MISSED',
                                    title: incCount > 1 ? `⚠️ Incomplete Checklists Alert (${incCount})` : '⚠️ Missed Checklist Alert',
                                    message: `"${overdueTitle}" scheduled for ${slotWindowLabel} was NOT completed on time.`,
                                    deepLink: `/properties/${propId}/sop`,
                                    priority: 'HIGH',
                                });
                            }

                            // 2. Dispatch WhatsApp notification (1 consolidated message)
                            await WhatsAppEventProcessor.processEvent({
                                event_type: 'CHECKLIST_OVERDUE',
                                payload: {
                                    organization_id: orgId,
                                    property_id: propId,
                                    template_id: incompleteTemplates[0].id,
                                    template_title: overdueTitle,
                                    slot_time: slotWindowLabel,
                                    assigned_to: recipientIds[0] || null
                                }
                            });

                            // 3. Dispatch Voice Call if voice channel is enabled in Omnichannel matrix
                            try {
                                const orgMatrix = (orgSettingsRes.data || []).find(os => os.organization_id === orgId)?.notification_matrix || {};
                                const overdueRule = orgMatrix?.checklists?.checklist_overdue_alert;
                                const isVoiceEnabled = overdueRule?.channels?.voice === true;

                                if (isVoiceEnabled && overdueRecipients.length > 0) {
                                    for (const u of overdueRecipients) {
                                        if (u.phone) {
                                            await VoiceCallingService.triggerCall({
                                                organizationId: orgId,
                                                propertyId: propId,
                                                recipientPhone: u.phone,
                                                recipientUserId: u.id,
                                                eventType: 'CHECKLIST_OVERDUE',
                                                customTemplate: overdueRule?.voice_template,
                                                voiceId: overdueRule?.voice_id,
                                                speechSpeed: overdueRule?.speech_speed,
                                                variables: {
                                                    userName: u.name || 'Staff',
                                                    checklistTitle: overdueTitle,
                                                    propertyName: propertyName,
                                                    shiftTime: slotWindowLabel
                                                }
                                            });
                                        }
                                    }
                                }
                            } catch (voiceErr: any) {
                                console.error('[SOP Reminders] Overdue voice call error:', voiceErr.message);
                            }

                            // Mark all incomplete templates in group as sent
                            incompleteTemplates.forEach(t => {
                                if (!enqueuedEventsMap.has(t.id)) enqueuedEventsMap.set(t.id, new Set());
                                enqueuedEventsMap.get(t.id)!.add('CHECKLIST_OVERDUE');
                                enqueuedEventsMap.get(t.id)!.add('CHECKLIST_OVERDUE_ALERT');
                            });

                            overdueAlertsDispatched++;
                            console.log(`[SOP Reminders] Sent consolidated overdue alert for "${overdueTitle}" (slot: ${slotWindowLabel})`);
                        } catch (err: any) {
                            console.error(`[SOP Reminders] Overdue alert error for group ${overdueTitle}:`, err.message);
                        }
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            totalTemplates: validTemplates.length,
            shiftGroupsChecked: groupedTemplates.size,
            dispatched: {
                pre_start_reminders: remindersDispatched,
                shift_started_alerts: startAlertsDispatched,
                overdue_alerts: overdueAlertsDispatched
            },
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[SOP Reminders Cron] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
