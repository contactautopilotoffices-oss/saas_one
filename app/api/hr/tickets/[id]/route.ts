import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { data: ticket, error } = await supabaseAdmin
            .from('hr_tickets')
            .select(`
                *,
                category:hr_ticket_categories(*),
                raised_by:users!raised_by_user_id(id, email, full_name, phone, user_photo_url),
                assigned_to:users!assigned_to_user_id(id, email, full_name, phone, user_photo_url),
                resolved_by:users!resolved_by_user_id(id, email, full_name, phone, user_photo_url),
                comments:hr_ticket_comments(
                    *,
                    sender:users!sender_user_id(id, full_name, email, user_photo_url)
                ),
                audit_logs:hr_ticket_audit_logs(
                    *,
                    actor:users!actor_user_id(id, email, full_name, phone, user_photo_url)
                )
            `)
            .eq('id', id)
            .order('created_at', { ascending: false, foreignTable: 'audit_logs' })
            .single();

        if (error || !ticket) {
            return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const reqRole = (searchParams.get('role') || '').toLowerCase();
        const reqUserId = searchParams.get('userId');
        const hrRoles = ['hr', 'hr_head', 'hr_manager', 'hr_ops'];
        const orgSuperAdminRoles = ['org_super_admin', 'master_admin', 'super_admin'];

        const isSuperAdmin = orgSuperAdminRoles.includes(reqRole);
        const isHrRole = hrRoles.includes(reqRole);
        const isConfidential = Boolean(ticket.is_confidential) || ticket.ticket_type === 'confidential_feedback' || ticket.ticket_type === 'confidential';

        if (ticket.is_anonymous) {
            if (hrRoles.includes(reqRole)) {
                return NextResponse.json({ success: false, error: 'Anonymous feedback tickets are not accessible to HR roles.' }, { status: 403 });
            }
            if (!isSuperAdmin && reqUserId && ticket.assigned_to_user_id !== reqUserId && !(Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(reqUserId))) {
                return NextResponse.json({ success: false, error: 'Anonymous feedback tickets are restricted to Org Super Admin and assigned users.' }, { status: 403 });
            }
            ticket.raised_by = { id: null, email: 'anonymous@hidden.local', full_name: 'Anonymous Employee' };
            ticket.employee_snapshot = {
                name: 'Anonymous Employee',
                department: 'Confidential',
                location: 'Hidden',
                manager_name: 'Hidden',
                reporting_manager_name: 'Hidden',
                code: 'Hidden'
            };
        } else if (isConfidential) {
            // Confidential tickets are strictly restricted to Org Super Admin, the explicitly assigned user as per admin config, or the submitter
            const isAssigned = reqUserId && (ticket.assigned_to_user_id === reqUserId || (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(reqUserId)));
            const isSubmitter = reqUserId && ticket.raised_by_user_id === reqUserId;

            if (!isSuperAdmin && !isAssigned && !isSubmitter) {
                return NextResponse.json({ success: false, error: 'Confidential tickets are not accessible to HR roles and are restricted to Org Super Admin and assigned users.' }, { status: 403 });
            }
        }

        // Resolve names for each escalation level authority
        let l1Name = ticket.assigned_to?.full_name || ticket.assigned_to?.email || 'L1 Manager';
        let l2Name = 'HR Ops';
        let l3Name = 'HR Head';
        let l4Name = 'Director';

        try {
            if (ticket.raised_by_user_id) {
                const { data: emp } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('employee_code, reporting_manager_code, reporting_manager_id, reporting_manager:users!reporting_manager_id(full_name, email)')
                    .eq('user_id', ticket.raised_by_user_id)
                    .maybeSingle();
                if (emp?.reporting_manager) {
                    l1Name = (emp.reporting_manager as any).full_name || (emp.reporting_manager as any).email || l1Name;
                }
                if (ticket.employee_snapshot && !ticket.is_anonymous) {
                    if (!ticket.employee_snapshot.code && emp?.employee_code) {
                        ticket.employee_snapshot.code = emp.employee_code;
                    }
                    if (!ticket.employee_snapshot.manager_name || ticket.employee_snapshot.manager_name === 'N/A') {
                        ticket.employee_snapshot.manager_name = (emp?.reporting_manager as any)?.full_name || (emp?.reporting_manager as any)?.email || emp?.reporting_manager_code || 'N/A';
                    }
                }
            }

            try {
                const { data: hrMgrs, error: mgrErr } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user:users!employee_profiles_user_id_fkey(full_name, email), designation')
                    .or('designation.eq.Designated HR Manager,is_hr_manager_authority.eq.true')
                    .limit(1);
                let hrMgrUser = hrMgrs?.[0]?.user as any;

                if (mgrErr || !hrMgrUser) {
                    const { data: fallbackMgrs } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user:users!employee_profiles_user_id_fkey(full_name, email)')
                        .eq('designation', 'Designated HR Manager')
                        .limit(1);
                    hrMgrUser = fallbackMgrs?.[0]?.user as any;
                }

                if (hrMgrUser) {
                    l2Name = hrMgrUser.full_name || hrMgrUser.email || l2Name;
                }
            } catch (e) {
                console.warn('Error resolving L2 owner:', e);
            }

            try {
                const { data: hrHeads } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user:users!employee_profiles_user_id_fkey(full_name, email)')
                    .eq('is_hr_authority', true)
                    .limit(1);
                const hrHeadUser = hrHeads?.[0]?.user as any;
                if (hrHeadUser) {
                    l3Name = hrHeadUser.full_name || hrHeadUser.email || l3Name;
                }
            } catch (e) {
                console.warn('Error resolving L3 owner:', e);
            }

            try {
                const { data: dirs } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user:users!employee_profiles_user_id_fkey(full_name, email)')
                    .eq('is_director_authority', true)
                    .limit(1);
                const dirUser = dirs?.[0]?.user as any;
                if (dirUser) {
                    l4Name = dirUser.full_name || dirUser.email || l4Name;
                }
            } catch (e) {
                console.warn('Error resolving L4 owner:', e);
            }
        } catch (e) {
            console.error('Error resolving level owners:', e);
        }

        if (ticket.current_level === 1 && ticket.assigned_to) l1Name = ticket.assigned_to.full_name || ticket.assigned_to.email || l1Name;
        if (ticket.current_level === 2 && ticket.assigned_to) l2Name = ticket.assigned_to.full_name || ticket.assigned_to.email || l2Name;
        if (ticket.current_level === 3 && ticket.assigned_to) l3Name = ticket.assigned_to.full_name || ticket.assigned_to.email || l3Name;
        if (ticket.current_level === 4 && ticket.assigned_to) l4Name = ticket.assigned_to.full_name || ticket.assigned_to.email || l4Name;

        ticket.level_owners = {
            l1: l1Name,
            l2: l2Name,
            l3: l3Name,
            l4: l4Name
        };

        // Build dynamic escalation flow array for any category/ticket type level count
        let flowAssigneesConfig: any = {};
        let flowLevelsConfig: any = {};
        try {
            const effectiveOrgId = ticket.organization_id || '211e1330-ad83-446d-941f-dcea48396798';
            let orgSettingsQuery = supabaseAdmin
                .from('organization_settings')
                .select('hr_escalation_config, notification_matrix');

            if (effectiveOrgId) {
                orgSettingsQuery = orgSettingsQuery.eq('organization_id', effectiveOrgId);
            }

            const { data: orgSettings } = await orgSettingsQuery
                .limit(1)
                .maybeSingle();

            const configObj = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
            flowAssigneesConfig = configObj.flow_assignees || {};
            while (flowAssigneesConfig && flowAssigneesConfig.flow_assignees) {
                flowAssigneesConfig = flowAssigneesConfig.flow_assignees;
            }
            flowLevelsConfig = configObj.flow_levels || {};
        } catch (e) {
            console.warn('Could not read hr_escalation_config in GET ticket detail:', e);
        }

        const defaultFlowCounts: Record<string, number> = {
            grievance: 4,
            hr_query: 4,
            confidential_feedback: 2,
            anonymous_feedback: 2
        };
        const tType = ticket.ticket_type || ticket.category?.ticket_type || 'grievance';
        const customFlowLevels = (flowLevelsConfig && Array.isArray(flowLevelsConfig[tType]) && flowLevelsConfig[tType].length > 0)
            ? flowLevelsConfig[tType]
            : (flowLevelsConfig && Array.isArray(flowLevelsConfig['grievance']) && tType === 'grievance')
                ? flowLevelsConfig['grievance']
                : [];
        const totalLevelsCount = customFlowLevels.length > 0 ? customFlowLevels.length : (defaultFlowCounts[tType] || 4);

        const escalationFlow: Array<{ level: number; label: string; assignee: string }> = [];
        for (let i = 1; i <= totalLevelsCount; i++) {
            let assigneeName = '';
            const stepAssignees = flowAssigneesConfig[tType]?.[String(i)] || flowAssigneesConfig[tType]?.[i];
            
            // 1. Dynamic check: Are specific user(s) assigned in Admin Config for this level?
            if (Array.isArray(stepAssignees) && stepAssignees.length > 0) {
                const filterOr = stepAssignees.map((id: string) => `id.eq.${id},user_id.eq.${id}`).join(',');
                const { data: targetProfs } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user:users!employee_profiles_user_id_fkey(full_name, email), first_name, last_name')
                    .or(filterOr);
                
                if (targetProfs && targetProfs.length > 0) {
                    const names = targetProfs.map(tp => {
                        return (tp.user as any)?.full_name || (tp.user as any)?.email || `${tp.first_name || ''} ${tp.last_name || ''}`.trim();
                    }).filter(Boolean);
                    if (names.length > 0) {
                        assigneeName = names.join(' & ');
                    }
                }
            }

            // 2. If not explicitly assigned, check the designated ownerType from Admin Config
            if (!assigneeName) {
                const currentLevelMeta = (customFlowLevels || []).find((l: any) => l.level === i);
                const ownerType = currentLevelMeta?.ownerType;

                if (ownerType === 'reporting_manager' || i === 1) {
                    assigneeName = l1Name;
                } else if (ownerType === 'hr' || (!ownerType && i === 2)) {
                    const { data: hrMgrs } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user:users!employee_profiles_user_id_fkey(full_name, email), first_name, last_name')
                        .or('designation.eq.Designated HR Manager,is_hr_manager_authority.eq.true');
                    const names = (hrMgrs || []).map(p => (p.user as any)?.full_name || (p.user as any)?.email || `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(Boolean);
                    assigneeName = names.length > 0 ? names.join(' & ') : l2Name;
                } else if (ownerType === 'hr_head' || (!ownerType && i === 3)) {
                    const { data: hrHeads } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user:users!employee_profiles_user_id_fkey(full_name, email), first_name, last_name')
                        .eq('is_hr_authority', true);
                    const names = (hrHeads || []).map(p => (p.user as any)?.full_name || (p.user as any)?.email || `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(Boolean);
                    assigneeName = names.length > 0 ? names.join(' & ') : l3Name;
                } else if (ownerType === 'director' || ownerType === 'super_admin' || (!ownerType && i === 4)) {
                    const { data: dirs } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user:users!employee_profiles_user_id_fkey(full_name, email), first_name, last_name')
                        .eq('is_director_authority', true);
                    const names = (dirs || []).map(p => (p.user as any)?.full_name || (p.user as any)?.email || `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(Boolean);
                    assigneeName = names.length > 0 ? names.join(' & ') : l4Name;
                } else {
                    assigneeName = `Level ${i} Authority`;
                }
            }

            // 3. Fallback to ticket.assigned_to ONLY if no assignee was resolved from admin config
            if (!assigneeName && ticket.current_level === i && ticket.assigned_to?.full_name) {
                assigneeName = ticket.assigned_to.full_name;
            }

            escalationFlow.push({
                level: i,
                label: `Level ${i}`,
                assignee: assigneeName || `Level ${i}`
            });
        }

        ticket.escalation_flow = escalationFlow;
        ticket.level_owners = {
            l1: escalationFlow[0]?.assignee || l1Name,
            l2: escalationFlow[1]?.assignee || l2Name,
            l3: escalationFlow[2]?.assignee || l3Name,
            l4: escalationFlow[3]?.assignee || l4Name
        };

        // Enrich assigned_to_details with complete location, app_role, employee_role, photo_url
        if (ticket.assigned_to_user_id) {
            try {
                const { data: assignedProfile } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('employee_code, first_name, last_name, designation, department, location, phone, email, is_hr_authority, is_hr_manager_authority, is_director_authority')
                    .eq('user_id', ticket.assigned_to_user_id)
                    .maybeSingle();

                const { data: assignedMem } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('role')
                    .eq('user_id', ticket.assigned_to_user_id)
                    .maybeSingle();

                const { data: userRecord } = await supabaseAdmin
                    .from('users')
                    .select('user_photo_url, role')
                    .eq('id', ticket.assigned_to_user_id)
                    .maybeSingle();

                const photoUrl = (userRecord as any)?.user_photo_url || null;
                const appRole = assignedMem?.role || (userRecord as any)?.role || (assignedProfile?.is_director_authority ? 'Director' : assignedProfile?.is_hr_authority ? 'HR Head' : assignedProfile?.is_hr_manager_authority ? 'HR Manager' : 'Staff');

                // Resolve handler location independently from employee profile or property
                let handlerLocation = assignedProfile?.location;
                if (!handlerLocation || handlerLocation.toLowerCase() === 'hidden') {
                    const { data: propMem } = await supabaseAdmin
                        .from('property_memberships')
                        .select('property:properties(name, city)')
                        .eq('user_id', ticket.assigned_to_user_id)
                        .limit(1)
                        .maybeSingle();
                    if (propMem?.property) {
                        const p = propMem.property as any;
                        handlerLocation = p.name ? `${p.name}${p.city ? ` (${p.city})` : ''}` : p.city;
                    }
                }
                if (!handlerLocation || handlerLocation.toLowerCase() === 'hidden') {
                    handlerLocation = 'Head Office';
                }

                const handlerEmpCode = assignedProfile?.employee_code || 'N/A';

                ticket.assigned_to_details = {
                    id: ticket.assigned_to_user_id,
                    full_name: ticket.assigned_to?.full_name || `${assignedProfile?.first_name || ''} ${assignedProfile?.last_name || ''}`.trim() || 'Assigned User',
                    email: ticket.assigned_to?.email || assignedProfile?.email || '',
                    phone: ticket.assigned_to?.phone || assignedProfile?.phone || '',
                    photo_url: photoUrl,
                    avatar_url: photoUrl,
                    location: handlerLocation,
                    department: assignedProfile?.department || 'Operations',
                    employee_role: assignedProfile?.designation || 'Level Owner',
                    app_role: appRole,
                    employee_code: handlerEmpCode
                };
            } catch (e) {
                console.warn('Error fetching assigned user details:', e);
            }
        }

        // Attach structured submitter details
        if (!ticket.is_anonymous) {
            let submitterManagerName = ticket.employee_snapshot?.manager_name || ticket.employee_snapshot?.reporting_manager_name;
            if (ticket.raised_by_user_id) {
                try {
                    const { data: empProfile } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('reporting_manager_code, reporting_manager_id, reporting_manager:users!reporting_manager_id(full_name, email)')
                        .or(`user_id.eq.${ticket.raised_by_user_id},email.eq.${ticket.raised_by?.email || ''}`)
                        .maybeSingle();

                    if (empProfile) {
                        const trueMgr = (empProfile.reporting_manager as any)?.full_name 
                            || (empProfile.reporting_manager as any)?.email 
                            || empProfile.reporting_manager_code;
                        if (trueMgr) {
                            submitterManagerName = trueMgr;
                            if (ticket.employee_snapshot) {
                                ticket.employee_snapshot.manager_name = trueMgr;
                                ticket.employee_snapshot.manager_code = empProfile.reporting_manager_code;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Error resolving true submitter manager:', e);
                }
            }

            const submitterPhoto = ticket.raised_by?.user_photo_url || null;
            ticket.submitter_details = {
                id: ticket.raised_by_user_id,
                full_name: ticket.employee_snapshot?.name || ticket.raised_by?.full_name || 'Employee',
                email: ticket.raised_by?.email || '',
                phone: ticket.raised_by?.phone || '',
                photo_url: submitterPhoto,
                avatar_url: submitterPhoto,
                employee_code: ticket.employee_snapshot?.code || 'N/A',
                department: ticket.employee_snapshot?.department || 'Operations',
                location: ticket.employee_snapshot?.location || 'Head Office',
                designation: ticket.employee_snapshot?.designation || 'Staff',
                manager_name: submitterManagerName || 'N/A',
                is_anonymous: false
            };
        } else {
            ticket.submitter_details = {
                id: null,
                full_name: 'Anonymous Employee',
                email: 'hidden',
                phone: 'hidden',
                photo_url: null,
                avatar_url: null,
                employee_code: 'Hidden',
                department: 'Confidential',
                location: 'Hidden',
                designation: 'Confidential',
                manager_name: 'Hidden',
                is_anonymous: true
            };
        }

        // Filter out internal notes for the creator of the request (submitter)
        if (Array.isArray(ticket.comments)) {
            const isAssigned = reqUserId && (ticket.assigned_to_user_id === reqUserId || (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(reqUserId)));
            const isSubmitter = reqUserId && ticket.raised_by_user_id === reqUserId;
            const canViewInternalNotes = isSuperAdmin || (isAssigned && !isSubmitter) || (isHrRole && !isSubmitter);

            if (!canViewInternalNotes) {
                ticket.comments = ticket.comments.filter((c: any) => !c.is_internal);
            }
        }

        return NextResponse.json({ success: true, data: ticket });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { status, assigned_to_user_id, current_level, actor_user_id, priority, escalate, resolution_note, resolved_by_user_id, action, acknowledgement_note } = body;

        const { data: existing, error: fetchErr } = await supabaseAdmin
            .from('hr_tickets')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        }

        const cleanUuid = (val: any): string | null => {
            if (!val || typeof val !== 'string') return null;
            const trimmed = val.trim();
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
            return isUuid ? trimmed : null;
        };

        const safeActorId = cleanUuid(actor_user_id) || cleanUuid(resolved_by_user_id);
        const safeResolvedById = cleanUuid(resolved_by_user_id) || safeActorId;

        const isConfidential = Boolean(existing.is_confidential) || existing.ticket_type === 'confidential_feedback' || existing.ticket_type === 'confidential';
        const isAnonymous = Boolean(existing.is_anonymous) || existing.ticket_type === 'anonymous_feedback';

        if ((isConfidential || isAnonymous) && safeActorId) {
            const { data: mems } = await supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('user_id', safeActorId)
                .eq('organization_id', existing.organization_id);

            const isSuper = mems && mems.some(m => ['org_super_admin', 'master_admin', 'super_admin'].includes((m.role || '').toLowerCase()));
            const isAssigned = existing.assigned_to_user_id === safeActorId || (Array.isArray(existing.assigned_history) && existing.assigned_history.includes(safeActorId));
            const isSubmitter = existing.raised_by_user_id === safeActorId;

            if (isAnonymous && !isSuper && !(isSubmitter && (action === 'acknowledge' || action === 'reopen' || status === 'closed' || status === 'reopened'))) {
                return NextResponse.json({ success: false, error: 'Anonymous tickets can only be updated by Org Super Admin.' }, { status: 403 });
            }

            if (isConfidential && !isSuper && !isAssigned && !(isSubmitter && (action === 'acknowledge' || action === 'reopen' || status === 'closed' || status === 'reopened'))) {
                return NextResponse.json({ success: false, error: 'Confidential tickets are not accessible to HR roles and can only be updated by Org Super Admin or the assigned user.' }, { status: 403 });
            }
        }

        const updates: any = { updated_at: new Date().toISOString() };
        if (status) updates.status = status;
        if (priority) updates.priority = priority;
        if (cleanUuid(assigned_to_user_id)) updates.assigned_to_user_id = cleanUuid(assigned_to_user_id);
        if (resolution_note !== undefined) updates.resolution_note = resolution_note;

        const currentSnapshot = existing.employee_snapshot || {};

        const isSubmitter = Boolean(safeActorId && safeActorId === existing.raised_by_user_id);
        const isAcknowledgeAction = action === 'acknowledge';

        if (status === 'resolved' || status === 'pending_acknowledgement' || action === 'resolve') {
            updates.status = 'pending_acknowledgement';
            updates.resolved_at = new Date().toISOString();
            if (safeResolvedById) {
                updates.resolved_by_user_id = safeResolvedById;
            }
        } else if (status === 'closed' || isAcknowledgeAction) {
            // STRICT TWO-STEP CLOSING LIFECYCLE ENFORCEMENT:
            // Handlers cannot directly jump to 'closed'. If the actor is NOT the submitter and action !== 'acknowledge':
            // Route strictly to 'pending_acknowledgement' so submitter can review & confirm.
            if (!isSubmitter && !isAcknowledgeAction) {
                updates.status = 'pending_acknowledgement';
                updates.resolved_at = new Date().toISOString();
                if (safeResolvedById) {
                    updates.resolved_by_user_id = safeResolvedById;
                }
            } else {
                updates.status = 'closed';
                updates.closed_at = new Date().toISOString();
                currentSnapshot.acknowledged_at = new Date().toISOString();
                currentSnapshot.acknowledged_by_user_id = safeActorId || cleanUuid(body.acknowledged_by_user_id);
                currentSnapshot.acknowledgement_note = acknowledgement_note || 'Confirmed & Acknowledged by Submitter';
                updates.employee_snapshot = currentSnapshot;
            }
        }
        if (status === 'reopened' || action === 'reopen') {
            updates.status = 'reopened';
            updates.reopened_count = (existing.reopened_count || 0) + 1;
        }

        // Dynamic Level Escalation (Level 1 -> 2 -> 3 -> 4)
        if (escalate) {
            const nextLevel = Math.min((existing.current_level || 1) + 1, 4);
            updates.current_level = nextLevel;
            updates.status = 'escalated';

            // Resolve next level owner based on Admin Config first, then fallback to role hierarchy
            let nextAssigneeId: string | null = null;
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

                const tType = existing.ticket_type || 'grievance';
                const levelCustomAssignees = flowAssigneesConfig[tType]?.[String(nextLevel)] || flowAssigneesConfig[tType]?.[nextLevel];

                if (Array.isArray(levelCustomAssignees) && levelCustomAssignees.length > 0) {
                    const firstEmpId = levelCustomAssignees[0];
                    const { data: targetProfile } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user_id')
                        .or(`id.eq.${firstEmpId},user_id.eq.${firstEmpId}`)
                        .maybeSingle();

                    if (targetProfile?.user_id) {
                        nextAssigneeId = targetProfile.user_id;
                    } else {
                        const { data: uRec } = await supabaseAdmin
                            .from('users')
                            .select('id')
                            .eq('id', firstEmpId)
                            .maybeSingle();
                        if (uRec?.id) nextAssigneeId = uRec.id;
                    }
                }
            } catch (cfgErr) {
                console.warn('Could not read admin escalation config on PATCH ticket escalation:', cfgErr);
            }

            if (nextAssigneeId) {
                updates.assigned_to_user_id = nextAssigneeId;
            } else if (nextLevel === 2) {
                // Level 2: Designated HR Manager / Operations Lead
                const { data: hrMgrs } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_manager_authority', true)
                    .not('user_id', 'is', null);
                if (hrMgrs && hrMgrs.length > 0 && hrMgrs[0].user_id) {
                    updates.assigned_to_user_id = hrMgrs[0].user_id;
                } else {
                    const { data: hrList } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('user_id')
                        .eq('is_hr_authority', true)
                        .not('user_id', 'is', null);
                    if (hrList && hrList.length > 0) updates.assigned_to_user_id = hrList[0].user_id;
                }
            } else if (nextLevel === 3) {
                // Level 3: Designated HR Head
                const { data: hrHead } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .maybeSingle();

                if (hrHead?.user_id) {
                    updates.assigned_to_user_id = hrHead.user_id;
                }
            } else if (nextLevel === 4) {
                // Level 4: Designated Director
                const { data: directors } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_director_authority', true)
                    .not('user_id', 'is', null)
                    .maybeSingle();
                if (directors?.user_id) updates.assigned_to_user_id = directors.user_id;
            }

            // Recalculate SLA due date for next level based on category configured SLA days
            if (existing.category_id) {
                const { data: cat } = await supabaseAdmin
                    .from('hr_ticket_categories')
                    .select('*')
                    .eq('id', existing.category_id)
                    .maybeSingle();
                const key = `l${nextLevel}_sla_days` as keyof typeof cat;
                const slaDays = (cat && cat[key] !== undefined && !isNaN(Number(cat[key]))) ? Number(cat[key]) : (nextLevel === 2 ? 7 : nextLevel === 3 ? 10 : 12);
                updates.sla_due_at = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000).toISOString();
            }
        } else if (current_level) {
            updates.current_level = current_level;
        }

        // Maintain assigned_history array in employee_snapshot and root table
        const targetAssignedId = updates.assigned_to_user_id || existing.assigned_to_user_id;
        if (targetAssignedId) {
            const updatedHistory = Array.from(new Set([
                ...(existing.assigned_history || []),
                ...(currentSnapshot.assigned_history || []),
                existing.assigned_to_user_id,
                targetAssignedId
            ])).filter(Boolean);
            currentSnapshot.assigned_history = updatedHistory;
            updates.employee_snapshot = currentSnapshot;
            updates.assigned_history = updatedHistory;
            if (existing.manager_user_id) updates.manager_user_id = existing.manager_user_id;
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('hr_tickets')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        // Audit Log
        let auditAction = 'STATUS_UPDATE';
        if (escalate) {
            auditAction = `ESCALATED_L${updates.current_level}`;
        } else if (action === 'acknowledge' || (updates.status === 'closed' && safeActorId === existing.raised_by_user_id)) {
            auditAction = 'ACKNOWLEDGED_BY_CREATOR';
        } else if (updates.status === 'pending_acknowledgement' || updates.status === 'resolved') {
            auditAction = `RESOLVED_L${existing.current_level || 1}`;
        } else if (updates.status === 'reopened') {
            auditAction = 'REOPENED';
        }

        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: id,
            actor_user_id: safeActorId,
            action: auditAction,
            old_values: { status: existing.status, level: existing.current_level, assigned_to: existing.assigned_to_user_id },
            new_values: updates
        });

        // Dispatch Omnichannel Notifications
        if (escalate) {
            NotificationService.afterHrTicketEscalated(id, existing.current_level, updates.current_level, false, safeActorId || undefined).catch(err => {
                console.error('[HR Tickets API] afterHrTicketEscalated dispatch error:', err);
            });
        } else if (action === 'acknowledge' || (updates.status === 'closed' && safeActorId === existing.raised_by_user_id)) {
            NotificationService.afterHrTicketAcknowledged(id).catch(err => {
                console.error('[HR Tickets API] afterHrTicketAcknowledged dispatch error:', err);
            });
        } else if (updates.status && updates.status !== existing.status) {
            NotificationService.afterHrTicketStatusUpdated(id, existing.status, updates.status, safeActorId || undefined).catch(err => {
                console.error('[HR Tickets API] afterHrTicketStatusUpdated dispatch error:', err);
            });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
