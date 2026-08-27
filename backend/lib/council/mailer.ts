import nodemailer from 'nodemailer';

/**
 * Send-as-agent mailer for the Agent Council.
 *
 * Transport config mirrors backend/services/EmailService.ts exactly (same env vars,
 * same defaults). EmailService itself is not reused because its senders hardcode the
 * "Autopilot FMS" from-name and expose no reply-to — council mail must appear to come
 * from the agent ("Bose — Operations Specialist, Autopilot Council") and route replies
 * to the agent's virtual address (<name>.<key>@autopilotoffices.com).
 *
 * Every send is wrapped: callers get `{ sent: false, error }` instead of a throw, so a
 * broken SMTP session degrades the inbox row to a draft rather than failing the request.
 *
 * Post-MVP: real per-agent Zoho mailboxes replace the shared SMTP identity below.
 */

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

export interface CouncilAgentIdentity {
    key: string;
    name: string;
    title: string;
    /** The agent's virtual address, e.g. bose.ops@autopilotoffices.com */
    email: string;
}

export interface CouncilSendResult {
    sent: boolean;
    error?: string;
}

export function agentFromName(agent: Pick<CouncilAgentIdentity, 'name' | 'title'>): string {
    return `${agent.name} — ${agent.title}, Autopilot Council`;
}

export async function sendAsAgent({
    agent,
    to,
    subject,
    html,
}: {
    agent: CouncilAgentIdentity;
    to: string;
    subject: string;
    html: string;
}): Promise<CouncilSendResult> {
    if (!smtpUser) {
        return { sent: false, error: 'SMTP credentials not configured' };
    }
    try {
        await transporter.sendMail({
            // The envelope identity stays the shared SMTP user (that is what the server
            // will accept); the agent owns the display name and the reply-to.
            from: `"${agentFromName(agent)}" <${process.env.SMTP_SENDER_EMAIL || smtpUser}>`,
            replyTo: agent.email,
            to,
            subject,
            html,
        });
        return { sent: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[CouncilMailer] send as ${agent.key} failed:`, message);
        return { sent: false, error: message };
    }
}
