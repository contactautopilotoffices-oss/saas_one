import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

// POST: Upload a new comparative
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: requestId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { file_url, total_cost, vendor_details, notes, approver_uid } = body;

        if (!file_url || !total_cost) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // Security check: Only assignee or admin can upload
        const { data: mRequest } = await adminSupabase
            .from('material_requests')
            .select('assignee_uid, ticket:tickets(organization_id)')
            .eq('id', requestId)
            .single();

        if (!mRequest) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

        const orgId = Array.isArray(mRequest.ticket) ? mRequest.ticket[0]?.organization_id : (mRequest.ticket as any)?.organization_id;

        const { data: membership } = await adminSupabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('organization_id', orgId || '')
            .maybeSingle();

        const isAdmin = ['org_super_admin', 'master_admin'].includes(membership?.role || '');

        if (mRequest.assignee_uid !== user.id && !isAdmin) {
            return NextResponse.json({ error: 'Only the assigned procurement user can upload a comparative' }, { status: 403 });
        }

        // 1. Insert Comparative with approver_uid
        const { data: comparative, error: insertError } = await adminSupabase
            .from('material_request_comparatives')
            .insert({
                request_id: requestId,
                file_url,
                total_cost,
                vendor_details,
                notes,
                approver_uid: approver_uid || null,
                status: 'pending_approval',
                created_by: user.id
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error inserting comparative:', insertError);
            return NextResponse.json({ error: 'Failed to upload comparative' }, { status: 500 });
        }

        // 2. Update parent request status
        await adminSupabase
            .from('material_requests')
            .update({ status: 'pending_approval', updated_at: new Date().toISOString() })
            .eq('id', requestId);

        return NextResponse.json({ success: true, comparative });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH: Approve or Reject a comparative
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: requestId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { comparative_id, status } = body;

        if (!comparative_id || !status || !['approved', 'rejected', 'negotiating'].includes(status)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Check comparative and permissions
        const { data: comparative } = await adminSupabase
            .from('material_request_comparatives')
            .select('total_cost, approver_uid, request:material_requests(ticket_id, ticket:tickets(organization_id, property_id))')
            .eq('id', comparative_id)
            .single();

        if (!comparative) return NextResponse.json({ error: 'Comparative not found' }, { status: 404 });

        const reqObj = comparative.request as any;
        const ticketId = reqObj?.ticket_id;
        const ticketObj = Array.isArray(reqObj?.ticket) ? reqObj.ticket[0] : reqObj?.ticket;
        const orgId = ticketObj?.organization_id;
        const propId = ticketObj?.property_id;

        const [orgMem, propMem, actorRes, assignedApproverRes] = await Promise.all([
            adminSupabase.from('organization_memberships').select('role').eq('user_id', user.id).eq('organization_id', orgId || '').maybeSingle(),
            adminSupabase.from('property_memberships').select('role').eq('user_id', user.id).eq('property_id', propId || '').maybeSingle(),
            adminSupabase.from('users').select('full_name').eq('id', user.id).maybeSingle(),
            comparative.approver_uid ? adminSupabase.from('users').select('full_name').eq('id', comparative.approver_uid).maybeSingle() : Promise.resolve({ data: null })
        ]);

        const isOrgAdmin = ['org_super_admin', 'master_admin', 'org_admin'].includes(orgMem.data?.role || '');
        const isPropAdmin = ['property_admin'].includes(propMem.data?.role || '');
        const isAssignedApprover = comparative.approver_uid ? comparative.approver_uid === user.id : true;
        const actorName = actorRes.data?.full_name || 'Admin';
        const assignedApproverName = assignedApproverRes.data?.full_name || null;

        // Allow action if user is assigned approver OR if user is Org Admin (override capability)
        if (!isAssignedApprover && !isOrgAdmin && !isPropAdmin) {
            return NextResponse.json({ 
                error: `Only the assigned approver (${assignedApproverName || 'Designated Approver'}) or an Org Super Admin can approve or negotiate this comparative.` 
            }, { status: 403 });
        }

        // Determine if this was an Override action by Org Super Admin
        const isOverride = comparative.approver_uid && comparative.approver_uid !== user.id && isOrgAdmin;

        // 2. Update comparative
        const { error: updateError } = await adminSupabase
            .from('material_request_comparatives')
            .update({ 
                status,
                action_by: user.id,
                action_at: new Date().toISOString()
            })
            .eq('id', comparative_id);

        if (updateError) {
            console.error('Error updating comparative:', updateError);
            return NextResponse.json({ error: 'Failed to update comparative' }, { status: 500 });
        }

        // 3. Sync status back to main request
        const requestStatus = status === 'approved' ? 'approved' : 'negotiating';
        await adminSupabase
            .from('material_requests')
            .update({ status: requestStatus, updated_at: new Date().toISOString() })
            .eq('id', requestId);

        // 4. Log ticket comment & activity with acting admin's full name & override context (Non-blocking)
        if (ticketId) {
            const actionText = status === 'approved' ? 'APPROVED' : 'REJECTED/NEGOTIATION REQUESTED';
            const costFormatted = comparative.total_cost ? ` (₹${Number(comparative.total_cost).toLocaleString()})` : '';
            const overrideContext = isOverride && assignedApproverName ? ` (Override for assigned approver ${assignedApproverName})` : '';

            adminSupabase.from('ticket_comments').insert({
                ticket_id: ticketId,
                user_id: user.id,
                comment: `Comparative quote${costFormatted} was ${actionText} by ${actorName}${overrideContext}.`,
                is_internal: false
            }).then(({ error }) => {
                if (error) console.error('[Comparative API] Comment log error:', error.message);
            });

            adminSupabase.from('ticket_activity_log').insert({
                ticket_id: ticketId,
                user_id: user.id,
                action: status === 'approved' ? 'comparative_approved' : 'comparative_rejected',
                new_value: `Comparative ${status} by ${actorName}${costFormatted}${overrideContext}`
            }).then(({ error }) => {
                if (error) console.error('[Comparative API] Activity log error:', error.message);
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
