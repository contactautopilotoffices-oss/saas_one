import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';
import { getRosterSnapshot } from './roster';

/**
 * Active members of the property's organisation who hold the org-level 'it' role, with lower-cased full names.
 * Uses the admin client (as /api/tickets/mention-users does) because the caller's client may not be allowed to
 * read other users' organisation memberships. Read-only. Returns [] on any failure so assignment carries on.
 */
async function getOrgItMembers(propertyId: string): Promise<{ user_id: string; full_name: string }[]> {
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
        console.error('[Assignment] Could not load IT members:', err);
        return [];
    }
}

interface AssignmentResult {
    ticketId: string;
    assignedTo: string | null;
    status: string;
    /** Which rule picked the person (for logs). */
    reason?: string;
    error?: string;
}

interface TicketData {
    id: string;
    property_id: string;
    skill_group_code: string | null;
    title?: string;
    description?: string;
}

interface Candidate {
    user_id: string;
    role: 'mst' | 'staff';
    full_name: string;
    last_assigned_at: string | null;
    is_checked_in: boolean;
    is_available: boolean;
    /** Staff who hold the technical skill only view tickets; they are never picked automatically. */
    viewOnly: boolean;
}

/** Which kind of resolver a ticket needs: soft-services work goes to staff, everything else to MSTs. */
export function resolverRoleForSkill(skillCode: string | null | undefined): 'mst' | 'staff' {
    return (skillCode || '').toLowerCase() === 'soft_services' ? 'staff' : 'mst';
}

const OPEN_WORK_STATUSES = ['assigned', 'in_progress'];

type Embedded<T> = T | T[] | null;
interface MemberRow { user_id: string; role: string; users: Embedded<{ full_name: string | null }> }
interface StatRow { user_id: string; last_assigned_at: string | null; is_checked_in: boolean | null; is_available: boolean | null; skill_group: Embedded<{ code: string }> }
interface SkillRow { user_id: string; skill_code: string }
const one = <T,>(v: Embedded<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Ticket assignment, in this order (owner 2026-11-13):
 *
 * 1. @mention. "@Full Name" of an IT member of the organisation, or of an MST/staff member of the
 *    property, assigns to that person, whatever the category or roster says. Full names are matched
 *    before first names, so "@Rahul Kumar" is not taken by another Rahul.
 * 2. Category decides the side. The ticket's skill group (set by the AI classifier) picks MSTs
 *    (technical, plumbing, vendor) or soft-services staff (soft_services). If the property has only
 *    one kind of resolver, that kind takes every ticket.
 * 3. Roster, when the property uses it (backend/lib/ticketing/roster.ts):
 *      a. someone of the right side on shift now;
 *      b. otherwise anyone on shift now, even of the other side;
 *      c. otherwise the right-side person whose shift starts next (within 24 hours), then anyone's;
 *      d. otherwise a property admin.
 * 4. No roster at the property: the old method, made strict. Right side only; checked-in people
 *    first, then those marked available, then the rest.
 * Within a group the person with the fewest open tickets wins; a tie goes to whoever has waited
 * longest since their last ticket (round robin).
 *
 * Reads use the admin client: the caller may be a tenant who cannot read other users' memberships,
 * rosters or tickets. Writes still use the caller's client, as before.
 */
export async function processIntelligentAssignment(
    supabase: any,
    tickets: TicketData[],
    propertyId: string,
    options: { notify?: boolean } = {}
): Promise<{ summary: any; results: AssignmentResult[] }> {
    const notify = options.notify !== false;
    const results: AssignmentResult[] = [];
    const admin = createAdminClient();

    // 1. Everyone who can resolve tickets at this property, with their round-robin stats and skills.
    const [{ data: memberRows, error: membersError }, { data: statRows }] = await Promise.all([
        admin
            .from('property_memberships')
            .select('user_id, role, users!inner(full_name)')
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .in('role', ['mst', 'staff']),
        admin
            .from('resolver_stats')
            .select('user_id, last_assigned_at, is_checked_in, is_available, skill_group:skill_groups(code)')
            .eq('property_id', propertyId),
    ]);
    if (membersError) {
        console.error('[Assignment] Could not load resolvers:', membersError);
        throw membersError;
    }

    const members = (memberRows || []) as MemberRow[];
    const allStats = (statRows || []) as StatRow[];
    const memberIds = members.map(m => String(m.user_id));
    const { data: skillRows } = memberIds.length > 0
        ? await admin.from('mst_skills').select('user_id, skill_code').in('user_id', memberIds)
        : { data: [] as SkillRow[] };
    const extraSkills = (skillRows || []) as SkillRow[];

    const candidates: Candidate[] = members.map(m => {
        const userId = String(m.user_id);
        const stats = allStats.filter(r => String(r.user_id) === userId);
        const skills = new Set<string>([
            ...stats.map(r => one(r.skill_group)?.code).filter((c): c is string => !!c),
            ...extraSkills.filter(x => String(x.user_id) === userId).map(x => x.skill_code),
        ]);
        const lastTimes = stats.map(r => r.last_assigned_at).filter((t): t is string => !!t).sort();
        const u = one(m.users);
        return {
            user_id: userId,
            role: m.role === 'staff' ? 'staff' : 'mst',
            full_name: String(u?.full_name || '').trim().toLowerCase(),
            last_assigned_at: lastTimes.length > 0 ? lastTimes[lastTimes.length - 1] : null,
            is_checked_in: stats.some(r => !!r.is_checked_in),
            is_available: stats.some(r => !!r.is_available),
            viewOnly: m.role === 'staff' && skills.has('technical'),
        };
    });
    const assignable = candidates.filter(c => !c.viewOnly);
    const hasMst = assignable.some(c => c.role === 'mst');
    const hasStaff = assignable.some(c => c.role === 'staff');

    // 2. Open tickets per person, for the workload balance.
    const workload = new Map<string, number>();
    if (memberIds.length > 0) {
        const { data: openRows } = await admin
            .from('tickets')
            .select('assigned_to')
            .eq('property_id', propertyId)
            .in('status', OPEN_WORK_STATUSES)
            .in('assigned_to', memberIds);
        for (const r of (openRows || []) as { assigned_to: string }[]) {
            workload.set(String(r.assigned_to), (workload.get(String(r.assigned_to)) || 0) + 1);
        }
    }

    // 3. Roster and property admins (admins only matter when nobody else can be found).
    const roster = await getRosterSnapshot(admin, propertyId);
    let propertyAdmins: string[] | null = null;
    const loadPropertyAdmins = async () => {
        if (propertyAdmins) return propertyAdmins;
        const { data } = await admin
            .from('property_memberships')
            .select('user_id')
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .eq('role', 'property_admin');
        propertyAdmins = ((data || []) as { user_id: string }[]).map(r => String(r.user_id));
        return propertyAdmins;
    };

    /** Fewest open tickets first; then whoever has waited longest since their last ticket. */
    const pickBest = (pool: Candidate[]): Candidate | null => {
        if (pool.length === 0) return null;
        return [...pool].sort((a, b) => {
            const wa = workload.get(a.user_id) || 0;
            const wb = workload.get(b.user_id) || 0;
            if (wa !== wb) return wa - wb;
            if (!a.last_assigned_at) return -1;
            if (!b.last_assigned_at) return 1;
            return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
        })[0];
    };

    // IT members are loaded once, and only if some ticket contains an @mention
    let itMembers: { user_id: string; full_name: string }[] | null = null;

    for (const ticket of tickets) {
        try {
            let assignedTo: string | null = null;
            let reason = '';
            const fullText = `${ticket.title || ''} ${ticket.description || ''}`.toLowerCase();

            // Step 1: @mention wins.
            if (fullText.includes('@')) {
                // IT team (owner 2026-11-02): an org-level 'it' member is assigned when mentioned by FULL name,
                // at any property of the organisation. The category is unchanged (technical stays technical).
                itMembers ??= await getOrgItMembers(propertyId);
                const itMatch = itMembers.find(m => fullText.includes(`@${m.full_name}`));
                if (itMatch) {
                    assignedTo = itMatch.user_id;
                    reason = 'mention:it';
                }
                if (!assignedTo) {
                    const named = candidates.filter(c => c.full_name);
                    const byFull = named.find(c => fullText.includes(`@${c.full_name}`));
                    const byFirst = byFull ? null : named.find(c => fullText.includes(`@${c.full_name.split(' ')[0]}`));
                    const hit = byFull || byFirst;
                    if (hit) {
                        assignedTo = hit.user_id;
                        reason = byFull ? 'mention:full_name' : 'mention:first_name';
                    }
                }
            }

            // Step 2: which side. A property with only one kind of resolver gives that kind everything.
            const neededRole = resolverRoleForSkill(ticket.skill_group_code);
            const sidePool = assignable.filter(c => (hasMst && hasStaff ? c.role === neededRole : true));

            // Step 3: roster.
            if (!assignedTo && roster.inUse) {
                const onShiftSide = sidePool.filter(c => roster.onShift.has(c.user_id));
                const onShiftAny = assignable.filter(c => roster.onShift.has(c.user_id));
                const byNextShift = (pool: Candidate[]) => {
                    const upcoming = pool.filter(c => roster.nextShiftStart.has(c.user_id));
                    if (upcoming.length === 0) return null;
                    const earliest = Math.min(...upcoming.map(c => roster.nextShiftStart.get(c.user_id)!.getTime()));
                    return pickBest(upcoming.filter(c => roster.nextShiftStart.get(c.user_id)!.getTime() === earliest));
                };

                let winner = pickBest(onShiftSide);
                reason = 'roster:on_shift';
                if (!winner) { winner = pickBest(onShiftAny); reason = 'roster:on_shift_other_side'; }
                if (!winner) { winner = byNextShift(sidePool); reason = 'roster:next_shift'; }
                if (!winner) { winner = byNextShift(assignable); reason = 'roster:next_shift_other_side'; }
                if (winner) {
                    assignedTo = winner.user_id;
                } else {
                    const admins = await loadPropertyAdmins();
                    if (admins.length > 0) {
                        assignedTo = [...admins].sort((a, b) => (workload.get(a) || 0) - (workload.get(b) || 0))[0];
                        reason = 'roster:property_admin';
                    } else {
                        reason = '';
                    }
                }
            }

            // Step 4: no roster (or nobody from it): the old method, strict to the right side.
            if (!assignedTo) {
                const tier = sidePool.filter(c => c.is_checked_in).length > 0
                    ? sidePool.filter(c => c.is_checked_in)
                    : sidePool.filter(c => c.is_available).length > 0
                        ? sidePool.filter(c => c.is_available)
                        : sidePool;
                const winner = pickBest(tier);
                if (winner) {
                    assignedTo = winner.user_id;
                    reason = winner.is_checked_in ? 'fallback:checked_in' : winner.is_available ? 'fallback:available' : 'fallback:any';
                }
            }

            // Update database
            const { error: updateError } = await supabase
                .from('tickets')
                .update({
                    status: assignedTo ? 'assigned' : 'open',
                    assigned_to: assignedTo,
                    assigned_at: assignedTo ? new Date().toISOString() : null,
                })
                .eq('id', ticket.id);

            if (updateError) throw updateError;

            if (assignedTo) {
                console.log(`[Assignment] Ticket ${ticket.id} -> ${assignedTo} (${reason}, needs ${neededRole})`);
                // Keep the batch fair: the winner now has one more open ticket and was just assigned.
                workload.set(assignedTo, (workload.get(assignedTo) || 0) + 1);
                const nowIso = new Date().toISOString();
                const local = candidates.find(c => c.user_id === assignedTo);
                if (local) local.last_assigned_at = nowIso;

                await supabase
                    .from('resolver_stats')
                    .update({ last_assigned_at: nowIso })
                    .eq('user_id', assignedTo)
                    .eq('property_id', propertyId);

                if (notify) {
                    NotificationService.afterTicketAssigned(ticket.id, true).catch(err => {
                        console.error('[Intelligent Assignment] Notification failed:', err);
                    });
                }
            } else {
                console.warn(`[Assignment] No resolver found for ticket ${ticket.id} at property ${propertyId}`);
            }

            results.push({ ticketId: ticket.id, assignedTo, status: assignedTo ? 'assigned' : 'open', reason });
        } catch (err: any) {
            results.push({ ticketId: ticket.id, assignedTo: null, status: 'error', error: err.message });
        }
    }

    return {
        summary: {
            total: results.length,
            assigned: results.filter(r => r.status === 'assigned').length,
            unassigned: results.filter(r => r.status === 'open').length,
            errors: results.filter(r => r.status === 'error').length,
        },
        results
    };
}
