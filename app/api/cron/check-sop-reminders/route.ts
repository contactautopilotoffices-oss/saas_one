import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';
import { withAgentRun } from '@/backend/lib/agents/instrument';

const LOCAL_TIMEZONE = 'Asia/Kolkata';

/** The org the agents are registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/**
 * `check-sop-reminders:2026-08-30T14:07` — one run per scheduled minute.
 *
 * The schedule is "* * * * *", so the key MUST be minute-scoped: a per-day key
 * would dedupe 1,439 of the day's 1,440 passes into a single row and the
 * console would look dead again, which is the exact failure this wave exists to
 * fix. Minute scope still absorbs a platform retry of the same pass.
 */
function minuteRunKey(when: Date = new Date()): string {
    return `check-sop-reminders:${when.toISOString().slice(0, 16)}`;
}

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
 *
 * vercel.json schedule: { "path": "/api/cron/check-sop-reminders", "schedule": "* * * * *" }
 *
 * TELEMETRY — each pass is recorded as one agent run (Pratiksha / sop) so the
 * OEM console shows the checklist clock actually ticking. Deliberate:
 *   · every counter the response reports is computed by the job and read back
 *     out here, so the wrapper cannot change what the cron returns;
 *   · the vast majority of passes sit between windows and dispatch nothing;
 *     those are recorded as 'skipped', not 'succeeded'. A minute of watching
 *     the clock is not a minute of work, and marking it as one would inflate
 *     the agent's scorecard 1,440 times a day;
 *   · no token counts: this job calls no model. A null reads "not measured";
 *     a zero would claim we measured and it was free.
 * The run is filed under the org the OEM console renders; the pass itself spans
 * every organization, which the step detail states rather than implies.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Hoisted out of the telemetry callback: the responses below are built
        // from these, exactly as they were before instrumentation.
        let nothingToCheck = false;
        let totalTemplates = 0;
        let shiftGroupsChecked = 0;
        let remindersDispatched = 0;
        let startAlertsDispatched = 0;
        let overdueAlertsDispatched = 0;

        await withAgentRun({
            orgId: DEFAULT_ORG_ID,
            agentKey: 'pratiksha',
            module: 'sop',
            trigger: 'cron',
            runKey: minuteRunKey(),
        }, async (step) => {
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
            const istClock = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')} IST`;

            // Start of today in IST as ISO string for querying today's queue/completions
            const startOfTodayIST = new Date(`${dateKey}T00:00:00+05:30`).toISOString();

            // 2. Fetch all active running SOP templates
            const scan = await step('Reading active checklist templates', 'fetch');
            const { data: templates, error: templatesError } = await supabaseAdmin
                .from('sop_templates')
                .select('id, title, frequency, start_time, end_time, assigned_to, property_id, organization_id, is_running')
                .eq('is_active', true)
                .neq('frequency', 'on_demand');

            if (templatesError) {
                await scan.fail(templatesError, { detail: { table: 'sop_templates' } });
                throw templatesError;
            }
            if (!templates || templates.length === 0) {
                await scan.ok({ detail: { active_templates: 0, scope: 'all organizations' } });
                nothingToCheck = true;
                return {
                    outcome: `No active scheduled checklists are configured — nothing to watch at ${istClock}.`,
                    status: 'skipped' as const,
                };
            }

            // Filter out hourly frequencies to prevent spamming
            const validTemplates = templates.filter(t => {
                const freq = (t.frequency || '').toLowerCase();
                const isHourly = freq === 'hourly' || freq.startsWith('every_') || freq.includes('hour');
                return !isHourly;
            });

            await scan.ok({
                detail: {
                    active_templates: templates.length,
                    hourly_excluded: templates.length - validTemplates.length,
                    in_scope: validTemplates.length,
                    now_ist: istClock,
                    scope: 'all organizations',
                },
            });

            if (validTemplates.length === 0) {
                nothingToCheck = true;
                return {
                    outcome: `All ${templates.length} active checklist${templates.length === 1 ? ' is' : 's are'} hourly — `
                        + `none in scope for slot reminders. Nothing to check.`,
                    status: 'skipped' as const,
                };
            }

            totalTemplates = validTemplates.length;
            const templateIds = validTemplates.map(t => t.id);

            // 3. Fetch auxiliary data in parallel:
            // A. WhatsApp queue entries created today to prevent duplicate sends for the exact slot
            // B. Today's completed checklists in sop_completions
            // C. Organization settings for dynamic reminder_minutes lead times
            const context = await step("Reading today's sends, completions and reminder rules", 'fetch');
            const [queueRes, completionsRes, orgSettingsRes] = await Promise.all([
                supabaseAdmin
                    .from('whatsapp_queue')
                    .select('entity_id, event_type')
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
            const enqueuedEntitySet = new Set<string>();
            (queueRes.data || []).forEach(row => {
                if (row.entity_id) {
                    enqueuedEntitySet.add(row.entity_id);
                }
            });

            // Build completions map for today
            const completedTemplateIds = new Set<string>();
            (completionsRes.data || []).forEach(c => {
                if (c.status === 'completed' || c.completed_at) {
                    completedTemplateIds.add(c.template_id);
                }
            });

            await context.ok({
                detail: {
                    queued_today: enqueuedEntitySet.size,
                    completed_today: completedTemplateIds.size,
                    org_settings: (orgSettingsRes.data || []).length,
                    // The job treats these three reads as best-effort; the trace
                    // must not pretend a failed read was an empty one.
                    queue_read_error: queueRes.error?.message ?? null,
                    completions_read_error: completionsRes.error?.message ?? null,
                    settings_read_error: orgSettingsRes.error?.message ?? null,
                },
            });

            // 4. GROUP TEMPLATES by (property_id, rawStartTime, rawEndTime) for Consolidated Messaging
            const grouping = await step('Grouping checklists by property and shift slot', 'think');
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

            shiftGroupsChecked = groupedTemplates.size;
            await grouping.ok({
                detail: { checklists: validTemplates.length, shift_slots: groupedTemplates.size },
            });

            let groupsErrored = 0;

            const walk = await step(
                `Checking ${groupedTemplates.size} shift slot${groupedTemplates.size === 1 ? '' : 's'} against the clock`,
                'decide',
            );

            for (const [groupKey, group] of groupedTemplates.entries()) {
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

                // Dynamic configured reminder lead time from Omnichannel settings
                const orgMatrix = (orgSettingsRes.data || []).find(os => os.organization_id === orgId)?.notification_matrix || {};
                const reminderRule = orgMatrix?.checklists?.checklist_slot_reminder;
                const activeReminderRule = reminderRule?.property_overrides?.[propId] || reminderRule;
                const configuredLeadMins = (typeof activeReminderRule?.reminder_minutes === 'number' && activeReminderRule.reminder_minutes > 0)
                    ? activeReminderRule.reminder_minutes
                    : 10;
                const preStartMins = startMins - configuredLeadMins;
                const isOvernight = endMins <= startMins;

                // Fetch property name
                const { data: propData } = await supabaseAdmin.from('properties').select('name').eq('id', propId).maybeSingle();
                const propertyName = propData?.name || 'Site Facility';

                // Format consolidated checklist title
                const count = group.length;
                let groupTitle = count === 1 ? group[0].title : (count === 2 ? `${group[0].title}, ${group[1].title} (2 Checklists)` : `${group[0].title}, ${group[1].title} & ${count - 2} more (${count} Checklists)`);

                // Collect assigned user IDs
                const groupAssigneeIds = Array.from(new Set(
                    group.flatMap(t => Array.isArray(t.assigned_to) ? t.assigned_to : [t.assigned_to]).filter(Boolean)
                ));

                // Slot-specific deduplication keys
                const slotPreStartKey = (tid: string) => `sop_rem_${tid}_${rawStartTime}_${dateKey}`;
                const slotStartedKey = (tid: string) => `sop_start_${tid}_${rawStartTime}_${dateKey}`;
                const slotOverdueKey = (tid: string) => `sop_overdue_${tid}_${rawStartTime}_${dateKey}`;

                const hasSentPreStart = group.some(t => enqueuedEntitySet.has(slotPreStartKey(t.id)));
                const hasSentStarted = group.some(t => enqueuedEntitySet.has(slotStartedKey(t.id)));

                // ─────────────────────────────────────────────────────────────────
                // STAGE 1: PRE-START REMINDER
                // ─────────────────────────────────────────────────────────────────
                const isInPreStartWindow = currentMins >= preStartMins && currentMins < startMins;

                if (isInPreStartWindow && !hasSentPreStart) {
                    const formattedStartTime = format12h(rawStartTime);
                    const leadTimeText = `${configuredLeadMins} mins`;

                    const preStart = await step(
                        `Pre-start reminder — ${propertyName} ${formattedStartTime} shift`,
                        'notify',
                    );

                    try {
                        const { users: reminderRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                            organizationId: orgId,
                            propertyId: propId,
                            featureKey: 'checklist_slot_reminder',
                            contextualUserIds: groupAssigneeIds
                        });

                        const recipientIds = Array.from(new Set(reminderRecipients.map(u => u.id)));

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

                        await WhatsAppEventProcessor.processEvent({
                            event_type: 'CHECKLIST_SLOT_REMINDER',
                            payload: {
                                organization_id: orgId,
                                property_id: propId,
                                entity_id: slotPreStartKey(firstTemplate.id),
                                template_id: firstTemplate.id,
                                template_title: groupTitle,
                                due_time: `${formattedStartTime} (in ${leadTimeText})`,
                                assigned_to: recipientIds[0] || null
                            }
                        });

                        let voiceCalls = 0;
                        try {
                            const isVoiceEnabled = activeReminderRule?.channels?.voice === true;
                            if (isVoiceEnabled && reminderRecipients.length > 0) {
                                for (const u of reminderRecipients) {
                                    if (u.phone) {
                                        await VoiceCallingService.triggerCall({
                                            organizationId: orgId,
                                            propertyId: propId,
                                            recipientPhone: u.phone,
                                            recipientUserId: u.id,
                                            eventType: 'CHECKLIST_SLOT_REMINDER',
                                            customTemplate: activeReminderRule?.voice_template,
                                            voiceId: activeReminderRule?.voice_id,
                                            speechSpeed: activeReminderRule?.speech_speed,
                                            variables: { userName: u.name || 'Staff', checklistTitle: groupTitle, propertyName, shiftTime: formattedStartTime }
                                        });
                                        voiceCalls++;
                                    }
                                }
                            }
                        } catch (voiceErr: any) { console.error('[SOP Reminders] Pre-start voice call error:', voiceErr.message); }

                        group.forEach(t => enqueuedEntitySet.add(slotPreStartKey(t.id)));
                        remindersDispatched++;
                        await preStart.ok({
                            detail: {
                                property: propertyName,
                                checklists: count,
                                shift_start: formattedStartTime,
                                lead_minutes: configuredLeadMins,
                                recipients: recipientIds.length,
                                voice_calls: voiceCalls,
                            },
                        });
                    } catch (err: any) {
                        groupsErrored++;
                        await preStart.fail(err, { detail: { property: propertyName, shift_start: formattedStartTime } });
                        console.error(`[SOP Reminders] Pre-start error for group ${groupTitle}:`, err.message);
                    }
                }

                // ─────────────────────────────────────────────────────────────────
                // STAGE 2: EXACT START TIME ALERT
                // ─────────────────────────────────────────────────────────────────
                const startGraceMins = 45;
                const isInStartedWindow = isOvernight
                    ? ((currentMins >= startMins && currentMins <= startMins + startGraceMins) || (currentMins < endMins && currentMins <= (startMins + startGraceMins) % 1440))
                    : (currentMins >= startMins && currentMins <= Math.min(startMins + startGraceMins, endMins));

                if (isInStartedWindow && !hasSentStarted) {
                    const formattedStartTime = format12h(rawStartTime);
                    const started = await step(
                        `Shift-start alert — ${propertyName} ${formattedStartTime} shift`,
                        'notify',
                    );
                    try {
                        const { users: startedRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                            organizationId: orgId,
                            propertyId: propId,
                            featureKey: 'checklist_started',
                            contextualUserIds: groupAssigneeIds
                        });

                        const recipientIds = Array.from(new Set(startedRecipients.map(u => u.id)));

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

                        await WhatsAppEventProcessor.processEvent({
                            event_type: 'CHECKLIST_STARTED',
                            payload: {
                                organization_id: orgId,
                                property_id: propId,
                                entity_id: slotStartedKey(firstTemplate.id),
                                template_id: firstTemplate.id,
                                template_title: groupTitle,
                                start_time: formattedStartTime,
                                assigned_to: recipientIds[0] || null
                            }
                        });

                        let voiceCalls = 0;
                        try {
                            const startedRule = orgMatrix?.checklists?.checklist_started;
                            const activeStartedRule = startedRule?.property_overrides?.[propId] || startedRule;
                            const isVoiceEnabled = activeStartedRule?.channels?.voice === true;
                            if (isVoiceEnabled && startedRecipients.length > 0) {
                                for (const u of startedRecipients) {
                                    if (u.phone) {
                                        await VoiceCallingService.triggerCall({
                                            organizationId: orgId,
                                            propertyId: propId,
                                            recipientPhone: u.phone,
                                            recipientUserId: u.id,
                                            eventType: 'CHECKLIST_STARTED',
                                            customTemplate: activeStartedRule?.voice_template,
                                            voiceId: activeStartedRule?.voice_id,
                                            speechSpeed: activeStartedRule?.speech_speed,
                                            variables: { userName: u.name || 'Staff', checklistTitle: groupTitle, propertyName, shiftTime: formattedStartTime }
                                        });
                                        voiceCalls++;
                                    }
                                }
                            }
                        } catch (voiceErr: any) { console.error('[SOP Reminders] Started voice call error:', voiceErr.message); }

                        group.forEach(t => enqueuedEntitySet.add(slotStartedKey(t.id)));
                        startAlertsDispatched++;
                        await started.ok({
                            detail: {
                                property: propertyName,
                                checklists: count,
                                shift_start: formattedStartTime,
                                recipients: recipientIds.length,
                                voice_calls: voiceCalls,
                            },
                        });
                    } catch (err: any) {
                        groupsErrored++;
                        await started.fail(err, { detail: { property: propertyName, shift_start: formattedStartTime } });
                        console.error(`[SOP Reminders] Started alert error for group ${groupTitle}:`, err.message);
                    }
                }

                // ─────────────────────────────────────────────────────────────────
                // STAGE 3: OVERDUE / MISSED ALERT
                // ─────────────────────────────────────────────────────────────────
                const isAfterEndTime = isOvernight ? (currentMins >= endMins && currentMins < startMins) : (currentMins >= endMins);

                if (isAfterEndTime) {
                    const incompleteTemplates = group.filter(t => !completedTemplateIds.has(t.id));
                    if (incompleteTemplates.length > 0) {
                        const hasSentOverdue = incompleteTemplates.some(t => enqueuedEntitySet.has(slotOverdueKey(t.id)));

                        if (!hasSentOverdue) {
                            const slotWindowLabel = `${format12h(rawStartTime)} – ${format12h(rawEndTime)}`;
                            const incCount = incompleteTemplates.length;
                            const overdueTitle = incCount === 1 ? incompleteTemplates[0].title : (incCount === 2 ? `${incompleteTemplates[0].title}, ${incompleteTemplates[1].title} (2 Checklists)` : `${incompleteTemplates[0].title}, ${incompleteTemplates[1].title} & ${incCount - 2} more (${incCount} Checklists)`);

                            const overdue = await step(
                                `Overdue alert — ${incCount} unfinished checklist${incCount === 1 ? '' : 's'} at ${propertyName}`,
                                'notify',
                            );

                            try {
                                const { users: overdueRecipients } = await WhatsAppRecipientResolver.resolveRecipients({
                                    organizationId: orgId,
                                    propertyId: propId,
                                    featureKey: 'checklist_overdue_alert',
                                    contextualUserIds: groupAssigneeIds
                                });

                                const recipientIds = Array.from(new Set(overdueRecipients.map(u => u.id)));

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

                                await WhatsAppEventProcessor.processEvent({
                                    event_type: 'CHECKLIST_OVERDUE',
                                    payload: {
                                        organization_id: orgId,
                                        property_id: propId,
                                        entity_id: slotOverdueKey(incompleteTemplates[0].id),
                                        template_id: incompleteTemplates[0].id,
                                        template_title: overdueTitle,
                                        slot_time: slotWindowLabel,
                                        assigned_to: recipientIds[0] || null
                                    }
                                });

                                let voiceCalls = 0;
                                try {
                                    const overdueRule = orgMatrix?.checklists?.checklist_overdue_alert;
                                    const activeOverdueRule = overdueRule?.property_overrides?.[propId] || overdueRule;
                                    const isVoiceEnabled = activeOverdueRule?.channels?.voice === true;
                                    if (isVoiceEnabled && overdueRecipients.length > 0) {
                                        for (const u of overdueRecipients) {
                                            if (u.phone) {
                                                await VoiceCallingService.triggerCall({
                                                    organizationId: orgId,
                                                    propertyId: propId,
                                                    recipientPhone: u.phone,
                                                    recipientUserId: u.id,
                                                    eventType: 'CHECKLIST_OVERDUE',
                                                    customTemplate: activeOverdueRule?.voice_template,
                                                    voiceId: activeOverdueRule?.voice_id,
                                                    speechSpeed: activeOverdueRule?.speech_speed,
                                                    variables: { userName: u.name || 'Staff', checklistTitle: overdueTitle, propertyName, shiftTime: slotWindowLabel }
                                                });
                                                voiceCalls++;
                                            }
                                        }
                                    }
                                } catch (voiceErr: any) { console.error('[SOP Reminders] Overdue voice call error:', voiceErr.message); }

                                incompleteTemplates.forEach(t => enqueuedEntitySet.add(slotOverdueKey(t.id)));
                                overdueAlertsDispatched++;
                                await overdue.ok({
                                    detail: {
                                        property: propertyName,
                                        incomplete: incCount,
                                        of_checklists: count,
                                        slot: slotWindowLabel,
                                        recipients: recipientIds.length,
                                        voice_calls: voiceCalls,
                                    },
                                });
                                console.log(`[SOP Reminders] Sent consolidated overdue alert for "${overdueTitle}" (slot: ${slotWindowLabel})`);
                            } catch (err: any) {
                                groupsErrored++;
                                await overdue.fail(err, { detail: { property: propertyName, slot: slotWindowLabel } });
                                console.error(`[SOP Reminders] Overdue alert error for group ${overdueTitle}:`, err.message);
                            }
                        }
                    }
                }
            }

            const dispatched = remindersDispatched + startAlertsDispatched + overdueAlertsDispatched;

            await walk.end(groupsErrored > 0 ? 'failed' : 'ok', {
                detail: {
                    shift_slots: groupedTemplates.size,
                    checklists: validTemplates.length,
                    now_ist: istClock,
                    pre_start_reminders: remindersDispatched,
                    shift_started_alerts: startAlertsDispatched,
                    overdue_alerts: overdueAlertsDispatched,
                    stages_errored: groupsErrored,
                },
            });

            const errorTail = groupsErrored > 0
                ? ` ${groupsErrored} stage${groupsErrored === 1 ? '' : 's'} errored mid-dispatch.`
                : '';

            if (dispatched === 0) {
                return {
                    outcome: `${validTemplates.length} checklist${validTemplates.length === 1 ? '' : 's'} in `
                        + `${groupedTemplates.size} shift slot${groupedTemplates.size === 1 ? '' : 's'} — none inside a `
                        + `pre-start, shift-start or overdue window at ${istClock}, or all already alerted today. `
                        + `Nothing sent.${errorTail}`,
                    status: 'skipped' as const,
                };
            }

            return {
                outcome: `Nudged ${dispatched} of ${groupedTemplates.size} shift slot${groupedTemplates.size === 1 ? '' : 's'} at ${istClock} — `
                    + `${remindersDispatched} pre-start reminder${remindersDispatched === 1 ? '' : 's'}, `
                    + `${startAlertsDispatched} shift-start alert${startAlertsDispatched === 1 ? '' : 's'}, `
                    + `${overdueAlertsDispatched} overdue alert${overdueAlertsDispatched === 1 ? '' : 's'}.${errorTail}`,
            };
        });

        if (nothingToCheck) {
            return NextResponse.json({ success: true, checked: 0, dispatched: 0 });
        }

        return NextResponse.json({
            success: true,
            totalTemplates,
            shiftGroupsChecked,
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
