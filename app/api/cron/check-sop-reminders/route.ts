import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';

/**
 * GET /api/cron/check-sop-reminders
 * Runs every minute. Sends push notifications 30 minutes before a checklist is due.
 * Uses a 27–30 minute window to avoid duplicate notifications across cron runs.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();

        // 1. Fetch all active templates (excluding on_demand)
        const { data: templates, error: templatesError } = await supabaseAdmin
            .from('sop_templates')
            .select('id, title, frequency, assigned_to, property_id, organization_id')
            .eq('is_active', true)
            .neq('frequency', 'on_demand');

        if (templatesError) throw templatesError;
        if (!templates || templates.length === 0) {
            return NextResponse.json({ success: true, checked: 0, notifications_sent: 0 });
        }

        // 2. For each template, get the most recent completion
        const templateIds = templates.map((t) => t.id);

        const { data: completions, error: completionsError } = await supabaseAdmin
            .from('sop_completions')
            .select('template_id, completed_at')
            .in('template_id', templateIds)
            .order('completed_at', { ascending: false });

        if (completionsError) throw completionsError;

        // Build a map: templateId → latest completed_at
        const lastCompletionMap: Record<string, Date> = {};
        for (const c of completions || []) {
            if (!lastCompletionMap[c.template_id]) {
                lastCompletionMap[c.template_id] = new Date(c.completed_at);
            }
        }

        let notificationsSent = 0;

        for (const template of templates) {
            const freq = (template.frequency || '').toLowerCase();
            // Skip hourly checklist notifications to prevent hourly spam; notify for daily, weekly, monthly etc.
            if (freq === 'hourly' || freq.startsWith('every_') || freq.includes('hour')) {
                continue;
            }

            const nextDue = getNextDueTime(template.frequency, lastCompletionMap[template.id] ?? null, now);
            if (!nextDue) continue;

            const minutesUntilDue = (nextDue.getTime() - now.getTime()) / 60_000;

            // Fire once when 27 ≤ minutes_until_due ≤ 30 (one cron-cycle window)
            if (minutesUntilDue < 27 || minutesUntilDue > 30) continue;

            const assignedUsers: string[] = Array.isArray(template.assigned_to) && template.assigned_to.length > 0
                ? template.assigned_to
                : [];

            const { WhatsAppRecipientResolver } = await import('@/backend/services/WhatsAppRecipientResolver');
            const { users: waUsers } = await WhatsAppRecipientResolver.resolveRecipients({
                organizationId: template.organization_id || '',
                propertyId: template.property_id,
                featureKey: 'checklist_slot_reminder',
                contextualUserIds: assignedUsers
            });

            const recipientIds = Array.from(new Set(waUsers.map(u => u.id)));
            if (recipientIds.length === 0) continue;

            const dueTimeFormatted = nextDue.toLocaleTimeString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            try {
                await NotificationService.sendToMany(recipientIds, {
                    propertyId: template.property_id,
                    organizationId: template.organization_id ?? undefined,
                    type: 'SOP_REMINDER',
                    title: 'Checklist Due Soon 📋',
                    message: `"${template.title}" is due at ${dueTimeFormatted}.`,
                    deepLink: `/properties/${template.property_id}/sop?via=notification`,
                    priority: 'HIGH',
                });
                notificationsSent += recipientIds.length;

                // Dispatch WhatsApp reminder
                const { WhatsAppEventProcessor } = await import('@/backend/services/WhatsAppEventProcessor');
                await WhatsAppEventProcessor.processEvent({
                    event_type: 'CHECKLIST_SLOT_REMINDER',
                    payload: {
                        organization_id: template.organization_id,
                        property_id: template.property_id,
                        template_id: template.id,
                        template_title: template.title,
                        due_time: dueTimeFormatted,
                        assigned_to: assignedUsers[0] || null
                    }
                });
            } catch (notifErr: any) {
                console.error(`[SOP Reminders] Failed for template ${template.id}:`, notifErr.message);
            }
        }

        return NextResponse.json({
            success: true,
            checked: templates.length,
            notifications_sent: notificationsSent,
        });
    } catch (error) {
        console.error('[SOP Reminders Cron] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Calculates the next due time for a template based on its frequency and last completion.
 * If never completed, treats "now" as the baseline so the schedule still works.
 */
function getNextDueTime(frequency: string, lastCompleted: Date | null, now: Date): Date | null {
    const base = lastCompleted ?? now;

    // Hourly frequencies: every_1_hour, every_2_hours, ..., every_12_hours
    const hourlyMatch = frequency.match(/^every_(\d+)_hours?$/);
    if (hourlyMatch) {
        const hours = parseInt(hourlyMatch[1], 10);
        if (lastCompleted) {
            return new Date(lastCompleted.getTime() + hours * 3_600_000);
        }
        // Never completed — next due is `hours` from now
        return new Date(now.getTime() + hours * 3_600_000);
    }

    switch (frequency) {
        case 'daily': {
            const next = new Date(base);
            next.setDate(next.getDate() + 1);
            return next;
        }
        case 'weekly': {
            const next = new Date(base);
            next.setDate(next.getDate() + 7);
            return next;
        }
        case 'monthly': {
            const next = new Date(base);
            next.setMonth(next.getMonth() + 1);
            return next;
        }
        default:
            return null;
    }
}
