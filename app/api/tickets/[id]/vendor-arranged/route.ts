import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

/**
 * POST /api/tickets/[id]/vendor-arranged
 * Procurement team marks or edits vendor arrangement details for a ticket
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: ticketId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { details } = body;

        const adminSupabase = createAdminClient();

        // 1. Fetch ticket details
        const { data: ticket, error: ticketError } = await adminSupabase
            .from('tickets')
            .select(`
                *,
                property:properties(id, name, organization_id),
                raised_by_user:users!raised_by(id, full_name, email),
                assignee_user:users!assigned_to(id, full_name, email),
                tagged_by_user:users!tickets_vendor_tagged_by_fkey(id, full_name, email)
            `)
            .eq('id', ticketId)
            .single();

        if (ticketError || !ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const isEdit = ticket.vendor_procurement_status === 'vendor_arranged';
        const now = new Date().toISOString();
        const arrangedNote = details && typeof details === 'string' ? details.trim() : 'Vendor arranged by Procurement team.';

        // 2. Update ticket columns
        const { error: updateError } = await adminSupabase
            .from('tickets')
            .update({
                vendor_procurement_status: 'vendor_arranged',
                vendor_arranged_details: arrangedNote,
                vendor_arranged_at: now,
                vendor_arranged_by: user.id
            })
            .eq('id', ticketId);

        if (updateError) {
            console.error('[VendorArranged] Update error:', updateError);
            return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
        }

        // 3. Log activity for timeline
        await adminSupabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: user.id,
            action: isEdit ? 'vendor_procurement_arranged_updated' : 'vendor_procurement_arranged',
            notes: isEdit ? `Updated vendor details: "${arrangedNote}"` : `Vendor arranged by Procurement: "${arrangedNote}"`
        });

        // 4. Return success response (Notifications are handled asynchronously via event_outbox trigger)
        return NextResponse.json({
            success: true,
            message: isEdit ? 'Vendor details updated successfully.' : 'Ticket status updated to Vendor Arranged and requester notified.'
        });
    } catch (err: any) {
        console.error('[VendorArranged] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
