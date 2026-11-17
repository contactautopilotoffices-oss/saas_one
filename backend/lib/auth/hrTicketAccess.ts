import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getAllConfiguredAssigneeIds } from '@/backend/lib/hr/levelAssignees';
import { belongsToOrg, orgRolesIn, type CallerAccess } from '@/backend/lib/auth/callerAccess';

/**
 * Shared access rules for one HR ticket, used by /api/hr/tickets/[id] and its comments route.
 */
/** The HR ticket fields the access checks read. */
export type HrTicketAccessFields = {
    organization_id?: string | null;
    ticket_type?: string | null;
    assigned_to_user_id?: string | null;
    raised_by_user_id?: string | null;
    manager_user_id?: string | null;
    assigned_history?: unknown;
    employee_snapshot?: { manager_user_id?: string; manager_code?: string } | null;
};

/** The HR ticket's organisation must be one the signed-in caller belongs to. */
export async function inTicketOrg(caller: CallerAccess, t: HrTicketAccessFields): Promise<boolean> {
    return Boolean(t?.organization_id) && belongsToOrg(caller, t.organization_id as string);
}

/**
 * Who may change a normal (not anonymous, not confidential) HR ticket: the same people who may
 * open it in GET below. Org super admins, HR roles, the assigned handler (now or before), the
 * submitter, the reporting manager, and anyone in the ticket type's escalation config.
 * Anonymous and confidential tickets have their own stricter rules inside PATCH.
 */
export async function mayActOnHrTicket(caller: CallerAccess, t: HrTicketAccessFields): Promise<boolean> {
    if (!t.organization_id) return false;
    const uid = caller.userId;
    const roles = orgRolesIn(caller, t.organization_id).map(r => (r || '').toLowerCase().trim());
    if (caller.isMasterAdmin || roles.some(r => ['org_super_admin', 'master_admin', 'super_admin', 'hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(r))) return true;
    const { data: me } = await supabaseAdmin.from('employee_profiles')
        .select('id, employee_code, is_hr_authority, is_hr_manager_authority').eq('user_id', uid).maybeSingle();
    if (me?.is_hr_authority || me?.is_hr_manager_authority) return true;
    const ids = [uid, me?.id].filter(Boolean);
    const history: unknown[] = Array.isArray(t.assigned_history) ? t.assigned_history : [];
    if (ids.some(i => t.assigned_to_user_id === i || t.raised_by_user_id === i || history.includes(i))) return true;
    if (ids.some(i => t.manager_user_id === i || t.employee_snapshot?.manager_user_id === i)) return true;
    if (me?.employee_code && t.employee_snapshot?.manager_code === me.employee_code) return true;
    try {
        const { data: orgSettings } = await supabaseAdmin.from('organization_settings')
            .select('hr_escalation_config, notification_matrix').eq('organization_id', t.organization_id).maybeSingle();
        const configObj = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
        const assignees = getAllConfiguredAssigneeIds(configObj, t.ticket_type || '');
        if (ids.some(i => assignees.has(i))) return true;
    } catch { /* no config: fall through */ }
    return false;
}
