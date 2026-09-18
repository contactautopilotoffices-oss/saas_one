import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';
import {
    loadHrEscalationConfig,
    getMaxLevelForFlow,
    resolveLevelAssignee,
    resolveLevelSlaDays,
    buildAssignedHistory
} from '@/backend/lib/hr/slaEscalation';

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
                raised_by:users!raised_by_user_id(id, email, full_name, phone),
                assigned_to:users!assigned_to_user_id(id, email, full_name, phone),
                resolved_by:users!resolved_by_user_id(id, email, full_name, phone),
                comments:hr_ticket_comments(*),
                audit_logs:hr_ticket_audit_logs(
                    *,
                    actor:users!actor_user_id(id, email, full_name, phone)
                )
            `)
            .eq('id', id)
            .order('created_at', { ascending: false, foreignTable: 'audit_logs' })
            .single();

        if (error || !ticket) {
            return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        }

        if (ticket.is_anonymous) {
            ticket.raised_by = { id: null, email: 'anonymous@hidden.local', full_name: 'Anonymous Employee' };
            ticket.employee_snapshot = { name: 'Anonymous Employee', department: 'Confidential', location: 'Hidden' };
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
                    if (!ticket.employee_snapshot.manager_name) {
                        ticket.employee_snapshot.manager_name = l1Name || emp?.reporting_manager_code;
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

        if (ticket.employee_snapshot && !ticket.is_anonymous && !ticket.employee_snapshot.manager_name) {
            ticket.employee_snapshot.manager_name = l1Name;
        }

        // Build dynamic escalation flow array for any category/ticket type level count
        let flowAssigneesConfig: any = {};
        let flowLevelsConfig: any = {};
        try {
            const { data: orgSettings } = await supabaseAdmin
                .from('organization_settings')
                .select('hr_escalation_config')
                .limit(1)
                .maybeSingle();
            if (orgSettings?.hr_escalation_config) {
                flowAssigneesConfig = orgSettings.hr_escalation_config.flow_assignees || {};
                flowLevelsConfig = orgSettings.hr_escalation_config.flow_levels || {};
            }
        } catch (e) {
            console.warn('Could not read hr_escalation_config in GET ticket detail:', e);
        }

        const tType = ticket.ticket_type || ticket.category?.ticket_type || 'grievance';
        const customFlowLevels = flowLevelsConfig[tType] || flowLevelsConfig['grievance'] || [];
        const totalLevelsCount = customFlowLevels.length > 0 ? customFlowLevels.length : 4;

        const escalationFlow: Array<{ level: number; label: string; assignee: string }> = [];
        for (let i = 1; i <= totalLevelsCount; i++) {
            let assigneeName = '';
            const stepAssignees = flowAssigneesConfig[tType]?.[String(i)] || flowAssigneesConfig[tType]?.[i];
            
            if (Array.isArray(stepAssignees) && stepAssignees.length > 0) {
                const filterOr = stepAssignees.map(id => `id.eq.${id},user_id.eq.${id}`).join(',');
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

            if (!assigneeName) {
                if (i === 1) assigneeName = l1Name;
                else if (i === 2) assigneeName = l2Name;
                else if (i === 3) assigneeName = l3Name;
                else if (i === 4) assigneeName = l4Name;
                else assigneeName = `Level ${i} Authority`;
            }

            if (ticket.current_level === i && ticket.assigned_to?.full_name) {
                assigneeName = ticket.assigned_to.full_name;
            }

            escalationFlow.push({
                level: i,
                label: `Level ${i}`,
                assignee: assigneeName || `Level ${i}`
            });
        }

        ticket.escalation_flow = escalationFlow;

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

        const updates: any = { updated_at: new Date().toISOString() };
        if (status) updates.status = status;
        if (priority) updates.priority = priority;
        if (assigned_to_user_id) updates.assigned_to_user_id = assigned_to_user_id;
        if (resolution_note !== undefined) updates.resolution_note = resolution_note;

        const currentSnapshot = existing.employee_snapshot || {};

        if (status === 'resolved' || status === 'pending_acknowledgement' || action === 'resolve') {
            updates.status = 'pending_acknowledgement';
            updates.resolved_at = new Date().toISOString();
            if (resolved_by_user_id || actor_user_id) {
                updates.resolved_by_user_id = resolved_by_user_id || actor_user_id;
            }
        }
        if (status === 'closed' || action === 'acknowledge') {
            updates.status = 'closed';
            updates.closed_at = new Date().toISOString();
            currentSnapshot.acknowledged_at = new Date().toISOString();
            currentSnapshot.acknowledged_by_user_id = actor_user_id || body.acknowledged_by_user_id || null;
            currentSnapshot.acknowledgement_note = acknowledgement_note || 'Confirmed & Acknowledged by Submitter';
            updates.employee_snapshot = currentSnapshot;
        }
        if (status === 'reopened' || action === 'reopen') {
            updates.status = 'reopened';
            updates.reopened_count = (existing.reopened_count || 0) + 1;
        }

        // Dynamic Level Escalation. The ladder length and the owner of each level come
        // from the org escalation tree (hr_escalation_config), exactly as the SLA job
        // resolves them, so a manual escalation and an auto escalation land on the
        // same person. Levels beyond 4 are supported when the tree defines them.
        if (escalate) {
            const ticketType = existing.ticket_type || 'grievance';
            const escalationConfig = await loadHrEscalationConfig();
            const maxLevel = getMaxLevelForFlow(escalationConfig, ticketType);
            const nextLevel = Math.min((existing.current_level || 1) + 1, maxLevel);

            if (nextLevel === (existing.current_level || 1)) {
                return NextResponse.json({
                    success: false,
                    error: `Ticket is already at the final escalation level (Level ${maxLevel})`
                }, { status: 400 });
            }

            updates.current_level = nextLevel;
            updates.status = 'escalated';

            const nextAssigneeId = await resolveLevelAssignee(
                escalationConfig,
                ticketType,
                nextLevel,
                existing.assigned_to_user_id
            );
            if (nextAssigneeId) updates.assigned_to_user_id = nextAssigneeId;

            // Recalculate SLA due date for the level being escalated into
            let category: any = null;
            if (existing.category_id) {
                const { data: cat } = await supabaseAdmin
                    .from('hr_ticket_categories')
                    .select('*')
                    .eq('id', existing.category_id)
                    .maybeSingle();
                category = cat;
            }
            const slaDays = resolveLevelSlaDays(escalationConfig, ticketType, nextLevel, category);
            updates.sla_due_at = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000).toISOString();
        } else if (current_level) {
            updates.current_level = current_level;
        }

        // Maintain assigned_history array in employee_snapshot and root table.
        // Every past holder stays in the array: this is what lets a level-N owner keep
        // seeing the ticket once it has moved to level N+1.
        const targetAssignedId = updates.assigned_to_user_id || existing.assigned_to_user_id;
        if (targetAssignedId) {
            const updatedHistory = buildAssignedHistory(existing, targetAssignedId);
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
        } else if (action === 'acknowledge' || (status === 'closed' && actor_user_id === existing.raised_by_user_id)) {
            auditAction = 'ACKNOWLEDGED_BY_CREATOR';
        } else if (status === 'resolved' || status === 'closed') {
            auditAction = `RESOLVED_L${existing.current_level || 1}`;
        } else if (status === 'reopened') {
            auditAction = 'REOPENED';
        }

        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: id,
            actor_user_id: actor_user_id || resolved_by_user_id || null,
            action: auditAction,
            old_values: { status: existing.status, level: existing.current_level, assigned_to: existing.assigned_to_user_id },
            new_values: { ...updates, assigned_to: updates.assigned_to_user_id || existing.assigned_to_user_id }
        });

        return NextResponse.json({ success: true, data: updated });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
