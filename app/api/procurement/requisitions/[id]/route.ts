import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: 'Requisition ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        const { data: req, error } = await adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name, address, city),
                uploader:users!uploaded_by(id, full_name, email, phone),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .eq('id', id)
            .single();

        if (error || !req) {
            return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
        }

        let parsedData: any = {};
        try {
            if (req.notes && typeof req.notes === 'string' && req.notes.trim().startsWith('{')) {
                parsedData = JSON.parse(req.notes);
            }
        } catch {
            parsedData = {};
        }

        return NextResponse.json({
            requisition: {
                ...req,
                items: parsedData.items || [],
                categories: parsedData.categories || [],
                total_estimated_amount: parsedData.total_estimated_amount || 0,
                total_items_count: parsedData.items?.length || 0,
                site_notes: parsedData.site_notes || req.notes || '',
                vendor_quotation: parsedData.vendor_quotation || null,
                approver_info: parsedData.approver_info || null,
                po_info: parsedData.po_info || null
            }
        });
    } catch (err: any) {
        console.error('[Requisition Single GET Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: 'Requisition ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const contentType = request.headers.get('content-type') || '';

        // Fetch existing record
        const { data: existing, error: fetchErr } = await adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email)
            `)
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
        }

        let existingNotesObj: any = {};
        try {
            if (existing.notes && existing.notes.trim().startsWith('{')) {
                existingNotesObj = JSON.parse(existing.notes);
            }
        } catch {
            existingNotesObj = { site_notes: existing.notes || '' };
        }

        let updateStatus = existing.status;
        let vendorQuotationData = existingNotesObj.vendor_quotation || null;
        let approverInfoData = existingNotesObj.approver_info || null;
        let poInfoData = existingNotesObj.po_info || null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const action = formData.get('action') as string || 'submit_for_approval';

            if (action === 'issue_po') {
                const poNumber = formData.get('po_number') as string || '';
                const vendorName = formData.get('vendor_name') as string || vendorQuotationData?.vendor_name || '';
                const totalPoAmount = parseFloat(formData.get('total_po_amount') as string || String(vendorQuotationData?.total_quoted_amount || existingNotesObj.total_estimated_amount || 0));
                const expectedDeliveryDate = formData.get('expected_delivery_date') as string || '';
                const poNotes = formData.get('po_notes') as string || '';
                const poFile = formData.get('po_file') as File | null;

                let poFileUrl = poInfoData?.file_url || '';
                let poFileName = poInfoData?.file_name || '';

                if (poFile) {
                    const poPath = `${existing.organization_id}/${existing.property_id}/po_${Date.now()}_${poFile.name}`;
                    const arrayBuffer = await poFile.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const { data: uploadData, error: poUploadErr } = await adminSupabase.storage
                        .from('procurement_requisitions')
                        .upload(poPath, buffer, { upsert: true, contentType: poFile.type || 'application/octet-stream' });

                    if (!poUploadErr && uploadData) {
                        poFileUrl = adminSupabase.storage.from('procurement_requisitions').getPublicUrl(uploadData.path).data.publicUrl;
                        poFileName = poFile.name;
                    }
                }

                poInfoData = {
                    po_number: poNumber,
                    vendor_name: vendorName,
                    total_po_amount: totalPoAmount,
                    expected_delivery_date: expectedDeliveryDate,
                    notes: poNotes,
                    file_url: poFileUrl,
                    file_name: poFileName,
                    issued_at: new Date().toISOString()
                };

                updateStatus = 'ordered';
            } else {
                const vendorName = formData.get('vendor_name') as string || '';
                const totalQuotedAmount = parseFloat(formData.get('total_quoted_amount') as string || '0');
                const vendorNotes = formData.get('vendor_notes') as string || '';
                const targetApproverId = formData.get('target_approver_id') as string || '';
                const quoteFile = formData.get('quote_file') as File | null;

                let fileUrl = vendorQuotationData?.file_url || '';
                let fileName = vendorQuotationData?.file_name || '';

                if (quoteFile) {
                    const quotePath = `${existing.organization_id}/${existing.property_id}/quotes_${Date.now()}_${quoteFile.name}`;
                    const arrayBuffer = await quoteFile.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const { data: uploadData, error: quoteUploadErr } = await adminSupabase.storage
                        .from('procurement_requisitions')
                        .upload(quotePath, buffer, { upsert: true, contentType: quoteFile.type || 'application/octet-stream' });

                    if (!quoteUploadErr && uploadData) {
                        fileUrl = adminSupabase.storage.from('procurement_requisitions').getPublicUrl(uploadData.path).data.publicUrl;
                        fileName = quoteFile.name;
                    }
                }

                vendorQuotationData = {
                    vendor_name: vendorName,
                    total_quoted_amount: totalQuotedAmount,
                    notes: vendorNotes,
                    file_url: fileUrl,
                    file_name: fileName,
                    uploaded_at: new Date().toISOString()
                };

                if (targetApproverId) {
                    const { data: approverUser } = await adminSupabase.from('users').select('id, full_name, email, phone').eq('id', targetApproverId).single();
                    approverInfoData = {
                        id: targetApproverId,
                        name: approverUser?.full_name || 'Approver',
                        email: approverUser?.email || '',
                        phone: approverUser?.phone || '',
                        assigned_at: new Date().toISOString(),
                        status: 'pending'
                    };
                }

                if (action === 'submit_for_approval') {
                    updateStatus = 'pending_approval';
                }
            }
        } else {
            const body = await request.json();
            if (body.status) updateStatus = body.status;
            if (body.vendor_quotation) vendorQuotationData = body.vendor_quotation;
            if (body.approver_info) approverInfoData = body.approver_info;
            if (body.po_info) poInfoData = body.po_info;
        }

        const mergedNotes = JSON.stringify({
            ...existingNotesObj,
            vendor_quotation: vendorQuotationData,
            approver_info: approverInfoData,
            po_info: poInfoData,
            updated_at: new Date().toISOString()
        });

        const { data: updatedRecord, error: updateError } = await adminSupabase
            .from('property_monthly_requisitions')
            .update({
                status: updateStatus,
                notes: mergedNotes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email)
            `)
            .single();

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update requisition', details: updateError.message }, { status: 500 });
        }

        // If status moved to pending_approval, notify Approver via Email & WhatsApp
        if (updateStatus === 'pending_approval' && approverInfoData?.id) {
            const monthName = MONTH_NAMES[(existing.requisition_month || 1) - 1];
            const propertyName = existing.property?.name || 'Site Property';
            const totalAmount = vendorQuotationData?.total_quoted_amount || existingNotesObj.total_estimated_amount || 0;

            (async () => {
                try {
                    const emailResolution = await EmailRecipientResolver.resolveRecipients({
                        organizationId: existing.organization_id,
                        propertyId: existing.property_id,
                        featureKey: 'requisition_approval_requested',
                        contextualEmails: approverInfoData.email ? [approverInfoData.email] : []
                    });

                    if (emailResolution.enabled && emailResolution.emails.length > 0) {
                        await EmailService.sendGenericNotificationEmail({
                            emailTo: emailResolution.emails.join(', '),
                            subject: `[Action Required] Requisition Approval for ${propertyName} (${monthName} ${existing.requisition_year})`,
                            title: `Requisition Approval Requested`,
                            htmlBody: `
                                <p>Hello <b>${approverInfoData.name || 'Approver'}</b>,</p>
                                <p>Procurement has finalized vendor quotations for <b>${propertyName}</b> (${monthName} ${existing.requisition_year}) and requested your review & approval.</p>
                                <ul>
                                    <li><b>Site:</b> ${propertyName}</li>
                                    <li><b>Quoted Amount:</b> ₹${Number(totalAmount).toLocaleString('en-IN')}</li>
                                    <li><b>Vendor:</b> ${vendorQuotationData?.vendor_name || 'Selected Vendor'}</li>
                                    ${vendorQuotationData?.file_url ? `<li><b>Quotation Sheet:</b> <a href="${vendorQuotationData.file_url}" target="_blank">Download Attached Quote</a></li>` : ''}
                                </ul>
                                <p>Please open the Autopilot App UI to review the items and approve/reject.</p>
                            `
                        });
                    }

                    await WhatsAppEventProcessor.dispatch({
                        featureKey: 'requisition_approval_requested',
                        templateEventKey: 'requisition_approval_requested',
                        organizationId: existing.organization_id,
                        propertyId: existing.property_id,
                        entityId: existing.id,
                        contextualUserIds: { approverId: approverInfoData.id },
                        paramValues: {
                            approver_name: approverInfoData.name || 'Director',
                            property: propertyName,
                            month: monthName,
                            year: String(existing.requisition_year || new Date().getFullYear()),
                            vendor_name: vendorQuotationData?.vendor_name || 'Selected Vendor',
                            total_amount: Number(totalAmount).toLocaleString('en-IN'),
                            notes: vendorQuotationData?.notes || 'Vendor quotes attached for approval'
                        },
                        summaryMessage: `Requisition approval requested for ${propertyName} (₹${Number(totalAmount).toLocaleString('en-IN')})`
                    });
                } catch (notifErr) {
                    console.error('[Approver Notification Dispatch Error]:', notifErr);
                }
            })();
        }

        // If status moved to ordered (PO Issued), notify Site Admin & Requester via Email & WhatsApp (Template 13D)
        if (updateStatus === 'ordered' && poInfoData) {
            const monthName = MONTH_NAMES[(existing.requisition_month || 1) - 1];
            const propertyName = existing.property?.name || 'Site Property';
            const floorTag = existing.floor_tag && existing.floor_tag !== 'All Floors' ? ` (${existing.floor_tag})` : '';
            const propertyDisplay = `${propertyName}${floorTag}`;

            (async () => {
                try {
                    const contextualEmails: string[] = [];
                    if (existing.uploader?.email) contextualEmails.push(existing.uploader.email);

                    const emailResolution = await EmailRecipientResolver.resolveRecipients({
                        organizationId: existing.organization_id,
                        propertyId: existing.property_id,
                        featureKey: 'requisition_po_issued',
                        contextualEmails
                    });

                    if (emailResolution.enabled && emailResolution.emails.length > 0) {
                        await EmailService.sendGenericNotificationEmail({
                            emailTo: emailResolution.emails.join(', '),
                            subject: `[PO Issued] Monthly Requisition #${poInfoData.po_number} for ${propertyDisplay}`,
                            title: `Purchase Order Issued 🛒`,
                            htmlBody: `
                                <p>Hello,</p>
                                <p>The Purchase Order for the <b>${propertyDisplay}</b> (${monthName} ${existing.requisition_year}) monthly requisition has been officially issued to <b>${poInfoData.vendor_name}</b>.</p>
                                <ul>
                                    <li><b>PO Number:</b> #${poInfoData.po_number}</li>
                                    <li><b>Vendor:</b> ${poInfoData.vendor_name}</li>
                                    <li><b>Total Amount:</b> ₹${Number(poInfoData.total_po_amount).toLocaleString('en-IN')}</li>
                                    ${poInfoData.expected_delivery_date ? `<li><b>Expected Delivery:</b> ${poInfoData.expected_delivery_date}</li>` : ''}
                                    ${poInfoData.file_url ? `<li><b>PO Document:</b> <a href="${poInfoData.file_url}" target="_blank">Download PO</a></li>` : ''}
                                </ul>
                                <p>Items will be delivered to site as per schedule. Please conduct physical stock verification upon arrival.</p>
                            `
                        });
                    }

                    await WhatsAppEventProcessor.dispatch({
                        featureKey: 'requisition_po_issued',
                        templateEventKey: 'requisition_po_issued',
                        organizationId: existing.organization_id,
                        propertyId: existing.property_id,
                        entityId: existing.id,
                        contextualUserIds: { requesterId: existing.uploaded_by },
                        paramValues: {
                            user_name: existing.uploader?.full_name || 'Site Admin',
                            month: monthName,
                            year: String(existing.requisition_year || new Date().getFullYear()),
                            property: propertyDisplay,
                            vendor_name: poInfoData.vendor_name || 'Vendor',
                            po_number: poInfoData.po_number || 'PO-1001',
                            total_amount: Number(poInfoData.total_po_amount || 0).toLocaleString('en-IN')
                        },
                        summaryMessage: `PO #${poInfoData.po_number} issued to ${poInfoData.vendor_name} for ${propertyDisplay}`
                    });
                } catch (err) {
                    console.error('[PO Issued Notification Dispatch Error]:', err);
                }
            })();
        }

        return NextResponse.json({ success: true, requisition: updatedRecord });
    } catch (err: any) {
        console.error('[Requisition PATCH Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: 'Requisition ID is required' }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch existing requisition
        const { data: existing, error: fetchErr } = await adminSupabase
            .from('property_monthly_requisitions')
            .select('id, organization_id, property_id, uploaded_by, status, file_url')
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
        }

        // 2. Permission check: Must be the requester (uploaded_by) OR Super Admin / Procurement
        const userRole = (user.user_metadata?.role || '').toLowerCase();
        const isRequester = existing.uploaded_by === user.id;
        const isSuperAdmin = userRole === 'org_super_admin' || userRole === 'master_admin';
        const isProcurement = userRole.includes('procurement');

        if (!isRequester && !isSuperAdmin && !isProcurement) {
            return NextResponse.json({
                error: 'Forbidden: Only the original requester or administrators can delete this requisition.'
            }, { status: 403 });
        }

        // 3. Delete from database
        const { error: deleteErr } = await adminSupabase
            .from('property_monthly_requisitions')
            .delete()
            .eq('id', id);

        if (deleteErr) {
            console.error('Error deleting requisition:', deleteErr);
            return NextResponse.json({ error: deleteErr.message }, { status: 500 });
        }

        // 4. Clean up uploaded storage file if exists
        if (existing.file_url && existing.file_url.includes('procurement_requisitions')) {
            try {
                const parts = existing.file_url.split('/procurement_requisitions/');
                if (parts[1]) {
                    const storagePath = decodeURIComponent(parts[1]);
                    await adminSupabase.storage.from('procurement_requisitions').remove([storagePath]);
                }
            } catch (storageErr) {
                console.warn('Storage cleanup warning:', storageErr);
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Requisition deleted successfully'
        });
    } catch (err: any) {
        console.error('[Requisition DELETE Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
