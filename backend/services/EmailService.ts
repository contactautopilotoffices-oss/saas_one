import * as nodemailer from 'nodemailer';

const resendApiKey = process.env.RESEND_API_KEY || (process.env.SMTP_USER === 'resend' ? process.env.SMTP_PASS : undefined);
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_SMTP_USER || (resendApiKey ? 'resend' : undefined);
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_SMTP_PASS || resendApiKey;
const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_SMTP_HOST || (resendApiKey ? 'smtp.resend.com' : 'smtp.gmail.com');
const smtpPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT || '465');
const DEFAULT_SENDER_NAME = process.env.SMTP_SENDER_NAME || 'Autopilot Offices';

const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
    auth: (smtpUser && smtpPass) ? {
        user: smtpUser,
        pass: smtpPass,
    } : undefined,
});

// In-memory deduplication cache to prevent concurrent/rapid duplicate emails (e.g. within 45s)
const recentlySentEmails = new Map<string, number>();

export const EmailService = {
    /** Outbox delivery uses durable identity; no subject cache or cross-provider fallback. */
    async sendTransactionalEmail({to,subject,html,text,idempotencyKey}:{to:string;subject:string;html:string;text:string;idempotencyKey:string}):Promise<{success:boolean;ambiguous?:boolean;error?:string;providerReference?:string}> {
        const sender=process.env.RESEND_FROM_EMAIL||process.env.SMTP_SENDER_EMAIL||smtpUser||'onboarding@resend.dev';
        if(resendApiKey){
            try {
                const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':`petty-cash-${idempotencyKey}`},body:JSON.stringify({from:sender.includes('<')?sender:`"${DEFAULT_SENDER_NAME}" <${sender}>`,to:[to],subject,html,text}),signal:AbortSignal.timeout(15_000)});
                const body=await response.json().catch(()=>({}));
                return response.ok?{success:true,providerReference:typeof body.id==='string'?body.id:undefined}:{success:false,ambiguous:response.status>=500,error:`Email provider HTTP ${response.status}`};
            }catch{return {success:false,ambiguous:true,error:'Email provider outcome unknown; reconcile before retry'};}
        }
        if(!smtpUser||!smtpPass)return {success:false,error:'Email provider credentials are not configured'};
        try {const result=await transporter.sendMail({from:sender.includes('<')?sender:`"${DEFAULT_SENDER_NAME}" <${sender}>`,to,subject,html,text,messageId:`<petty-cash-${idempotencyKey}@autopilot.local>`});return {success:true,providerReference:result.messageId};}
        catch(reason:any){return {success:false,ambiguous:!['EAUTH','EENVELOPE','ECONNECTION'].includes(reason?.code),error:'Email provider failed'+(reason?.code?` (${reason.code})`:'')};}
    },
    // Generic sender — supports Resend API (RESEND_API_KEY) and SMTP credentials.
    async sendEmail({ to, subject, html, attachments }: {
        to: string | string[];
        subject: string;
        html: string;
        attachments?: { filename: string; content: Buffer; contentType?: string }[];
    }) {
        // Deduplication guard
        const recipientKey = Array.isArray(to) ? to.slice().sort().join(',') : (to || '');
        const dedupeKey = `${recipientKey.toLowerCase().trim()}:::${(subject || '').trim()}`;
        const now = Date.now();
        const lastSent = recentlySentEmails.get(dedupeKey);
        if (lastSent && now - lastSent < 45_000) {
            console.log(`[EmailService] Suppressing duplicate email send to ${recipientKey} for subject "${subject}" (sent ${Math.round((now - lastSent) / 1000)}s ago)`);
            return true;
        }
        recentlySentEmails.set(dedupeKey, now);

        // Prune stale cache entries
        if (recentlySentEmails.size > 1000) {
            recentlySentEmails.forEach((ts, key) => {
                if (now - ts > 120_000) recentlySentEmails.delete(key);
            });
        }

        const apiKey = resendApiKey;
        const sender = process.env.RESEND_FROM_EMAIL || process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER || 'onboarding@resend.dev';

        if (apiKey) {
            try {
                const res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: sender.includes('<') ? sender : `"${DEFAULT_SENDER_NAME}" <${sender}>`,
                        to: Array.isArray(to) ? to : [to],
                        subject,
                        html
                    })
                });
                if (res.ok) return true;
                const errData = await res.json().catch(() => ({}));
                console.error('[EmailService] Resend API error:', errData);
            } catch (err) {
                console.error('[EmailService] Resend fetch failed, falling back to SMTP:', err);
            }
        }

        if (!smtpUser || !smtpPass) {
            console.warn('[EmailService] Neither RESEND_API_KEY nor SMTP credentials found, skipping email send.');
            return false;
        }
        try {
            await transporter.sendMail({
                from: sender.includes('<') ? sender : `"${DEFAULT_SENDER_NAME}" <${sender}>`,
                to: Array.isArray(to) ? to.join(',') : to,
                subject,
                html,
                attachments,
            });
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send email via SMTP:', error);
            return false;
        }
    },

    async sendNewLeadEmail({ emailTo, subject, html }: { emailTo: string; subject: string; html: string }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }
        try {
            await transporter.sendMail({
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
        if (!process.env.SMTP_USER && !process.env.RESEND_API_KEY) {
            console.warn('[EmailService] SMTP/Resend credentials not found, skipping email send.');
            return false;
        }

        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://fms-dev-saas-one.vercel.app').replace(/\/$/, '');
        const ticketUrl = `${appUrl}/tickets/${ticket.id || ticket.ticket_number}#section-materials`;
        const procurementUrl = `${appUrl}/procurement?tab=orders`;

        const propertyName = property?.name ? ` - ${property.name}` : '';
        const subject = `Material Request for Ticket #${ticket.ticket_number}${propertyName}`;
        
        const itemsHtml = (items && items.length > 0)
            ? items.map(
                img => `<li><b>${img.name || img.title || img.item_name || 'Item'}</b> - Qty: ${img.quantity || img.qty || 1} ${img.notes || img.description ? `(Notes: ${img.notes || img.description})` : ''}</li>`
            ).join('')
            : '<li><i>Requested items list pending details</i></li>';

        const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;

        const html = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; line-height: 1.6;">
                <h2 style="color: #0f172a; margin-top: 0;">🛒 New Material Request Submitted</h2>
                <p>A new material request has been submitted by the site team for a maintenance ticket.</p>
                
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 16px 0;">
                    <h3 style="margin-top: 0; color: #334155; font-size: 15px;">Ticket Details</h3>
                    <ul style="padding-left: 20px; margin: 0; font-size: 14px;">
                        <li><b>Ticket ID:</b> #${ticket.ticket_number} - ${ticket.title || 'Maintenance Request'}</li>
                        <li><b>Property:</b> ${property?.name || 'N/A'}</li>
                        <li><b>Requested By:</b> ${requestedBy?.full_name || requestedBy?.email || 'Site Team'} (${requesterRole?.toUpperCase() || 'Support'})</li>
                        <li><b>Assigned Procurement User:</b> ${assignedToName || 'Unassigned'}</li>
                    </ul>
                </div>

                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 16px 0;">
                    <h3 style="margin-top: 0; color: #334155; font-size: 15px;">📦 Requested Materials</h3>
                    <ul style="padding-left: 20px; margin: 0; font-size: 14px;">
                        ${itemsHtml}
                    </ul>
                </div>

                <p style="font-size: 14px; color: #334155;">Please review the material requirements and upload comparative quotations.</p>

                <div style="margin: 28px 0; text-align: center;">
                    <a href="${ticketUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">
                        View Material Request
                    </a>
                </div>

                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                <p style="font-size: 12px; color: #64748b;">
                    Direct link: <a href="${ticketUrl}" style="color: #2563eb;">${ticketUrl}</a><br/>
                    Procurement orders dashboard: <a href="${procurementUrl}" style="color: #2563eb;">${procurementUrl}</a>
                </p>
            </div>
        `;

        try {
            await this.sendEmail({
                to: emailTo,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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

    async sendMeetingRoomReminderEmail({
        emailTo,
        roomName,
        date,
        startTime,
        endTime,
        propertyName,
        requesterName,
        requesterEmail,
        reminderType = 'end',
        remainingMinutes = 10,
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
        reminderType?: 'start' | 'end';
        remainingMinutes?: number;
        comment?: string | null;
        customHtml?: string | null;
    }) {
        if (!process.env.SMTP_USER) {
            console.warn('[EmailService] SMTP credentials not found, skipping email send.');
            return false;
        }

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

        const formatDate = (d: string) => {
            if (!d) return d;
            const parts = d.split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return d;
        };
        const formattedDate = formatDate(date);

        const isEnd = reminderType === 'end';
        const subject = isEnd
            ? `Reminder: Meeting in ${roomName} concludes in ${remainingMinutes} mins (${formattedEnd})`
            : `Upcoming: Meeting in ${roomName} begins in ${remainingMinutes} mins (${formattedStart})`;

        const badgeBg = isEnd ? '#fff7ed' : '#eff6ff';
        const badgeBorder = isEnd ? '#fed7aa' : '#bfdbfe';
        const badgeColor = isEnd ? '#c2410c' : '#1d4ed8';
        const badgeIcon = isEnd ? '⏳' : '🗓️';
        const badgeText = isEnd
            ? `Ending Soon: ${remainingMinutes} Minutes Remaining`
            : `Starting Soon: Begins in ${remainingMinutes} Minutes`;

        const bannerText = isEnd
            ? `Your ongoing meeting session in <b>${roomName}</b> is scheduled to wrap up at <b>${formattedEnd}</b>.`
            : `Your upcoming meeting reservation in <b>${roomName}</b> is scheduled to start promptly at <b>${formattedStart}</b>.`;

        const tipsList = isEnd
            ? `
                <li style="margin-bottom: 6px;">Please wrap up key discussion points and conclusions on time.</li>
                <li style="margin-bottom: 6px;">Ensure video-conferencing screens, displays, and AC are turned off if leaving the room vacant.</li>
                <li style="margin-bottom: 6px;">If you require an extension, please verify next-slot availability on the portal before extending.</li>
            `
            : `
                <li style="margin-bottom: 6px;">The meeting room displays, high-speed Wi-Fi, and presentation cables are prepped.</li>
                <li style="margin-bottom: 6px;">Please arrive 2-3 minutes early to test video conferencing or presentation equipment.</li>
                <li style="margin-bottom: 6px;">For beverage or hospitality requests, reach out to front-desk assistance.</li>
            `;

        const varMap: Record<string, string> = {
            '{{roomName}}': roomName,
            '{{propertyName}}': propertyName,
            '{{date}}': formattedDate,
            '{{startTime}}': formattedStart,
            '{{endTime}}': formattedEnd,
            '{{remainingMinutes}}': String(remainingMinutes),
            '{{requesterName}}': requesterName,
            '{{requesterEmail}}': requesterEmail,
            '{{comment}}': comment || '',
        };

        let html: string;
        if (customHtml) {
            html = customHtml.replace(/\{\{(\w+)\}\}/g, (match) => varMap[match] ?? match);
        } else {
            html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
            </head>
            <body style="margin: 0; padding: 24px 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                                
                                <!-- Brand Header -->
                                <tr>
                                    <td style="padding: 24px 32px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td>
                                                    <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #94a3b8; text-transform: uppercase;">Autopilot Facilities Management</span>
                                                    <h1 style="margin: 6px 0 0; font-size: 20px; font-weight: 700; color: #ffffff;">Meeting Room Notification</h1>
                                                </td>
                                                <td align="right">
                                                    <span style="display: inline-block; padding: 6px 14px; background: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 9999px; font-size: 12px; font-weight: 700; color: ${badgeColor};">
                                                        ${badgeIcon} ${badgeText}
                                                    </span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <!-- Content Body -->
                                <tr>
                                    <td style="padding: 32px;">
                                        <p style="margin: 0 0 16px; font-size: 15px; color: #334155; line-height: 1.6;">
                                            Hello <b>${requesterName}</b>,
                                        </p>
                                        <p style="margin: 0 0 24px; font-size: 15px; color: #475569; line-height: 1.6;">
                                            ${bannerText}
                                        </p>

                                        <!-- Highlight Box -->
                                        <div style="background-color: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 12px; padding: 18px 20px; margin-bottom: 24px;">
                                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td style="font-size: 28px; line-height: 1; width: 44px; vertical-align: middle;">
                                                        ${badgeIcon}
                                                    </td>
                                                    <td style="vertical-align: middle;">
                                                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ${badgeColor};">
                                                            ${isEnd ? 'Remaining Meeting Time' : 'Time Before Start'}
                                                        </div>
                                                        <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 2px;">
                                                            ${remainingMinutes} Minutes Notice
                                                        </div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>

                                        <!-- Reservation Details Table -->
                                        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                                            <h3 style="margin: 0 0 14px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
                                                Reservation Summary
                                            </h3>
                                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; width: 130px; font-weight: 600;">Meeting Room:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${roomName}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Location / Property:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${propertyName}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Date:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${formattedDate}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Reserved Slot:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${formattedStart} – ${formattedEnd}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Booked By:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${requesterName} (${requesterEmail})</td>
                                                </tr>
                                                ${comment ? `
                                                <tr>
                                                    <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Purpose / Note:</td>
                                                    <td style="padding: 6px 0; color: #0f172a; font-weight: 500;">${comment}</td>
                                                </tr>` : ''}
                                            </table>
                                        </div>

                                        <!-- Courteous Reminders -->
                                        <div style="background-color: #ffffff; border-left: 3px solid ${isEnd ? '#f97316' : '#3b82f6'}; padding: 14px 18px; margin-bottom: 24px;">
                                            <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 700; color: #0f172a;">
                                                ${isEnd ? 'Wrap-Up Checklist' : 'Meeting Preparation'}
                                            </h4>
                                            <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #64748b; line-height: 1.5;">
                                                ${tipsList}
                                            </ul>
                                        </div>

                                        <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                                            Need help or want to report an issue? Contact your on-site property operations team.
                                        </p>
                                    </td>
                                </tr>

                                <!-- Footer -->
                                <tr>
                                    <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                                        <div style="margin-bottom: 16px;">
                                            <img src="${process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com'}/email-banner.png" alt="Autopilot Offices" style="max-width: 180px; height: auto; display: inline-block;" />
                                        </div>
                                        <p style="margin: 0 0 8px; font-size: 12px; color: #64748b; font-weight: 600;">
                                            Autopilot Offices • Smart Facility Management System
                                        </p>
                                        <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4;">
                                            This is an automated operational notification. Please do not reply directly to this email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
            `;
        }

        try {
            await transporter.sendMail({
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: emailTo,
                subject,
                html,
            });
            console.log(`[EmailService] Meeting room ${reminderType} reminder email sent to ${emailTo}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send meeting room reminder email:', error);
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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

    async sendChecklistStartedEmail({
        emailTo,
        checklistTitle,
        property,
        assignedTo,
        startTime
    }: {
        emailTo: string | string[];
        checklistTitle: string;
        property: any;
        assignedTo?: any;
        startTime?: string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[🚀 Shift Started] Checklist: ${checklistTitle} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2563eb; margin: 0; font-size: 20px;">🚀 Checklist Shift Started</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Scheduled shift inspection is now live</p>
                    </div>

                    <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Checklist:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${checklistTitle}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            ${startTime ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Start Time:</b></td><td style="padding: 4px 0; color: #2563eb; font-weight: bold;">${startTime}</td></tr>` : ''}
                            ${assignedTo ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Assigned To:</b></td><td style="padding: 4px 0; color: #0f172a;">${assignedTo.full_name || assignedTo.email || 'Staff'}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/soft-service-manager" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">Open Checklist</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Checklist started email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send checklist started email:', error);
            return false;
        }
    },

    async sendChecklistRatedEmail({
        emailTo,
        checklistTitle,
        property,
        ratedBy,
        completedBy,
        rating
    }: {
        emailTo: string | string[];
        checklistTitle: string;
        property: any;
        ratedBy?: any;
        completedBy?: any;
        rating?: number | string;
    }) {
        if (!smtpUser || !emailTo) return false;
        try {
            const recipients = Array.isArray(emailTo) ? emailTo.join(', ') : emailTo;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
            const subject = `[⭐ Audited & Rated] Checklist: ${checklistTitle} - ${property?.name || 'Property'}`;

            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #f59e0b; margin: 0; font-size: 20px;">⭐ Checklist Audited & Rated</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Supervisor rating logged for checklist submission</p>
                    </div>

                    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Checklist:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${checklistTitle}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Property:</b></td><td style="padding: 4px 0; color: #0f172a;">${property?.name || 'Site Property'}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Rating:</b></td><td style="padding: 4px 0; color: #f59e0b; font-weight: bold; font-size: 16px;">${rating || '3/3 (Approved)'}</td></tr>
                            ${ratedBy ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Audited By:</b></td><td style="padding: 4px 0; color: #0f172a;">${ratedBy.full_name || ratedBy.email || 'Supervisor'}</td></tr>` : ''}
                            ${completedBy ? `<tr><td style="padding: 4px 0; color: #64748b;"><b>Completed By:</b></td><td style="padding: 4px 0; color: #0f172a;">${completedBy.full_name || completedBy.email || 'Staff'}</td></tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${appUrl}/property/${property?.id || ''}/soft-service-manager" style="display: inline-block; background-color: #f59e0b; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 28px; border-radius: 8px; font-size: 14px;">View Scorecard</a>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
                to: recipients,
                subject,
                html,
            });
            console.log(`[EmailService] Checklist rated email sent to ${recipients}`);
            return true;
        } catch (error) {
            console.error('[EmailService] Failed to send checklist rated email:', error);
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
                from: `"${DEFAULT_SENDER_NAME}" <${process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER}>`,
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
    },

    // ============================================================================
    // Professional Ticket Management & Grievance Email Notifications
    // ============================================================================
    async sendHrTicketCreatedEmail({
        emailTo,
        ticket,
        submitterName,
        assignedOwnerName,
        categoryName
    }: {
        emailTo: string | string[];
        ticket: any;
        submitterName: string;
        assignedOwnerName: string;
        categoryName: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Submission Recorded';

        const subject = meta.isConfidential
            ? `[Confidential] Confirmation: Ticket #${ticketNo} Received — ${subjectTitle}`
            : `Confirmation: Ticket #${ticketNo} Received — ${subjectTitle}`;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Classification:', value: meta.classification },
            { label: 'Category:', value: categoryName || 'General' },
            { label: 'Subject:', value: subjectTitle, isBold: true },
            { label: 'Assigned Reviewer:', value: `${assignedOwnerName || 'Review Team'} (Level ${ticket?.current_level || 1})` }
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: 'SUBMISSION CONFIRMED',
            title: 'Ticket Submission Confirmation',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${submitterName || 'Team Member'},`,
            leadText: 'Your ticket has been received and logged into the system. It has been routed to the designated review team for assessment. You will receive updates as the ticket progresses through the workflow.',
            tableRows,
            descriptionBox: ticket?.description ? { title: 'Submitted Summary', content: ticket.description } : undefined,
            actionButton: {
                text: 'Track Ticket Status',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    },

    async sendHrTicketAssignedEmail({
        emailTo,
        ticket,
        assigneeName,
        submitterName,
        categoryName
    }: {
        emailTo: string | string[];
        ticket: any;
        assigneeName: string;
        submitterName: string;
        categoryName: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const level = ticket?.current_level || 1;
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Review Required';

        const subject = (meta.isAnonymous || meta.isConfidential)
            ? `[Confidential] Ticket Assigned: #${ticketNo} — ${subjectTitle}`
            : `Action Required: Ticket #${ticketNo} — ${subjectTitle}`;

        const isSubmitterAnon = meta.isAnonymous || submitterName?.toLowerCase().includes('anonymous');
        const displaySubmitter = isSubmitterAnon
            ? 'Confidential Submitter (Identity Protected)'
            : submitterName;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Classification:', value: meta.classification },
            { label: 'Category:', value: categoryName || 'General' },
            { label: 'Subject:', value: subjectTitle, isBold: true },
            { label: 'Submitter:', value: displaySubmitter },
            { label: 'Review Assignment:', value: `Level ${level} (${assigneeName || 'Assigned Reviewer'})`, highlightColor: '#0f766e', isBold: true },
            ...(ticket?.sla_due_at ? [{ label: 'SLA Target:', value: formatHrEmailDateTime(ticket.sla_due_at) }] : [])
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: `LEVEL ${level} • ACTION REQUIRED`,
            title: 'Ticket Assigned for Review',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${assigneeName || 'Colleague'},`,
            leadText: `A new ${meta.classification.toLowerCase()} has been assigned to you for Level ${level} review and action. Please review the ticket information below and take appropriate action in accordance with designated SLA standards.`,
            tableRows,
            descriptionBox: ticket?.description ? { title: 'Ticket Description / Statement', content: ticket.description } : undefined,
            actionButton: {
                text: 'Review Ticket Details',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    },

    async sendHrTicketEscalatedEmail({
        emailTo,
        ticket,
        assigneeName,
        level,
        reason,
        submitterName
    }: {
        emailTo: string | string[];
        ticket: any;
        assigneeName: string;
        level: number;
        reason: string;
        submitterName: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Escalation Review';

        const subject = `Notice of Escalation: Ticket #${ticketNo} (Level ${level}) — ${subjectTitle}`;

        const isSubmitterAnon = meta.isAnonymous || submitterName?.toLowerCase().includes('anonymous');
        const displaySubmitter = isSubmitterAnon
            ? 'Confidential Submitter (Identity Protected)'
            : submitterName;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Classification:', value: meta.classification },
            { label: 'Subject:', value: subjectTitle, isBold: true },
            { label: 'Submitter:', value: displaySubmitter },
            { label: 'Escalated Level:', value: `Level ${level} (${assigneeName || 'Level Owner'})`, highlightColor: '#b91c1c', isBold: true },
            { label: 'Escalation Reason:', value: reason || 'SLA timeline exceeded' }
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: `LEVEL ${level} • ESCALATION`,
            title: 'Ticket Escalated for Higher-Level Review',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${assigneeName || 'Reviewer'},`,
            leadText: `Ticket #${ticketNo} has been escalated to Level ${level} for your review and intervention. Please examine the ticket history and facilitate prompt resolution.`,
            tableRows,
            actionButton: {
                text: 'Review Escalated Ticket',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    },

    async sendHrTicketResolvedEmail({
        emailTo,
        ticket,
        submitterName,
        resolverName,
        resolutionNote
    }: {
        emailTo: string | string[];
        ticket: any;
        submitterName: string;
        resolverName: string;
        resolutionNote: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Ticket Resolved';

        const subject = `Resolution Notice: Ticket #${ticketNo} — ${subjectTitle}`;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Subject:', value: subjectTitle, isBold: true },
            { label: 'Resolved By:', value: resolverName || 'Review Team' },
            { label: 'Status:', value: 'Resolved (Pending Confirmation)', highlightColor: '#059669', isBold: true }
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: 'TICKET RESOLVED',
            title: 'Ticket Marked as Resolved',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${submitterName || 'Team Member'},`,
            leadText: `The review team has marked Ticket #${ticketNo} as resolved. Please review the resolution summary below and confirm your acknowledgment in the portal.`,
            tableRows,
            descriptionBox: resolutionNote ? { title: 'Resolution Summary', content: resolutionNote } : undefined,
            actionButton: {
                text: 'Confirm & Acknowledge Resolution',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    },

    async sendHrTicketCommentAddedEmail({
        emailTo,
        ticket,
        recipientName,
        senderName,
        commentSnippet
    }: {
        emailTo: string | string[];
        ticket: any;
        recipientName: string;
        senderName: string;
        commentSnippet: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Ticket Update';

        const subject = `Ticket Update: Ticket #${ticketNo} — ${subjectTitle}`;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Subject:', value: subjectTitle },
            { label: 'Posted By:', value: senderName, isBold: true }
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: 'NEW COMMUNICATION',
            title: 'New Message on Ticket Discussion',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${recipientName || 'Team Member'},`,
            leadText: `A new message has been posted by <strong>${senderName}</strong> regarding Ticket #${ticketNo}.`,
            tableRows,
            descriptionBox: commentSnippet ? { title: `Message from ${senderName}`, content: commentSnippet } : undefined,
            actionButton: {
                text: 'View Discussion in Portal',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    },

    async sendHrTicketAcknowledgedEmail({
        emailTo,
        ticket,
        handlerName,
        submitterName
    }: {
        emailTo: string | string[];
        ticket: any;
        handlerName: string;
        submitterName: string;
    }) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms.autopilotoffices.com';
        const meta = getHrCaseMeta(ticket);
        const ticketNo = ticket?.ticket_number || '';
        const subjectTitle = ticket?.subject || 'Ticket Closed';

        const subject = `Ticket Closed: Ticket #${ticketNo} — Acknowledged`;

        const isSubmitterAnon = meta.isAnonymous || submitterName?.toLowerCase().includes('anonymous');
        const displaySubmitter = isSubmitterAnon
            ? 'Confidential Submitter (Identity Protected)'
            : submitterName;

        const tableRows = [
            { label: 'Ticket Reference:', value: `#${ticketNo}`, isBold: true },
            { label: 'Subject:', value: subjectTitle },
            { label: 'Acknowledged By:', value: displaySubmitter },
            { label: 'Final Status:', value: 'Closed & Completed', highlightColor: '#0f766e', isBold: true }
        ];

        const html = renderCorporateCaseEmailLayout({
            headerBadge: 'TICKET CLOSED',
            title: 'Ticket Resolution Acknowledged & Closed',
            subtitle: `Reference: #${ticketNo}`,
            recipientGreeting: `Dear ${handlerName || 'Handler'},`,
            leadText: `The submitter (${displaySubmitter}) has acknowledged and confirmed the resolution of Ticket #${ticketNo}. The ticket has been officially closed and archived in accordance with record-keeping policies.`,
            tableRows,
            actionButton: {
                text: 'View Closed Ticket Record',
                url: `${appUrl}/hr-tickets?tab=tickets&id=${ticket.id}`
            },
            appUrl
        });

        return EmailService.sendEmail({ to: emailTo, subject, html });
    }
};

// ============================================================================
// Ticket / Grievance Executive Email Layout & Classification Helpers
// ============================================================================
function formatHrEmailDateTime(val?: string | Date | null): string {
    if (!val) return '';
    try {
        const d = new Date(val);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return '';
    }
}

function getHrCaseMeta(ticket: any) {
    const isAnonymous = Boolean(ticket?.is_anonymous || ticket?.ticket_type === 'anonymous_feedback');
    const isConfidential = Boolean(ticket?.is_confidential || ticket?.ticket_type === 'confidential_feedback');
    const isGrievance = ticket?.ticket_type === 'grievance';

    let classification = 'Workplace Ticket';
    let badgeText = 'TICKET REVIEW';

    if (isAnonymous) {
        classification = 'Confidential Anonymous Feedback';
        badgeText = 'CONFIDENTIAL • ANONYMOUS';
    } else if (isConfidential) {
        classification = 'Confidential Grievance';
        badgeText = 'CONFIDENTIAL';
    } else if (isGrievance) {
        classification = 'Formal Workplace Grievance';
        badgeText = 'GRIEVANCE';
    } else {
        classification = 'Employee Request';
        badgeText = 'TICKET REVIEW';
    }

    return {
        isAnonymous,
        isConfidential,
        isGrievance,
        classification,
        badgeText
    };
}

function renderCorporateCaseEmailLayout({
    headerBadge,
    title,
    subtitle,
    recipientGreeting,
    leadText,
    tableRows,
    descriptionBox,
    actionButton,
    appUrl
}: {
    headerBadge?: string;
    title: string;
    subtitle?: string;
    recipientGreeting?: string;
    leadText: string;
    tableRows: Array<{ label: string; value: string; isBold?: boolean; highlightColor?: string }>;
    descriptionBox?: { title: string; content: string };
    actionButton?: { text: string; url: string };
    appUrl: string;
}): string {
    const rowsHtml = tableRows
        .filter(r => r.value && String(r.value).trim().length > 0)
        .map((r, i) => {
            const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
            const valColor = r.highlightColor || '#0f172a';
            const fontWeight = r.isBold ? '600' : '500';
            return `
                <tr style="background-color: ${bg};">
                    <td class="table-label" style="padding: 10px 14px; font-size: 13px; color: #64748b; font-weight: 600; width: 36%; border-bottom: 1px solid #e2e8f0; vertical-align: top; word-break: normal;">${r.label}</td>
                    <td class="table-value" style="padding: 10px 14px; font-size: 13.5px; color: ${valColor}; font-weight: ${fontWeight}; border-bottom: 1px solid #e2e8f0; vertical-align: top; word-break: break-word; overflow-wrap: anywhere;">${r.value}</td>
                </tr>
            `;
        }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
    <title>${title}</title>
    <style>
        /* Base email resets */
        body, table, td, p, a, div {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
            box-sizing: border-box;
        }
        table, td {
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
        }

        /* Responsive Mobile Styles */
        @media only screen and (max-width: 600px) {
            .email-outer-body {
                padding: 12px 6px !important;
            }
            .email-card {
                width: 100% !important;
                max-width: 100% !important;
                border-radius: 6px !important;
            }
            .header-cell {
                padding: 16px 16px !important;
            }
            .header-stack-cell {
                display: block !important;
                width: 100% !important;
                text-align: left !important;
            }
            .header-badge-cell {
                display: block !important;
                width: 100% !important;
                text-align: left !important;
                margin-top: 10px !important;
            }
            .content-cell {
                padding: 20px 16px 18px 16px !important;
            }
            .content-title {
                font-size: 17px !important;
                line-height: 1.35 !important;
            }
            .content-lead {
                font-size: 13.5px !important;
                line-height: 1.55 !important;
                margin-bottom: 18px !important;
            }
            .table-label {
                width: 38% !important;
                padding: 9px 10px !important;
                font-size: 12px !important;
                line-height: 1.4 !important;
            }
            .table-value {
                padding: 9px 10px !important;
                font-size: 12.5px !important;
                line-height: 1.4 !important;
                word-break: break-word !important;
                overflow-wrap: anywhere !important;
            }
            .description-card {
                padding: 12px 14px !important;
                margin-bottom: 18px !important;
            }
            .cta-btn-wrap {
                margin: 20px 0 12px 0 !important;
            }
            .cta-btn {
                display: block !important;
                width: 100% !important;
                box-sizing: border-box !important;
                text-align: center !important;
                padding: 13px 16px !important;
                font-size: 14px !important;
            }
            .footer-cell {
                padding: 16px 16px !important;
            }
            .footer-col-left,
            .footer-col-right {
                display: block !important;
                width: 100% !important;
                text-align: left !important;
            }
            .footer-col-right {
                margin-top: 8px !important;
            }
        }
    </style>
</head>
<body class="email-outer-body" style="margin: 0; padding: 24px 12px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td align="center">
                <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
                    
                    <!-- Executive Header -->
                    <tr>
                        <td class="header-cell" style="background-color: #0f172a; padding: 20px 26px; border-bottom: 1px solid #1e293b;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td class="header-stack-cell" style="vertical-align: middle;">
                                        <div style="font-size: 15px; font-weight: 700; letter-spacing: 0.8px; color: #ffffff; text-transform: uppercase;">Autopilot Offices</div>
                                        <div style="font-size: 12px; color: #94a3b8; margin-top: 3px; letter-spacing: 0.2px;">People Operations & Ticket Management</div>
                                    </td>
                                    ${headerBadge ? `
                                    <td class="header-badge-cell" align="right" style="vertical-align: middle;">
                                        <span style="display: inline-block; padding: 5px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; color: #e2e8f0; background-color: #1e293b; border: 1px solid #334155; border-radius: 4px; text-transform: uppercase; white-space: nowrap;">
                                            ${headerBadge}
                                        </span>
                                    </td>
                                    ` : ''}
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td class="content-cell" style="padding: 28px 26px 22px 26px;">
                            ${recipientGreeting ? `<p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #0f172a;">${recipientGreeting}</p>` : ''}
                            
                            <h1 class="content-title" style="margin: 0 0 6px 0; font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.35;">${title}</h1>
                            ${subtitle ? `<p style="margin: 0 0 18px 0; font-size: 13.5px; color: #64748b;">${subtitle}</p>` : '<div style="margin-bottom: 16px;"></div>'}
                            
                            <p class="content-lead" style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #334155;">
                                ${leadText}
                            </p>

                            <!-- Ticket Overview Table -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 22px; table-layout: fixed;">
                                ${rowsHtml}
                            </table>

                            ${descriptionBox && descriptionBox.content ? `
                            <!-- Details Block -->
                            <div class="description-card" style="margin: 0 0 22px 0; padding: 14px 18px; background-color: #f8fafc; border-left: 3px solid #0f172a; border-radius: 4px; word-break: break-word; overflow-wrap: anywhere;">
                                <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 6px;">${descriptionBox.title}</div>
                                <div style="font-size: 13.5px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${descriptionBox.content}</div>
                            </div>
                            ` : ''}

                            ${actionButton ? `
                            <!-- CTA Button -->
                            <table class="cta-btn-wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0 12px 0;">
                                <tr>
                                    <td align="center">
                                        <a class="cta-btn" href="${actionButton.url}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; letter-spacing: 0.3px; max-width: 100%; box-sizing: border-box;">
                                            ${actionButton.text}
                                        </a>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-top: 10px;">
                                        <span style="font-size: 12px; color: #64748b;">Or access securely through the <a href="${appUrl}" style="color: #0f766e; text-decoration: underline;">Autopilot Offices Portal</a></span>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                        </td>
                    </tr>

                    <!-- Legal & Confidentiality Notice -->
                    <tr>
                        <td class="footer-cell" style="padding: 20px 26px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0 0 10px 0; font-size: 11px; line-height: 1.55; color: #94a3b8;">
                                <strong>CONFIDENTIALITY NOTICE:</strong> This communication and any associated materials are intended solely for the designated recipient and may contain proprietary, sensitive, or legally privileged information. Any unauthorized review, dissemination, copying, or reliance on this information is strictly prohibited. If you have received this transmission in error, please immediately notify the sender and delete all copies from your system.
                            </p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td class="footer-col-left" style="font-size: 11px; color: #94a3b8;">
                                        &copy; ${new Date().getFullYear()} Autopilot Offices. All rights reserved.
                                    </td>
                                    <td class="footer-col-right" align="right" style="font-size: 11px; color: #94a3b8;">
                                        Ticket Operations Workflow
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}


