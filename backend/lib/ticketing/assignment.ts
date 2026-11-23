import { createClient } from '@/frontend/utils/supabase/server';
import { getOrgItMembers, IT_TEAM } from './itRule';

// getOrgItMembers moved to itRule.ts (2026-11-20) so ticket sorting can use it too; unchanged.

/**
 * Owner 2026-11-16: the property roles that can be handed a ticket. Soft service supervisors and managers
 * can receive soft service tickets.
 */
const ASSIGNABLE_ROLES = ['mst', 'staff', 'soft_service_supervisor', 'soft_service_manager'];

/**
 * Roles that only ever receive work in their own skill pool — they are deliberately kept out of the `general`
 * pool, so a technical or plumbing ticket is never round-robined onto a soft service supervisor or manager.
 */
const SKILL_ONLY_ROLES = ['soft_service_supervisor', 'soft_service_manager'];

/**
 * Minimum remaining minutes in a shift required to assign a new ticket.
 * If a resolver has less than this buffer (e.g. 30 mins) before their shift ends,
 * tickets are routed to resolvers with adequate remaining time or to the incoming shift.
 */
const SHIFT_END_BUFFER_MINUTES = 30;

function getMinutesUntilShiftEnd(currentTime: string, endTime: string | null): number {
    if (!endTime) return 999;
    const [cHours, cMins] = currentTime.split(':').map(Number);
    const [eHours, eMins] = endTime.split(':').map(Number);
    let diffMins = (eHours * 60 + eMins) - (cHours * 60 + cMins);
    if (diffMins < 0) diffMins += 24 * 60; // Overnight shift
    return diffMins;
}

function getMinutesUntilShiftStart(currentTime: string, startTime: string | null): number {
    if (!startTime) return 999;
    const [cHours, cMins] = currentTime.split(':').map(Number);
    const [sHours, sMins] = startTime.split(':').map(Number);
    let diffMins = (sHours * 60 + sMins) - (cHours * 60 + cMins);
    if (diffMins < 0) diffMins += 24 * 60;
    return diffMins;
}

interface AssignmentResult {
    ticketId: string;
    assignedTo: string | null;
    status: string;
    error?: string;
}

interface TicketData {
    id: string;
    property_id: string;
    skill_group_code: string | null;
    title?: string;
    description?: string;
}

interface ResolverStat {
    user_id: string;
    last_assigned_at: string | null;
    is_checked_in: boolean;
    skill_group?: { code: string } | any;
}

/**
 * Intelligent Assignment Logic
 * Assigns tickets to MSTs based on skill groups and load balancing (persistent round-robin)
 * ALWAYS assigns tickets - if no resolver available, finds any active MST/staff
 */
export async function processIntelligentAssignment(
    supabase: any,
    tickets: TicketData[],
    propertyId: string
): Promise<{ summary: any; results: AssignmentResult[] }> {
    const results: AssignmentResult[] = [];

    // 1. Fetch resolver stats for load balancing (sorting by last_assigned_at ensures persistent round-robin)
    const { data: resolverStats, error: statsError } = await supabase
        .from('resolver_stats')
        .select(`
            user_id,
            last_assigned_at,
            is_checked_in,
            skill_group:skill_groups(code)
        `)
        .eq('property_id', propertyId)
        .eq('is_available', true);

    if (statsError) {
        console.error('Error fetching resolver stats:', statsError);
        throw statsError;
    }

    const typedResolverStats: ResolverStat[] = resolverStats || [];

    // 2. Fetch specific skill mappings
    const { data: mstSkills } = await supabase
        .from('mst_skills')
        .select('user_id, skill_code')
        .in('user_id', typedResolverStats.map((rs: any) => rs.user_id));

    // 2.5 Fetch all active MST/Staff/Supervisor members for this property (for role checking and @mention assignment)
    const { data: allMembersInfo } = await supabase
        .from('property_memberships')
        .select('user_id, role, users:users!property_memberships_user_id_fkey(full_name)')
        .eq('property_id', propertyId)
        .eq('is_active', true)
        .in('role', ASSIGNABLE_ROLES);

    // Create a map of user_id -> role for quick lookup
    const userRoleMap: Record<string, string> = {};
    (allMembersInfo || []).forEach((ur: any) => {
        userRoleMap[ur.user_id] = ur.role;
    });

    // Ensure all assignable active members from property_memberships are represented in typedResolverStats
    const existingResolverUserIds = new Set(typedResolverStats.map(rs => rs.user_id));
    (allMembersInfo || []).forEach((mem: any) => {
        if (!existingResolverUserIds.has(mem.user_id)) {
            typedResolverStats.push({
                user_id: mem.user_id,
                last_assigned_at: null,
                is_checked_in: false,
                skill_group: { code: SKILL_ONLY_ROLES.includes(mem.role) ? 'soft_services' : 'general' }
            });
            existingResolverUserIds.add(mem.user_id);
        }
    });

    // 3. Map MSTs to pools (excluding staff with technical skill from assignment)
    const mstPools: Record<string, ResolverStat[]> = {
        technical: [],
        plumbing: [],
        soft_services: [],
        vendor: [],
        general: []
    };

    typedResolverStats.forEach((rs: ResolverStat) => {
        const userId = rs.user_id;
        const userRole = userRoleMap[userId];
        const primarySkill = rs.skill_group?.code;
        const extraSkills = mstSkills?.filter((s: any) => s.user_id === userId).map((s: any) => s.skill_code) || [];

        const allSkills = new Set([primarySkill, ...extraSkills].filter(Boolean));

        // Skip staff with technical skill - they can only view, not be assigned
        const isStaffTechnical = userRole === 'staff' && allSkills.has('technical');
        if (isStaffTechnical) {
            console.log(`Skipping staff technical user ${userId} from assignment pools`);
            return; // Don't add to any pools
        }

        allSkills.forEach(skill => {
            if (mstPools[skill]) {
                mstPools[skill].push(rs);
            }
        });

        // Soft service supervisors/managers stay in their own skill pool only (see SKILL_ONLY_ROLES), so they are not
        // round-robined technical work. Everyone else (except staff technical) is also in general.
        if (SKILL_ONLY_ROLES.includes(userRole)) return;

        mstPools.general.push(rs);
    });

    // 4. Fetch today's duty roster for property (IST date)
    // Offline staff (e.g. pantry boys, contract housekeeping) are never assigned tickets.
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const todayStr = istDate.toISOString().split('T')[0];
    const currentIstTime = istDate.toISOString().slice(11, 19); // "HH:MM:SS"

    const { data: todayRosters } = await supabase
        .from('staff_rosters')
        .select(`
            user_id,
            is_reliever,
            shift:shift_configurations(code, name, start_time, end_time, is_working_day)
        `)
        .eq('property_id', propertyId)
        .eq('roster_date', todayStr);

    const rosterScheduledWorkingUserIds = new Set<string>();
    const rosterAdequateShiftUserIds = new Set<string>();
    const rosterEndingSoonUserIds = new Set<string>();
    const rosterUpcomingShiftUserIds = new Set<string>();

    if (todayRosters && todayRosters.length > 0) {
        for (const r of todayRosters) {
            // Only consider registered app users with assignable roles (offline staff are never assigned)
            if (!userRoleMap[r.user_id]) continue;

            const shift = r.shift as any;
            const isWorking = shift ? shift.is_working_day !== false : true;
            if (!isWorking) continue; // Exclude weekly off (WO), leave (L), comp off (C OFF)

            rosterScheduledWorkingUserIds.add(r.user_id);

            // Check shift timing relative to current IST time
            if (shift?.start_time && shift?.end_time) {
                const s = shift.start_time;
                const e = shift.end_time;
                const isCurrent = s <= e
                    ? (currentIstTime >= s && currentIstTime <= e)
                    : (currentIstTime >= s || currentIstTime <= e); // Overnight shift spanning midnight

                if (isCurrent) {
                    const remainingMins = getMinutesUntilShiftEnd(currentIstTime, e);
                    if (remainingMins >= SHIFT_END_BUFFER_MINUTES) {
                        rosterAdequateShiftUserIds.add(r.user_id);
                    } else {
                        // Shift is ending within buffer window (e.g. 15 mins left) — avoid assigning unless no one else
                        rosterEndingSoonUserIds.add(r.user_id);
                    }
                } else {
                    const startMins = getMinutesUntilShiftStart(currentIstTime, s);
                    if (startMins > 0 && startMins <= SHIFT_END_BUFFER_MINUTES) {
                        // Upcoming shift starting within buffer window (ready to take ticket)
                        rosterUpcomingShiftUserIds.add(r.user_id);
                    }
                }
            } else {
                // Flexible or un-timed working shift: treat as having adequate time
                rosterAdequateShiftUserIds.add(r.user_id);
            }
        }
    }

    // 4.5 Fallback: If no resolvers found, get any active MST/staff from property_memberships
    let fallbackResolver = null;
    if (typedResolverStats.length === 0) {
        const { data: fallbackUsers } = await supabase
            .from('property_memberships')
            .select('user_id, role, last_activity_at')
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .in('role', ['mst', 'staff', 'soft_service_supervisor', 'soft_service_manager'])
            .order('last_activity_at', { ascending: false })
            .limit(1);

        if (fallbackUsers && fallbackUsers.length > 0) {
            fallbackResolver = fallbackUsers[0].user_id;
            console.log(`[Assignment] No resolver stats found, falling back to: ${fallbackResolver}`);
        }
    }

    // IT members are loaded once, and only if some ticket contains an @mention or is for the IT team
    let itMembers: { user_id: string; full_name: string }[] | null = null;

    // 5. Process tickets
    for (const ticket of tickets) {
        try {
            const poolName = (ticket.skill_group_code || 'general').toLowerCase();
            let pool = mstPools[poolName]?.length > 0 ? mstPools[poolName] : mstPools.general;

            // Roster-aware intelligent tiering:
            // Tier 1: Resolvers currently on shift with adequate time remaining (>= 30 mins)
            // Tier 2: Resolvers starting their shift shortly (<= 30 mins)
            // Tier 3: Resolvers on shift whose shift is ending soon (< 30 mins, handover buffer)
            // Tier 4: Any resolver scheduled for work today
            if (rosterAdequateShiftUserIds.size > 0) {
                const adequatePool = pool.filter(p => rosterAdequateShiftUserIds.has(p.user_id));
                if (adequatePool.length > 0) pool = adequatePool;
            } else if (rosterUpcomingShiftUserIds.size > 0) {
                const upcomingPool = pool.filter(p => rosterUpcomingShiftUserIds.has(p.user_id));
                if (upcomingPool.length > 0) pool = upcomingPool;
            } else if (rosterEndingSoonUserIds.size > 0) {
                const endingSoonPool = pool.filter(p => rosterEndingSoonUserIds.has(p.user_id));
                if (endingSoonPool.length > 0) pool = endingSoonPool;
            } else if (rosterScheduledWorkingUserIds.size > 0) {
                const scheduledWorkingPool = pool.filter(p => rosterScheduledWorkingUserIds.has(p.user_id));
                if (scheduledWorkingPool.length > 0) pool = scheduledWorkingPool;
            }

            // Prioritize checked-in users if any are available
            const checkedInPool = pool.filter(p => p.is_checked_in);
            if (checkedInPool.length > 0) pool = checkedInPool;

            let assignedTo: string | null = null;
            let status = 'assigned';

            // Check for @mention in title or description FIRST
            const fullText = `${ticket.title || ''} ${ticket.description || ''}`.toLowerCase();

            // IT team (owner 2026-11-02): an org-level 'it' member is assigned when mentioned by FULL name, at any
            // property of the organisation. Checked before the MST/staff loop so "@Rahul Kumar" (IT) is not taken
            // by an MST whose first name is also Rahul. (Since 2026-11-20 the ticket is also sorted to the IT team, itRule.ts.)
            if (fullText.includes('@')) {
                itMembers ??= await getOrgItMembers(propertyId);
                const itMatch = itMembers.find(m => fullText.includes(`@${m.full_name}`));
                if (itMatch) {
                    assignedTo = itMatch.user_id;
                    console.log(`[Assignment] @Mention of IT member found, explicitly assigning to ${assignedTo}`);
                }
            }

            // Owner 2026-11-20: an IT team ticket (itRule.ts) with no IT person tagged goes straight to the IT person
            // (today one; with more, the first by name).
            if (!assignedTo && (ticket.skill_group_code || '').toLowerCase() === IT_TEAM) {
                itMembers ??= await getOrgItMembers(propertyId);
                const itPerson = [...itMembers].sort((x, y) => x.full_name.localeCompare(y.full_name))[0];
                if (itPerson) {
                    assignedTo = itPerson.user_id;
                    console.log(`[Assignment] IT team ticket, assigning to the IT team member ${assignedTo}`);
                }
            }

            if (!assignedTo && fullText.includes('@') && allMembersInfo) {
                for (const member of allMembersInfo) {
                    const u: any = Array.isArray(member.users) ? member.users[0] : member.users;
                    const name = (u?.full_name || '').toLowerCase();
                    if (name) {
                        const firstName = name.split(' ')[0];
                        // If mentioned by full name or first name
                        if (fullText.includes(`@${name}`) || fullText.includes(`@${firstName}`)) {
                            assignedTo = member.user_id;
                            console.log(`[Assignment] @Mention found for ${name}, explicitly assigning to ${assignedTo}`);
                            break;
                        }
                    }
                }
            }

            if (!assignedTo) {
                if (pool.length > 0) {
                    // Persistent Round-Robin: Sort by last_assigned_at (nulls first)
                    pool.sort((a, b) => {
                        if (!a.last_assigned_at) return -1;
                        if (!b.last_assigned_at) return 1;
                        return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
                    });

                    const winner = pool[0];
                    assignedTo = winner.user_id;

                    // Update the winner's local stats for the next ticket in this batch
                    winner.last_assigned_at = new Date().toISOString();
                } else if (fallbackResolver) {
                    // No pool available, use fallback resolver
                    assignedTo = fallbackResolver;
                } else {
                    // Last resort: find any MST/staff in the property
                    const { data: anyResolver } = await supabase
                        .from('property_memberships')
                        .select('user_id')
                        .eq('property_id', propertyId)
                        .eq('is_active', true)
                        .in('role', ['mst', 'staff'])
                        .limit(1)
                        .single();

                    if (anyResolver) {
                        assignedTo = anyResolver.user_id;
                    }
                }
            }

            // ALWAYS assign - if still no one found, get last active MST/staff
            if (!assignedTo) {
                const { data: lastActiveMstStaff } = await supabase
                    .from('property_memberships')
                    .select('user_id, last_activity_at')
                    .eq('property_id', propertyId)
                    .eq('is_active', true)
                    .in('role', ['mst', 'staff'])
                    .order('last_activity_at', { ascending: false })
                    .limit(1)
                    .single();

                if (lastActiveMstStaff) {
                    assignedTo = lastActiveMstStaff.user_id;
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

            // Update winner's last_assigned_at in database
            if (assignedTo) {
                await supabase
                    .from('resolver_stats')
                    .update({ last_assigned_at: new Date().toISOString() })
                    .eq('user_id', assignedTo)
                    .eq('property_id', propertyId);

                // Notifications: the assignment itself fires trg_tickets_outbox, and the Omnichannel
                // matrix decides who is told and on which channel.
            }

            results.push({ ticketId: ticket.id, assignedTo, status: assignedTo ? 'assigned' : 'open' });
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
