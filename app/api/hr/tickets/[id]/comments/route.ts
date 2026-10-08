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
        const { searchParams } = new URL(request.url);
        const includeInternal = searchParams.get('includeInternal') === 'true';
        const reqUserId = searchParams.get('userId');
        const reqRole = (searchParams.get('role') || '').toLowerCase();
        const isSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin'].includes(reqRole);

        // Check confidentiality / anonymity restrictions
        const { data: ticket } = await supabaseAdmin
            .from('hr_tickets')
            .select('id, is_confidential, is_anonymous, ticket_type, assigned_to_user_id, assigned_history, raised_by_user_id, organization_id, manager_user_id, employee_snapshot')
            .eq('id', id)
            .maybeSingle();

        if (ticket) {
            const isConfidential = Boolean(ticket.is_confidential) || ticket.ticket_type === 'confidential_feedback' || ticket.ticket_type === 'confidential';
            const isAnon = Boolean(ticket.is_anonymous) || ticket.ticket_type === 'anonymous_feedback';
            const isConfOrAnon = isConfidential || isAnon;

            const isAssigned = reqUserId && (ticket.assigned_to_user_id === reqUserId || (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(reqUserId) && (!isConfOrAnon || (reqUserId !== ticket.manager_user_id && reqUserId !== ticket.employee_snapshot?.manager_user_id))));

            if (isAnon && !isSuperAdmin && !isAssigned) {
                return NextResponse.json({ success: false, error: 'Anonymous ticket comments are strictly restricted to Org Super Admin and assigned users.' }, { status: 403 });
            }

            if (isConfidential) {
                const isSubmitter = reqUserId && ticket.raised_by_user_id === reqUserId;
                if (!isSuperAdmin && !isAssigned && !isSubmitter) {
                    return NextResponse.json({ success: false, error: 'Confidential ticket comments are not accessible to HR roles and are restricted to Org Super Admin and assigned users.' }, { status: 403 });
                }
            }
        }

        let query = supabaseAdmin
            .from('hr_ticket_comments')
            .select(`
                *,
                sender:users!sender_user_id(id, full_name, email, user_photo_url)
            `)
            .eq('ticket_id', id)
            .order('created_at', { ascending: true });

        // Filter out internal notes if requested by non-handler/employee view or if user is the submitter
        const isAssigned = reqUserId && (ticket?.assigned_to_user_id === reqUserId || (Array.isArray(ticket?.assigned_history) && ticket.assigned_history.includes(reqUserId)));
        const isSubmitter = reqUserId && ticket?.raised_by_user_id === reqUserId;
        const canViewInternal = includeInternal && (isSuperAdmin || (isAssigned && !isSubmitter) || (reqRole.includes('hr') && !isSubmitter));

        if (!canViewInternal) {
            query = query.eq('is_internal', false);
        }

        const { data, error } = await query;
        if (error) throw error;

        // If anonymous ticket, ensure non-assigned commenters have their name, email, and user object masked
        let sanitizedData = data;
        if (ticket?.is_anonymous || ticket?.ticket_type === 'anonymous_feedback') {
            const assignedIds = new Set([
                ticket.assigned_to_user_id,
                ...(Array.isArray(ticket.assigned_history) ? ticket.assigned_history : [])
            ].filter(Boolean));

            sanitizedData = (data || []).map((c: any) => {
                const isHandler = c.sender_user_id && assignedIds.has(c.sender_user_id);
                if (!isHandler) {
                    return {
                        ...c,
                        sender_user_id: null,
                        sender_name: 'Anonymous Employee',
                        sender: { full_name: 'Anonymous Employee', email: null, user_photo_url: null }
                    };
                }
                return c;
            });
        }

        return NextResponse.json({ success: true, data: sanitizedData });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { sender_user_id, sender_name, content, attachment_urls = [], is_internal = false } = body;

        if (!content) {
            return NextResponse.json({ success: false, error: 'Comment content is required' }, { status: 400 });
        }

        // Check confidentiality / anonymity restrictions on comment creation
        const { data: ticket } = await supabaseAdmin
            .from('hr_tickets')
            .select('id, is_confidential, is_anonymous, ticket_type, assigned_to_user_id, assigned_history, raised_by_user_id, organization_id, manager_user_id, employee_snapshot')
            .eq('id', id)
            .maybeSingle();

        let isSuperAdmin = false;
        if (ticket && sender_user_id) {
            const isConfidential = Boolean(ticket.is_confidential) || ticket.ticket_type === 'confidential_feedback' || ticket.ticket_type === 'confidential';
            const isAnon = Boolean(ticket.is_anonymous) || ticket.ticket_type === 'anonymous_feedback';

            const { data: mems } = await supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('user_id', sender_user_id)
                .eq('organization_id', ticket.organization_id);

            isSuperAdmin = (mems || []).some((m: any) => ['org_super_admin', 'master_admin', 'super_admin'].includes((m.role || '').toLowerCase()));
            const isConfOrAnon = isConfidential || isAnon;
            const isAssigned = ticket.assigned_to_user_id === sender_user_id || 
                               (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(sender_user_id) && (!isConfOrAnon || (sender_user_id !== ticket.manager_user_id && sender_user_id !== ticket.employee_snapshot?.manager_user_id)));
            const isSubmitter = ticket.raised_by_user_id === sender_user_id;

            if (isAnon && !isSuperAdmin && !isAssigned) {
                let isOrgMember = (mems || []).length > 0;
                if (!isOrgMember) {
                    const { data: userRec } = await supabaseAdmin
                        .from('users')
                        .select('email')
                        .eq('id', sender_user_id)
                        .maybeSingle();

                    const filterStr = userRec?.email 
                        ? `user_id.eq.${sender_user_id},email.eq.${userRec.email}`
                        : `user_id.eq.${sender_user_id}`;

                    const { data: empProf } = await supabaseAdmin
                        .from('employee_profiles')
                        .select('id')
                        .or(filterStr)
                        .maybeSingle();

                    if (empProf?.id) isOrgMember = true;
                }
                if (!isOrgMember) {
                    return NextResponse.json({ success: false, error: 'Cannot post comments to anonymous ticket without authorization.' }, { status: 403 });
                }
            }

            if (isConfidential && !isSuperAdmin && !isAssigned && !isSubmitter) {
                return NextResponse.json({ success: false, error: 'Cannot post comments to confidential ticket without authorization.' }, { status: 403 });
            }
        }

        let resolvedSenderName = sender_name;
        let effectiveSenderUserId = sender_user_id || null;

        const isAnonTicket = Boolean(ticket?.is_anonymous) || ticket?.ticket_type === 'anonymous_feedback';
        const isAssignedHandler = ticket && (
            ticket.assigned_to_user_id === sender_user_id || 
            (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(sender_user_id))
        );

        if (isAnonTicket && !isAssignedHandler && !isSuperAdmin) {
            resolvedSenderName = 'Anonymous Employee';
            effectiveSenderUserId = null;
        } else if ((!resolvedSenderName || resolvedSenderName === 'Handler / Support' || resolvedSenderName === 'System User') && sender_user_id) {
            const { data: userData } = await supabaseAdmin
                .from('users')
                .select('full_name, email')
                .eq('id', sender_user_id)
                .maybeSingle();

            if (userData?.full_name) {
                resolvedSenderName = userData.full_name;
            } else if (userData?.email) {
                resolvedSenderName = userData.email;
            } else {
                const { data: empData } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('first_name, last_name')
                    .eq('user_id', sender_user_id)
                    .maybeSingle();
                if (empData?.first_name) {
                    resolvedSenderName = `${empData.first_name} ${empData.last_name || ''}`.trim();
                }
            }
        }
        if (!resolvedSenderName) resolvedSenderName = 'Handler / Support';

        const { data: comment, error } = await supabaseAdmin
            .from('hr_ticket_comments')
            .insert({
                ticket_id: id,
                sender_user_id: effectiveSenderUserId,
                sender_name: resolvedSenderName,
                content,
                attachment_urls,
                is_internal: Boolean(is_internal)
            })
            .select()
            .single();

        if (error) throw error;

        // Audit log
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: id,
            actor_user_id: effectiveSenderUserId,
            action: is_internal ? 'INTERNAL_NOTE_ADDED' : 'PUBLIC_REPLY_ADDED',
            new_values: { sender_name: resolvedSenderName, is_internal, content_snippet: content.substring(0, 50) }
        });

        // Trigger Omnichannel Comment Notification
        NotificationService.afterHrTicketCommentAdded(comment.id).catch(err => {
            console.error('Failed to trigger comment notification:', err);
        });

        return NextResponse.json({ success: true, data: comment });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
