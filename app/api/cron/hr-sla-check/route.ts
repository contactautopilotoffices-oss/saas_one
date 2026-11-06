import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { runAutoSlaEscalation } from '@/backend/lib/hr/slaEscalation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const now = new Date();

        // Fetch open tickets with valid SLA due dates (exclude resolved, closed, cancelled, pending_acknowledgement)
        const { data: tickets, error } = await supabaseAdmin
            .from('hr_tickets')
            .select(`
                *,
                category:hr_ticket_categories(*),
                raised_by:users!raised_by_user_id(id, full_name, email),
                assigned_to:users!assigned_to_user_id(id, full_name, email)
            `)
            .not('status', 'in', '("resolved","closed","cancelled","pending_acknowledgement")')
            .not('sla_due_at', 'is', null);

        if (error) throw error;

        let processedWarnings = 0;
        let processedBreaches = 0;

        for (const ticket of (tickets || [])) {
            const slaDueAt = new Date(ticket.sla_due_at);
            const diffMs = slaDueAt.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            // 1. SLA Breached (Overdue)
            if (diffMs < 0) {
                const overdueHours = Math.abs(Math.floor(diffHours));
                const overdueStr = overdueHours > 24 ? `${Math.floor(overdueHours / 24)} days` : `${overdueHours} hours`;

                // Dispatch WhatsApp SLA Breach Alert
                await WhatsAppEventProcessor.processEvent({
                    event_type: 'HR_TICKET_SLA_BREACHED',
                    payload: {
                        ...ticket,
                        overdue_duration: overdueStr
                    }
                }).catch(err => console.error('[HR SLA Cron] Breach alert error:', err));
                processedBreaches++;
            }
            // 2. SLA Warning (Due within 24 hours)
            else if (diffHours > 0 && diffHours <= 24) {
                const remainingStr = `${Math.ceil(diffHours)} hours`;

                await WhatsAppEventProcessor.processEvent({
                    event_type: 'HR_TICKET_SLA_WARNING',
                    payload: {
                        ...ticket,
                        remaining_hours: remainingStr
                    }
                }).catch(err => console.error('[HR SLA Cron] Warning alert error:', err));
                processedWarnings++;
            }
        }

        // Run auto-escalation engine safely for eligible open tickets
        let autoEscalated = 0;
        try {
            const escRes = await runAutoSlaEscalation();
            autoEscalated = escRes?.escalated_tickets?.length || 0;
            for (const esc of (escRes?.escalated_tickets || [])) {
                await WhatsAppEventProcessor.processEvent({
                    event_type: 'HR_TICKET_LEVEL_ESCALATED',
                    payload: {
                        id: esc.id,
                        ticket_number: esc.ticket_number,
                        current_level: esc.newLevel
                    }
                }).catch(err => console.error('[HR SLA Cron] Escalation alert error:', err));
            }
        } catch (escErr) {
            console.error('[HR SLA Cron] Error during runAutoSlaEscalation:', escErr);
        }

        return NextResponse.json({
            success: true,
            timestamp: now.toISOString(),
            stats: {
                total_checked: (tickets || []).length,
                sla_warnings_sent: processedWarnings,
                sla_breaches_sent: processedBreaches,
                auto_escalated: autoEscalated
            }
        });
    } catch (err: any) {
        console.error('[HR SLA Cron Error]:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
