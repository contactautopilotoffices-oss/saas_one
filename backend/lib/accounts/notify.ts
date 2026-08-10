import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { issueEmailActionToken } from '@/backend/lib/emailActions/tokens';

/**
 * Payment intimation — best-effort email. Fire-and-forget from the routes.
 * Email only sends when SMTP is configured. WhatsApp stays dormant (add a
 * WhatsAppQueueService call here once the business API is in place).
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
const inr = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// Who hears that a payment was completed. Finance-side only: procurement and the person
// who asked for the money are mailed by notifyUtrRecorded instead, which is chained off
// this function — same event, two audiences, exactly one email each. Splitting them lets
// the procurement mail lead with the UTR, which is the only part they were waiting for.
const NOTIFY_ROLES = new Set([
    'accounts', 'org_super_admin', 'org_admin', 'master_admin',
]);

// Procurement side: they raised the PO and are chasing the vendor for delivery.
const PROCUREMENT_ROLES = new Set([
    'purchase_manager', 'purchase_executive', 'procurement',
]);

async function orgRoleEmails(orgId: string, roleSet: Set<string>): Promise<string[]> {
    const { data: members } = await supabaseAdmin
        .from('organization_memberships').select('user_id, role').eq('organization_id', orgId).eq('is_active', true);
    const ids = [...new Set((members || []).filter((m: { role: string }) => roleSet.has(m.role)).map((m: { user_id: string }) => m.user_id))];
    if (!ids.length) return [];
    const { data: users } = await supabaseAdmin.from('users').select('email').in('id', ids);
    return (users || []).map((u: { email?: string }) => u.email).filter(Boolean) as string[];
}

// Finance decides on an aligned tranche, so only they are asked to act on one.
const FINANCE_ROLES = new Set(['accounts', 'org_super_admin', 'org_admin', 'master_admin']);

async function orgRoleRecipients(orgId: string, roleSet: Set<string>): Promise<{ id: string; email: string }[]> {
    const { data: members } = await supabaseAdmin
        .from('organization_memberships').select('user_id, role').eq('organization_id', orgId).eq('is_active', true);
    const ids = [...new Set((members || []).filter((m: { role: string }) => roleSet.has(m.role)).map((m: { user_id: string }) => m.user_id))];
    if (!ids.length) return [];
    const { data: users } = await supabaseAdmin.from('users').select('id, email').in('id', ids);
    return ((users || []) as { id: string; email?: string }[])
        .filter(u => !!u.email)
        .map(u => ({ id: u.id, email: u.email as string }));
}

async function emailsForUsers(ids: (string | null | undefined)[]): Promise<string[]> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return [];
    const { data } = await supabaseAdmin.from('users').select('email').in('id', unique);
    return (data || []).map((u: { email?: string }) => u.email).filter(Boolean) as string[];
}

export interface AlignedPayment {
    id: string;
    organization_id: string;
    po_number?: string | null;
    vendor_name?: string | null;
    tranche_no?: number | null;
    requested_amount?: number | null;
    payment_term?: string | null;
    aligned_by_name?: string | null;
}

/**
 * Tell finance a tranche is waiting on them, with a one-click way to reject it.
 *
 * Completing a payment is deliberately NOT offered as a button: it needs a UTR, which a
 * single click cannot supply. So finance gets "Cancel this alignment" inline and a deep
 * link for the completion itself.
 */
export async function notifyPaymentAligned(p: AlignedPayment): Promise<void> {
    try {
        const recipients = await orgRoleRecipients(p.organization_id, FINANCE_ROLES);
        if (!recipients.length) return;

        const link = APP_URL ? `${APP_URL.replace(/\/$/, '')}/${p.organization_id}/accounts` : '';
        const subject = `Payment aligned · ${p.po_number || 'PO'} · ${inr(p.requested_amount)}`;

        await Promise.all(recipients.map(async (r) => {
            let actions = '';
            if (APP_URL) {
                const token = await issueEmailActionToken({
                    organizationId: p.organization_id,
                    userId: r.id,
                    entityType: 'po_payment',
                    entityId: p.id,
                    action: 'cancel',
                    payload: { remark: 'Alignment rejected from email' },
                });
                if (token) {
                    actions = `
                <p style="margin:18px 0 6px;color:#334155;font-size:13px">Not right? Reject it here:</p>
                <p style="margin:0"><a href="${APP_URL.replace(/\/$/, '')}/api/email-actions/${token}" style="display:inline-block;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:11px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px">Reject alignment</a></p>
                <p style="color:#94a3b8;font-size:11px;margin:10px 0 0">Works once, expires in 7 days. Do not forward — anyone with this link can act as you.</p>`;
                }
            }

            const html = `
            <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
                <h2 style="color:#0f172a;font-size:18px">Payment aligned — awaiting your action</h2>
                <table style="font-size:14px;color:#334155;border-collapse:collapse">
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">PO</td><td style="padding:4px 0"><b>${p.po_number || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td style="padding:4px 0">${p.vendor_name || '—'}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount</td><td style="padding:4px 0"><b>${inr(p.requested_amount)}</b></td></tr>
                    ${p.tranche_no ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Tranche</td><td style="padding:4px 0">#${p.tranche_no}</td></tr>` : ''}
                    ${p.payment_term ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Term</td><td style="padding:4px 0">${p.payment_term}</td></tr>` : ''}
                    ${p.aligned_by_name ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Aligned by</td><td style="padding:4px 0">${p.aligned_by_name}</td></tr>` : ''}
                </table>
                ${actions}
                ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open to complete (needs UTR)</a></p>` : ''}
            </div>`;

            await EmailService.sendEmail({ to: r.email, subject, html })
                .catch((e) => console.error('[accounts notify] send failed:', e));
        }));
    } catch (e) {
        console.error('[accounts notify aligned] failed:', e);
    }
}

export interface RequestedPayment {
    id: string;
    organization_id: string;
    po_number?: string | null;
    vendor_name?: string | null;
    tranche_no?: number | null;
    requested_amount?: number | null;
    percent_of_po?: number | null;
    payment_term?: string | null;
    po_amount?: number | null;
    requested_by_name?: string | null;
}

/**
 * Stage 1 of the flow: a tranche has been raised as "yet to be aligned" and accounts need
 * to know money is being asked for.
 *
 * Same one-click pattern as notifyPaymentAligned — Approve here means ALIGN the tranche
 * (it moves to_align -> aligned), Reject cancels it. Both run through the shared state
 * machine at click time, so an emailed click can never do what the API would refuse.
 */
export async function notifyPaymentRequested(p: RequestedPayment): Promise<void> {
    try {
        const recipients = await orgRoleRecipients(p.organization_id, FINANCE_ROLES);
        if (!recipients.length) return;

        const base = APP_URL.replace(/\/$/, '');
        const link = base ? `${base}/${p.organization_id}/accounts` : '';
        const subject = `Payment requested · ${p.po_number || 'PO'} · ${inr(p.requested_amount)}`;

        await Promise.all(recipients.map(async (r) => {
            let actions = '';
            if (base) {
                const [alignToken, cancelToken] = await Promise.all([
                    issueEmailActionToken({
                        organizationId: p.organization_id, userId: r.id,
                        entityType: 'po_payment', entityId: p.id, action: 'align',
                        payload: { remark: 'Aligned from email' },
                    }),
                    issueEmailActionToken({
                        organizationId: p.organization_id, userId: r.id,
                        entityType: 'po_payment', entityId: p.id, action: 'cancel',
                        payload: { remark: 'Request rejected from email' },
                    }),
                ]);
                if (alignToken || cancelToken) {
                    actions = `
                <p style="margin:18px 0 6px;color:#334155;font-size:13px">Act on it here:</p>
                <p style="margin:0">
                    ${alignToken ? `<a href="${base}/api/email-actions/${alignToken}" style="display:inline-block;background:#dcfce7;color:#166534;border:1px solid #86efac;padding:11px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;margin-right:8px">Align this payment</a>` : ''}
                    ${cancelToken ? `<a href="${base}/api/email-actions/${cancelToken}" style="display:inline-block;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:11px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px">Reject</a>` : ''}
                </p>
                <p style="color:#94a3b8;font-size:11px;margin:10px 0 0">Works once, expires in 7 days. Do not forward — anyone with this link can act as you.</p>`;
                }
            }

            const html = `
            <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
                <h2 style="color:#0f172a;font-size:18px">Payment requested — yet to be aligned</h2>
                <table style="font-size:14px;color:#334155;border-collapse:collapse">
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">PO</td><td style="padding:4px 0"><b>${p.po_number || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td style="padding:4px 0">${p.vendor_name || '—'}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount</td><td style="padding:4px 0"><b>${inr(p.requested_amount)}</b></td></tr>
                    ${p.percent_of_po != null ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Share of PO</td><td style="padding:4px 0">${p.percent_of_po}%${p.po_amount != null ? ` of ${inr(p.po_amount)}` : ''}</td></tr>` : ''}
                    ${p.tranche_no ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Tranche</td><td style="padding:4px 0">#${p.tranche_no}</td></tr>` : ''}
                    ${p.payment_term ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Term</td><td style="padding:4px 0">${p.payment_term}</td></tr>` : ''}
                    ${p.requested_by_name ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Requested by</td><td style="padding:4px 0">${p.requested_by_name}</td></tr>` : ''}
                </table>
                ${actions}
                ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Payment Tracker</a></p>` : ''}
            </div>`;

            await EmailService.sendEmail({ to: r.email, subject, html })
                .catch((e) => console.error('[accounts notify requested] send failed:', e));
        }));
    } catch (e) {
        console.error('[accounts notify requested] failed:', e);
    }
}

export interface CompletedPayment {
    organization_id: string;
    po_number?: string | null;
    vendor_name?: string | null;
    paid_amount?: number | null;
    requested_amount?: number | null;
    utr_no?: string | null;
    payment_date?: string | null;
    payment_term?: string | null;
    /** the procurement user who aligned the tranche — they are waiting on this UTR */
    aligned_by?: string | null;
    /** whoever raised the tranche; on a request-first flow this is not the aligner */
    created_by?: string | null;
}

// Email the team when a payment is completed, carrying the UTR.
export async function notifyPaymentCompleted(p: CompletedPayment): Promise<void> {
    try {
        // The aligner is added explicitly: they are the SPOC for this tranche even if
        // their role is not one of the broadcast roles.
        const [roleTo, alignerTo] = await Promise.all([
            orgRoleEmails(p.organization_id, NOTIFY_ROLES),
            emailsForUsers([p.aligned_by]),
        ]);
        const to = [...new Set([...roleTo, ...alignerTo])];
        // The UTR intimation goes out for the same event, to the other half of the org.
        // Chained here rather than from the routes so no completion path can ever send one
        // without the other — including notifyPaymentAfterEmailAction.
        notifyUtrRecorded(p, to).catch(() => {});
        if (!to.length) return;
        const link = APP_URL ? `${APP_URL}/${p.organization_id}/accounts` : '';
        const subject = `Payment completed · ${p.po_number || 'PO'} · UTR ${p.utr_no || '—'}`;
        const html = `
            <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
                <h2 style="color:#0f172a;font-size:18px">Payment completed</h2>
                <table style="font-size:14px;color:#334155;border-collapse:collapse">
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">PO</td><td style="padding:4px 0"><b>${p.po_number || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td style="padding:4px 0">${p.vendor_name || '—'}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount paid</td><td style="padding:4px 0"><b>${inr(p.paid_amount ?? p.requested_amount)}</b></td></tr>
                    ${p.payment_term ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Term</td><td style="padding:4px 0">${p.payment_term}</td></tr>` : ''}
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">UTR</td><td style="padding:4px 0"><b>${p.utr_no || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Date</td><td style="padding:4px 0">${p.payment_date || '—'}</td></tr>
                </table>
                ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Payment Tracker</a></p>` : ''}
            </div>`;
        await EmailService.sendEmail({ to, subject, html });
    } catch (e) {
        console.error('[accounts notify] failed:', e);
    }
}

/**
 * The UTR intimation — procurement's half of a completed payment.
 *
 * A UTR is the only proof the vendor was actually paid, and procurement is the one holding
 * the vendor relationship, so they get a mail that leads with the reference number rather
 * than with the accounting.
 *
 * `alreadyMailed` carries the addresses notifyPaymentCompleted just wrote to. Someone who
 * is both accounts and procurement is a real thing in this org, and two mails about one
 * payment trains people to ignore both.
 */
export async function notifyUtrRecorded(p: CompletedPayment, alreadyMailed: string[] = []): Promise<void> {
    try {
        if (!p.utr_no) return; // nothing to announce — completion always carries one
        const [procurementTo, requesterTo] = await Promise.all([
            orgRoleEmails(p.organization_id, PROCUREMENT_ROLES),
            emailsForUsers([p.created_by, p.aligned_by]),
        ]);
        const seen = new Set(alreadyMailed);
        const to = [...new Set([...procurementTo, ...requesterTo])].filter((e) => !seen.has(e));
        if (!to.length) return;

        const link = APP_URL ? `${APP_URL.replace(/\/$/, '')}/${p.organization_id}/accounts` : '';
        const subject = `UTR recorded · ${p.po_number || 'PO'} · ${p.utr_no}`;
        const html = `
            <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
                <h2 style="color:#0f172a;font-size:18px">Payment done — UTR recorded</h2>
                <p style="font-size:14px;color:#334155;margin:0 0 12px">The vendor has been paid. Quote this UTR when they ask.</p>
                <table style="font-size:14px;color:#334155;border-collapse:collapse">
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">UTR</td><td style="padding:4px 0"><b style="font-family:ui-monospace,monospace">${p.utr_no}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">PO</td><td style="padding:4px 0"><b>${p.po_number || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td style="padding:4px 0">${p.vendor_name || '—'}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount paid</td><td style="padding:4px 0"><b>${inr(p.paid_amount ?? p.requested_amount)}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Date</td><td style="padding:4px 0">${p.payment_date || '—'}</td></tr>
                </table>
                ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Payment Tracker</a></p>` : ''}
            </div>`;
        await EmailService.sendEmail({ to, subject, html });
    } catch (e) {
        console.error('[accounts notify utr] failed:', e);
    }
}

export interface CancelledPayment {
    organization_id: string;
    po_number?: string | null;
    vendor_name?: string | null;
    requested_amount?: number | null;
    tranche_no?: number | null;
    aligned_by?: string | null;
    reason?: string | null;
}

// A cancelled tranche is dead: tell the aligner and finance so neither keeps chasing it.
export async function notifyPaymentCancelled(p: CancelledPayment): Promise<void> {
    try {
        const [alignerTo, financeTo] = await Promise.all([
            emailsForUsers([p.aligned_by]),
            orgRoleEmails(p.organization_id, FINANCE_ROLES),
        ]);
        const to = [...new Set([...alignerTo, ...financeTo])];
        if (!to.length) return;
        const link = APP_URL ? `${APP_URL}/${p.organization_id}/accounts` : '';
        const subject = `Payment cancelled · ${p.po_number || 'PO'} · ${inr(p.requested_amount)}`;
        const html = `
            <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
                <h2 style="color:#0f172a;font-size:18px">Payment cancelled</h2>
                <table style="font-size:14px;color:#334155;border-collapse:collapse">
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">PO</td><td style="padding:4px 0"><b>${p.po_number || '—'}</b></td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td style="padding:4px 0">${p.vendor_name || '—'}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount</td><td style="padding:4px 0"><b>${inr(p.requested_amount)}</b></td></tr>
                    ${p.tranche_no ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Tranche</td><td style="padding:4px 0">#${p.tranche_no}</td></tr>` : ''}
                    ${p.reason ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Reason</td><td style="padding:4px 0">${p.reason}</td></tr>` : ''}
                </table>
                ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Payment Tracker</a></p>` : ''}
            </div>`;
        await EmailService.sendEmail({ to, subject, html });
    } catch (e) {
        console.error('[accounts notify cancelled] failed:', e);
    }
}

/**
 * Intimation for a payment actioned through a one-click email link.
 *
 * The email-action route applies the transition through the shared state machine and
 * then hands the payment id here; the row's status IS what happened. Only terminal
 * outcomes are announced — re-announcing an aligned tranche would mail finance a fresh
 * set of action buttons for something they already hold.
 */
export async function notifyPaymentAfterEmailAction(orgId: string, paymentId: string, remark?: string): Promise<void> {
    const { data: pay } = await supabaseAdmin
        .from('po_payments').select('*')
        .eq('id', paymentId).eq('organization_id', orgId).maybeSingle();
    if (!pay) return;

    if (pay.status === 'completed') {
        await notifyPaymentCompleted({
            organization_id: orgId,
            po_number: pay.po_number, vendor_name: pay.vendor_name,
            paid_amount: pay.paid_amount, requested_amount: pay.requested_amount,
            utr_no: pay.utr_no, payment_date: pay.payment_date, payment_term: pay.payment_term,
            aligned_by: pay.aligned_by, created_by: pay.created_by,
        });
    } else if (pay.status === 'cancelled') {
        await notifyPaymentCancelled({
            organization_id: orgId,
            po_number: pay.po_number, vendor_name: pay.vendor_name,
            requested_amount: pay.requested_amount, tranche_no: pay.tranche_no,
            aligned_by: pay.aligned_by, reason: remark ?? pay.remarks ?? null,
        });
    }
}
