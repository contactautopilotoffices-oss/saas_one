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
        const filterOr = `assigned_to_user_id.in.(${targetIds.join(',')}),manager_user_id.eq.${activeUserId},and(raised_by_user_id.eq.${activeUserId},status.eq.pending_acknowledgement)`;

        const { data: tickets, error } = await supabaseAdmin
            .from('hr_tickets')
            .select(`
                id, ticket_number, ticket_type, subject, status, current_level, priority, created_at,
                raised_by_user_id, assigned_to_user_id, manager_user_id, is_anonymous, employee_snapshot
            `)
            .or(filterOr)
            .not('status', 'in', '("closed","resolved")')
            .order('created_at', { ascending: false })
            .limit(25);

        if (error) {
            console.error('[HR Pending Actions API Error]:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            tickets: tickets || []
        });
    } catch (err: any) {
        console.error('[HR Pending Actions Error]:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Server error' }, { status: 500 });
    }
}
