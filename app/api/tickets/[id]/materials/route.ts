import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';

/**
 * POST /api/tickets/[id]/materials
 * Creates a new material request, logs a chat comment, and sends an email to Procurement.
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
        const { items, assignee_uid } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'Items required' }, { status: 400 });
        }
        if (!assignee_uid) {
            return NextResponse.json({ error: 'Procurement assignee required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch Ticket details
        const { data: ticket } = await adminSupabase
            .from('tickets')
            .select('*, property:properties(name)')
            .eq('id', ticketId)
            .single();

        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

        // 2. Fetch User Profile (Requested By)
        const { data: requester } = await adminSupabase
            .from('users')
            .select('id, full_name, email')
            .eq('id', user.id)
            .single();

        const { data: reqMembership } = await adminSupabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('property_id', ticket.property_id)
            .maybeSingle();

        // Fetch User Profile (Assignee / Procurement)
        const { data: assignee } = await adminSupabase
            .from('users')
            .select('id, full_name, email')
            .eq('id', assignee_uid)
            .single();

        // 3. Create Material Request
        const { data: materialReq, error: reqError } = await adminSupabase
            .from('material_requests')
            .insert({
                ticket_id: ticketId,
                property_id: ticket.property_id,
                requested_by: user.id,
                assignee_uid,
                items,
                status: 'pending'
            })
            .select()
            .single();

        if (reqError) {
            console.error('Failed to create material request:', reqError);
            return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
        }

        // 4. Create Chat Message (Structured Comment)
        const commentText = `Material requested: ${items.map(i => `${i.quantity}x ${i.name}`).join(', ')}`;
        
        await adminSupabase.from('ticket_comments').insert({
            ticket_id: ticketId,
            user_id: user.id,
            comment: commentText,
            is_internal: true, // Keep material requests internal by default so tenants don't see procurement chatter
            metadata: {
                mentions: [{ 
                    user_id: assignee_uid, 
                    name: assignee?.full_name || 'Procurement User',
                    role: 'Procurement' 
                }],
                material_request_id: materialReq.id
            }
        });

        // 5. Send Automated Email
        if (assignee?.email) {
            // Non-blocking email trigger
            EmailService.sendMaterialRequestEmail({
                emailTo: assignee.email,
                ticket,
                property: ticket.property,
                requestedBy: requester,
                requesterRole: reqMembership?.role || 'Staff',
                items
            }).catch(e => console.error('SMTP Failure (Async):', e));
        }

        return NextResponse.json({ success: true, material_request: materialReq });
    } catch (error) {
        console.error('POST Material Request Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * PATCH /api/tickets/[id]/materials
 * Update status of an existing material request
 */
export async function PATCH(
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
        const { material_id, status, reason } = body;

        const ALLOWED_STATUSES = ['pending', 'pending_approval', 'approved', 'rejected', 'ordered', 'delivered', 'cancelled', 'reverted'];
        if (!ALLOWED_STATUSES.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // Fetch request with line items
        const { data: requestRecord, error: fetchErr } = await adminSupabase
            .from('material_requests')
            .select('*, line_items:material_request_items(*)')
            .eq('id', material_id)
            .single();

        if (fetchErr || !requestRecord) {
            console.error('Fetch error:', fetchErr);
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        // Permission check
        const isAssignee = requestRecord.assignee_uid === user.id;
        const { data: membership } = await adminSupabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('organization_id', requestRecord.organization_id)
            .single();
        
        const isHO = ['org_super_admin', 'master_admin', 'procurement'].includes(membership?.role || '');
        
        if (!isAssignee && !isHO) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Prepare update data
        const updateData: any = { status };
        let logAction = status;
        let logNewValue = status;

        if (status === 'approved') {
            updateData.approved_at = new Date().toISOString();
            updateData.approved_by = user.id;
        } else if (status === 'rejected') {
            updateData.rejected_at = new Date().toISOString();
            updateData.rejection_reason = reason;
        } else if (status === 'ordered') {
            updateData.ordered_at = new Date().toISOString();
        } else if (status === 'delivered') {
            updateData.delivered_at = new Date().toISOString();
        } else if (status === 'cancelled') {
            updateData.cancelled_at = new Date().toISOString();
            updateData.cancellation_reason = reason;
        } else if (status === 'reverted') {
            // Revert logic: move back one step
            const currentStatus = requestRecord.status;
            if (currentStatus === 'delivered') {
                updateData.status = 'ordered';
                updateData.delivered_at = null;
            } else if (currentStatus === 'ordered') {
                updateData.status = 'approved';
                updateData.ordered_at = null;
            } else {
                return NextResponse.json({ error: 'Cannot revert from current status' }, { status: 400 });
            }
            logAction = `undo_${currentStatus}`;
            logNewValue = updateData.status;
        }

        const { data: updatedReq, error: updateErr } = await adminSupabase
            .from('material_requests')
            .update(updateData)
            .eq('id', material_id)
            .select()
            .single();

        if (updateErr) {
            console.error('Update error:', updateErr);
            return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
        }

        // --- NEW: Procurement Tracking Integration ---
        
        // 1. Log to procurement_activity_log
        try {
            await adminSupabase.from('procurement_activity_log').insert({
                material_request_id: material_id,
                user_id: user.id,
                action: logAction,
                old_value: requestRecord.status,
                new_value: logNewValue,
                metadata: { 
                    ticket_id: ticketId,
                    reason: reason || null
                }
            });
        } catch (e) {
            console.error('Log error (non-blocking):', e);
        }

        // 2. Automate Procurement Order record (only on real 'ordered' status, not reverts)
        if (status === 'ordered') {
            const items = requestRecord.line_items?.length > 0 
                ? requestRecord.line_items 
                : (Array.isArray(requestRecord.items) ? requestRecord.items : []);

            await adminSupabase.from('procurement_orders').insert({
                material_request_id: material_id,
                property_id: requestRecord.property_id,
                organization_id: requestRecord.organization_id,
                ordered_by: user.id,
                vendor_name: 'Pending Assignment',
                items: items,
                total_amount: requestRecord.total_amount || 0,
                delivery_status: 'pending'
            });
        }

        // 3. Add a chat comment
        const displayStatus = status === 'reverted' ? `UNDO ${requestRecord.status.toUpperCase()}` : status.toUpperCase();
        await adminSupabase.from('ticket_comments').insert({
            ticket_id: ticketId,
            user_id: user.id,
            comment: `📦 Material Request: ${displayStatus}${reason ? ` - ${reason}` : ''}`,
            is_internal: true,
            metadata: {
                system_update: true,
                material_request_id: material_id,
                status_change: updateData.status
            }
        });

        return NextResponse.json({ success: true, material_request: updatedReq });
    } catch (error) {
        console.error('PATCH Material Request Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
