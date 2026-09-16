import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
    try {
        const nowIso = new Date().toISOString();

        // 1. Fetch all open tickets where SLA has expired and status is not resolved/closed/cancelled
        const { data: breachedTickets, error } = await supabaseAdmin
            .from('hr_tickets')
            .select('*, category:hr_ticket_categories(*)')
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

            // Fallback: If specific authority flag wasn't found and nextAssigneeId is still the breached manager, reassign to any HR / Director authority or Org Super Admin
            if (nextAssigneeId === ticket.assigned_to_user_id) {
                const { data: fallbackAuth } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .or('is_director_authority.eq.true,is_hr_authority.eq.true,is_hr_manager_authority.eq.true')
                    .neq('user_id', ticket.assigned_to_user_id || '00000000-0000-0000-0000-000000000000')
                    .not('user_id', 'is', null)
                    .limit(1);

                if (fallbackAuth?.[0]?.user_id) {
                    nextAssigneeId = fallbackAuth[0].user_id;
                } else {
                    // Fallback to Org Super Admin membership
                    const { data: orgAdminMem } = await supabaseAdmin
                        .from('organization_memberships')
                        .select('user_id')
                        .or('role.eq.org_super_admin,role.eq.ops_super_admin')
                        .limit(1);
                    if (orgAdminMem?.[0]?.user_id) {
                        nextAssigneeId = orgAdminMem[0].user_id;
                    }
                }
            }

            // Calculate SLA for next level using category's configured SLA days
            let nextLevelSlaDays = nextLevel === 2 ? 7 : nextLevel === 3 ? 10 : 12;
            if (ticket.category) {
                const key = `l${nextLevel}_sla_days` as keyof typeof ticket.category;
                if (ticket.category[key] !== undefined && !isNaN(Number(ticket.category[key]))) {
                    nextLevelSlaDays = Number(ticket.category[key]);
                }
            }
            const newSla = new Date(Date.now() + nextLevelSlaDays * 24 * 60 * 60 * 1000);

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

            // Dispatch Omnichannel SLA Escalation Notification
            NotificationService.afterHrTicketEscalated(
                ticket.id,
                ticket.current_level,
                nextLevel,
                true, // isSlaAutoEscalated
                undefined
            ).catch(err => {
                console.error('Failed SLA escalation notification:', err);
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
