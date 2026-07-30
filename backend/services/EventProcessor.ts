import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';

export const EventProcessor = {
    async processEvent(event: any) {
        const { event_type, payload } = event;

        if (event_type === 'MEETING_ROOM_BOOKED' || event_type === 'MEETING_ROOM_CANCELLED') {
            await this.handleMeetingRoomEvent(event_type, payload);
        } else if (event_type === 'MATERIAL_REQUEST_CREATED') {
            await this.handleMaterialRequestEvent(payload);
        } else if (['COMPARATIVE_UPLOADED', 'COMPARATIVE_APPROVED', 'COMPARATIVE_REJECTED', 'MATERIAL_DELIVERED'].includes(event_type)) {
            await this.handleProcurementWorkflowEvent(event_type, payload);
        } else if (event_type === 'REQUISITION_UPLOADED') {
            await this.handleRequisitionUploadedEvent(payload);
        } else {
            console.warn(`[EventProcessor] Unknown event type: ${event_type}`);
        }
    },

    async handleMeetingRoomEvent(eventType: string, payload: any) {
        const propertyId = payload.property_id;
        const meetingRoomId = payload.meeting_room_id;
        const userId = payload.user_id;

        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('organization_id, name')
            .eq('id', propertyId)
            .single();

        if (!property?.organization_id) throw new Error('Property or org_id not found');

        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('email_preferences, email_templates')
            .eq('organization_id', property.organization_id)
            .maybeSingle();

        const emailPrefs = orgData?.email_preferences || {};
        if (emailPrefs.meeting_rooms === false) {
            console.log(`[EventProcessor] Meeting rooms email disabled for org ${property.organization_id}`);
            return;
        }

        const customHtml = (orgData as any)?.email_templates?.meeting_rooms?.html || null;

        const { data: admins } = await supabaseAdmin
            .from('property_memberships')
            .select('user:users!user_id(email)')
            .eq('property_id', propertyId)
            .eq('role', 'property_admin')
            .eq('is_active', true);

        if (!admins || admins.length === 0) {
            console.warn(`[EventProcessor] No property admins found for property ${propertyId}`);
            return;
        }

        const { data: roomData } = await supabaseAdmin
            .from('meeting_rooms')
            .select('name')
            .eq('id', meetingRoomId)
            .single();

        const { data: userData } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', userId)
            .single();

        const isCancellation = eventType === 'MEETING_ROOM_CANCELLED';

        for (const admin of admins) {
            // @ts-ignore
            const emailTo = admin.user?.email || admin.user?.[0]?.email;
            if (emailTo) {
                await EmailService.sendMeetingRoomEmail({
                    emailTo: emailTo,
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
        }
    },

    async handleMaterialRequestEvent(payload: any) {
        const assigneeUid = payload.assignee_uid;
        const ticketId = payload.ticket_id;
        const requestId = payload.id;
        const userId = payload.requested_by;

        const orgId = payload.organization_id;
        if (orgId) {
            const { data: orgData } = await supabaseAdmin
                .from('organization_settings')
                .select('email_preferences')
                .eq('organization_id', orgId)
                .maybeSingle();
            
            if (orgData?.email_preferences?.procurement === false) {
                 console.log(`[EventProcessor] Procurement emails disabled for org ${orgId}`);
                 return;
            }
        }

        let assigneeName = '';
        const recipientEmails = new Set<string>();

        if (assigneeUid) {
            const { data: assignee } = await supabaseAdmin.from('users').select('full_name, email').eq('id', assigneeUid).single();
            if (assignee?.full_name) assigneeName = assignee.full_name;
            if (assignee?.email) recipientEmails.add(assignee.email);
        }

        // Fetch all procurement users for the organization
        if (orgId) {
            const { data: procurementMembers } = await supabaseAdmin
                .from('organization_memberships')
                .select('user_id, users:users!user_id(email, full_name)')
                .eq('organization_id', orgId)
                .eq('role', 'procurement');

            (procurementMembers || []).forEach((m: any) => {
                const email = m.users?.email || m.users?.[0]?.email;
                if (email) recipientEmails.add(email);
            });
        }

        if (recipientEmails.size === 0) {
            console.log(`[EventProcessor] No recipient emails found for material request. Skipping email.`);
            return;
        }

        const { data: ticket } = await supabaseAdmin.from('tickets').select('*, property:properties(name)').eq('id', ticketId).single();
        const { data: requester } = await supabaseAdmin.from('users').select('id, full_name, email').eq('id', userId).single();
        const { data: items } = await supabaseAdmin.from('material_request_items').select('*').eq('request_id', requestId);

        if (ticket) {
            await EmailService.sendMaterialRequestEmail({
                emailTo: Array.from(recipientEmails),
                ticket,
                property: ticket.property,
                requestedBy: requester,
                assignedToName: assigneeName || 'Unassigned',
                items: items || []
            });
        }
    },

    async handleProcurementWorkflowEvent(eventType: string, payload: any) {
        // payload is either a material_request (for DELIVERED) or comparative (for others)
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

        const itemsList: any[] = (request.items as any[]) || [];
        const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com').replace(/\/$/, '');

        // Collect emails based on event
        const emails = new Set<string>();

        const getAdmins = async () => {
            const [orgMems, propMems] = await Promise.all([
                supabaseAdmin.from('organization_memberships').select('users!inner(email)').eq('organization_id', orgId).in('role', ['org_super_admin', 'org_admin']),
                supabaseAdmin.from('property_memberships').select('users!inner(email)').eq('property_id', propId).eq('role', 'property_admin')
            ]);
            orgMems.data?.forEach((m: any) => m.users?.email && emails.add(m.users.email));
            propMems.data?.forEach((m: any) => m.users?.email && emails.add(m.users.email));
        };

        const getAssignee = async () => {
            if (request.assignee_uid) {
                const { data: u } = await supabaseAdmin.from('users').select('email').eq('id', request.assignee_uid).single();
                if (u?.email) emails.add(u.email);
            }
        };

        const getRequester = async () => {
            if (request.requested_by) {
                const { data: u } = await supabaseAdmin.from('users').select('email').eq('id', request.requested_by).single();
                if (u?.email) emails.add(u.email);
            }
        };

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
                            ${payload.file_url ? `<a href="${payload.file_url}" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 8px; margin-bottom: 8px;">📄 View Uploaded Comparative File</a>` : ''}
                            ${ticketId ? `<a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #059669; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-bottom: 8px;">✅ Review & Approve / Negotiate</a>` : ''}
                        </div>
                    </div>
                `;
                await EmailService.sendGenericNotificationEmail({ emailTo: assignedApproverUser.email, subject: appSubject, title: appTitle, htmlBody: appBody }).catch(console.error);
            }

            // 2. Send Informational Audit Notice to Org Super Admins
            const { data: orgSuperAdmins } = await supabaseAdmin
                .from('organization_memberships')
                .select('users!inner(email)')
                .eq('organization_id', orgId)
                .in('role', ['org_super_admin', 'master_admin']);

            const targetApproverLabel = assignedApproverUser ? assignedApproverUser.full_name : 'Designated Approver';

            if (orgSuperAdmins && orgSuperAdmins.length > 0) {
                const auditSubject = `[Audit Notice] Comparative Uploaded for Ticket #${ticketNum}`;
                const auditTitle = 'Comparative Quote Uploaded';
                const auditBody = `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                        <p style="font-size: 15px;">A new comparative quote of <b style="color: #059669; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> at <b>${propertyName}</b> has been uploaded by <b>${assigneeName}</b> and assigned to <b>${targetApproverLabel}</b> for approval.</p>
                        
                        <div style="background-color: #f8fafc; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #e2e8f0;">
                            <p style="margin: 4px 0; font-size: 13px; color: #64748b;"><b>Note for Super Admins:</b> This notification is for your tracking. If <b>${targetApproverLabel}</b> is unavailable or absent, you can review and override approval directly in the dashboard.</p>
                        </div>

                        ${ticketId ? `<div style="margin-top: 16px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 View Ticket & Override in Dashboard</a></div>` : ''}
                    </div>
                `;
                for (const adminMem of orgSuperAdmins) {
                    // @ts-ignore
                    const adminEmail = adminMem.users?.email || adminMem.users?.[0]?.email;
                    if (adminEmail && adminEmail !== assignedApproverUser?.email) {
                        await EmailService.sendGenericNotificationEmail({ emailTo: adminEmail, subject: auditSubject, title: auditTitle, htmlBody: auditBody }).catch(console.error);
                    }
                }
            }

            return; // Finished handling COMPARATIVE_UPLOADED custom multi-email dispatch
        } else if (eventType === 'COMPARATIVE_APPROVED') {
            await getAssignee();
            subject = `Comparative Approved for Ticket #${ticketNum}`;
            title = 'Comparative Cost Approved';
            htmlBody = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                    <p style="font-size: 15px;">Your comparative quote of <b style="color: #059669; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> at <b>${propertyName}</b> has been approved by <b>${actionByName}</b>!</p>
                    <p style="font-size: 14px; color: #64748b;">You may now proceed with placing the order with the selected vendor.</p>
                    ${ticketId ? `<div style="margin-top: 20px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #059669; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🛒 View Ticket & Place Order</a></div>` : ''}
                </div>
            `;
        } else if (eventType === 'COMPARATIVE_REJECTED') {
            await getAssignee();
            subject = `Comparative Rejected/Negotiating for Ticket #${ticketNum}`;
            title = 'Negotiation Requested';
            htmlBody = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6;">
                    <p style="font-size: 15px;">The comparative quote of <b style="color: #dc2626; font-size: 16px;">₹${(payload.total_cost || 0).toLocaleString()}</b> for <b>Ticket #${ticketNum} (${ticketTitle})</b> was marked for negotiation/rejection by <b>${actionByName}</b>.</p>
                    <p style="font-size: 14px; color: #64748b;">Please negotiate with vendors or adjust the quotation details, then upload a revised comparative statement.</p>
                    ${ticketId ? `<div style="margin-top: 20px;"><a href="${appUrl}/tickets/${ticketId}" target="_blank" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 View Ticket Details</a></div>` : ''}
                </div>
            `;
        } else if (eventType === 'MATERIAL_DELIVERED') {
            await getAdmins();
            await getAssignee();
            await getRequester();
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

        if (emails.size === 0) return;

        for (const email of emails) {
            await EmailService.sendGenericNotificationEmail({ emailTo: email, subject, title, htmlBody }).catch(console.error);
        }
    },

    async handleRequisitionUploadedEvent(payload: any) {
        const { organization_id, property_id, requisition_month, requisition_year, file_name, uploaded_by } = payload;

        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = months[requisition_month - 1] || `Month ${requisition_month}`;

        // Get Property Name
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('name')
            .eq('id', property_id)
            .single();

        // Get Uploader Name
        const { data: uploader } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', uploaded_by)
            .single();

        const emailSet = new Set<string>();

        // 1. Get Procurement Users / Admins in the Organization
        const { data: orgMembers } = await supabaseAdmin
            .from('organization_memberships')
            .select('user:users!user_id(email), org_role')
            .eq('organization_id', organization_id)
            .eq('is_active', true);

        if (orgMembers) {
            for (const member of orgMembers) {
                const role = (member.org_role || '').toLowerCase();
                // @ts-ignore
                const userEmail = member.user?.email;
                if (userEmail && (role.includes('procurement') || role.includes('admin') || role.includes('owner') || role === 'master_admin')) {
                    emailSet.add(userEmail);
                }
            }
        }

        // 2. Query property members with procurement role
        const { data: propMembers } = await supabaseAdmin
            .from('property_memberships')
            .select('user:users!user_id(email), role')
            .eq('property_id', property_id)
            .eq('is_active', true);

        if (propMembers) {
            for (const member of propMembers) {
                const role = (member.role || '').toLowerCase();
                // @ts-ignore
                const userEmail = member.user?.email;
                if (userEmail && (role.includes('procurement') || role.includes('admin'))) {
                    emailSet.add(userEmail);
                }
            }
        }

        // 3. Query direct users table for users with procurement/admin emails
        const { data: directUsers } = await supabaseAdmin
            .from('users')
            .select('email')
            .or('email.ilike.%procurement%,email.ilike.%admin%');

        if (directUsers) {
            for (const u of directUsers) {
                if (u.email) emailSet.add(u.email);
            }
        }

        if (emailSet.size === 0) {
            console.warn(`[EventProcessor] No procurement recipients found for org ${organization_id}`);
            return;
        }

        const emailList = Array.from(emailSet);
        console.log(`[EventProcessor] Sending requisition uploaded alert to ${emailList.length} procurement recipients: ${emailList.join(', ')}`);

        await EmailService.sendRequisitionUploadedEmail({
            emailTo: emailList,
            propertyName: property?.name || 'Property',
            monthName,
            year: requisition_year,
            fileName: file_name,
            uploaderName: uploader?.full_name || uploader?.email || 'Property Admin'
        });
    }
};
