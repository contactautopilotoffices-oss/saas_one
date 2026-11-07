import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { orgRolesIn, type CallerAccess } from '@/backend/lib/auth/callerAccess';

/**
 * HR administration (employee directory, escalation setup, reconciliation, HR notes): the same
 * people the HR screen shows those tabs to (HRTicketsContent `canViewOrgWide`). Org super admins,
 * ops super admins, directors and HR roles of the organisation, plus anyone whose employee profile
 * is marked as an HR, HR manager or director authority. Roles always come from the database.
 */
const HR_ADMIN_ORG_ROLES = ['org_super_admin', 'master_admin', 'super_admin', 'ops_super_admin', 'director', 'hr', 'hr_head', 'hr_manager', 'hr_ops', 'hr_admin'];

export async function isHrAdmin(caller: CallerAccess, orgId: string | null): Promise<boolean> {
    if (caller.isMasterAdmin) return true;
    const orgIds = orgId ? [orgId] : caller.orgMemberships.map(m => m.organization_id);
    for (const id of orgIds) {
        if (orgRolesIn(caller, id).some(r => HR_ADMIN_ORG_ROLES.includes(r) || r.includes('hr'))) return true;
    }
    let q = supabaseAdmin.from('employee_profiles')
        .select('organization_id, is_hr_authority, is_hr_manager_authority, is_director_authority')
        .eq('user_id', caller.userId);
    if (orgId) q = q.or(`organization_id.eq.${orgId},organization_id.is.null`);
    const { data } = await q;
    const authority = (data || []).some(p => p.is_hr_authority || p.is_hr_manager_authority || p.is_director_authority);
    // An authority flag counts for this organisation only if the person is also a member of it.
    return authority && (!orgId || caller.orgMemberships.some(m => m.organization_id === orgId)
        || caller.propertyMemberships.some(m => m.organization_id === orgId));
}

/** The organisations in which the caller is an HR admin (for routes that receive no organisation). */
export async function hrAdminOrgIds(caller: CallerAccess): Promise<string[]> {
    const ids = Array.from(new Set([
        ...caller.orgMemberships.map(m => m.organization_id),
        ...caller.propertyMemberships.map(m => m.organization_id).filter((x): x is string => !!x),
    ]));
    const out: string[] = [];
    for (const id of ids) if (await isHrAdmin(caller, id)) out.push(id);
    return out;
}

/**
 * May the caller change this employee profile? An HR admin of the profile's organisation (older
 * profiles with no organisation: the person's own organisation). 'missing' when there is no such profile.
 */
export async function hrAdminOfProfile(caller: CallerAccess, profileId: string): Promise<'ok' | 'missing' | 'denied'> {
    const { data: prof } = await supabaseAdmin.from('employee_profiles').select('organization_id, user_id').eq('id', profileId).maybeSingle();
    if (!prof) return 'missing';
    let orgId: string | null = prof.organization_id || null;
    if (!orgId && prof.user_id) {
        const { data: m } = await supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', prof.user_id).limit(1).maybeSingle();
        orgId = m?.organization_id || null;
    }
    return (await isHrAdmin(caller, orgId)) ? 'ok' : 'denied';
}
