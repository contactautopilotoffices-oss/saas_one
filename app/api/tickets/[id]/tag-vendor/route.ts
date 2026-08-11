import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

/**
 * POST /api/tickets/[id]/tag-vendor
 * Tag procurement team to arrange an external vendor for a ticket (Create or Edit)
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
        const { note, assignedProcurementUserId } = body;

        if (!note || typeof note !== 'string' || !note.trim()) {
            return NextResponse.json({ error: 'Vendor requirement note is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch ticket details
        const { data: ticket, error: ticketError } = await adminSupabase
            .from('tickets')
            .select('*, property:properties(id, name, organization_id), raised_by_user:users!raised_by(id, full_name, email)')
            .eq('id', ticketId)
            .single();

        if (ticketError || !ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const isEdit = Boolean(ticket.needs_vendor_procurement);
        const now = new Date().toISOString();

        // Fetch assigned procurement user if provided
        let assignedUser: any = null;
        if (assignedProcurementUserId) {
            const { data: pUser } = await adminSupabase
                .from('users')
                .select('id, full_name, email')
                .eq('id', assignedProcurementUserId)
                .single();
            assignedUser = pUser;
        }

        // 2. Update ticket columns
        const updatePayload: any = {
            needs_vendor_procurement: true,
            vendor_procurement_status: ticket.vendor_procurement_status === 'vendor_arranged' ? 'vendor_arranged' : 'vendor_requested',
            vendor_procurement_note: note.trim(),
            vendor_tagged_at: now,
            vendor_tagged_by: user.id,
            assigned_procurement_user_id: assignedProcurementUserId || null
        };

        let { error: updateError } = await adminSupabase
            .from('tickets')
            .update(updatePayload)
            .eq('id', ticketId);

        if (updateError && (updateError.code === 'PGRST204' || updateError.message?.includes('assigned_procurement_user_id'))) {
            console.warn('[TagVendor] assigned_procurement_user_id column missing, retrying without assigned_procurement_user_id field');
            delete updatePayload.assigned_procurement_user_id;
            const fallback = await adminSupabase
                .from('tickets')
                .update(updatePayload)
                .eq('id', ticketId);
            updateError = fallback.error;
        }

        if (updateError) {
            console.error('[TagVendor] Update error:', updateError);
            return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
        }

        // 3. Log activity for timeline
        await adminSupabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: user.id,
            action: isEdit ? 'vendor_procurement_updated' : 'vendor_procurement_tagged',
            notes: isEdit ? `Updated vendor request note: "${note.trim()}"` : `Tagged Procurement for vendor: "${note.trim()}"`
        });

        // 4. Resolve procurement recipients to notify via Email Service Settings
        const orgId = ticket.property?.organization_id || ticket.organization_id;

        const { enabled, emails: resolvedEmails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: orgId,
            propertyId: ticket.property_id,
            featureKey: 'procurement_vendor_tag',
            contextualEmails: [assignedUser?.email]
        });

        const finalEmails = new Set<string>(resolvedEmails);
        if (assignedUser?.email) {
            finalEmails.add(assignedUser.email);
        }

        if (enabled && finalEmails.size > 0) {
            const { data: currentUser } = await adminSupabase
                .from('users')
                .select('id, full_name, email')
                .eq('id', user.id)
                .single();

            await EmailService.sendProcurementVendorTagEmail({
                emailTo: Array.from(finalEmails),
                ticket,
                property: ticket.property,
                taggedBy: currentUser || { full_name: user.email },
                vendorNote: note.trim(),
                assignedProcurementUser: assignedUser
            });
        }

        return NextResponse.json({
            success: true,
            message: isEdit ? 'Vendor request updated successfully.' : 'Procurement tagged for vendor arrangement successfully.'
        });
    } catch (err: any) {
        console.error('[TagVendor] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/tickets/[id]/tag-vendor
 * Removes/cancels the vendor procurement tag from a ticket
 */
export async function DELETE(
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

        const adminSupabase = createAdminClient();

        // 1. Clear vendor procurement fields
        const { error: updateError } = await adminSupabase
            .from('tickets')
            .update({
                needs_vendor_procurement: false,
                vendor_procurement_status: 'none',
                vendor_procurement_note: null,
                vendor_arranged_details: null,
                vendor_tagged_at: null,
                vendor_tagged_by: null,
                vendor_arranged_at: null,
                vendor_arranged_by: null
            })
            .eq('id', ticketId);

        if (updateError) {
            console.error('[TagVendor DELETE] Error:', updateError);
            return NextResponse.json({ error: 'Failed to remove vendor tag' }, { status: 500 });
        }

        // 2. Log activity for timeline
        await adminSupabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: user.id,
            action: 'vendor_procurement_removed',
            notes: 'Cancelled/removed vendor procurement request'
        });

        return NextResponse.json({
            success: true,
            message: 'Vendor procurement tag removed successfully.'
        });
    } catch (err: any) {
        console.error('[TagVendor DELETE] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
