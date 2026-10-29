/**
 * Meeting Assistant: who can open what. Kept apart (no database imports) so tests run offline.
 *
 * Owner 2026-10-29: the Meeting Assistant lives in three dashboards, each with its OWN meetings ("space"):
 *   tech   the Tech console              (role 'tech')
 *   hr     the HR console                (roles 'hr', 'hr_head', 'hr_manager', 'hr_ops')
 *   admin  the Super Admin console       (role 'org_super_admin')
 * Inside a space every meeting is shared with everyone in it, except a confidential one (its creator only).
 */

export type MeetingSpace = 'tech' | 'hr' | 'admin';
export const MEETING_SPACES: readonly MeetingSpace[] = ['tech', 'hr', 'admin'];

const ROLE_SPACE: Record<string, MeetingSpace> = {
    tech: 'tech',
    hr: 'hr', hr_head: 'hr', hr_manager: 'hr', hr_ops: 'hr',
    org_super_admin: 'admin',
};

/** The spaces a person may use, from their active membership roles. */
export function spacesForRoles(roles: Array<string | null | undefined>): Set<MeetingSpace> {
    const out = new Set<MeetingSpace>();
    for (const r of roles) {
        const s = ROLE_SPACE[String(r ?? '').toLowerCase()];
        if (s) out.add(s);
    }
    return out;
}

export const isMeetingSpace = (v: unknown): v is MeetingSpace => typeof v === 'string' && (MEETING_SPACES as readonly string[]).includes(v);

/** How someone who is not in the Task Manager is shown when they send tasks "as me". */
export const SPACE_DEPARTMENT: Record<MeetingSpace, string> = { tech: 'Tech', hr: 'HR', admin: 'Management' };

export const canSee = (m: { confidential: boolean; created_by: string }, userId: string) => !m.confidential || m.created_by === userId;
