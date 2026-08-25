import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { requisition_ids, action, approver_id, approver_name, remarks } = body;

        if (!Array.isArray(requisition_ids) || requisition_ids.length === 0) {
            return NextResponse.json({ error: 'Please specify at least one requisition ID.' }, { status: 400 });
        }

        if (!action || (action !== 'approve' && action !== 'reject')) {
            return NextResponse.json({ error: 'Invalid action. Must be approve or reject.' }, { status: 400 });
        }

        if (!approver_id) {
            return NextResponse.json({ error: 'Approver ID is required.' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const isApproval = action === 'approve';
        const newStatus = isApproval ? 'approved' : 'rejected';

        const updatedRecords: any[] = [];
        const affectedPropertyNames: string[] = [];

        for (const reqId of requisition_ids) {
            const { data: existing } = await adminSupabase
                .from('property_monthly_requisitions')
                .select(`
                    *,
                    property:properties!property_id(id, name, address),
                    uploader:users!uploaded_by(id, full_name, email, phone)
                `)
                .eq('id', reqId)
                .maybeSingle();

            if (!existing) continue;

            let existingNotesObj: any = {};
            try {
                if (existing.notes && typeof existing.notes === 'string' && existing.notes.trim().startsWith('{')) {
                    existingNotesObj = JSON.parse(existing.notes);
                } else if (typeof existing.notes === 'object' && existing.notes !== null) {
                    existingNotesObj = existing.notes;
                }
            } catch {
                existingNotesObj = { site_notes: existing.notes || '' };
            }

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
                approver_info: updatedApproverInfo,
                status_history: [
                    ...(existingNotesObj.status_history || []),
                    {
                        status: newStatus,
                        by_id: approver_id,
                        by_name: approver_name || 'Approver',
                        remarks: remarks || (isApproval ? 'Approved in multi-site approval batch' : 'Rejected in multi-site approval batch'),
                        timestamp: new Date().toISOString()
                    }
                ]
            });

            const { data: updatedRecord, error: updateError } = await adminSupabase
                .from('property_monthly_requisitions')
                .update({
                    status: newStatus,
                    notes: mergedNotes,
                    acknowledged_by: isApproval ? approver_id : existing.acknowledged_by,
                    acknowledged_at: isApproval ? new Date().toISOString() : existing.acknowledged_at,
                    updated_at: new Date().toISOString()
                })
                .eq('id', reqId)
                .select(`
                    *,
                    property:properties!property_id(id, name, address),
                    uploader:users!uploaded_by(id, full_name, email, phone)
                `)
                .single();

            if (!updateError && updatedRecord) {
                updatedRecords.push(updatedRecord);
                const propLabel = `${existing.property?.name || 'Property'}${existing.floor_tag && existing.floor_tag !== 'All Floors' ? ` (${existing.floor_tag})` : ''}`;
                affectedPropertyNames.push(propLabel);

                // Dispatch individual notification per requisition
                (async () => {
                    try {
                        const monthName = MONTH_NAMES[(existing.requisition_month || 1) - 1];
                        const totalAmount = existingNotesObj.vendor_quotation?.total_quoted_amount || existingNotesObj.total_estimated_amount || 0;

                        if (existing.uploader?.email) {
                            const emailResolution = await EmailRecipientResolver.resolveRecipients({
                                organizationId: existing.organization_id,
                                propertyId: existing.property_id,
                                featureKey: 'requisition_status_updated',
                                contextualEmails: [existing.uploader.email]
                            });

                            if (emailResolution.enabled && emailResolution.emails.length > 0) {
                                await EmailService.sendGenericNotificationEmail({
                                    emailTo: emailResolution.emails.join(', '),
                                    subject: `[${isApproval ? 'Approved' : 'Rejected'}] Monthly Requisition for ${propLabel} (${monthName} ${existing.requisition_year})`,
                                    title: `Requisition ${isApproval ? 'Approved ✅' : 'Rejected ❌'}`,
                                    htmlBody: `
                                        <p>The monthly requisition for <b>${propLabel}</b> (${monthName} ${existing.requisition_year}) has been <b>${newStatus.toUpperCase()}</b> by <b>${approver_name || 'Approver'}</b>.</p>
                                        <ul>
                                            <li><b>Site:</b> ${propLabel}</li>
                                            <li><b>Total Amount:</b> ₹${Number(totalAmount).toLocaleString('en-IN')}</li>
                                            <li><b>Status:</b> ${newStatus.toUpperCase()}</li>
                                            <li><b>Approver Remarks:</b> ${remarks || 'Approved'}</li>
                                        </ul>
                                    `
                                });
                            }
                        }

                        await WhatsAppEventProcessor.dispatch({
                            featureKey: 'requisition_status_updated',
                            templateEventKey: 'requisition_status_updated',
                            organizationId: existing.organization_id,
                            propertyId: existing.property_id,
                            entityId: existing.id,
                            contextualUserIds: { requesterId: existing.uploaded_by },
                            paramValues: {
                                user_name: 'Procurement Team',
                                property: propLabel,
                                month: monthName,
                                year: String(existing.requisition_year || new Date().getFullYear()),
                                status: String(newStatus).toUpperCase(),
                                approver_name: approver_name || 'Approver',
                                total_amount: Number(totalAmount).toLocaleString('en-IN'),
                                remarks: remarks || (isApproval ? 'Approved as per quote' : 'Revision requested')
                            },
                            summaryMessage: `Requisition for ${propLabel} ${isApproval ? 'Approved' : 'Rejected'} by ${approver_name || 'Approver'}`
                        });
                    } catch (notifErr) {
                        console.error('[Bulk Action Individual Notification Error]:', notifErr);
                    }
                })();
            }
        }

        return NextResponse.json({
            success: true,
            action,
            updated_count: updatedRecords.length,
            records: updatedRecords
        });
    } catch (err: any) {
        console.error('[Bulk Approve Action Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
