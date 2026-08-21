import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver, ResolvedWhatsAppUser } from '@/backend/services/WhatsAppRecipientResolver';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';

/**
 * GET /api/cron/whatsapp-reminders
 * Runs every 5 minutes.
 * Processes active time-based reminders:
 *   - tickets   → tickets.sla_deadline (status not resolved/closed)
 *   - ppm       → ppm_schedules.planned_date (date-only, IST)
 *   - checklists → sop_templates (scheduled shift slot)
 */

const REMINDER_FEATURES = ['tickets', 'ppm'] as const;
type ReminderFeature = typeof REMINDER_FEATURES[number];

interface OrgContext {
    organizationId: string;
    configMap: Record<string, any>;
    templates: Record<string, { campaign_name?: string; params?: string[] }>;
}

const IST = 'Asia/Kolkata';

function istNow(): Date {
    return new Date(new Date().toLocaleString('en-US', { timeZone: IST }));
}

function istDateString(d: Date): string {
    return d.toISOString().split('T')[0];
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { timeZone: IST }); // dd/mm/yyyy
}

function fmtDateTime(d: Date): string {
    const datePart = d.toLocaleDateString('en-GB', { timeZone: IST });
    const timePart = d.toLocaleTimeString('en-IN', {
        timeZone: IST,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    return `${datePart}, ${timePart}`; // dd/mm/yyyy, hh:mm A
}

async function resolveFeatureRecipients(options: {
    organizationId: string;
    propertyId?: string | null;
    featureKey: string;
    assigneeId?: string | null;
    requesterId?: string | null;
}): Promise<ResolvedWhatsAppUser[]> {
    const { organizationId, propertyId, featureKey, assigneeId, requesterId } = options;

    const { enabled, users, config } = await WhatsAppRecipientResolver.resolveRecipients({
        organizationId,
        propertyId,
        featureKey,
    });

    if (!enabled) return [];

    const userMap = new Map<string, ResolvedWhatsAppUser>(users.map(u => [u.id, u]));

    const contextualIds: string[] = [];
    if (config.notify_assignee && assigneeId) contextualIds.push(assigneeId);
    if (config.notify_requester && requesterId) contextualIds.push(requesterId);

    const missingIds = contextualIds.filter(id => !userMap.has(id));
    if (missingIds.length > 0) {
        const { data: contextualUsers } = await supabaseAdmin
            .from('users')
            .select('id, phone, full_name')
            .in('id', missingIds);
        (contextualUsers || [])
            .filter((u: any) => u?.phone && String(u.phone).trim())
            .forEach((u: any) => {
                userMap.set(u.id, { id: u.id, phone: String(u.phone).trim(), name: u.full_name || null });
            });
    }

    return Array.from(userMap.values());
}

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: orgSettings, error: orgsErr } = await supabaseAdmin
        .from('organization_settings')
        .select('organization_id, whatsapp_service_config, notification_matrix, whatsapp_templates');

    if (orgsErr) {
        return NextResponse.json({ error: orgsErr.message }, { status: 500 });
    }

    const orgContexts: OrgContext[] = (orgSettings || []).map((row: any) => {
        const matrix = row.notification_matrix || {};
        const waConfig = row.whatsapp_service_config || {};

        // Merge matrix into configMap for unified lookup
        const mergedConfig: Record<string, any> = { ...waConfig };
        if (matrix.tickets?.reminder_ticket_sla) {
            mergedConfig.tickets = { ...mergedConfig.tickets, ...matrix.tickets.reminder_ticket_sla };
        }
        if (matrix.ppm?.reminder_ppm) {
            mergedConfig.ppm = { ...mergedConfig.ppm, ...matrix.ppm.reminder_ppm };
        }

        return {
            organizationId: row.organization_id,
            configMap: mergedConfig,
            templates: row.whatsapp_templates || {},
        };
    });

    const summary: Record<ReminderFeature, { checked: number; enqueued: number }> = {
        tickets: { checked: 0, enqueued: 0 },
        ppm: { checked: 0, enqueued: 0 },
    };

    for (const ctx of orgContexts) {
        // 1. Tickets SLA reminders
        const ticketCfg = ctx.configMap.tickets;
        if (ticketCfg?.enabled !== false && ticketCfg?.reminder_minutes && ticketCfg.reminder_minutes > 0) {
            try {
                const enq = await processTicketSlaReminders(ctx, ticketCfg.reminder_minutes);
                summary.tickets.enqueued += enq;
                summary.tickets.checked++;
            } catch (err: any) {
                console.error(`[cron:whatsapp-reminders] tickets error for org ${ctx.organizationId}:`, err.message);
            }
        }

        // 2. PPM reminders
        const ppmCfg = ctx.configMap.ppm;
        if (ppmCfg?.enabled !== false && ppmCfg?.reminder_minutes && ppmCfg.reminder_minutes > 0) {
            try {
                const enq = await processPpmReminders(ctx, ppmCfg.reminder_minutes);
                summary.ppm.enqueued += enq;
                summary.ppm.checked++;
            } catch (err: any) {
                console.error(`[cron:whatsapp-reminders] ppm error for org ${ctx.organizationId}:`, err.message);
            }
        }
    }

    return NextResponse.json({ success: true, summary });
}

async function processTicketSlaReminders(ctx: OrgContext, reminderMinutes: number): Promise<number> {
    const template = ctx.templates.reminder_ticket_sla;
    if (!template?.campaign_name) return 0;

    const now = new Date();
    const windowEnd = new Date(now.getTime() + reminderMinutes * 60 * 1000);

    const { data: tickets, error } = await supabaseAdmin
        .from('tickets')
        .select(`
            id, ticket_number, title, priority, sla_deadline, property_id, assigned_to, raised_by,
            property:properties(name),
            assignee:users!assigned_to(id, full_name, phone)
        `)
        .eq('organization_id', ctx.organizationId)
        .not('status', 'in', '(resolved,closed)')
        .not('sla_deadline', 'is', null)
        .gt('sla_deadline', now.toISOString())
        .lte('sla_deadline', windowEnd.toISOString());

    if (error || !tickets || tickets.length === 0) return 0;

    let enqueued = 0;

    for (const t of tickets as any[]) {
        const recipients = await resolveFeatureRecipients({
            organizationId: ctx.organizationId,
            propertyId: t.property_id,
            featureKey: 'tickets',
            assigneeId: t.assigned_to,
            requesterId: t.raised_by,
        });

        if (recipients.length === 0) continue;

        const propName = t.property?.name || 'Property';
        const assigneeName = t.assignee?.full_name || 'Unassigned';
        const slaDeadlineStr = t.sla_deadline ? fmtDateTime(new Date(t.sla_deadline)) : 'N/A';

        const paramValues: Record<string, string> = {
            user_name: 'Team',
            ticket_number: t.ticket_number || 'N/A',
            title: t.title || 'Ticket',
            property: propName,
            sla_deadline: slaDeadlineStr,
            priority: t.priority || 'Medium',
            assignee_name: assigneeName,
        };

        const orderedParams: string[] = (template.params || []).map((k: string) => paramValues[k] ?? 'N/A');

        await WhatsAppQueueService.enqueue({
            userIds: recipients.map(u => u.id),
            message: `⚠️ SLA Warning: Ticket #${t.ticket_number} (${t.title}) at ${propName} SLA expires on ${slaDeadlineStr}`,
            eventType: 'REMINDER_TICKET_SLA',
            organizationId: ctx.organizationId,
            templateName: template.campaign_name,
            templateParams: orderedParams,
            entityId: t.id,
            ticketId: t.id,
        });

        enqueued += recipients.length;
    }

    return enqueued;
}

async function processPpmReminders(ctx: OrgContext, reminderMinutes: number): Promise<number> {
    const template = ctx.templates.reminder_ppm;
    if (!template?.campaign_name) return 0;

    const targetDate = new Date(Date.now() + reminderMinutes * 60 * 1000);
    const targetDateStr = istDateString(targetDate);

    const { data: schedules, error } = await supabaseAdmin
        .from('ppm_schedules')
        .select(`
            id, planned_date, system_name, location,
            property_id, organization_id, vendor_id,
            property:properties(name),
            vendor:vendors(name)
        `)
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'pending')
        .eq('planned_date', targetDateStr);

    if (error || !schedules || schedules.length === 0) return 0;

    let enqueued = 0;

    for (const s of schedules as any[]) {
        const recipients = await resolveFeatureRecipients({
            organizationId: ctx.organizationId,
            propertyId: s.property_id,
            featureKey: 'ppm',
        });

        if (recipients.length === 0) continue;

        const propName = s.property?.name || 'Property';
        const vendorName = s.vendor?.name || 'Assigned Vendor';
        const plannedDateStr = fmtDate(new Date(s.planned_date));

        const paramValues: Record<string, string> = {
            user_name: 'Property Team',
            system_name: s.system_name || 'System / Asset',
            property: propName,
            due_date: plannedDateStr,
            vendor_name: vendorName,
            location: s.location || 'Site Facility',
        };

        const orderedParams: string[] = (template.params || []).map((k: string) => paramValues[k] ?? 'N/A');

        await WhatsAppQueueService.enqueue({
            userIds: recipients.map(u => u.id),
            message: `🔧 PPM Reminder: ${s.system_name} at ${propName} is scheduled for ${plannedDateStr} with ${vendorName}`,
            eventType: 'REMINDER_PPM',
            organizationId: ctx.organizationId,
            templateName: template.campaign_name,
            templateParams: orderedParams,
            entityId: s.id,
        });

        enqueued += recipients.length;
    }

    return enqueued;
}
