/**
 * Forward an ingested bill PDF to the site's property admin(s).
 *
 * Recipient resolution order (plan Phase 1):
 *   1. electricity_billing_accounts.spoc_user_id — explicit override, wins when set.
 *   2. active property_memberships with role='property_admin' on account.property_id.
 *   3. Nobody → the mail is not sent and the caller records forwarded_to = [].
 *
 * Delivery is plain SMTP (EmailService/nodemailer), never the Zoho send scope — the
 * electricity mailbox's OAuth grant is READ-only by design (plan §9 item 2).
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';

export interface ForwardResult {
    sent: boolean;
    recipients: string[];
    error?: string;
}

interface AccountRow {
    id: string;
    property_id: string | null;
    spoc_user_id: string | null;
    provider: string;
    site_label: string;
    consumer_ref: string | null;
}

/** Resolve the SPOC email addresses for a billing account. */
export async function resolveBillSpocEmails(account: AccountRow): Promise<string[]> {
    const userIds: string[] = [];

    if (account.spoc_user_id) {
        userIds.push(account.spoc_user_id);
    } else if (account.property_id) {
        const { data: admins } = await supabaseAdmin
            .from('property_memberships')
            .select('user_id')
            .eq('property_id', account.property_id)
            .eq('role', 'property_admin')
            .eq('is_active', true);
        for (const a of admins || []) if (a.user_id) userIds.push(a.user_id);
    }
    if (userIds.length === 0) return [];

    const { data: users } = await supabaseAdmin
        .from('users').select('id, email').in('id', userIds);
    return [...new Set((users || []).map(u => String(u.email || '').toLowerCase()).filter(Boolean))];
}

/**
 * Email one bill PDF to the account's SPOC(s). Never throws — a send failure is
 * reported back so the ingest run can record it on the document row.
 */
export async function forwardBillToSpoc(
    account: AccountRow,
    pdf: Buffer,
    fileName: string,
    context: { billingMonth?: string | null; totalAmount?: number | null } = {},
): Promise<ForwardResult> {
    try {
        const recipients = await resolveBillSpocEmails(account);
        if (recipients.length === 0) {
            return { sent: false, recipients: [], error: 'no property admin / spoc resolved' };
        }

        const ref = account.consumer_ref ? ` (consumer ${account.consumer_ref})` : '';
        const month = context.billingMonth ? ` — ${context.billingMonth.slice(0, 7)}` : '';
        const amount = context.totalAmount != null
            ? `₹${Math.round(context.totalAmount).toLocaleString('en-IN')}` : 'amount not parsed';

        const sent = await EmailService.sendEmail({
            to: recipients,
            subject: `Electricity bill received: ${account.provider} — ${account.site_label}${month}`,
            html: `
                <h2>Electricity Bill Received</h2>
                <p>A new electricity bill has arrived for <b>${account.site_label}</b>${ref} and is attached.</p>
                <ul>
                    <li><b>Provider:</b> ${account.provider}</li>
                    <li><b>Billing month:</b> ${context.billingMonth?.slice(0, 7) || 'not parsed'}</li>
                    <li><b>Total amount:</b> ${amount}</li>
                </ul>
                <p>The bill has been logged in the electricity tracker on Autopilot FMS.</p>
            `,
            attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
        });

        return sent
            ? { sent: true, recipients }
            : { sent: false, recipients, error: 'SMTP send failed (see EmailService log)' };
    } catch (e) {
        return { sent: false, recipients: [], error: e instanceof Error ? e.message : 'forward failed' };
    }
}
