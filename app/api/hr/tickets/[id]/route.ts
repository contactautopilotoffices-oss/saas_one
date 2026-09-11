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
                raised_by:users!raised_by_user_id(id, email, full_name, phone),
                assigned_to:users!assigned_to_user_id(id, email, full_name, phone),
                comments:hr_ticket_comments(*),
                audit_logs:hr_ticket_audit_logs(*)
            `)
            .eq('id', id)
            .single();

        if (error || !ticket) {
            return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        }

        if (ticket.is_anonymous) {
            ticket.raised_by = { id: null, email: 'anonymous@hidden.local', full_name: 'Anonymous Employee' };
            ticket.employee_snapshot = { name: 'Anonymous Employee', department: 'Confidential', location: 'Hidden' };
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
        const { status, assigned_to_user_id, current_level, actor_user_id, priority, escalate } = body;

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

        if (status === 'resolved') updates.resolved_at = new Date().toISOString();
        if (status === 'closed') updates.closed_at = new Date().toISOString();
        if (status === 'reopened') updates.reopened_count = (existing.reopened_count || 0) + 1;

        // Dynamic Level Escalation (Level 1 -> 2 -> 3 -> 4)
        if (escalate) {
            const nextLevel = Math.min((existing.current_level || 1) + 1, 4);
            updates.current_level = nextLevel;
            updates.status = 'escalated';

            // Resolve next level owner based on hierarchy
            if (nextLevel === 2) {
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
        } else if (current_level) {
            updates.current_level = current_level;
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('hr_tickets')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        // Audit Log
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: id,
            actor_user_id: actor_user_id || null,
            action: escalate ? `ESCALATED_L${updates.current_level}` : 'STATUS_UPDATE',
            old_values: { status: existing.status, level: existing.current_level, assigned_to: existing.assigned_to_user_id },
            new_values: updates
        });

        // Omnichannel WhatsApp & In-App Status Notification Hook
        NotificationService.afterHrTicketStatusUpdated(id, existing.status, updated.status, actor_user_id).catch(err => {
            console.error('Failed to trigger HR ticket status notification:', err);
        });

        return NextResponse.json({ success: true, data: updated });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
