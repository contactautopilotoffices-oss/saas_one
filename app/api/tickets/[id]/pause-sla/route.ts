import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { pauseTicketSLA, resumeTicketSLA } from '@/backend/lib/ticketing/slaPauseService';

/**
 * PATCH /api/tickets/[id]/pause-sla
 * Pause or resume SLA for a ticket
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: ticketId } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { pause, reason } = body;

        let result;
        if (pause) {
            result = await pauseTicketSLA(supabase, ticketId, reason || 'Paused by admin', user.id);
        } else {
            result = await resumeTicketSLA(supabase, ticketId, reason || 'Resumed by admin', user.id);
        }

        if (!result.success) {
            return NextResponse.json({ error: 'Failed to update SLA' }, { status: 500 });
        }

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('SLA pause error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
