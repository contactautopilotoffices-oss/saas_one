import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { requisitionNotes, siteVendorQuotation } from '@/backend/lib/procurement/requisition-approval.mjs';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const client = await createClient();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const body = await request.json();
        const { action } = body;
        const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
        const approver_id = user.id;
        const approver_name = user.user_metadata?.full_name || user.email || 'Approver';
        if (!id || !['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Choose approve or reject for a single requisition.' }, { status: 400 });
        }
        if (action === 'reject' && !remarks) {
            return NextResponse.json({ error: 'Enter the reason for rejection or revision.' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch current requisition
        const { data: existing, error: fetchErr } = await adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email, phone)
            `)
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
        }

        const existingNotesObj = requisitionNotes(existing);
        if (existing.status !== 'pending_approval') {
            return NextResponse.json({ error: 'This requisition is no longer awaiting approval. Refresh to see its current status.' }, { status: 409 });
        }
        const { data: profile, error: profileError } = await adminSupabase.from('users')
            .select('is_master_admin,deleted_at').eq('id', user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile || profile.deleted_at) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        // Authorization Check: Only designated approver or Org Super Admin can approve/reject
        const targetApproverId = existingNotesObj.approver_info?.id || existingNotesObj.approver_info?.approver_id;
        
        const { data: member, error: memberError } = await adminSupabase
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', existing.organization_id)
            .eq('user_id', approver_id)
            .eq('is_active', true)
            .maybeSingle();

        if (memberError) throw memberError;
        const role = (member?.role || '').toLowerCase();
        const isSuperAdmin = Boolean(profile.is_master_admin) || role === 'org_super_admin' || role === 'master_admin';
        const isDesignatedApprover = Boolean(member && targetApproverId && approver_id === targetApproverId);

        if (!isSuperAdmin && !isDesignatedApprover) {
            return NextResponse.json({ 
                error: 'Unauthorized: Only the selected approver or Org Super Admins can approve or reject this requisition.' 
            }, { status: 403 });
        }

        const isApproval = action === 'approve';
        const newStatus = isApproval ? 'approved' : 'rejected';

        const updatedApproverInfo = {
            ...(existingNotesObj.approver_info || {}),
            id: approver_id,
            name: approver_name || existingNotesObj.approver_info?.name || 'Approver',
            status: newStatus,
            remarks: remarks || '',
            action_at: new Date().toISOString()
        };

        const mergedNotes = JSON.stringify({
            ...existingNotesObj,
            vendor_quotation: siteVendorQuotation(existing),
            approver_info: updatedApproverInfo,
            status_history: [
                ...(Array.isArray(existingNotesObj.status_history) ? existingNotesObj.status_history : []),
                {
                    status: newStatus,
                    by_id: approver_id,
                    by_name: approver_name || 'Approver',
                    remarks: remarks || '',
                    timestamp: new Date().toISOString()
                }
            ]
        });

        // 2. Update Database Record
        const { data: updatedRecord, error: updateError } = await adminSupabase
            .from('property_monthly_requisitions')
            .update({
                status: newStatus,
                notes: mergedNotes,
                acknowledged_by: isApproval ? approver_id : existing.acknowledged_by,
                acknowledged_at: isApproval ? new Date().toISOString() : existing.acknowledged_at,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('status', 'pending_approval')
            .eq('updated_at', existing.updated_at)
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email, phone)
            `)
            .maybeSingle();

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update approval status', details: updateError.message }, { status: 500 });
        }

        if (!updatedRecord) return NextResponse.json({ error: 'The requisition changed during review. Refresh before deciding.' }, { status: 409 });
        const propertyName = existing.property?.name || 'Site Property';
        const monthName = MONTH_NAMES[(existing.requisition_month || 1) - 1];
        const totalAmount = siteVendorQuotation(existing)?.total_quoted_amount ?? existingNotesObj.total_estimated_amount ?? existing.total_estimated_amount ?? 0;

        // 3. Dispatch Notifications (Email + WhatsApp) via OmniChannel Matrix
        (async () => {
            try {
                // A. Resolve email recipients through OmniChannel Matrix
                const contextualEmails: string[] = [];
                if (existing.uploader?.email) contextualEmails.push(existing.uploader.email);

                const emailResolution = await EmailRecipientResolver.resolveRecipients({
                    organizationId: existing.organization_id,
                    propertyId: existing.property_id,
                    featureKey: 'requisition_status_updated',
                    contextualEmails
                });

                // Send Confirmation Email if channel is enabled in matrix
                if (emailResolution.enabled && emailResolution.emails.length > 0) {
                    await EmailService.sendGenericNotificationEmail({
                        emailTo: emailResolution.emails.join(', '),
                        subject: `[${isApproval ? 'Approved' : 'Rejected'}] Monthly Requisition for ${propertyName} (${monthName} ${existing.requisition_year})`,
                        title: `Requisition ${isApproval ? 'Approved ✅' : 'Rejected ❌'}`,
                        htmlBody: `
                            <p>The monthly requisition for <b>${propertyName}</b> (${monthName} ${existing.requisition_year}) has been <b>${newStatus.toUpperCase()}</b> by <b>${approver_name || 'Approver'}</b>.</p>
                            <ul>
                                <li><b>Site:</b> ${propertyName}</li>
                                <li><b>Total Amount:</b> ₹${Number(totalAmount).toLocaleString('en-IN')}</li>
                                <li><b>Status:</b> ${newStatus.toUpperCase()}</li>
                                <li><b>Approver Remarks:</b> ${remarks || 'No remarks provided.'}</li>
                            </ul>
                            <p>${isApproval ? 'Procurement team may now proceed with issuing the Purchase Order (PO).' : 'Please review approver remarks and revise the requisition.'}</p>
                        `
                    });
                }

                // B. Dispatch WhatsApp Notification via OmniChannel Matrix
                await WhatsAppEventProcessor.dispatch({
                    featureKey: 'requisition_status_updated',
                    templateEventKey: 'requisition_status_updated',
                    organizationId: existing.organization_id,
                    propertyId: existing.property_id,
                    entityId: existing.id,
                    contextualUserIds: { requesterId: existing.uploaded_by },
                    paramValues: {
                        user_name: 'Procurement Team',
                        property: propertyName,
                        month: monthName,
                        year: String(existing.requisition_year || new Date().getFullYear()),
                        status: String(newStatus).toUpperCase(),
                        approver_name: approver_name || 'Approver',
                        total_amount: Number(totalAmount).toLocaleString('en-IN'),
                        remarks: remarks || (isApproval ? 'Approved as per lowest quote' : 'Revision requested')
                    },
                    summaryMessage: `Requisition for ${propertyName} ${isApproval ? 'Approved' : 'Rejected'} by ${approver_name || 'Approver'}`
                });
            } catch (notifErr) {
                console.error('[Approval Notification Dispatch Error]:', notifErr);
            }
        })();

        return NextResponse.json({ success: true, requisition: updatedRecord });
    } catch (err: any) {
        console.error('[Requisition Approve Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
