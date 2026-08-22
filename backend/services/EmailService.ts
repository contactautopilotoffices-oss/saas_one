import nodemailer from 'nodemailer';

const smtpUser = process.env.SMTP_USER || process.env.EMAIL_SMTP_USER;
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_SMTP_PASS;
const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com';
const smtpPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT || '465');

const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
    auth: {
        user: smtpUser,
        pass: smtpPass,
    },
});

export const EmailService = {
    async sendNewLeadEmail({ emailTo, subject, html }: { emailTo: string; subject: string; html: string }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }
        try {
            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
            });
            console.log(`[EmailService] New lead email sent to ${emailTo}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send new lead email:', error);
            return false;
        }
    },

    async sendGenericNotificationEmail({ 
        emailTo, 
        subject, 
        title, 
        htmlBody,
        attachments
    }: { 
        emailTo: string; 
        subject: string; 
        title: string; 
        htmlBody: string;
        attachments?: Array<{ filename: string; path?: string; href?: string; contentType?: string }>;
    }) {
        if (!process.env.SMTP_USER) return false;
        try {
            const html = `
                <h2>${title}</h2>
                <div style="margin-top:16px;">${htmlBody}</div>
                <p style="margin-top:24px; color: #555;">Log in to Autopilot FMS to view the details.</p>
            `;
            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
                attachments: attachments || [],
            });
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send generic notification email:', error);
            return false;
        }
    },

    async sendMaterialRequestEmail({
        emailTo,
        ticket,
        property,
        requestedBy,
        requesterRole,
        assignedToName,
        items
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        requestedBy: any;
        requesterRole?: string;
        assignedToName?: string;
        items: any[];
    }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }

        const propertyName = property?.name ? ` - ${property.name}` : '';
        const subject = `Material Request for Ticket #${ticket.ticket_number}${propertyName}`;
        const itemsHtml = items.map(
            img => `<li><b>${img.name}</b> - Qty: ${img.quantity} ${img.notes ? `(Notes: ${img.notes})` : ''}</li>`
        ).join('');

        const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;

        const html = `
            <h2>New Material Request Submitted</h2>
            <p>A new material request has been submitted for a maintenance ticket.</p>
            
            <h3>Ticket Details</h3>
            <ul>
                <li><b>Ticket:</b> ${ticket.ticket_number} - ${ticket.title}</li>
                <li><b>Property:</b> ${property?.name || 'N/A'}</li>
                <li><b>Requested By:</b> ${requestedBy?.full_name || requestedBy?.email || 'System'} (${requesterRole?.toUpperCase() || 'Support'})</li>
                <li><b>Assigned Procurement User:</b> ${assignedToName || 'Unassigned'}</li>
            </ul>

            <h3>Requested Materials</h3>
            <ul>
                ${itemsHtml}
            </ul>

            <p>Please check the Procurement Dashboard or view the ticket directly to fulfill this request.</p>
        `;

        try {
            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Material request email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send material request email:', error);
            return false;
        }
    },

    async sendMeetingRoomEmail({
        emailTo,
        roomName,
        date,
        startTime,
        endTime,
        propertyName,
        requesterName,
        requesterEmail,
        isCancellation = false,
        comment,
        customHtml
    }: {
        emailTo: string;
        roomName: string;
        date: string;
        startTime: string;
        endTime: string;
        propertyName: string;
        requesterName: string;
        requesterEmail: string;
        isCancellation?: boolean;
        comment?: string | null;
        customHtml?: string | null;
    }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }

        // Helper to format time to AM/PM
        const formatTime12h = (timeStr: string) => {
            if (!timeStr) return '';
            const [hours, minutes] = timeStr.split(':');
            let h = parseInt(hours, 10);
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12;
            h = h ? h : 12;
            return `${h.toString().padStart(2, '0')}:${minutes} ${ampm}`;
        };

        const formattedStart = formatTime12h(startTime);
        const formattedEnd = formatTime12h(endTime);

        // Format date from YYYY-MM-DD to DD/MM/YYYY
        const formatDate = (d: string) => {
            if (!d) return d;
            const parts = d.split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return d;
        };
        const formattedDate = formatDate(date);

        const actionText = isCancellation ? 'CANCELLED' : 'Booked';
        const actionWord = isCancellation ? 'Cancelled' : 'Booked';
        const actionDesc = isCancellation 
            ? `A meeting room booking has been <b style="color: #ef4444;">cancelled</b> at <b>${propertyName}</b>.`
            : `A meeting room has been successfully <b style="color: #10b981;">booked</b> at <b>${propertyName}</b>.`;
        
        const subject = `Meeting Room ${actionText}: ${roomName}`;

        // Variable substitution map for custom templates
        const varMap: Record<string, string> = {
            '{{action}}': actionWord,
            '{{action_lower}}': actionWord.toLowerCase(),
            '{{roomName}}': roomName,
            '{{date}}': formattedDate,
            '{{startTime}}': formattedStart,
            '{{endTime}}': formattedEnd,
            '{{propertyName}}': propertyName,
            '{{requesterName}}': requesterName,
            '{{requesterEmail}}': requesterEmail,
            '{{comment}}': comment || '',
        };

        // Use custom org template if provided, else fall back to default
        let html: string;
        if (customHtml) {
            html = customHtml.replace(/\{\{(\w+)\}\}/g, (match) => varMap[match] ?? match);
        } else {
            html = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #334155; line-height: 1.6;">
                <h2 style="color: #0f172a; margin-bottom: 24px; font-weight: 800;">Meeting Room ${isCancellation ? 'Cancellation' : 'Booking'} Notification</h2>
                <p style="font-size: 16px; margin-bottom: 24px;">${actionDesc}</p>
                
                <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">Booking Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; font-weight: 600; width: 120px; color: #64748b;">Room Name:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${roomName}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: 600; color: #64748b;">Date:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${formattedDate}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: 600; color: #64748b;">Time:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${formattedStart} - ${formattedEnd}</td></tr>
                    </table>
                </div>

                <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">Requester Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; font-weight: 600; width: 120px; color: #64748b;">Name:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${requesterName}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: 600; color: #64748b;">Email:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${requesterEmail}</td></tr>
                    </table>
                </div>
                
                ${comment ? `
                <div style="background-color: #fffbeb; padding: 20px; border-radius: 12px; margin: 24px 0; border: 1px solid #fde68a;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Note / Comment</h3>
                    <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">${comment}</p>
                </div>` : ''}
                
                <p style="font-size: 14px; color: #64748b;">Please log in to the FMS Dashboard to view full details.</p>
                
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
                
                <!-- Autopilot Image Banner -->
                <div style="text-align: center; margin-top: 30px;">
                    <img src="${process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com'}/email-banner.png" alt="Autopilot Offices" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                
                <p style="font-size: 11px; font-style: italic; color: #94a3b8; margin-top: 24px; line-height: 1.4;">
                    The information contained in this email is confidential and is directed to the intended addressee(s) only. If you are not the intended addressee, you are requested to notify us immediately and delete the original email.
                </p>
            </div>
        `;
        }

        try {
            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
            });
            console.log(`[EmailService] Meeting room ${isCancellation ? 'cancellation' : 'booking'} email sent to ${emailTo}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send meeting room booking email:', error);
            return false;
        }
    },

    async sendLeadAssignmentEmail({
        emailTo,
        assigneeName,
        leadName,
        companyName,
        contactNumber,
        requirement,
        priority,
        leadId
    }: {
        emailTo: string;
        assigneeName: string;
        leadName: string;
        companyName?: string;
        contactNumber?: string;
        requirement?: string;
        priority?: string;
        leadId: string;
    }) {
        if (!process.env.SMTP_USER || !emailTo) return false;
        try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `New Lead Assigned: ${companyName || leadName || 'CRM Lead'}`;
            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #4f46e5; margin: 0; font-size: 20px;">New CRM Lead Assigned to You</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">You have been assigned a new lead in Autopilot CRM</p>
                    </div>

                    <p style="font-size: 14px;">Hello <b>${assigneeName}</b>,</p>
                    <p style="font-size: 14px;">A new lead has been assigned to you. Here are the key details:</p>

                    <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            ${companyName ? `<tr><td style="padding: 4px 0; color: #64748b; width: 140px;"><b>Company:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${companyName}</td></tr>` : ''}
                            ${leadName ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Contact Person:</b></td><td style="padding: 4px 0; color: #0f172a;">${leadName}</td></tr>` : ''}
                            ${contactNumber ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Phone:</b></td><td style="padding: 4px 0; color: #0f172a;">${contactNumber}</td></tr>` : ''}
                            ${priority ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Priority:</b></td><td style="padding: 4px 0; color: #0f172a;"><span style="background: #fef3c7; color: #d97706; padding: 2px 8px; rounded: 4px; font-size: 12px; font-weight: bold;">${priority}</span></td></tr>` : ''}
                            ${requirement ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Requirement:</b></td><td style="padding: 4px 0; color: #0f172a;">${requirement}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 24px;">
                        <a href="${appUrl}/crm" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-weight: bold; padding: 10px 24px; border-radius: 8px; font-size: 14px;">Open CRM Dashboard</a>
                    </div>

                    <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; text-align: center;">
                        This is an automated notification from Autopilot CRM.
                    </p>
                </div>
            `;
            await transporter.sendMail({
                from: `"Autopilot CRM" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
            });
            console.log(`[EmailService] Lead assignment email sent to ${emailTo}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send lead assignment email:', error);
            return false;
        }
    },

    async sendRequisitionUploadedEmail({
        emailTo,
        propertyName,
        monthName,
        year,
        fileName,
        uploaderName
    }: {
        emailTo: string | string[];
        propertyName: string;
        monthName: string;
        year: number;
        fileName: string;
        uploaderName: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `New Monthly Requisition Uploaded - ${propertyName} (${monthName} ${year})`;
            
            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #0284c7; margin: 0; font-size: 20px;">Monthly Requisition Uploaded</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">A property admin has uploaded a monthly requisition file</p>
                    </div>

                    <div style="background-color: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 140px;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${propertyName}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Requisition Period:</b></td><td style="padding: 4px 0; color: #0f172a;">${monthName} ${year}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Uploaded By:</b></td><td style="padding: 4px 0; color: #0f172a;">${uploaderName}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>File Name:</b></td><td style="padding: 4px 0; color: #0f172a;">${fileName}</td></tr>
                        </table>
                    </div>

                    <p style="font-size: 14px;">Please log in to the procurement portal to download, inspect, and acknowledge this requisition.</p>

                    <div style="text-align: center; margin-top: 24px;">
                        <a href="${appUrl}/procurement" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-weight: bold; padding: 10px 24px; border-radius: 8px; font-size: 14px;">Open Procurement Requisitions</a>
                    </div>

                    <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; text-align: center;">
                        This is an automated notification from Autopilot FMS Procurement System.
                    </p>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot Procurement" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Requisition uploaded email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send requisition uploaded email:', error);
            return false;
        }
    },

    async sendProcurementVendorTagEmail({
        emailTo,
        ticket,
        property,
        taggedBy,
        vendorNote,
        assignedProcurementUser
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        taggedBy: any;
        vendorNote: string;
        assignedProcurementUser?: any;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Action Needed] Vendor Required for Ticket #${ticket.ticket_number} - ${property?.name || ''}`;

            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #ea580c; margin: 0; font-size: 20px;">Vendor Arrangement Required</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">A ticket has been tagged for Procurement team to arrange an external vendor</p>
                    </div>

                    <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 160px;"><b>Ticket #:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">#${ticket.ticket_number || ticket.ticket_code || ticket.id}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Ticket Title:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${ticket.title || ticket.issue_summary || 'Untitled Ticket'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property Name:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${property?.name || 'N/A'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Location / Floor:</b></td><td style="padding: 4px 0; color: #0f172a;">${ticket.location || ticket.location_details || 'N/A'} ${ticket.floor_number ? `(Floor ${ticket.floor_number})` : ''}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Tagged By:</b></td><td style="padding: 4px 0; color: #0f172a;">${taggedBy?.full_name || taggedBy?.email || 'Property Staff'}</td></tr>
                            ${assignedProcurementUser ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned Specialist:</b></td><td style="padding: 4px 0; color: #ea580c; font-weight: bold;">${assignedProcurementUser.full_name || assignedProcurementUser.email}</td></tr>` : ''}
                        </table>
                    </div>

                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">Ticket Description:</h3>
                    <div style="background-color: #f8fafc; padding: 14px; border-radius: 8px; font-size: 14px; color: #334155; border: 1px solid #e2e8f0; white-space: pre-wrap; margin-bottom: 16px;">
                        ${ticket.description || ticket.details || ticket.issue_description || 'No description provided.'}
                    </div>

                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 16px; margin-bottom: 8px;">Vendor Requirements & Notes:</h3>
                    <div style="background-color: #fff7ed; padding: 14px; border-radius: 8px; font-size: 14px; color: #ea580c; border: 1px solid #ffedd5; font-weight: 500; white-space: pre-wrap;">
                        ${vendorNote || 'No specific notes provided.'}
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/procurement?tab=vendor_tickets" style="display: inline-block; background-color: #ea580c; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View in Procurement Dashboard</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Vendor Tagged email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send vendor tagged email:', error);
            return false;
        }
    },

    async sendVendorArrangedEmail({
        emailTo,
        ticket,
        property,
        arrangedBy,
        arrangedDetails
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        arrangedBy: any;
        arrangedDetails: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Vendor Arranged] Update for Ticket #${ticket.ticket_number} - ${property?.name || ''}`;

            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #16a34a; margin: 0; font-size: 20px;">Vendor Arranged</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Procurement has successfully arranged a vendor for your ticket</p>
                    </div>

                    <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 140px;"><b>Ticket #:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">#${ticket.ticket_number} - ${ticket.title}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'N/A'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Arranged By:</b></td><td style="padding: 4px 0; color: #0f172a;">${arrangedBy?.full_name || arrangedBy?.email || 'Procurement Team'}</td></tr>
                        </table>
                    </div>

                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 20px;">Vendor Details / Visit Schedule:</h3>
                    <div style="background-color: #f8fafc; padding: 14px; border-radius: 8px; font-size: 14px; color: #334155; border: 1px solid #e2e8f0; white-space: pre-wrap;">
                        ${arrangedDetails || 'Vendor has been assigned to visit.'}
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/tickets/${ticket.id}" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View Ticket Details</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Vendor Arranged email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send vendor arranged email:', error);
            return false;
        }
    },

    async sendTicketCreatedEmail({
        emailTo,
        ticket,
        property,
        raisedBy,
        assignedTo
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        raisedBy: any;
        assignedTo?: any;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const priorityColor = ticket.priority === 'Critical' ? '#dc2626' : (ticket.priority === 'High' ? '#ea580c' : '#2563eb');
            const subject = `[New Ticket #${ticket.ticket_number}] ${ticket.title} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #0f172a; margin: 0; font-size: 20px;">🎫 New Service Ticket Raised</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Ticket #${ticket.ticket_number} has been logged in Autopilot FMS</p>
                    </div>

                    <div style="background-color: #f8fafc; border-left: 4px solid ${priorityColor}; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Ticket #:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">#${ticket.ticket_number}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Subject:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${ticket.title}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Priority:</b></td><td style="padding: 4px 0; color: ${priorityColor}; font-weight: bold;">${ticket.priority || 'Medium'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Raised By:</b></td><td style="padding: 4px 0; color: #0f172a;">${raisedBy?.full_name || raisedBy?.email || 'Tenant'} ${raisedBy?.phone ? `(${raisedBy.phone})` : ''}</td></tr>
                            ${assignedTo ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned To:</b></td><td style="padding: 4px 0; color: #0f172a;">${assignedTo.full_name || assignedTo.email}</td></tr>` : ''}
                        </table>
                    </div>

                    ${ticket.description ? `
                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 16px; margin-bottom: 6px;">Description / Issue Details:</h3>
                    <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 14px; color: #334155; white-space: pre-wrap;">
                        ${ticket.description}
                    </div>` : ''}

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/tickets/${ticket.id || ticket.ticket_id}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View Ticket in Dashboard</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Ticket created email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send ticket created email:', error);
            return false;
        }
    },

    async sendTicketAssignedEmail({
        emailTo,
        ticket,
        property,
        assignedTo,
        raisedBy
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        assignedTo: any;
        raisedBy?: any;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Ticket Assigned #${ticket.ticket_number}] ${ticket.title} - ${property?.name || ''}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2563eb; margin: 0; font-size: 20px;">👷 Ticket Assigned</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">You have been assigned to Ticket #${ticket.ticket_number}</p>
                    </div>

                    <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Ticket #:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">#${ticket.ticket_number}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Subject:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${ticket.title}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Priority:</b></td><td style="padding: 4px 0; color: #2563eb; font-weight: bold;">${ticket.priority || 'Medium'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned To:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${assignedTo?.full_name || assignedTo?.email || 'Technician'}</td></tr>
                            ${raisedBy ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Requester:</b></td><td style="padding: 4px 0; color: #0f172a;">${raisedBy.full_name || raisedBy.email} ${raisedBy.phone ? `(${raisedBy.phone})` : ''}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/tickets/${ticket.id || ticket.ticket_id}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Open Ticket & Update Status</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Ticket assigned email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send ticket assigned email:', error);
            return false;
        }
    },

    async sendTicketCompletedEmail({
        emailTo,
        ticket,
        property,
        resolvedBy,
        resolutionNotes
    }: {
        emailTo: string | string[];
        ticket: any;
        property: any;
        resolvedBy: any;
        resolutionNotes?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Resolved] Ticket #${ticket.ticket_number} - ${ticket.title}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #16a34a; margin: 0; font-size: 20px;">✅ Service Request Resolved</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Ticket #${ticket.ticket_number} has been completed</p>
                    </div>

                    <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Ticket #:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">#${ticket.ticket_number}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Subject:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${ticket.title}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Resolved By:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${resolvedBy?.full_name || resolvedBy?.email || 'Technician'}</td></tr>
                        </table>
                    </div>

                    ${resolutionNotes ? `
                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 16px; margin-bottom: 6px;">Resolution Summary:</h3>
                    <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 14px; color: #334155; white-space: pre-wrap;">
                        ${resolutionNotes}
                    </div>` : ''}

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/tickets/${ticket.id || ticket.ticket_id}" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Verify & Rate Service Quality</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Ticket completed email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send ticket completed email:', error);
            return false;
        }
    },

    async sendChecklistCompletedEmail({
        emailTo,
        checklistTitle,
        property,
        completedBy,
        score,
        notes
    }: {
        emailTo: string | string[];
        checklistTitle: string;
        property: any;
        completedBy: any;
        score?: number | string;
        notes?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Checklist Completed] ${checklistTitle} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #059669; margin: 0; font-size: 20px;">📋 Checklist Completed</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">SOP execution has been logged in Autopilot FMS</p>
                    </div>

                    <div style="background-color: #f0fdf4; border-left: 4px solid #059669; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Checklist:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${checklistTitle}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Completed By:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${completedBy?.full_name || completedBy?.email || 'Staff'}</td></tr>
                            ${score !== undefined ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Score / Compliance:</b></td><td style="padding: 4px 0; color: #059669; font-weight: bold;">${score}</td></tr>` : ''}
                        </table>
                    </div>

                    ${notes ? `
                    <h3 style="font-size: 15px; color: #0f172a; margin-top: 16px; margin-bottom: 6px;">Notes / Remarks:</h3>
                    <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 14px; color: #334155; white-space: pre-wrap;">
                        ${notes}
                    </div>` : ''}

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/soft-service-manager" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View Checklist Report</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Checklist completed email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send checklist completed email:', error);
            return false;
        }
    },

    async sendChecklistReminderEmail({
        emailTo,
        checklistTitle,
        property,
        assignedTo,
        dueTime
    }: {
        emailTo: string | string[];
        checklistTitle: string;
        property: any;
        assignedTo?: any;
        dueTime?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[📋 Reminder] Checklist Due Soon: ${checklistTitle} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #6366f1; margin: 0; font-size: 20px;">📋 Checklist Due Soon</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">An upcoming SOP checklist is scheduled for execution</p>
                    </div>

                    <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Checklist:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${checklistTitle}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            ${assignedTo ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned To:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${assignedTo?.full_name || assignedTo?.email || 'Staff'}</td></tr>` : ''}
                            ${dueTime ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Due Time:</b></td><td style="padding: 4px 0; color: #6366f1; font-weight: bold;">${dueTime}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/soft-service-manager" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Open Checklist in FMS</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Checklist reminder email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send checklist reminder email:', error);
            return false;
        }
    },

    async sendChecklistOverdueEmail({
        emailTo,
        checklistTitle,
        property,
        assignedTo,
        slotTime
    }: {
        emailTo: string | string[];
        checklistTitle: string;
        property: any;
        assignedTo?: any;
        slotTime?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[⚠️ Overdue Alert] Checklist Missed: ${checklistTitle} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #dc2626; margin: 0; font-size: 20px;">⚠️ Checklist Slot Overdue</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">A scheduled checklist was not completed in the designated slot</p>
                    </div>

                    <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Checklist:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${checklistTitle}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Scheduled Slot:</b></td><td style="padding: 4px 0; color: #dc2626; font-weight: 600;">${slotTime || 'Scheduled Time'}</td></tr>
                            ${assignedTo ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned Staff:</b></td><td style="padding: 4px 0; color: #0f172a;">${assignedTo.full_name || assignedTo.email}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/soft-service-manager" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Review Missed Checklist</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Checklist overdue alert email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send checklist overdue email:', error);
            return false;
        }
    },

    async sendPpmReminderEmail({
        emailTo,
        schedule,
        property,
        vendor
    }: {
        emailTo: string | string[];
        schedule: any;
        property: any;
        vendor?: any;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[🔧 PPM Reminder] ${schedule.system_name || 'Asset Maintenance'} Due - ${property?.name || ''}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #d97706; margin: 0; font-size: 20px;">🔧 Planned Preventive Maintenance Reminder</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">PPM activity is scheduled for execution</p>
                    </div>

                    <div style="background-color: #fffbeb; border-left: 4px solid #d97706; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>System / Asset:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${schedule.system_name || 'System / Asset'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Planned Date:</b></td><td style="padding: 4px 0; color: #d97706; font-weight: bold;">${schedule.planned_date}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Vendor / Team:</b></td><td style="padding: 4px 0; color: #0f172a;">${vendor?.name || schedule.vendor_name || 'Assigned Vendor'}</td></tr>
                            ${schedule.location ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Location:</b></td><td style="padding: 4px 0; color: #0f172a;">${schedule.location}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/dashboard?tab=ppm" style="display: inline-block; background-color: #d97706; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View PPM Schedule</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] PPM reminder email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send PPM reminder email:', error);
            return false;
        }
    },

    async sendLeadAssignedEmail({
        emailTo,
        lead,
        assignedTo,
        propertyName
    }: {
        emailTo: string | string[];
        lead: any;
        assignedTo: any;
        propertyName?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[Lead Assigned] ${lead.company_name || 'New Lead'} - ${propertyName || 'CRM'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #6366f1; margin: 0; font-size: 20px;">🎯 CRM Lead Assigned</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">A new lead has been assigned to you</p>
                    </div>

                    <div style="background-color: #eef2ff; border-left: 4px solid #6366f1; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Company:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${lead.company_name || 'Company'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Contact Person:</b></td><td style="padding: 4px 0; color: #0f172a;">${lead.contact_person || 'N/A'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Phone / Mobile:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${lead.phone || lead.contact_number || 'N/A'}</td></tr>
                            ${lead.requirement ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Requirement:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${lead.requirement}</td></tr>` : ''}
                            ${lead.email ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Email:</b></td><td style="padding: 4px 0; color: #0f172a;">${lead.email}</td></tr>` : ''}
                            ${propertyName ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Property Interest:</b></td><td style="padding: 4px 0; color: #0f172a;">${propertyName}</td></tr>` : ''}
                            ${lead.source ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Source:</b></td><td style="padding: 4px 0; color: #0f172a;">${lead.source}</td></tr>` : ''}
                            ${lead.campaign ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Campaign:</b></td><td style="padding: 4px 0; color: #0f172a;">${lead.campaign}</td></tr>` : ''}
                            ${lead.next_followup ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Next Follow-up:</b></td><td style="padding: 4px 0; color: #6366f1; font-weight: bold;">${lead.next_followup}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/crm/leads" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Open CRM Lead</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Lead assigned email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send lead assigned email:', error);
            return false;
        }
    }
};
