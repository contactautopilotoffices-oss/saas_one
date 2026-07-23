import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', // Match your supabase config
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
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

    async sendMaterialRequestEmail({
        emailTo,
        ticket,
        property,
        requestedBy,
        requesterRole,
        items
    }: {
        emailTo: string;
        ticket: any;
        property: any;
        requestedBy: any;
        requesterRole?: string;
        items: any[];
    }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }

        const subject = `Material Request for Ticket #${ticket.ticket_number}`;
        const itemsHtml = items.map(
            img => `<li><b>${img.name}</b> - Qty: ${img.quantity} ${img.notes ? `(Notes: ${img.notes})` : ''}</li>`
        ).join('');

        const html = `
            <h2>Material Request</h2>
            <p>You have been tagged in a new material request for a ticket.</p>
            
            <h3>Ticket Details</h3>
            <ul>
                <li><b>Ticket:</b> ${ticket.ticket_number} - ${ticket.title}</li>
                <li><b>Property:</b> ${property?.name || 'N/A'}</li>
                <li><b>Requested By:</b> ${requestedBy?.full_name || requestedBy?.email || 'System'} (${requesterRole?.toUpperCase() || 'Support'})</li>
            </ul>

            <h3>Requested Materials</h3>
            <ul>
                ${itemsHtml}
            </ul>

            <p>Please check the Procurement Dashboard or view the ticket directly to fulfill this request.</p>
            
            <p style="margin-top: 20px;">
                <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotoffices.com'}/tickets/${ticket.id}?from=requests" style="display: inline-block; padding: 12px 24px; background-color: #000000; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-family: sans-serif;">
                    View Ticket Details
                </a>
            </p>
        `;

        try {
            await transporter.sendMail({
                from: `"Autopilot FMS" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
            });
            console.log(`[EmailService] Material request email sent to ${emailTo}`);
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
    }
};
