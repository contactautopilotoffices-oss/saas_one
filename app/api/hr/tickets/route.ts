import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';
import { runAutoSlaEscalation } from '@/backend/lib/hr/slaEscalation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        // Run SLA breach auto-escalation check in real-time on ticket fetch
        await runAutoSlaEscalation().catch(err => console.error('[HR SLA Auto Check Error]:', err));

        const { searchParams } = new URL(request.url);

        const orgId = searchParams.get('orgId');
        const userId = searchParams.get('userId');
        const role = searchParams.get('role') || 'employee';
        const type = searchParams.get('type');
        const status = searchParams.get('status');

        const propertyId = searchParams.get('propertyId');

        let query = supabaseAdmin
            .from('hr_tickets')
            .select(`
                *,
                category:hr_ticket_categories(*),
                raised_by:users!raised_by_user_id(id, email, full_name),
                assigned_to:users!assigned_to_user_id(id, email, full_name)
            `)
            .order('created_at', { ascending: false });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }
        if (propertyId && propertyId !== 'all') {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('name')
                .eq('id', propertyId)
                .maybeSingle();
            
            const propName = prop?.name;
            if (propName) {
                query = query.or(`employee_snapshot->>property_id.eq.${propertyId},employee_snapshot->>location.ilike.%${propName}%,employee_snapshot->>property_id.is.null`);
            } else {
                query = query.or(`employee_snapshot->>property_id.eq.${propertyId},employee_snapshot->>property_id.is.null`);
            }
        }

        // Granular Role Scoping
        const normalizedRole = (role || '').toLowerCase();
        const hrRoles = ['hr', 'hr_head', 'hr_manager', 'hr_ops', 'org_super_admin', 'ops_super_admin', 'master_admin', 'org_admin'];

        // PostgREST treats , . ( ) and " as syntax inside an or() group. Any free-text
        // value (a person's name) has to be double-quoted, and a name that carries a
        // quote itself can never be made safe, so it is dropped rather than corrupting
        // the whole filter (a malformed or() fails the entire request, not just one term).
        const safeIlike = (column: string, value: string): string | null => {
            const cleaned = (value || '').trim();
            if (!cleaned || cleaned.includes('"')) return null;
            return `${column}.ilike."*${cleaned}*"`;
        };

        let isHrAuthorityUser = false;
        let isDirectorAuthorityUser = false;
        if (userId) {
            // Check employee_profiles for HR authority flags (avoid .maybeSingle() error when multiple rows exist)
            const { data: hrEmps } = await supabaseAdmin
                .from('employee_profiles')
                .select('is_hr_authority, is_hr_manager_authority, is_director_authority')
                .eq('user_id', userId);

            if (hrEmps && hrEmps.some(e => e.is_hr_authority || e.is_hr_manager_authority)) {
                isHrAuthorityUser = true;
            }
            if (hrEmps && hrEmps.some(e => e.is_director_authority)) {
                isDirectorAuthorityUser = true;
            }

            // Check organization_memberships for App roles (hr, hr_head, org_super_admin, etc.)
            if (!isHrAuthorityUser) {
                const { data: mems } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('role')
                    .eq('user_id', userId);

                if (mems && mems.some(m => hrRoles.includes((m.role || '').toLowerCase()))) {
                    isHrAuthorityUser = true;
                }
            }
        }

        if (isHrAuthorityUser || hrRoles.includes(normalizedRole)) {
            query = query.or('is_confidential.eq.false,is_confidential.is.null');
        } else if (userId) {
            // Fetch manager's employee profile (if any) to resolve profile ID & employee code.
            // Duplicate profiles for one user are common here, so take the first row instead
            // of .maybeSingle() (which errors out and blanks the whole ticket list).
            const { data: mgrProfiles } = await supabaseAdmin
                .from('employee_profiles')
                .select('id, employee_code, user_id')
                .eq('user_id', userId)
                .limit(1);

            const mgrProfile = mgrProfiles?.[0];
            const mgrProfId = mgrProfile?.id;
            const mgrCode = mgrProfile?.employee_code;

            // Fetch user profile for name matching in level_owners / snapshots
            const { data: uProfile } = await supabaseAdmin
                .from('users')
                .select('full_name')
                .eq('id', userId)
                .maybeSingle();

            const cleanName = (uProfile?.full_name || '').trim();

            // Dynamically check if user is a reporting manager for any employees (matching user_id, profile id, or manager name/code)
            const reporteeConditions: string[] = [
                `reporting_manager_id.eq.${userId}`
            ];
            if (mgrProfId) {
                reporteeConditions.push(`reporting_manager_id.eq.${mgrProfId}`);
            }
            const reporteeNameCond = cleanName ? safeIlike('reporting_manager_code', cleanName) : null;
            if (reporteeNameCond) reporteeConditions.push(reporteeNameCond);
            const reporteeCodeCond = mgrCode ? safeIlike('reporting_manager_code', mgrCode) : null;
            if (reporteeCodeCond) reporteeConditions.push(reporteeCodeCond);

            const { data: reportees } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .or(reporteeConditions.join(','))
                .not('user_id', 'is', null);

            // Tickets this user has ever held. `assigned_history` is JSONB, and jsonb
            // containment cannot be expressed inside an or() group, so it is resolved
            // as its own query and folded back in as an id list. This is what keeps a
            // level-N owner able to see a ticket after it escalates to level N+1.
            const { data: historyTickets, error: historyErr } = await supabaseAdmin
                .from('hr_tickets')
                .select('id')
                .filter('assigned_history', 'cs', JSON.stringify([userId]));

            if (historyErr) {
                console.error('[HR Tickets] assigned_history lookup failed:', historyErr);
            }

            const { data: snapshotTickets } = await supabaseAdmin
                .from('hr_tickets')
                .select('id')
                .filter('employee_snapshot->assigned_history', 'cs', JSON.stringify([userId]));

            // Fetch any tickets where this user was involved via audit logs (actor or previous/new assigned manager)
            const { data: auditLogs } = await supabaseAdmin
                .from('hr_ticket_audit_logs')
                .select('ticket_id')
                .or(`actor_user_id.eq.${userId},old_values->>assigned_to.eq.${userId},new_values->>assigned_to.eq.${userId}`);

            const reporteeUserIds = (reportees || []).map(r => r.user_id).filter(Boolean);
            const allowedUserIds = Array.from(new Set([userId, ...reporteeUserIds]));

            const participantTicketIds = Array.from(new Set([
                ...(historyTickets || []).map(t => t.id),
                ...(snapshotTickets || []).map(t => t.id),
                ...(auditLogs || []).map(a => a.ticket_id)
            ].filter(Boolean)));

            const filterConditions: string[] = [
                `assigned_to_user_id.eq.${userId}`,
                `manager_user_id.eq.${userId}`,
                `employee_snapshot->>manager_user_id.eq.${userId}`
            ];
            if (allowedUserIds.length > 0) {
                filterConditions.push(`raised_by_user_id.in.(${allowedUserIds.join(',')})`);
            }
            if (cleanName) {
                for (const col of ['employee_snapshot->>manager_code', 'employee_snapshot->>manager_name', 'employee_snapshot->>reporting_manager_name']) {
                    const cond = safeIlike(col, cleanName);
                    if (cond) filterConditions.push(cond);
                }
            }
            if (mgrCode) {
                const cond = safeIlike('employee_snapshot->>manager_code', mgrCode);
                if (cond) filterConditions.push(cond);
            }
            if (participantTicketIds.length > 0) {
                filterConditions.push(`id.in.(${participantTicketIds.join(',')})`);
            }

            // A director additionally sees the confidential / anonymous stream and anything
            // sitting at the top of the ladder. These are ADDED to their own participation
            // scope, never substituted for it.
            if (isDirectorAuthorityUser || normalizedRole === 'director') {
                filterConditions.push('is_confidential.eq.true');
                filterConditions.push('is_anonymous.eq.true');
                filterConditions.push('current_level.gte.4');
            }

            query = query.or(filterConditions.join(','));
        } else if (normalizedRole === 'director') {
            query = query.or('is_confidential.eq.true,is_anonymous.eq.true,current_level.gte.4');
        }

        if (type) query = query.eq('ticket_type', type);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        // Mask identity for anonymous tickets
        const sanitized = (data || []).map(t => {
            if (t.is_anonymous) {
                return {
                    ...t,
                    raised_by_user_id: null,
                    raised_by: { id: null, email: 'anonymous@hidden.local', raw_user_meta_data: { full_name: 'Anonymous Employee' } },
                    employee_snapshot: { name: 'Anonymous Employee', department: 'Confidential', location: 'Hidden' }
                };
            }
            return t;
        });

        return NextResponse.json({ success: true, data: sanitized });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            organization_id,
            property_id,
            category_id,
            raised_by_user_id,
            subject,
            description,
            attachment_urls = [],
            is_confidential = false,
            is_anonymous = false,
            priority = 'medium'
        } = body;

        if (!category_id || !subject || !description) {
            return NextResponse.json({ success: false, error: 'Category, subject, and description are required' }, { status: 400 });
        }

        // 1. Fetch category details
        const { data: category, error: catErr } = await supabaseAdmin
            .from('hr_ticket_categories')
            .select('*')
            .eq('id', category_id)
            .single();

        if (catErr || !category) {
            return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 404 });
        }

        // 2. Fetch employee profile & reporting manager
        let empProfile: any = null;
        let submitterUser: any = null;
        if (raised_by_user_id) {
            const { data: userObj } = await supabaseAdmin
                .from('users')
                .select('id, email, full_name')
                .eq('id', raised_by_user_id)
                .maybeSingle();
            submitterUser = userObj;

            const { data: profile } = await supabaseAdmin
                .from('employee_profiles')
                .select('*, reporting_manager:users!reporting_manager_id(full_name, email)')
                .eq('user_id', raised_by_user_id)
                .maybeSingle();
            empProfile = profile;

            if (!empProfile && submitterUser?.email) {
                const { data: profByEmail } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('*, reporting_manager:users!reporting_manager_id(full_name, email)')
                    .eq('email', submitterUser.email)
                    .maybeSingle();
                if (profByEmail) empProfile = profByEmail;
            }
        }

        const effectiveOrgId = organization_id || empProfile?.organization_id || '211e1330-ad83-446d-941f-dcea48396798';
        const empLocation = empProfile?.location || 'Lower Parel';

        // 3. Generate Format: HR + Org Initial + Property Initial + Year + Serial (e.g. HR-WS-LP-2026-00001)
        let ticketNumber = '';
        const { data: generatedNum, error: rpcErr } = await supabaseAdmin.rpc('generate_hr_ticket_number', {
            p_org_id: effectiveOrgId,
            p_property_id: property_id || null,
            p_location: empLocation
        });

        if (!rpcErr && generatedNum) {
            ticketNumber = generatedNum;
        } else {
            // Fallback: derive initials from location (e.g. "Lower Parel" -> "LP")
            const locInitials = empLocation.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase() || 'LP';
            const year = new Date().getFullYear();
            const { count } = await supabaseAdmin.from('hr_tickets').select('*', { count: 'exact', head: true });
            const seqStr = String((count || 0) + 1).padStart(5, '0');
            ticketNumber = `HR-WS-${locInitials}-${year}-${seqStr}`;
        }

        // 4. Determine Ticket Type & Owner Auto-Routing
        let ticketType = category.ticket_type;
        if (is_anonymous) ticketType = 'anonymous_feedback';
        else if (is_confidential) ticketType = 'confidential_feedback';

        let firstLevelOwnerId: string | null = null;
        let isFallbackHrManager = false;

        if (ticketType === 'confidential_feedback' || ticketType === 'anonymous_feedback' || category.first_level_owner_type === 'director') {
            const { data: directors } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('is_director_authority', true)
                .not('user_id', 'is', null)
                .limit(1);

            firstLevelOwnerId = directors?.[0]?.user_id || null;
        } else if (category.first_level_owner_type === 'hr') {
            firstLevelOwnerId = category.default_hr_owner_id;
            if (!firstLevelOwnerId) {
                const { data: hrStaff } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                firstLevelOwnerId = hrStaff?.[0]?.user_id || null;
            }
        } else {
            firstLevelOwnerId = empProfile?.reporting_manager_id || empProfile?.alternate_manager_id;

            // If reporting_manager_id is null, try resolving manager user_id by reporting_manager_code / name
            if (!firstLevelOwnerId && empProfile?.reporting_manager_code) {
                const mgrCodeStr = empProfile.reporting_manager_code.trim();
                // 1. Try matching employee_code
                const { data: mgrEmpByCode } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('employee_code', mgrCodeStr)
                    .not('user_id', 'is', null)
                    .maybeSingle();

                if (mgrEmpByCode?.user_id) {
                    firstLevelOwnerId = mgrEmpByCode.user_id;
                } else {
                    // 2. Try matching user full_name or email
                    const { data: mgrUserByName } = await supabaseAdmin
                        .from('users')
                        .select('id')
                        .or(`full_name.ilike.%${mgrCodeStr}%,email.ilike.%${mgrCodeStr}%`)
                        .maybeSingle();

                    if (mgrUserByName?.id) {
                        firstLevelOwnerId = mgrUserByName.id;
                    }
                }
            }

            if (!firstLevelOwnerId || firstLevelOwnerId === raised_by_user_id) {
                isFallbackHrManager = true;
                const { data: hrStaff } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .or('is_hr_authority.eq.true,is_hr_manager_authority.eq.true')
                    .not('user_id', 'is', null)
                    .limit(1);
                firstLevelOwnerId = hrStaff?.[0]?.user_id || category.default_hr_owner_id || null;
            }
        }

        // Final safety fallback: If still null, assign to category default owner or any HR authority
        if (!firstLevelOwnerId && category.default_hr_owner_id) {
            firstLevelOwnerId = category.default_hr_owner_id;
        }

        // Fetch resolved assigned owner name for snapshot
        let assignedOwnerName: string | null = null;
        if (firstLevelOwnerId) {
            const { data: ownerUser } = await supabaseAdmin
                .from('users')
                .select('full_name, email')
                .eq('id', firstLevelOwnerId)
                .maybeSingle();
            assignedOwnerName = ownerUser?.full_name || ownerUser?.email || null;
        }

        // 5. Calculate SLA target date
        const slaDays = Number(category.l1_sla_days) || 3;
        const slaDueAt = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000);

        // 6. Employee Snapshot with manager_user_id & assigned_history
        const managerName = assignedOwnerName || empProfile?.reporting_manager?.full_name || empProfile?.reporting_manager?.email || empProfile?.reporting_manager_code || 'HR Head';
        const submitterName = (empProfile?.first_name ? `${empProfile.first_name} ${empProfile.last_name || ''}`.trim() : null) || submitterUser?.full_name || submitterUser?.email || 'Employee';
        const managerUserId = empProfile?.reporting_manager?.id || firstLevelOwnerId;

        const snapshot = {
            name: submitterName,
            code: empProfile?.employee_code || 'N/A',
            department: empProfile?.department || 'General',
            designation: empProfile?.designation || 'Staff',
            location: empLocation,
            property_id: property_id || empProfile?.property_id || null,
            manager_name: managerName,
            manager_code: empProfile?.reporting_manager_code || null,
            manager_user_id: managerUserId,
            assigned_history: [firstLevelOwnerId, managerUserId].filter(Boolean),
            routing_mode: isFallbackHrManager ? 'hr_fallback_no_manager' : 'direct_reporting_manager'
        };

        // 7. Insert Ticket
        const { data: newTicket, error: createErr } = await supabaseAdmin
            .from('hr_tickets')
            .insert({
                organization_id: effectiveOrgId,
                ticket_number: ticketNumber,
                ticket_type: ticketType,
                category_id: category.id,
                raised_by_user_id: is_anonymous ? null : raised_by_user_id,
                anonymous_token: is_anonymous ? `anon_${Math.random().toString(36).substring(2, 10)}` : null,
                employee_snapshot: snapshot,
                manager_user_id: managerUserId,
                assigned_history: Array.from(new Set([firstLevelOwnerId, managerUserId].filter(Boolean))),
                subject,
                description,
                attachment_urls,
                current_level: 1,
                assigned_to_user_id: firstLevelOwnerId,
                status: 'new',
                priority,
                sla_due_at: slaDueAt.toISOString(),
                is_confidential: is_confidential || category.is_confidential,
                is_anonymous: is_anonymous || category.is_anonymous
            })
            .select()
            .single();

        if (createErr) throw createErr;

        // 8. Log initial audit entry
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: newTicket.id,
            actor_user_id: raised_by_user_id,
            action: 'CREATED',
            new_values: { ticket_number: ticketNumber, status: 'new', assigned_to: firstLevelOwnerId }
        });

        return NextResponse.json({ success: true, data: newTicket });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
