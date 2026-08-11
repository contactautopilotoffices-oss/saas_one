import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';

export const EventProcessor = {
    async processEvent(event: any) {
        const { event_type, payload } = event;

        if (['MEETING_ROOM_BOOKED', 'MEETING_ROOM_CANCELLED', 'ROOM_BOOKED', 'ROOM_CANCELLED', 'ROOM_BOOKING_CANCELLED'].includes(event_type)) {
            await this.handleMeetingRoomEvent(event_type, payload);
        } else if (event_type === 'MATERIAL_REQUEST_CREATED') {
            await this.handleMaterialRequestEvent(payload);
        } else if (['COMPARATIVE_UPLOADED', 'COMPARATIVE_APPROVED', 'COMPARATIVE_REJECTED', 'MATERIAL_DELIVERED'].includes(event_type)) {
            await this.handleProcurementWorkflowEvent(event_type, payload);
        } else if (event_type === 'REQUISITION_UPLOADED') {
            await this.handleRequisitionUploadedEvent(payload);
        } else if (event_type === 'VENDOR_PROCUREMENT_REQUESTED') {
            await this.handleVendorProcurementRequestedEvent(payload);
        } else if (event_type === 'VENDOR_PROCUREMENT_ARRANGED') {
            await this.handleVendorProcurementArrangedEvent(payload);
        } else {
            console.warn(`[EventProcessor] Unknown event type: ${event_type}`);
        }
    },

    async handleMeetingRoomEvent(eventType: string, payload: any) {
        let propertyId = payload.property_id;
        const meetingRoomId = payload.meeting_room_id;
        const userId = payload.user_id;

        if (!propertyId && meetingRoomId) {
            const { data: room } = await supabaseAdmin
                .from('meeting_rooms')
                .select('property_id')
                .eq('id', meetingRoomId)
                .maybeSingle();
            if (room?.property_id) {
                propertyId = room.property_id;
            }
        }

        if (!propertyId) {
            console.error('[EventProcessor] Meeting room event missing property_id:', payload);
            return;
        }

        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('organization_id, name')
            .eq('id', propertyId)
            .maybeSingle();

        if (!property?.organization_id) {
            console.error(`[EventProcessor] Property ${propertyId} or org_id not found`);
            return;
        }

        const { data: userData } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', userId)
            .single();

        const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: property.organization_id,
            propertyId,
            featureKey: 'meeting_rooms',
            contextualEmails: [userData?.email]
        });

        if (!enabled || emails.length === 0) {
            console.log(`[EventProcessor] Meeting room email disabled or no recipients for org ${property.organization_id}`);
            return;
        }

        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('email_templates')
            .eq('organization_id', property.organization_id)
            .maybeSingle();

        const customHtml = (orgData as any)?.email_templates?.meeting_rooms?.html || null;

        const { data: roomData } = await supabaseAdmin
            .from('meeting_rooms')
            .select('name')
            .eq('id', meetingRoomId)
            .single();

        const isCancellation = ['MEETING_ROOM_CANCELLED', 'ROOM_CANCELLED', 'ROOM_BOOKING_CANCELLED'].includes(eventType);

        for (const emailTo of emails) {
            await EmailService.sendMeetingRoomEmail({
                emailTo,
                roomName: roomData?.name || 'Meeting Room',
                date: payload.booking_date,
                startTime: payload.start_time,
                endTime: payload.end_time,
                propertyName: property.name || 'Your Property',
                requesterName: userData?.full_name || 'Tenant User',
                requesterEmail: userData?.email || 'N/A',
                isCancellation,
                comment: payload.comment || null,
                customHtml
            });
        }
    },

    async handleMaterialRequestEvent(payload: any) {
        const assigneeUid = payload.assignee_uid;
        const ticketId = payload.ticket_id;
        const requestId = payload.id;
        const userId = payload.requested_by;
        const orgId = payload.organization_id;

        let assigneeName = '';
        let assigneeEmail = '';

        if (assigneeUid) {
            const { data: assignee } = await supabaseAdmin.from('users').select('full_name, email').eq('id', assigneeUid).single();
            if (assignee?.full_name) assigneeName = assignee.full_name;
            if (assignee?.email) assigneeEmail = assignee.email;
        }

        const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: orgId,
            propertyId: payload.property_id,
            featureKey: 'material_requests',
            contextualEmails: [assigneeEmail]
        });

        console.log(`[EventProcessor] Material Request ${requestId} resolved emails (${emails.length}):`, emails);

        if (!enabled || emails.length === 0) {
            console.log(`[EventProcessor] Material request email disabled or no recipients for org ${orgId}`);
            return;
        }

        const { data: ticket } = await supabaseAdmin.from('tickets').select('*, property:properties(name)').eq('id', ticketId).single();
        const { data: requester } = await supabaseAdmin.from('users').select('id, full_name, email').eq('id', userId).single();
        const { data: items } = await supabaseAdmin.from('material_request_items').select('*').eq('request_id', requestId);

        if (ticket) {
            console.log(`[EventProcessor] Sending Material Request email for Request ID ${requestId} to: ${emails.join(', ')}`);
            await EmailService.sendMaterialRequestEmail({
                emailTo: emails,
                ticket,
                property: ticket.property,
                requestedBy: requester,
                assignedToName: assigneeName || 'Unassigned',
                items: items || []
            });
        }
    },

    async handleProcurementWorkflowEvent(eventType: string, payload: any) {
        let requestId = payload.request_id || payload.id;
        
        const { data: request } = await supabaseAdmin
            .from('material_requests')
            .select(`
                id,
                ticket_id,
                requested_by,
                assignee_uid,
                ticket:tickets(id, ticket_number, title, property_id, organization_id, property:properties(name)),
                requester:users!requested_by(full_name, email),
                assignee:users!assignee_uid(full_name, email),
                items:material_request_items(name, quantity, unit_price)
            `)
            .eq('id', requestId)
            .single();

        if (!request) return;

        const ticketObj = Array.isArray(request.ticket) ? request.ticket[0] : (request.ticket as any);
        const ticketId = ticketObj?.id;
        const ticketNum = ticketObj?.ticket_number || '';
        const ticketTitle = ticketObj?.title || 'Maintenance Request';
        const propertyName = ticketObj?.property?.name || 'Site Property';
        const orgId = ticketObj?.organization_id;
        const propId = ticketObj?.property_id;

        const requesterObj = Array.isArray(request.requester) ? request.requester[0] : (request.requester as any);
        const requesterName = requesterObj?.full_name || 'Field Technician';
        const requesterEmail = requesterObj?.email || 'N/A';

        const assigneeObj = Array.isArray(request.assignee) ? request.assignee[0] : (request.assignee as any);
        const assigneeName = assigneeObj?.full_name || 'Procurement User';
        const assigneeEmail = assigneeObj?.email || null;

        const itemsList: any[] = (request.items as any[]) || [];
        const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com').replace(/\/$/, '');

        let featureKey = 'comparative_quotes';
        if (eventType === 'MATERIAL_DELIVERED') {
            featureKey = 'material_delivery';
        }

        const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: orgId,
            propertyId: propId,
            featureKey,
            contextualEmails: [assigneeEmail, requesterEmail]
        });

        if (!enabled || emails.length === 0) return;

        const emailSet = new Set<string>(emails);

        let subject = '';
        let title = '';
        let htmlBody = '';

        let actionByName = 'An Administrator';
        if (payload.action_by) {
            const { data: u } = await supabaseAdmin.from('users').select('full_name').eq('id', payload.action_by).maybeSingle();
            if (u?.full_name) actionByName = u.full_name;
        }

        if (eventType === 'COMPARATIVE_UPLOADED') {
            let assignedApproverUser: any = null;
            if (payload.approver_uid) {
                const { data: u } = await supabaseAdmin.from('users').select('full_name, email').eq('id', payload.approver_uid).maybeSingle();
                if (u) assignedApproverUser = u;
            }

            // 1. Send Action Email to Assigned Approver
            if (assignedApproverUser?.email) {
                const appSubject = `Action Required: Comparative Quote Uploaded for Ticket #${ticketNum}`;
                const appTitle = 'Comparative Quote Ready for Approval';
                const appBody = `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                        <p style="font-size: 15px;">Hello <b>${assignedApproverUser.full_name}</b>,</p>
                        <p style="font-size: 15px;">A new comparative quote of <b style="color: #059669; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> has been uploaded by <b>${assigneeName}</b> and <b>assigned to you for approval</b>.</p>
                        
                        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                            <h4 style="margin-top: 0; color: #0f172a; margin-bottom: 8px;">📋 Ticket & Requester Details</h4>
                            <p style="margin: 4px 0;"><b>Ticket Number:</b> #${ticketNum}</p>
                            <p style="margin: 4px 0;"><b>Subject:</b> ${ticketTitle}</p>
                            <p style="margin: 4px 0;"><b>Property:</b> ${propertyName}</p>
                            <p style="margin: 4px 0;"><b>Requested By:</b> ${requesterName} (${requesterEmail})</p>
                        </div>

                        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                            <h4 style="margin-top: 0; color: #0f172a; margin-bottom: 8px;">📦 Requested Materials (${itemsList.length})</h4>
                            <ul style="padding-left: 20px; margin: 8px 0;">
                                ${itemsList.map((item: any) => `<li><b>${item.name}</b> — Qty: ${item.quantity} ${item.unit_price ? `(Est: ₹${item.unit_price}/unit)` : ''}</li>`).join('')}
                            </ul>
                        </div>

                        ${payload.notes ? `
                        <div style="background-color: #fffbeb; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #fde68a;">
                            <b style="color: #92400e;">Note from Procurement:</b>
                            <p style="margin: 4px 0 0 0; color: #78350f;">${payload.notes}</p>
                        </div>` : ''}

                        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                            ${payload.file_url ? `<a href="${payload.file_url}" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 8px; margin-bottom: 8px;">📄 Download / View Comparative Statement</a>` : ''}
                            ${ticketId ? `<a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #059669; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-bottom: 8px;">✅ Review & Approve / Negotiate</a>` : ''}
                        </div>
                    </div>
                `;

                const getAttachmentFilename = () => {
                    if (payload.file_name) return payload.file_name;
                    if (payload.file_url) {
                        try {
                            const urlPath = new URL(payload.file_url).pathname;
                            const nameFromUrl = urlPath.split('/').pop();
                            if (nameFromUrl && nameFromUrl.includes('.')) return decodeURIComponent(nameFromUrl);
                        } catch {
                            // ignore URL parse errors
                        }
                    }
                    return `Comparative_Statement_${ticketNum}`;
                };

                const fileAttachments = payload.file_url ? [
                    {
                        filename: getAttachmentFilename(),
                        path: payload.file_url
                    }
                ] : [];

                await EmailService.sendGenericNotificationEmail({ 
                    emailTo: assignedApproverUser.email, 
                    subject: appSubject, 
                    title: appTitle, 
                    htmlBody: appBody,
                    attachments: fileAttachments
                }).catch(console.error);
            }

            // 2. Send Audit / Informational Notice to Dynamic Recipients
            const targetApproverLabel = assignedApproverUser ? assignedApproverUser.full_name : 'Designated Approver';

            if (emailSet.size > 0) {
                const auditSubject = `[Notice] Comparative Uploaded for Ticket #${ticketNum}`;
                const auditTitle = 'Comparative Quote Uploaded';
                const auditBody = `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                        <p style="font-size: 15px;">A new comparative quote of <b style="color: #059669; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> at <b>${propertyName}</b> has been uploaded by <b>${assigneeName}</b> and assigned to <b>${targetApproverLabel}</b> for approval.</p>
                        
                        <div style="background-color: #f8fafc; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                            <p style="margin: 4px 0; font-size: 13px; color: #64748b;">This notification is for your tracking. If <b>${targetApproverLabel}</b> is unavailable or absent, authorized users can review and approve directly in the dashboard.</p>
                        </div>

                        ${ticketId ? `<div style="margin-top: 16px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 View Ticket in Dashboard</a></div>` : ''}
                    </div>
                `;
                const getAttachmentFilename = () => {
                    if (payload.file_name) return payload.file_name;
                    if (payload.file_url) {
                        try {
                            const urlPath = new URL(payload.file_url).pathname;
                            const nameFromUrl = urlPath.split('/').pop();
                            if (nameFromUrl && nameFromUrl.includes('.')) return decodeURIComponent(nameFromUrl);
                        } catch {
                            // ignore URL parse errors
                        }
                    }
                    return `Comparative_Statement_${ticketNum}`;
                };

                const fileAttachments = payload.file_url ? [
                    {
                        filename: getAttachmentFilename(),
                        path: payload.file_url
                    }
                ] : [];
                for (const adminEmail of emailSet) {
                    if (adminEmail !== assignedApproverUser?.email) {
                        await EmailService.sendGenericNotificationEmail({ 
                            emailTo: adminEmail, 
                            subject: auditSubject, 
                            title: auditTitle, 
                            htmlBody: auditBody,
                            attachments: fileAttachments
                        }).catch(console.error);
                    }
                }
            }

            return;
        } 
        
        // Fetch approver comment if comparative_id is available
        let approverComment: string | null = payload.approver_comment || null;
        if (!approverComment && payload.comparative_id) {
            const { data: comp } = await supabaseAdmin.from('material_request_comparatives').select('approver_comment').eq('id', payload.comparative_id).maybeSingle();
            if (comp?.approver_comment) approverComment = comp.approver_comment;
        }

        if (eventType === 'COMPARATIVE_APPROVED') {
            subject = `Comparative Approved for Ticket #${ticketNum}`;
            title = 'Comparative Cost Approved';
            htmlBody = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                    <p style="font-size: 15px;">The comparative quote of <b style="color: #059669; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> at <b>${propertyName}</b> has been approved by <b>${actionByName}</b>!</p>
                    ${approverComment ? `
                    <div style="background-color: #ecfdf5; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #a7f3d0;">
                        <b style="color: #065f46; font-size: 14px;">💬 Approval Comment / Note:</b>
                        <p style="margin: 6px 0 0 0; color: #047857; font-size: 14px; font-weight: 500;">"${approverComment}"</p>
                    </div>` : ''}
                    <p style="font-size: 14px; color: #64748b;">Procurement may now proceed with placing the order with the selected vendor.</p>
                    ${ticketId ? `<div style="margin-top: 20px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #059669; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🛒 View Ticket & Place Order</a></div>` : ''}
                </div>
            `;
        } else if (eventType === 'COMPARATIVE_REJECTED') {
            subject = `Comparative Rejected/Negotiating for Ticket #${ticketNum}`;
            title = 'Negotiation Requested';
            htmlBody = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                    <p style="font-size: 15px;">The comparative quote of <b style="color: #dc2626; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> was marked for negotiation/rejection by <b>${actionByName}</b>.</p>
                    ${approverComment ? `
                    <div style="background-color: #fff1f2; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #fecdd3;">
                        <b style="color: #9f1239; font-size: 14px;">💬 Negotiation Reason / Comment:</b>
                        <p style="margin: 6px 0 0 0; color: #be123c; font-size: 14px; font-weight: 500;">"${approverComment}"</p>
                    </div>` : ''}
                    <p style="font-size: 14px; color: #64748b;">Please negotiate with vendors or adjust the quotation details, then upload a revised comparative statement.</p>
                    ${ticketId ? `<div style="margin-top: 20px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 View Ticket Details</a></div>` : ''}
                </div>
            `;
        } else if (eventType === 'MATERIAL_DELIVERED') {
            subject = `Material Delivered for Ticket #${ticketNum}`;
            title = 'Material Delivered Successfully';
            htmlBody = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                    <p style="font-size: 15px;">The requested materials for <b>Ticket #${ticketNum} (${ticketTitle})</b> at <b>${propertyName}</b> have been confirmed as delivered to the site.</p>
                    
                    <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                        <h4 style="margin-top: 0; color: #0f172a; margin-bottom: 8px;">📦 Delivered Items (${itemsList.length})</h4>
                        <ul style="padding-left: 20px; margin: 8px 0;">
                            ${itemsList.map((item: any) => `<li><b>${item.name}</b> — Qty: ${item.quantity}</li>`).join('')}
                        </ul>
                    </div>

                    ${ticketId ? `<div style="margin-top: 20px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 View Ticket</a></div>` : ''}
                </div>
            `;
        }

        if (emailSet.size === 0) return;

        for (const email of emailSet) {
            await EmailService.sendGenericNotificationEmail({ emailTo: email, subject, title, htmlBody }).catch(console.error);
        }
    },

    async handleRequisitionUploadedEvent(payload: any) {
        const { organization_id, property_id, requisition_month, requisition_year, file_name, uploaded_by } = payload;

        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[requisition_month - 1] || `Month ${requisition_month}`;

        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('name')
            .eq('id', property_id)
            .single();

        const { data: uploader } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', uploaded_by)
            .single();

        const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: organization_id,
            propertyId: property_id,
            featureKey: 'monthly_requisitions'
        });

        if (!enabled || emails.length === 0) {
            console.warn(`[EventProcessor] No recipients found for requisition upload in org ${organization_id}`);
            return;
        }

        console.log(`[EventProcessor] Sending requisition uploaded alert to ${emails.length} recipient(s): ${emails.join(', ')}`);

        await EmailService.sendRequisitionUploadedEmail({
            emailTo: emails,
            propertyName: property?.name || 'Property',
            monthName,
            year: requisition_year,
            fileName: file_name,
            uploaderName: uploader?.full_name || uploader?.email || 'Property Admin'
        });
    },

    async handleVendorProcurementRequestedEvent(payload: any) {
        const { ticket_id, property_id, organization_id, note, tagged_by, assigned_procurement_user_id } = payload;

        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('*, property:properties(id, name, organization_id)')
            .eq('id', ticket_id)
            .maybeSingle();

        if (!ticket) {
            console.error(`[EventProcessor] Ticket ${ticket_id} not found for vendor request`);
            return;
        }

        const { data: taggedByUser } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', tagged_by)
            .maybeSingle();

        let assignedProcurementUser: any = null;
        if (assigned_procurement_user_id) {
            const { data: pUser } = await supabaseAdmin
                .from('users')
                .select('id, full_name, email')
                .eq('id', assigned_procurement_user_id)
                .maybeSingle();
            assignedProcurementUser = pUser;
        }

        const orgId = organization_id || ticket.property?.organization_id;

        const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: orgId,
            propertyId: property_id || ticket.property_id,
            featureKey: 'procurement_vendor_tag'
        });

        const finalEmails = new Set<string>(emails);
        if (assignedProcurementUser?.email) {
            finalEmails.add(assignedProcurementUser.email);
        }

        if (!enabled || finalEmails.size === 0) {
            console.warn(`[EventProcessor] No recipients resolved for vendor request in org ${orgId}`);
            return;
        }

        console.log(`[EventProcessor] Processing VENDOR_PROCUREMENT_REQUESTED outbox event for ticket #${ticket.ticket_number}`);

        await EmailService.sendProcurementVendorTagEmail({
            emailTo: Array.from(finalEmails),
            ticket,
            property: ticket.property,
            taggedBy: taggedByUser || { full_name: 'Property Staff' },
            vendorNote: note,
            assignedProcurementUser
        });
    },

    async handleVendorProcurementArrangedEvent(payload: any) {
        const { ticket_id, details, arranged_by, raised_by, assigned_to, tagged_by } = payload;

        const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('*, property:properties(id, name, organization_id)')
            .eq('id', ticket_id)
            .maybeSingle();

        if (!ticket) {
            console.error(`[EventProcessor] Ticket ${ticket_id} not found for vendor arranged`);
            return;
        }

        const { data: arrangedByUser } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', arranged_by)
            .maybeSingle();

        const orgId = ticket.property?.organization_id;

        const { enabled, emails: resolvedEmails } = await EmailRecipientResolver.resolveRecipients({
            organizationId: orgId,
            propertyId: ticket.property_id,
            featureKey: 'procurement_vendor_aligned'
        });

        const finalEmails = new Set<string>(resolvedEmails);

        // Notify ticket requester (raised_by) & tagger staff (tagged_by)
        const recipientUids = Array.from(new Set([raised_by, tagged_by].filter(Boolean)));
        if (recipientUids.length > 0) {
            const { data: users } = await supabaseAdmin
                .from('users')
                .select('email')
                .in('id', recipientUids);
            users?.forEach(u => { if (u.email) finalEmails.add(u.email); });
        }

        if (!enabled || finalEmails.size === 0) {
            console.warn(`[EventProcessor] No recipient emails found for vendor arranged event on ticket #${ticket.ticket_number}`);
            return;
        }

        console.log(`[EventProcessor] Processing VENDOR_PROCUREMENT_ARRANGED outbox event for ticket #${ticket.ticket_number}`);

        await EmailService.sendVendorArrangedEmail({
            emailTo: Array.from(finalEmails),
            ticket,
            property: ticket.property,
            arrangedBy: arrangedByUser || { full_name: 'Procurement Team' },
            arrangedDetails: details
        });
    }
};
