import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export interface HrEscalationConfig {
    flowAssignees: Record<string, any>;
    flowLevels: Record<string, any[]>;
}

const DEFAULT_MAX_LEVEL = 4;

/**
 * Reads the org-level escalation tree (levels + per-level assignees) once.
 * Shared by the SLA auto-escalation job and the manual escalate endpoint so
 * both routes land a ticket on the SAME person the escalation tree configures.
 */
export async function loadHrEscalationConfig(): Promise<HrEscalationConfig> {
    try {
        const { data: orgSettings } = await supabaseAdmin
            .from('organization_settings')
            .select('hr_escalation_config')
            .limit(1)
            .maybeSingle();

        if (orgSettings?.hr_escalation_config) {
            return {
                flowAssignees: orgSettings.hr_escalation_config.flow_assignees || {},
                flowLevels: orgSettings.hr_escalation_config.flow_levels || {}
            };
        }
    } catch (e) {
        console.warn('Could not read hr_escalation_config:', e);
    }
    return { flowAssignees: {}, flowLevels: {} };
}

/** Highest level this ticket type can reach. Falls back to the built-in 4-level ladder. */
export function getMaxLevelForFlow(config: HrEscalationConfig, ticketType: string): number {
    const levels = config.flowLevels[ticketType] || config.flowLevels['grievance'] || [];
    return levels.length > 0 ? levels.length : DEFAULT_MAX_LEVEL;
}

/**
 * Resolves the owner of a given escalation level.
 * Order: configured tree assignee -> role authority flag -> any other authority -> org admin.
 * `currentAssigneeId` is only used to avoid handing the ticket straight back to the
 * person who just breached it during the last-resort fallback.
 */
export async function resolveLevelAssignee(
    config: HrEscalationConfig,
    ticketType: string,
    level: number,
    currentAssigneeId?: string | null
): Promise<string | null> {
    let assigneeId: string | null = null;

    // 1. Explicit assignee from the escalation tree
    const configured =
        config.flowAssignees[ticketType]?.[String(level)] ||
        config.flowAssignees[ticketType]?.[level];

    if (Array.isArray(configured) && configured.length > 0) {
        const firstEmpId = configured[0];
        const { data: targetProfile } = await supabaseAdmin
            .from('employee_profiles')
            .select('user_id')
            .or(`id.eq.${firstEmpId},user_id.eq.${firstEmpId}`)
            .limit(1);

        assigneeId = targetProfile?.[0]?.user_id || firstEmpId;
    }

    // 2. Role authority flags for the built-in ladder
    if (!assigneeId) {
        let flagFilter: string | null = null;
        if (level === 2) flagFilter = 'is_hr_manager_authority';
        else if (level === 3) flagFilter = 'is_hr_authority';
        else if (level >= 4) flagFilter = 'is_director_authority';

        if (flagFilter) {
            const { data: rows } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq(flagFilter, true)
                .not('user_id', 'is', null)
                .limit(1);
            if (rows?.[0]?.user_id) assigneeId = rows[0].user_id;
        }

        // Level 2 secondary: fall back to HR authority when no HR manager exists
        if (!assigneeId && level === 2) {
            const { data: hrStaff } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('is_hr_authority', true)
                .not('user_id', 'is', null)
                .limit(1);
            if (hrStaff?.[0]?.user_id) assigneeId = hrStaff[0].user_id;
        }
    }

    // 3. Last resort: any authority other than the breaching assignee, else an org admin
    if (!assigneeId) {
        const { data: fallbackAuth } = await supabaseAdmin
            .from('employee_profiles')
            .select('user_id')
            .or('is_director_authority.eq.true,is_hr_authority.eq.true,is_hr_manager_authority.eq.true')
            .neq('user_id', currentAssigneeId || '00000000-0000-0000-0000-000000000000')
            .not('user_id', 'is', null)
            .limit(1);

        if (fallbackAuth?.[0]?.user_id) {
            assigneeId = fallbackAuth[0].user_id;
        } else {
            const { data: orgAdminMem } = await supabaseAdmin
                .from('organization_memberships')
                .select('user_id')
                .or('role.eq.org_super_admin,role.eq.ops_super_admin')
                .limit(1);
            assigneeId = orgAdminMem?.[0]?.user_id || currentAssigneeId || null;
        }
    }

    return assigneeId;
}

/** TAT (in days) for the level being escalated into. */
export function resolveLevelSlaDays(
    config: HrEscalationConfig,
    ticketType: string,
    level: number,
    category: any
): number {
    let slaDays = level === 2 ? 7 : level === 3 ? 10 : level === 4 ? 12 : level * 3;

    const levels = config.flowLevels[ticketType] || config.flowLevels['grievance'] || [];
    const levelObj = levels[level - 1];
    if (levelObj) {
        if (levelObj.sla_days !== undefined && levelObj.sla_days !== null && !isNaN(Number(levelObj.sla_days))) {
            slaDays = Number(levelObj.sla_days);
        } else if (levelObj.slaText) {
            const matchDays =
                levelObj.slaText.match(/(\d+)\s*working\s*day/i) || levelObj.slaText.match(/(\d+)\s*day/i);
            if (matchDays?.[1]) slaDays = Number(matchDays[1]);
        }
    }

    // Category-level override always wins
    if (category) {
        const key = `l${level}_sla_days`;
        if (category[key] !== undefined && category[key] !== null && !isNaN(Number(category[key]))) {
            slaDays = Number(category[key]);
        }
    }

    return slaDays;
}

/**
 * Appends every party that has ever held the ticket to `assigned_history`.
 * This array is what keeps a level-N owner able to see the ticket after it has
 * moved on to level N+1 — never overwrite it, only extend it.
 */
export function buildAssignedHistory(ticket: any, nextAssigneeId?: string | null): string[] {
    const snapshotHistory = (ticket.employee_snapshot || {}).assigned_history || [];
    return Array.from(
        new Set([
            ...(ticket.assigned_history || []),
            ...snapshotHistory,
            ticket.manager_user_id,
            ticket.assigned_to_user_id,
            nextAssigneeId
        ])
    ).filter(Boolean) as string[];
}

export async function runAutoSlaEscalation() {
    const nowIso = new Date().toISOString();

    const config = await loadHrEscalationConfig();

    // 1. Fetch all open tickets where SLA has expired and status is not resolved/closed/cancelled
    const { data: breachedTickets, error } = await supabaseAdmin
        .from('hr_tickets')
        .select('*, category:hr_ticket_categories(*)')
        .lt('sla_due_at', nowIso)
        .not('status', 'in', '("resolved","closed","cancelled")');

    if (error) throw error;

    const escalatedList = [];

    for (const ticket of breachedTickets || []) {
        const ticketType = ticket.ticket_type || ticket.category?.ticket_type || 'grievance';
        const maxLevelForFlow = getMaxLevelForFlow(config, ticketType);

        if ((ticket.current_level || 1) >= maxLevelForFlow) {
            continue; // Already at max escalation level
        }

        const nextLevel = (ticket.current_level || 1) + 1;
        const nextAssigneeId = await resolveLevelAssignee(
            config,
            ticketType,
            nextLevel,
            ticket.assigned_to_user_id
        );

        const slaDays = resolveLevelSlaDays(config, ticketType, nextLevel, ticket.category);
        const newSla = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000);

        const updatedHistory = buildAssignedHistory(ticket, nextAssigneeId);
        const currentSnapshot = { ...(ticket.employee_snapshot || {}), assigned_history: updatedHistory };

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

        // Audit log. `assigned_to` keys are read back by the ticket-list visibility
        // filter, so both the old and the new holder must be recorded here.
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: ticket.id,
            action: `AUTO_ESCALATED_SLA_BREACH_L${nextLevel}`,
            old_values: {
                level: ticket.current_level,
                status: ticket.status,
                assigned_to: ticket.assigned_to_user_id
            },
            new_values: { level: nextLevel, status: 'escalated', assigned_to: nextAssigneeId }
        });

        escalatedList.push({
            id: ticket.id,
            ticket_number: ticket.ticket_number,
            newLevel: nextLevel,
            assignedTo: nextAssigneeId
        });
    }

    return {
        total_breached_found: (breachedTickets || []).length,
        escalated_tickets: escalatedList
    };
}
