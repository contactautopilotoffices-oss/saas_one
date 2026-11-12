import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { resolveCaller, isCallerError, forbidden, canUseProperty } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/tickets/[id]/activity
 * Get full activity log for a ticket
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: ticketId } = await params;
        {
            const caller = await resolveCaller(request);
            if (isCallerError(caller)) return caller;
            const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
            const { data: t } = await supabaseAdmin.from('tickets').select('property_id, organization_id').eq('id', ticketId).maybeSingle();
            if (!t) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
            if (!t.property_id || !canUseProperty(caller, t.property_id, t.organization_id)) return forbidden('Forbidden: no access to this ticket');
        }
        const supabase = await createClient();

        const { data: activities, error } = await supabase
            .from('ticket_activity_log')
            .select(`
        *,
        user:users(id, full_name, email)
      `)
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Activity fetch error:', error);
            return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
        }

        return NextResponse.json({ activities: activities || [] });
    } catch (error) {
        console.error('Activity error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
