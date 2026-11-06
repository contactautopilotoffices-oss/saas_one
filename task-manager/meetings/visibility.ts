/**
 * Meeting Assistant: who can open what. Kept apart (no database imports) so tests run offline.
 *
 * Owner 2026-10-29: the Meeting Assistant lives in several dashboards, each with its OWN meetings ("space"):
 *   tech         the Tech console              (role 'tech')
 *   hr           the HR console                (roles 'hr', 'hr_head', 'hr_manager', 'hr_ops')
 *   admin        the Super Admin console       (role 'org_super_admin')
 *   procurement  the Procurement dashboard     (roles 'procurement', 'purchase_manager', 'purchase_executive') (owner 2026-11-04)
 *   design       the Design console            (role 'design') (owner 2026-11-04)
 *   operations   the Ops Super Admin dashboard (role 'ops_super_admin') (owner 2026-11-04)
 * Inside a space every meeting is shared with everyone in it, except a confidential one (its creator only).
 */

export type MeetingSpace = 'tech' | 'hr' | 'admin' | 'procurement' | 'design' | 'operations';
export const MEETING_SPACES: readonly MeetingSpace[] = ['tech', 'hr', 'admin', 'procurement', 'design', 'operations'];

const ROLE_SPACE: Record<string, MeetingSpace> = {
    tech: 'tech',
    hr: 'hr', hr_head: 'hr', hr_manager: 'hr', hr_ops: 'hr',
    org_super_admin: 'admin',
    procurement: 'procurement', purchase_manager: 'procurement', purchase_executive: 'procurement',
    design: 'design',
    ops_super_admin: 'operations',
};

/** Spaces whose roles also count when held on a property. Every other space takes organisation roles only. */
const PROPERTY_ROLE_SPACES: readonly MeetingSpace[] = ['hr', 'procurement'];

/** The spaces a person may use, from their active membership roles. */
export function spacesForRoles(roles: Array<string | null | undefined>): Set<MeetingSpace> {
    const out = new Set<MeetingSpace>();
    for (const r of roles) {
        const s = ROLE_SPACE[String(r ?? '').toLowerCase()];
        if (s) out.add(s);
    }
    return out;
}

/** The spaces a person may use, from their organisation roles and their property roles (see PROPERTY_ROLE_SPACES). */
export function spacesForMemberships(orgRoles: Array<string | null | undefined>, propertyRoles: Array<string | null | undefined>): Set<MeetingSpace> {
    const out = spacesForRoles(orgRoles);
    for (const s of spacesForRoles(propertyRoles)) if (PROPERTY_ROLE_SPACES.includes(s)) out.add(s);
    return out;
}

export const isMeetingSpace = (v: unknown): v is MeetingSpace => typeof v === 'string' && (MEETING_SPACES as readonly string[]).includes(v);

/** How someone who is not in the Task Manager is shown when they send tasks "as me". */
export const SPACE_DEPARTMENT: Record<MeetingSpace, string> = { tech: 'Tech', hr: 'HR', admin: 'Management', procurement: 'Procurement', design: 'Design', operations: 'Operations' };

export const canSee = (m: { confidential: boolean; created_by: string }, userId: string) => !m.confidential || m.created_by === userId;
