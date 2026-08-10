import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { issueEmailActionToken } from '@/backend/lib/emailActions/tokens';

/**
 * Best-effort petty-cash email intimation. Fire-and-forget from the routes.
 *
 * Email goes out only when SMTP is configured (EmailService silently skips
 * otherwise). WhatsApp is deliberately NOT wired here — it stays dormant until
 * the business API is in place; when ready, add a WhatsAppQueueService call
 * alongside the EmailService call below.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
const inr = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const APPROVER_ROLES = new Set([
    'org_super_admin', 'org_admin', 'master_admin', 'property_admin',
    'manager_executive', 'soft_service_manager', 'accounts',
]);
const FINANCE_ROLES = new Set(['accounts', 'org_super_admin', 'master_admin']);

async function emailsForUsers(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];
    const { data } = await supabaseAdmin.from('users').select('email').in('id', unique);
    return (data || []).map((u: { email?: string }) => u.email).filter(Boolean) as string[];
}

/** Recipients as {id, email} so each can be issued their own action token. */
async function roleRecipients(orgId: string, propertyId: string | null, roleSet: Set<string>): Promise<Recipient[]> {
    const [orgM, propM] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('user_id, role').eq('organization_id', orgId).eq('is_active', true),
        propertyId
            ? supabaseAdmin.from('property_memberships').select('user_id, role').eq('property_id', propertyId).eq('is_active', true)
            : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
    ]);
    const ids = [...new Set(
        [...(orgM.data || []), ...((propM as any).data || [])]
            .filter((m: { role: string }) => roleSet.has(m.role))
            .map((m: { user_id: string }) => m.user_id as string),
    )];
    if (!ids.length) return [];
    const { data } = await supabaseAdmin.from('users').select('id, email').in('id', ids);
    return ((data || []) as { id: string; email?: string }[])
        .filter(u => !!u.email)
        .map(u => ({ id: u.id, email: u.email as string }));
}

async function roleEmails(orgId: string, propertyId: string | null, roleSet: Set<string>): Promise<string[]> {
    return (await roleRecipients(orgId, propertyId, roleSet)).map(r => r.email);
}

interface Recipient { id: string; email: string }

/**
 * Approve / Reject buttons that action the request straight from the mail body.
 *
 * Tokens are issued PER RECIPIENT so the activity log records who actually clicked,
 * and each is single-use — see backend/lib/emailActions/tokens.ts.
 */
async function actionButtons(recipient: Recipient, req: PettyCashRequestRow): Promise<string> {
    if (!APP_URL) return '';
    const issue = (action: string, payload?: Record<string, unknown>) =>
        issueEmailActionToken({
            organizationId: req.organization_id,
            userId: recipient.id,
            entityType: 'petty_cash_request',
            entityId: req.id,
            action,
            payload,
        });

    const [approve, reject] = await Promise.all([
        issue('approve'),
        issue('reject', { remark: 'Rejected from email' }),
    ]);
    if (!approve || !reject) return '';

    const base = `${APP_URL.replace(/\/$/, '')}/api/email-actions`;
    const btn = (href: string, label: string, bg: string, fg: string, border: string) =>
        `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};border:1px solid ${border};padding:11px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;margin-right:10px">${label}</a>`;

    return `
        <p style="margin:18px 0 6px;color:#334155;font-size:13px">Act on this directly:</p>
        <p style="margin:0 0 4px">
            ${btn(`${base}/${approve}`, 'Approve', '#dcfce7', '#15803d', '#86efac')}
            ${btn(`${base}/${reject}`, 'Reject', '#fee2e2', '#b91c1c', '#fca5a5')}
        </p>
        <p style="color:#94a3b8;font-size:11px;margin:10px 0 0">These buttons work once and expire in 7 days. Do not forward this email — anyone with these links can act as you.</p>`;
}

function wrap(title: string, lines: string[], link: string, actions = ''): string {
    return `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
            <h2 style="color:#0f172a;font-size:18px">${title}</h2>
            ${lines.map(l => `<p style="color:#334155;font-size:14px;margin:6px 0">${l}</p>`).join('')}
            ${actions}
            ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Petty Cash</a></p>` : ''}
        </div>`;
}

export type PettyCashRequestRow = {
    id: string; organization_id: string; property_id: string; requester_id: string;
    request_no: string; amount_requested: number; purpose: string;
    approved_amount?: number | null; paid_amount?: number | null;
    requester_name?: string | null;
};

export async function notifyPettyCash(
    kind: 'submitted' | 'approved' | 'rejected' | 'sent_back' | 'paid' | 'settlement_submitted' | 'closed',
    req: PettyCashRequestRow,
    remark?: string,
): Promise<void> {
    try {
        const link = APP_URL ? `${APP_URL}/${req.organization_id}/petty-cash` : '';
        const who = req.requester_name || 'A team member';
        let to: string[] = [];
        let subject = '';
        let lines: string[] = [];

        switch (kind) {
            case 'submitted': {
                // Approvers get a personalised mail carrying their own one-click buttons,
                // so each mail is sent individually rather than to a shared recipient list.
                const approvers = await roleRecipients(req.organization_id, req.property_id, APPROVER_ROLES);
                subject = `Petty cash ${req.request_no} awaiting approval`;
                lines = [`${who} requested <b>${inr(req.amount_requested)}</b>.`, `Purpose: ${req.purpose}`];

                await Promise.all(approvers.map(async (r) => {
                    const buttons = await actionButtons(r, req);
                    await EmailService.sendEmail({
                        to: r.email,
                        subject,
                        html: wrap(subject, lines.filter(Boolean), link, buttons),
                    }).catch((e) => console.error('[pettyCash notify] send failed:', e));
                }));
                return;
            }
            case 'approved':
                to = await emailsForUsers([req.requester_id]);
                subject = `Petty cash ${req.request_no} approved`;
                lines = [`Your request was approved for <b>${inr(req.approved_amount ?? req.amount_requested)}</b>.`, remark ? `Note: ${remark}` : ''];
                break;
            case 'rejected':
                to = await emailsForUsers([req.requester_id]);
                subject = `Petty cash ${req.request_no} rejected`;
                lines = [`Your request was rejected.`, remark ? `Reason: ${remark}` : ''];
                break;
            case 'sent_back':
                to = await emailsForUsers([req.requester_id]);
                subject = `Petty cash ${req.request_no} sent back`;
                lines = [`Your request needs changes before it can be approved.`, remark ? `Note: ${remark}` : ''];
                break;
            case 'paid':
                to = await emailsForUsers([req.requester_id]);
                subject = `Petty cash ${req.request_no} paid`;
                lines = [`<b>${inr(req.paid_amount ?? req.approved_amount ?? req.amount_requested)}</b> has been disbursed. Please submit your bills to settle.`];
                break;
            case 'settlement_submitted':
                to = await roleEmails(req.organization_id, null, FINANCE_ROLES);
                subject = `Petty cash ${req.request_no} settlement submitted`;
                lines = [`${who} submitted settlement for ${req.request_no}. Please validate and close.`];
                break;
            case 'closed':
                to = await emailsForUsers([req.requester_id]);
                subject = `Petty cash ${req.request_no} closed`;
                lines = [`Your petty cash request has been validated and closed.`];
                break;
        }

        if (to.length) {
            await EmailService.sendEmail({ to, subject, html: wrap(subject, lines.filter(Boolean), link) });
        }
    } catch (e) {
        console.error('[pettyCash notify] failed:', e);
    }
}
