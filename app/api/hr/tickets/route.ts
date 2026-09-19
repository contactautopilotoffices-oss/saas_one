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
        const hrRoles = ['hr', 'hr_head', 'hr_manager', 'hr_ops', 'org_super_admin', 'master_admin', 'org_admin'];
        
        let isHrAuthorityUser = false;
        let isDirectorUser = normalizedRole === 'director';

        if (userId) {
            // Check employee_profiles for HR & Director authority flags
            const { data: hrEmps } = await supabaseAdmin
                .from('employee_profiles')
                .select('is_hr_authority, is_hr_manager_authority, is_director_authority')
                .eq('user_id', userId);

            if (hrEmps && hrEmps.some(e => e.is_hr_authority || e.is_hr_manager_authority)) {
                isHrAuthorityUser = true;
            }
            if (hrEmps && hrEmps.some(e => e.is_director_authority)) {
                isDirectorUser = true;
            }

            // Check organization_memberships for App roles (hr, hr_head, org_super_admin, director, etc.)
            const { data: mems } = await supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('user_id', userId);

            if (mems && mems.some(m => hrRoles.includes((m.role || '').toLowerCase()))) {
                isHrAuthorityUser = true;
            }
            if (mems && mems.some(m => (m.role || '').toLowerCase() === 'director')) {
                isDirectorUser = true;
            }
        }

        if (isDirectorUser) {
            // Directors can view all confidential, anonymous, level 4+, or assigned tickets
            query = query.or(`is_confidential.eq.true,is_anonymous.eq.true,current_level.gte.4${userId ? `,assigned_to_user_id.eq.${userId},assigned_history.cs.["${userId}"]` : ''}`);
        } else if (isHrAuthorityUser || hrRoles.includes(normalizedRole)) {
            // HR Authorities can view all non-confidential tickets, PLUS any confidential ticket specifically assigned to them
            if (userId) {
                query = query.or(`is_confidential.eq.false,is_confidential.is.null,assigned_to_user_id.eq.${userId},assigned_history.cs.["${userId}"]`);
            } else {
                query = query.or('is_confidential.eq.false,is_confidential.is.null');
            }
        } else if (userId) {
            // Fetch manager's employee profile (if any) to resolve profile ID & employee code
            const { data: mgrProfile } = await supabaseAdmin
                .from('employee_profiles')
                .select('id, employee_code, user_id')
                .eq('user_id', userId)
                .maybeSingle();

            const mgrProfId = mgrProfile?.id;
            const mgrCode = mgrProfile?.employee_code;

            // Fetch user profile for name matching in level_owners / snapshots
            const { data: uProfile } = await supabaseAdmin
                .from('users')
                .select('full_name')
                .eq('id', userId)
                .maybeSingle();

            // Dynamically check if user is a reporting manager for any employees (matching user_id, profile id, or manager name/code)
            const reporteeConditions: string[] = [
                `reporting_manager_id.eq.${userId}`
            ];
            if (mgrProfId) {
                reporteeConditions.push(`reporting_manager_id.eq.${mgrProfId}`);
            }
            if (uProfile?.full_name && uProfile.full_name.trim()) {
                const cleanName = uProfile.full_name.trim();
                reporteeConditions.push(`reporting_manager_code.ilike.*${cleanName}*`);
            }
            if (mgrCode) {
                reporteeConditions.push(`reporting_manager_code.ilike.*${mgrCode}*`);
            }

            const { data: reportees } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .or(reporteeConditions.join(','))
                .not('user_id', 'is', null);

            // Fetch any tickets where this user was involved via audit logs (actor or previous/new assigned manager)
            const { data: auditLogs } = await supabaseAdmin
                .from('hr_ticket_audit_logs')
                .select('ticket_id')
                .or(`actor_user_id.eq.${userId},old_values->>assigned_to.eq.${userId},new_values->>assigned_to.eq.${userId}`);

            const reporteeUserIds = (reportees || []).map(r => r.user_id).filter(Boolean);
            const auditTicketIds = (auditLogs || []).map(a => a.ticket_id).filter(Boolean);
            const allowedUserIds = Array.from(new Set([userId, ...reporteeUserIds]));

            const filterConditions: string[] = [
                `assigned_to_user_id.eq.${userId}`,
                `manager_user_id.eq.${userId}`,
                `assigned_history.cs.["${userId}"]`,
                `employee_snapshot->>manager_user_id.eq.${userId}`
            ];
            if (allowedUserIds.length > 0) {
                filterConditions.push(`raised_by_user_id.in.(${allowedUserIds.join(',')})`);
            }
            if (uProfile?.full_name && uProfile.full_name.trim()) {
                const cleanName = uProfile.full_name.trim();
                filterConditions.push(`employee_snapshot->>manager_code.ilike.*${cleanName}*`);
                filterConditions.push(`employee_snapshot->>manager_name.ilike.*${cleanName}*`);
                filterConditions.push(`employee_snapshot->>reporting_manager_name.ilike.*${cleanName}*`);
            }
            if (mgrCode) {
                filterConditions.push(`employee_snapshot->>manager_code.ilike.*${mgrCode}*`);
            }
            if (auditTicketIds.length > 0) {
                filterConditions.push(`id.in.(${Array.from(new Set(auditTicketIds)).join(',')})`);
            }

            query = query.or(filterConditions.join(','));
        }

        if (type) query = query.eq('ticket_type', type);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        // Load organization escalation config to dynamically attach current level owners for tickets
        let flowAssigneesConfig: any = {};
        try {
            const { data: orgSettings } = await supabaseAdmin
                .from('organization_settings')
                .select('hr_escalation_config, notification_matrix')
                .limit(1)
                .maybeSingle();

            const configObj = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
            flowAssigneesConfig = configObj.flow_assignees || {};
            while (flowAssigneesConfig && flowAssigneesConfig.flow_assignees) {
                flowAssigneesConfig = flowAssigneesConfig.flow_assignees;
            }
        } catch (e) {
            console.warn('Could not read hr_escalation_config in tickets list:', e);
        }

        // Collect all custom assignee IDs from flowAssigneesConfig to resolve names
        const allCustomIds = new Set<string>();
        Object.keys(flowAssigneesConfig).forEach(flowType => {
            const flowObj = flowAssigneesConfig[flowType] || {};
            Object.keys(flowObj).forEach(lvl => {
                const arr = flowObj[lvl];
                if (Array.isArray(arr)) {
                    arr.forEach((id: string) => allCustomIds.add(id));
                }
            });
        });

        const profileNameMap = new Map<string, string>();
        if (allCustomIds.size > 0) {
            const filterOr = Array.from(allCustomIds).map(id => `id.eq.${id},user_id.eq.${id}`).join(',');
            const { data: profs } = await supabaseAdmin
                .from('employee_profiles')
                .select('id, user_id, user:users!employee_profiles_user_id_fkey(full_name, email), first_name, last_name')
                .or(filterOr);

            (profs || []).forEach(p => {
                const name = (p.user as any)?.full_name || (p.user as any)?.email || `${p.first_name || ''} ${p.last_name || ''}`.trim();
                if (name) {
                    if (p.id) profileNameMap.set(p.id, name);
                    if (p.user_id) profileNameMap.set(p.user_id, name);
                }
            });
        }

        // Mask identity for anonymous tickets & attach dynamic current_level_owner
        const sanitized = (data || []).map(t => {
            const tType = t.ticket_type || t.category?.ticket_type || 'grievance';
            const curLvl = t.current_level || 1;
            const stepAssignees = flowAssigneesConfig[tType]?.[String(curLvl)] || flowAssigneesConfig[tType]?.[curLvl];
            let currentLevelOwner = '';
            if (Array.isArray(stepAssignees) && stepAssignees.length > 0) {
                const names = stepAssignees.map(id => profileNameMap.get(id)).filter(Boolean);
                if (names.length > 0) {
                    currentLevelOwner = names.join(' & ');
                }
            }

            const item = {
                ...t,
                current_level_owner: currentLevelOwner || t.assigned_to?.full_name || 'Manager / HR'
            };

            if (t.is_anonymous) {
                return {
                    ...item,
                    raised_by_user_id: null,
                    raised_by: { id: null, email: 'anonymous@hidden.local', raw_user_meta_data: { full_name: 'Anonymous Employee' } },
                    employee_snapshot: { name: 'Anonymous Employee', department: 'Confidential', location: 'Hidden' }
                };
            }
            return item;
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
        let configuredLevel1UserIds: string[] = [];

        // Check organization_settings to see if specific Level 1 assigned users were configured in Admin Config for this ticketType
        try {
            const { data: orgSettings } = await supabaseAdmin
                .from('organization_settings')
                .select('hr_escalation_config, notification_matrix')
                .limit(1)
                .maybeSingle();

            const configObj = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
            let flowAssigneesConfig = configObj.flow_assignees || {};
            while (flowAssigneesConfig && flowAssigneesConfig.flow_assignees) {
                flowAssigneesConfig = flowAssigneesConfig.flow_assignees;
            }

            const level1Assignees = flowAssigneesConfig[ticketType]?.[1] || flowAssigneesConfig[ticketType]?.['1'];
            if (Array.isArray(level1Assignees) && level1Assignees.length > 0) {
                const { data: matchedProfiles } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('id, user_id')
                    .or(`id.in.(${level1Assignees.join(',')}),user_id.in.(${level1Assignees.join(',')})`);

                const resolvedUserIds: string[] = [];
                for (const targetId of level1Assignees) {
                    const profileMatch = (matchedProfiles || []).find(p => p.id === targetId || p.user_id === targetId);
                    if (profileMatch?.user_id) {
                        resolvedUserIds.push(profileMatch.user_id);
                    } else {
                        const { data: uRec } = await supabaseAdmin
                            .from('users')
                            .select('id')
                            .eq('id', targetId)
                            .maybeSingle();
                        if (uRec?.id) resolvedUserIds.push(uRec.id);
                    }
                }

                if (resolvedUserIds.length > 0) {
                    firstLevelOwnerId = resolvedUserIds[0];
                    configuredLevel1UserIds = resolvedUserIds;
                }
            }
        } catch (cfgErr) {
            console.warn('Could not read admin escalation config on POST ticket:', cfgErr);
        }

        // Fallback: If no custom level 1 assignees were defined in Admin Config, fallback to standard role/hierarchy lookup
        if (!firstLevelOwnerId) {
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

        const assignedHistory = Array.from(new Set([firstLevelOwnerId, ...configuredLevel1UserIds, managerUserId].filter(Boolean)));

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
            assigned_history: assignedHistory,
            routing_mode: configuredLevel1UserIds.length > 0 ? 'custom_admin_config' : (isFallbackHrManager ? 'hr_fallback_no_manager' : 'direct_reporting_manager')
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
                assigned_history: assignedHistory,
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
