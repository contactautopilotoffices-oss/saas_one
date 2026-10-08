import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function getAuthUserId(request: NextRequest): Promise<string | null> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) return user.id;
    } catch {}

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        try {
            const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
            if (tokenUser?.id) return tokenUser.id;
        } catch {}
    }

    const { searchParams } = new URL(request.url);
    const queryUserId = searchParams.get('userId');
    if (queryUserId) return queryUserId;

    return null;
}

export async function GET(request: NextRequest) {
    try {
        const activeUserId = await getAuthUserId(request);
        if (!activeUserId) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Resolve employee profile ID and email for the active user
        const { data: empProfile } = await supabaseAdmin
            .from('employee_profiles')
            .select('id, email, employee_code')
            .eq('user_id', activeUserId)
            .maybeSingle();

        const empId = empProfile?.id;
        const targetIds = [activeUserId];
        if (empId) targetIds.push(empId);

        // 2. Query open HR tickets requiring attention for this user (assigned handler or submitter awaiting ack)
        // Managers only handle Level 1 tickets before escalation. Escalated tickets belong strictly to the current assigned_to_user_id!
        const filterOr = `assigned_to_user_id.in.(${targetIds.join(',')}),and(is_anonymous.not.is.true,is_confidential.not.is.true,ticket_type.not.in.(anonymous_feedback,confidential_feedback,confidential),manager_user_id.eq.${activeUserId},current_level.eq.1,status.neq.escalated),and(raised_by_user_id.eq.${activeUserId},status.eq.pending_acknowledgement)`;

        const { data: tickets, error } = await supabaseAdmin
            .from('hr_tickets')
            .select(`
                id, ticket_number, ticket_type, subject, status, current_level, priority, created_at,
                raised_by_user_id, assigned_to_user_id, manager_user_id, is_anonymous, is_confidential, employee_snapshot
            `)
            .or(filterOr)
            .not('status', 'in', '("closed","resolved")')
            .order('created_at', { ascending: false })
            .limit(25);

        if (error) {
            console.error('[HR Pending Actions API Error]:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // Strict filter: escalated tickets (current_level > 1 or status === 'escalated') belong ONLY to the active assigned handler!
        const validTickets = (tickets || []).filter(t => {
            const isConfOrAnon = Boolean(t.is_anonymous || t.is_confidential || t.ticket_type === 'confidential_feedback' || t.ticket_type === 'anonymous_feedback' || t.ticket_type === 'confidential');
            const isSubmitterWaitingAck = t.raised_by_user_id === activeUserId && t.status === 'pending_acknowledgement';
            const isCurrentHandler = targetIds.includes(t.assigned_to_user_id);
            const isL1Manager = !isConfOrAnon && t.current_level === 1 && t.status !== 'escalated' && t.manager_user_id === activeUserId;

            if (t.status === 'escalated' || (t.current_level && t.current_level > 1)) {
                return isCurrentHandler || isSubmitterWaitingAck;
            }
            return isCurrentHandler || isSubmitterWaitingAck || isL1Manager;
        });

        return NextResponse.json({
            success: true,
            tickets: validTickets
        });
    } catch (err: any) {
        console.error('[HR Pending Actions Error]:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Server error' }, { status: 500 });
    }
}
