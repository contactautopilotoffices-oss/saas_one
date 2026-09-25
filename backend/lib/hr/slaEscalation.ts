import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function runAutoSlaEscalation() {
    const nowIso = new Date().toISOString();

    // Fetch org escalation config for dynamic level assignees & levels
    let flowAssigneesConfig: any = {};
    let flowLevelsConfig: any = {};
    try {
        const { data: orgSettings } = await supabaseAdmin
            .from('organization_settings')
            .select('hr_escalation_config')
            .limit(1)
            .maybeSingle();
        if (orgSettings?.hr_escalation_config) {
            flowAssigneesConfig = orgSettings.hr_escalation_config.flow_assignees || {};
            flowLevelsConfig = orgSettings.hr_escalation_config.flow_levels || {};
        }
    } catch (e) {
        console.warn('Could not read hr_escalation_config in slaEscalation:', e);
    }

    // 1. Fetch all open tickets where SLA has expired and status is not resolved/closed/cancelled
    const { data: breachedTickets, error } = await supabaseAdmin
        .from('hr_tickets')
        .select('*, category:hr_ticket_categories(*)')
        .lt('sla_due_at', nowIso)
        .not('status', 'in', '("resolved","closed","cancelled")');

    if (error) throw error;

    const escalatedList = [];

    for (const ticket of (breachedTickets || [])) {
        const ticketType = ticket.ticket_type || ticket.category?.ticket_type || 'grievance';
        const customFlowLevels = flowLevelsConfig[ticketType] || [];
        const maxLevelForFlow = customFlowLevels.length > 0 ? customFlowLevels.length : 4;

        if (ticket.current_level >= maxLevelForFlow) {
            continue; // Already at max escalation level
        }

        const nextLevel = ticket.current_level + 1;
        let nextAssigneeId: string | null = null;

        // Check if custom step assignees are defined for this flow & level
        const levelCustomAssignees = flowAssigneesConfig[ticketType]?.[String(nextLevel)] || flowAssigneesConfig[ticketType]?.[nextLevel];

        if (Array.isArray(levelCustomAssignees) && levelCustomAssignees.length > 0) {
            const firstEmpId = levelCustomAssignees[0];
            // Resolve profile or user_id
            const { data: targetProfile } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .or(`id.eq.${firstEmpId},user_id.eq.${firstEmpId}`)
                .maybeSingle();

            if (targetProfile?.user_id) {
                nextAssigneeId = targetProfile.user_id;
            } else {
                nextAssigneeId = firstEmpId;
            }
        }

        // Fallback to role-based lookup if no custom assignee was configured for this level
        if (!nextAssigneeId) {
            if (nextLevel === 2) {
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
                const { data: hrHeads } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                if (hrHeads?.[0]?.user_id) nextAssigneeId = hrHeads[0].user_id;
            } else if (nextLevel >= 4) {
                const { data: directors } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_director_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                if (directors?.[0]?.user_id) nextAssigneeId = directors[0].user_id;
            }
        }

        // Fallback: ONLY if no authority was found for the next level, fallback to any available authority or Org Super Admin
        if (!nextAssigneeId) {
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
                } else {
                    nextAssigneeId = ticket.assigned_to_user_id;
                }
            }
        }

        // Calculate SLA/TAT for next level using custom flow level config or category's configured TAT days
        let nextLevelSlaDays = nextLevel === 2 ? 7 : nextLevel === 3 ? 10 : nextLevel === 4 ? 12 : nextLevel * 3;

        // 1. Check custom flow level config first (e.g. level 5, 6 configured in tree visualizer)
        const nextLevelObj = customFlowLevels[nextLevel - 1];
        if (nextLevelObj) {
            if (nextLevelObj.sla_days && !isNaN(Number(nextLevelObj.sla_days))) {
                nextLevelSlaDays = Number(nextLevelObj.sla_days);
            } else if (nextLevelObj.slaText) {
                const matchDays = nextLevelObj.slaText.match(/(\d+)\s*working\s*day/i) || nextLevelObj.slaText.match(/(\d+)\s*day/i);
                if (matchDays && matchDays[1]) {
                    nextLevelSlaDays = Number(matchDays[1]);
                }
            }
        }

        // 2. Override with category specific lX_sla_days if explicitly defined in hr_ticket_categories table
        if (ticket.category) {
            const key = `l${nextLevel}_sla_days` as keyof typeof ticket.category;
            if (ticket.category[key] !== undefined && ticket.category[key] !== null && !isNaN(Number(ticket.category[key]))) {
                nextLevelSlaDays = Number(ticket.category[key]);
            }
        }
        const newSla = new Date(Date.now() + nextLevelSlaDays * 24 * 60 * 60 * 1000);

        const currentSnapshot = ticket.employee_snapshot || {};
        const updatedHistory = Array.from(new Set([
            ...(ticket.assigned_history || []),
            ...(currentSnapshot.assigned_history || []),
            ticket.assigned_to_user_id,
            nextAssigneeId
        ])).filter(Boolean);
        currentSnapshot.assigned_history = updatedHistory;

        await supabaseAdmin
            .from('hr_tickets')
            .update({
                current_level: nextLevel,
                assigned_to_user_id: nextAssigneeId,
                status: 'escalated',
                employee_snapshot: currentSnapshot,
                assigned_history: updatedHistory,
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

        escalatedList.push({ id: ticket.id, ticket_number: ticket.ticket_number, newLevel: nextLevel, assignedTo: nextAssigneeId });
    }

    return {
        total_breached_found: (breachedTickets || []).length,
        escalated_tickets: escalatedList
    };
}
