import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';

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
 * Manages the automated SOP Checklist notification lifecycle:
 * 1. Pre-start reminder (X mins before start_time, dynamically configured in Omnichannel settings)
 * 2. Shift started alert (at start_time)
 * 3. Overdue / Missed alert (after end_time if incomplete)
 * 
 * Rules:
 * - Active for Daily, Weekly, and Monthly checklists.
 * - Hourly checklists ('hourly', 'every_1_hour', etc.) and on_demand are strictly EXCLUDED to avoid spam.
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
                .select('template_id, status, completed_at')
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

        let remindersDispatched = 0;
        let startAlertsDispatched = 0;
        let overdueAlertsDispatched = 0;

        for (const template of validTemplates) {
            const orgId = template.organization_id || '';
            const propId = template.property_id || '';
            const assignedUsers = Array.isArray(template.assigned_to) ? template.assigned_to : [];
            const alreadySentTypes = enqueuedEventsMap.get(template.id) || new Set();

            // Default times if not set on template
            const rawStartTime = (template.start_time || '09:00:00').slice(0, 5); // "09:00"
            const rawEndTime = (template.end_time || '18:00:00').slice(0, 5);     // "18:00"

            const [sH, sM] = rawStartTime.split(':').map(Number);
            const [eH, eM] = rawEndTime.split(':').map(Number);

            const startMins = sH * 60 + sM;
            const endMins = eH * 60 + eM;

            // Dynamic configured reminder lead time from Omnichannel settings (default 10 mins)
            const configuredLeadMins = orgReminderMinutesMap.get(orgId) || 10;
            const preStartMins = startMins - configuredLeadMins;

            const isOvernight = endMins <= startMins;

            // ─────────────────────────────────────────────────────────────────
            // STAGE 1: PRE-START REMINDER (e.g. 10 mins before start_time)
            // ─────────────────────────────────────────────────────────────────
            const isInPreStartWindow = currentMins >= preStartMins && currentMins < startMins;
            const hasSentPreStart = alreadySentTypes.has('CHECKLIST_SLOT_REMINDER') || alreadySentTypes.has('SOP_REMINDER');

            if (isInPreStartWindow && !hasSentPreStart) {
                const formattedStartTime = format12h(rawStartTime);
                const leadTimeText = `${configuredLeadMins} mins`;

                try {
                    // 1. Dispatch in-app notifications
                    if (assignedUsers.length > 0) {
                        await NotificationService.sendToMany(assignedUsers, {
                            propertyId: propId,
                            organizationId: orgId,
                            type: 'SOP_REMINDER',
                            title: 'Checklist Starting Soon 📋',
                            message: `"${template.title}" shift starts in ${leadTimeText} at ${formattedStartTime}.`,
                            deepLink: `/properties/${propId}/sop?templateId=${template.id}`,
                            priority: 'HIGH',
                        });
                    }

                    // 2. Dispatch WhatsApp notification
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'CHECKLIST_SLOT_REMINDER',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            template_id: template.id,
                            template_title: template.title,
                            due_time: `${formattedStartTime} (in ${leadTimeText})`,
                            assigned_to: assignedUsers[0] || null
                        }
                    });

                    alreadySentTypes.add('CHECKLIST_SLOT_REMINDER');
                    remindersDispatched++;
                    console.log(`[SOP Reminders] Sent pre-start reminder for "${template.title}" (starts in ${leadTimeText} at ${formattedStartTime})`);
                } catch (err: any) {
                    console.error(`[SOP Reminders] Pre-start error for template ${template.id}:`, err.message);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // STAGE 2: EXACT START TIME ALERT (at start_time)
            // ─────────────────────────────────────────────────────────────────
            const isInStartedWindow = isOvernight 
                ? (currentMins >= startMins || currentMins < endMins)
                : (currentMins >= startMins && currentMins < endMins);
            const hasSentStarted = alreadySentTypes.has('CHECKLIST_STARTED') || alreadySentTypes.has('SOP_STARTED');

            if (isInStartedWindow && !hasSentStarted) {
                const formattedStartTime = format12h(rawStartTime);

                try {
                    // 1. Dispatch in-app notifications
                    if (assignedUsers.length > 0) {
                        await NotificationService.sendToMany(assignedUsers, {
                            propertyId: propId,
                            organizationId: orgId,
                            type: 'SOP_STARTED',
                            title: 'Checklist Shift Started 🚀',
                            message: `"${template.title}" shift has started (${formattedStartTime}). Please begin your inspection.`,
                            deepLink: `/properties/${propId}/sop?templateId=${template.id}`,
                            priority: 'HIGH',
                        });
                    }

                    // 2. Dispatch WhatsApp notification
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'CHECKLIST_STARTED',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            template_id: template.id,
                            template_title: template.title,
                            start_time: formattedStartTime,
                            assigned_to: assignedUsers[0] || null
                        }
                    });

                    alreadySentTypes.add('CHECKLIST_STARTED');
                    startAlertsDispatched++;
                    console.log(`[SOP Reminders] Sent shift started alert for "${template.title}" at ${formattedStartTime}`);
                } catch (err: any) {
                    console.error(`[SOP Reminders] Started alert error for template ${template.id}:`, err.message);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // STAGE 3: OVERDUE / MISSED ALERT (after end_time if incomplete)
            // ─────────────────────────────────────────────────────────────────
            const isAfterEndTime = isOvernight
                ? (currentMins >= endMins && currentMins < startMins)
                : (currentMins >= endMins);

            const isCompletedToday = completedTemplateIds.has(template.id);
            const hasSentOverdue = alreadySentTypes.has('CHECKLIST_OVERDUE') || alreadySentTypes.has('SOP_OVERDUE') || alreadySentTypes.has('SOP_MISSED');

            if (isAfterEndTime && !isCompletedToday && !hasSentOverdue) {
                const slotWindowLabel = `${format12h(rawStartTime)} – ${format12h(rawEndTime)}`;

                try {
                    // 1. Dispatch in-app notifications
                    if (assignedUsers.length > 0) {
                        await NotificationService.sendToMany(assignedUsers, {
                            propertyId: propId,
                            organizationId: orgId,
                            type: 'SOP_MISSED',
                            title: '⚠️ Missed Checklist Alert',
                            message: `"${template.title}" scheduled for ${slotWindowLabel} was NOT completed on time.`,
                            deepLink: `/properties/${propId}/sop?templateId=${template.id}`,
                            priority: 'HIGH',
                        });
                    }

                    // 2. Dispatch WhatsApp notification
                    await WhatsAppEventProcessor.processEvent({
                        event_type: 'CHECKLIST_OVERDUE',
                        payload: {
                            organization_id: orgId,
                            property_id: propId,
                            template_id: template.id,
                            template_title: template.title,
                            slot_time: slotWindowLabel,
                            assigned_to: assignedUsers[0] || null
                        }
                    });

                    alreadySentTypes.add('CHECKLIST_OVERDUE');
                    overdueAlertsDispatched++;
                    console.log(`[SOP Reminders] Sent overdue alert for incomplete checklist "${template.title}" (slot: ${slotWindowLabel})`);
                } catch (err: any) {
                    console.error(`[SOP Reminders] Overdue alert error for template ${template.id}:`, err.message);
                }
            }
        }

        return NextResponse.json({
            success: true,
            checked: validTemplates.length,
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
