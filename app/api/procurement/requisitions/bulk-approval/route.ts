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
        const adminSupabase = createAdminClient();
        const formData = await request.formData();

        const requisitionIdsRaw = formData.get('requisition_ids') as string || '[]';
        const vendorName = (formData.get('vendor_name') as string || '').trim() || 'Vendor Quote';
        const totalQuotedAmount = parseFloat(formData.get('total_quoted_amount') as string || '0');
        const vendorNotes = formData.get('vendor_notes') as string || '';
        const targetApproverId = formData.get('target_approver_id') as string || '';
        const quoteFile = formData.get('quote_file') as File | null;
        const organizationId = formData.get('organization_id') as string || '';

        let requisitionIds: string[] = [];
        try {
            requisitionIds = JSON.parse(requisitionIdsRaw);
        } catch {
            requisitionIds = requisitionIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
        }

        if (!requisitionIds || requisitionIds.length === 0) {
            return NextResponse.json({ error: 'Please select at least one property requisition.' }, { status: 400 });
        }

        if (!targetApproverId) {
            return NextResponse.json({ error: 'Please select an Approver.' }, { status: 400 });
        }

        // 1. Fetch Approver details
        const { data: approverUser } = await adminSupabase
            .from('users')
            .select('id, full_name, email, phone')
            .eq('id', targetApproverId)
            .maybeSingle();

        const approverInfoData = {
            id: targetApproverId,
            name: approverUser?.full_name || 'Approver',
            email: approverUser?.email || '',
            phone: approverUser?.phone || '',
            assigned_at: new Date().toISOString(),
            status: 'pending'
        };

        // 2. Upload Quote File if provided
        let fileUrl = '';
        let fileName = '';

        if (quoteFile) {
            const orgPrefix = organizationId || 'org_quotes';
            const quotePath = `${orgPrefix}/bulk_quotes/quote_${Date.now()}_${quoteFile.name.replace(/\s+/g, '_')}`;
            const arrayBuffer = await quoteFile.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const { data: uploadData, error: quoteUploadErr } = await adminSupabase.storage
                .from('procurement_requisitions')
                .upload(quotePath, buffer, {
                    upsert: true,
                    contentType: quoteFile.type || 'application/octet-stream'
                });

            if (quoteUploadErr) {
                console.error('[Bulk Quote Upload Storage Error]:', quoteUploadErr);
                return NextResponse.json({ error: 'Failed to upload quotation file to storage', details: quoteUploadErr.message }, { status: 500 });
            }

            if (uploadData) {
                fileUrl = adminSupabase.storage.from('procurement_requisitions').getPublicUrl(uploadData.path).data.publicUrl;
                fileName = quoteFile.name;
            }
        }

        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const vendorQuotationData = {
            vendor_name: vendorName,
            total_quoted_amount: totalQuotedAmount,
            notes: vendorNotes,
            file_url: fileUrl,
            file_name: fileName,
            uploaded_at: new Date().toISOString(),
            batch_id: batchId,
            is_bulk: true
        };

        // 3. Update all selected requisitions to pending_approval
        const updatedRequisitions: any[] = [];
        const affectedProperties: string[] = [];

        for (const reqId of requisitionIds) {
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

            const mergedNotes = JSON.stringify({
                ...existingNotesObj,
                vendor_quotation: vendorQuotationData,
                approver_info: approverInfoData,
                batch_id: batchId,
                updated_at: new Date().toISOString(),
                status_history: [
                    ...(existingNotesObj.status_history || []),
                    {
                        status: 'pending_approval',
                        by_name: 'Procurement Team',
                        remarks: `Quotation uploaded from ${vendorName} and assigned to ${approverInfoData.name}`,
                        timestamp: new Date().toISOString()
                    }
                ]
            });

            const { data: updatedRecord, error: updateErr } = await adminSupabase
                .from('property_monthly_requisitions')
                .update({
                    status: 'pending_approval',
                    notes: mergedNotes,
                    updated_at: new Date().toISOString()
                })
                .eq('id', reqId)
                .select(`
                    *,
                    property:properties!property_id(id, name, address),
                    uploader:users!uploaded_by(id, full_name, email, phone)
                `)
                .single();

            if (!updateErr && updatedRecord) {
                updatedRequisitions.push(updatedRecord);
                const propLabel = `${existing.property?.name || 'Property'}${existing.floor_tag && existing.floor_tag !== 'All Floors' ? ` (${existing.floor_tag})` : ''}`;
                affectedProperties.push(propLabel);
            }
        }

        // 4. Dispatch Consolidated Notification to Approver (Email & WhatsApp)
        (async () => {
            try {
                if (approverUser?.email) {
                    const emailResolution = await EmailRecipientResolver.resolveRecipients({
                        organizationId: organizationId || updatedRequisitions[0]?.organization_id,
                        featureKey: 'requisition_approval_requested',
                        contextualEmails: [approverUser.email]
                    });

                    if (emailResolution.enabled && emailResolution.emails.length > 0) {
                        const sitesListHtml = affectedProperties.map(p => `<li><b>${p}</b></li>`).join('');
                        await EmailService.sendGenericNotificationEmail({
                            emailTo: emailResolution.emails.join(', '),
                            subject: `[Action Required] Multi-Site Requisition Approval Request (${affectedProperties.length} Sites) - ${vendorName}`,
                            title: `Multi-Site Requisition Approval Request`,
                            htmlBody: `
                                <p>Dear <b>${approverInfoData.name}</b>,</p>
                                <p>Procurement team has uploaded a vendor quotation and submitted monthly requisitions for <b>${affectedProperties.length} sites</b> for your review and approval:</p>
                                <ul>${sitesListHtml}</ul>
                                <ul>
                                    <li><b>Vendor Name:</b> ${vendorName}</li>
                                    <li><b>Total Quoted Amount:</b> ₹${Number(totalQuotedAmount).toLocaleString('en-IN')}</li>
                                    <li><b>Vendor Notes:</b> ${vendorNotes || 'Standard contracted quotation.'}</li>
                                    ${fileUrl ? `<li><b>Quotation Attachment:</b> <a href="${fileUrl}">Download ${fileName}</a></li>` : ''}
                                </ul>
                                <p>Please open the SaaS One Procurement module to review the line items and approve or reject the requisition.</p>
                            `
                        });
                    }
                }

                // WhatsApp dispatch to approver
                await WhatsAppEventProcessor.dispatch({
                    featureKey: 'requisition_approval_requested',
                    templateEventKey: 'requisition_approval_requested',
                    organizationId: organizationId || updatedRequisitions[0]?.organization_id,
                    entityId: batchId,
                    contextualUserIds: { approverId: targetApproverId },
                    paramValues: {
                        approver_name: approverInfoData.name,
                        property: `${affectedProperties.length} Sites (${affectedProperties.slice(0, 2).join(', ')}${affectedProperties.length > 2 ? '...' : ''})`,
                        month: MONTH_NAMES[new Date().getMonth()],
                        year: String(new Date().getFullYear()),
                        vendor_name: vendorName,
                        total_amount: Number(totalQuotedAmount).toLocaleString('en-IN'),
                        items_count: String(updatedRequisitions.length)
                    },
                    summaryMessage: `Multi-Site Requisition Approval requested for ${affectedProperties.length} sites by Procurement`
                });
            } catch (notifErr) {
                console.error('[Bulk Requisition Notification Error]:', notifErr);
            }
        })();

        return NextResponse.json({
            success: true,
            batch_id: batchId,
            updated_count: updatedRequisitions.length,
            requisitions: updatedRequisitions
        });
    } catch (err: any) {
        console.error('[Bulk Requisition Approval Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
