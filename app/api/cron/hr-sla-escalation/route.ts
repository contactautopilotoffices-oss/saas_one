import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
    try {
        const nowIso = new Date().toISOString();

        // 1. Fetch all open tickets where SLA has expired and status is not resolved/closed/cancelled
        const { data: breachedTickets, error } = await supabaseAdmin
            .from('hr_tickets')
            .select('*')
            .lt('sla_due_at', nowIso)
            .not('status', 'in', '("resolved","closed","cancelled")')
            .lt('current_level', 4);

        if (error) throw error;

        const escalatedList = [];

        for (const ticket of (breachedTickets || [])) {
            const nextLevel = ticket.current_level + 1;
            let nextAssigneeId = ticket.assigned_to_user_id;

            // Fetch next level assignee dynamically based on HR Admin escalation authority configuration
            if (nextLevel === 2) {
                // Level 2: Designated HR Manager / HR Operations Lead
                const { data: hrMgrs } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_manager_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                if (hrMgrs?.[0]?.user_id) {
                    nextAssigneeId = hrMgrs[0].user_id;
                } else {
                    const { data: hrStaff } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user_id')
                        .eq('is_hr_authority', true)
                        .not('user_id', 'is', null)
                        .limit(1);
                    if (hrStaff?.[0]?.user_id) nextAssigneeId = hrStaff[0].user_id;
                }
            } else if (nextLevel === 3) {
                // Level 3: Designated HR Head
                const { data: hrHead } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .maybeSingle();

                if (hrHead?.user_id) {
                    nextAssigneeId = hrHead.user_id;
                }
            } else if (nextLevel === 4) {
                // Level 4: Designated Director
                const { data: directors } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_director_authority', true)
                    .not('user_id', 'is', null)
                    .maybeSingle();
                if (directors?.user_id) nextAssigneeId = directors.user_id;
            }

            // Extend SLA for next level (+4 days default window)
            const newSla = new Date();
            newSla.setDate(newSla.getDate() + 4);

            await supabaseAdmin
                .from('hr_tickets')
                .update({
                    current_level: nextLevel,
                    assigned_to_user_id: nextAssigneeId,
                    status: 'escalated',
                    sla_due_at: newSla.toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticket.id);

            // Audit log
            await supabaseAdmin.from('hr_ticket_audit_logs').insert({
                ticket_id: ticket.id,
                action: `AUTO_ESCALATED_SLA_BREACH_L${nextLevel}`,
                old_values: { level: ticket.current_level, status: ticket.status },
                new_values: { level: nextLevel, status: 'escalated', assigned_to: nextAssigneeId }
            });

            escalatedList.push({ ticket_number: ticket.ticket_number, from_level: ticket.current_level, to_level: nextLevel });
        }

        return NextResponse.json({
            success: true,
            total_breached_found: (breachedTickets || []).length,
            escalated_tickets: escalatedList
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
