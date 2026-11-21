/**
 * The IT team rule (owner 2026-11-20: "only the ones who tag @Rahul Ramjiyawan in the ticket or specifically mention IT
 * in the ticket must go to this"; "i meant ... create IT as a team and not as category"; "anyone with IT role"; "it must
 * go straight to rahul"; a starter "IT support" category so it works from day one).
 *
 * A ticket goes to the IT team, before the AI is asked, when it tags someone who holds the organisation's IT role by
 * full name ("@Rahul Ramjiyawan"). Owner 2026-11-20, later: the word "IT" alone no longer counts ("we need to remove the
 * "IT" keyword based ticket assignment"): "7th Floor- SBI Dhruva IT Store cleaning required" is a cleaning ticket.
 * Such a ticket gets one of the property's IT categories (categories whose team is IT, set in Brain → Categories &
 * SLAs); its SLA and usual priority come from that category, like any other. With one IT category it is that one; with
 * more, the AI chooses among the IT categories only. Every other ticket is sorted by the AI without the IT categories,
 * so nothing else lands in IT. With no IT category at the property the rule does nothing and sorting is as before.
 * assignment.ts gives an IT team ticket straight to the IT person.
 *
 * A fixed rule, not a model: the owner named the exact conditions, and a rule is exact and costs nothing `[BAA p.93]`.
 */
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import type { CategoryOption } from './aiClassifier';

/** The IT team's code (skill_groups.code). */
export const IT_TEAM = 'it' as const;

/** The starter category the SQL file adds ("IT support"); the default when the AI cannot choose. */
export const IT_STARTER_CODE = 'it_support';

export interface ItMember { user_id: string; full_name: string }

/**
 * Active members of the property's organisation who hold the org-level 'it' role, with lower-cased full names.
 * Uses the admin client (as /api/tickets/mention-users does) because the caller's client may not be allowed to
 * read other users' organisation memberships. Read-only. Returns [] on any failure so sorting and assignment carry on.
 */
export async function getOrgItMembers(propertyId: string): Promise<ItMember[]> {
    try {
        const admin = createAdminClient();
        const { data: prop } = await admin.from('properties').select('organization_id').eq('id', propertyId).maybeSingle();
        if (!prop?.organization_id) return [];
        const { data } = await admin
            .from('organization_memberships')
            .select('user_id, users!organization_memberships_user_id_fkey(full_name)')
            .eq('organization_id', prop.organization_id)
            .eq('is_active', true)
            .eq('role', 'it');
        type Row = { user_id: string; users: { full_name: string | null } | { full_name: string | null }[] | null };
        return ((data || []) as Row[])
            .map(m => {
                const u = Array.isArray(m.users) ? m.users[0] : m.users;
                return { user_id: m.user_id, full_name: (u?.full_name || '').trim().toLowerCase() };
            })
            .filter(m => m.full_name);
    } catch (err) {
        console.error('[IT rule] Could not load IT members:', err);
        return [];
    }
}

/** The IT member the ticket tags by full name ("@Rahul Ramjiyawan"), or null (pure). */
export function taggedItMember(text: string, members: readonly ItMember[]): ItMember | null {
    const t = String(text ?? '').toLowerCase().replace(/\s+/g, ' ');
    if (!t.includes('@')) return null;
    return members.find(m => m.full_name && t.includes(`@${m.full_name.replace(/\s+/g, ' ')}`)) ?? null;
}

/** The property's IT categories: those whose team is IT (pure). */
export const itCategories = (categories: readonly CategoryOption[]) => categories.filter(c => c.team === IT_TEAM);

/** The list the AI may choose from for an ordinary ticket: every category but the IT ones (pure). */
export const withoutIt = (categories: readonly CategoryOption[]) => categories.filter(c => c.team !== IT_TEAM);

/** The IT category used when the AI is not asked or cannot choose: the starter one, else the first by name (pure). */
export function defaultItCategory(its: readonly CategoryOption[]): CategoryOption | null {
    return its.find(c => c.code === IT_STARTER_CODE) ?? [...its].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

export interface ItDecision {
    /** The IT categories the ticket may get (at least one). */
    categories: CategoryOption[];
    /** The one to use when there is no choice to make, or the AI cannot make it. */
    fallback: CategoryOption;
    reason: string;
}

/**
 * The rule's decision for one ticket, or null when it tags no IT person or the property has no IT category.
 * IT members are only looked up when the text tags someone. Never throws.
 */
export async function itRuleFor(
    text: string,
    categories: readonly CategoryOption[],
    propertyId: string | null | undefined,
    members?: readonly ItMember[],
): Promise<ItDecision | null> {
    const its = itCategories(categories);
    const fallback = defaultItCategory(its);
    if (!fallback) return null;
    if (!String(text ?? '').includes('@')) return null;
    const list = members ?? (propertyId ? await getOrgItMembers(propertyId) : []);
    return taggedItMember(text, list) ? { categories: its, fallback, reason: 'The ticket tags someone from the IT team, so it goes to the IT team.' } : null;
}
