/**
 * Ira — daily digest email.
 *
 * Composes and (optionally) sends the procurement task digest to the SPOC.
 * Email-only for now: no WhatsApp, no voice. Sends through the same SMTP
 * config the rest of the app uses.
 *
 * SAFETY: `send()` is never called by the preview route. Nothing leaves the
 * building unless someone hits the send endpoint with the explicit flag.
 */

import nodemailer from 'nodemailer';
import { getDailyTasks, summarise, STATUS_META, type IraTask } from './tasks';

export const IRA_FROM_NAME = 'Ira — Autopilot Procurement';
/** Set IRA_FROM_EMAIL once the ira@worksquare.in alias exists. */
export const IRA_FROM_EMAIL = process.env.IRA_FROM_EMAIL || process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER;
export const IRA_SPOC_EMAIL = process.env.IRA_SPOC_EMAIL || 'saniel@worksquare.in';

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function todayIST(): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date());
}

function row(t: IraTask): string {
    return `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #E4E3DE;color:#797E86;font-size:12px;text-align:center;">${t.sr}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #E4E3DE;color:#16181C;font-size:13px;font-weight:600;">${esc(t.task)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #E4E3DE;color:#4A4E55;font-size:13px;white-space:nowrap;">${esc(t.site)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #E4E3DE;color:#4A4E55;font-size:13px;">${esc(t.remark)}</td>
    </tr>`;
}

export function buildDigestHtml(tasks: IraTask[]): { subject: string; html: string } {
    const s = summarise(tasks);
    const date = todayIST();

    const blocks = s.byStatus.map((g) => {
        const meta = STATUS_META[g.status];
        return `
      <div style="margin:0 0 22px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${meta.tone};"></span>
          <span style="font-size:13px;font-weight:700;color:#16181C;letter-spacing:-0.01em;">${meta.label}</span>
          <span style="font-size:12px;color:#797E86;">· ${g.tasks.length}</span>
        </div>
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #E4E3DE;border-radius:4px;overflow:hidden;">
          <tr style="background:#F5F5F1;">
            <th style="padding:7px 10px;text-align:center;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#797E86;font-weight:600;width:36px;">#</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#797E86;font-weight:600;">Task</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#797E86;font-weight:600;">Site</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#797E86;font-weight:600;">Remark</th>
          </tr>
          ${g.tasks.map(row).join('')}
        </table>
      </div>`;
    }).join('');

    const siteChips = s.bySite.map((b) =>
        `<span style="display:inline-block;background:#F5F5F1;border:1px solid #E4E3DE;border-radius:4px;padding:3px 9px;margin:0 5px 5px 0;font-size:12px;color:#4A4E55;">${esc(b.site)} <b style="color:#16181C;">${b.count}</b></span>`
    ).join('');

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#FBFBF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:26px 20px 40px;">

    <div style="border:1px solid #D3D2CB;border-radius:5px;background:#fff;overflow:hidden;margin-bottom:20px;">
      <div style="padding:9px 16px;background:#F5F5F1;border-bottom:1px solid #E4E3DE;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#797E86;">
        Daily Procurement Task List · ${date}
      </div>
      <div style="padding:20px 18px;">
        <div style="font-size:24px;font-weight:700;letter-spacing:-.02em;color:#16181C;margin-bottom:6px;">
          ${s.blocking} ${s.blocking === 1 ? 'task needs' : 'tasks need'} your decision
        </div>
        <div style="font-size:14px;color:#4A4E55;line-height:1.55;">
          ${s.total} open tasks across ${s.bySite.length} sites. The ones below marked
          <b>Waiting for approval</b> and <b>Need to make PO</b> are blocked on a person, not a vendor.
        </div>
      </div>
    </div>

    <div style="margin-bottom:20px;">${siteChips}</div>

    ${blocks}

    <div style="margin-top:26px;padding-top:16px;border-top:1px solid #E4E3DE;font-size:12px;color:#A8ACB2;line-height:1.7;">
      Sent by <b style="color:#797E86;">Ira</b>, an automated procurement assistant at Autopilot.<br>
      Replies to this address are not monitored yet — reply to your procurement lead for anything urgent.
    </div>

  </div>
</body></html>`;

    return {
        subject: `Daily procurement — ${s.blocking} need your decision · ${date}`,
        html,
    };
}

/**
 * REPLY-TO IS NOT OPTIONAL POLISH — it is the return path.
 *
 * The From address must sit on a domain the SMTP provider has verified
 * (autopilotoffices.com here; Resend rejects worksquare.in with a 550). But the
 * mailbox Ira POLLS is purchase@worksquare.in. Without an explicit Reply-To,
 * every reply goes back to the From address, which nothing reads — the exact
 * silent-loss failure the disposition loop exists to prevent. So: send as the
 * verified domain, reply to the polled mailbox.
 */
export interface SendOptions {
    replyTo?: string | null;
    /**
     * Threading. A reply Ira sends must carry In-Reply-To/References or every
     * mail client files it as a NEW conversation, and the person loses the
     * context they were asking about. Pass the Message-ID being answered.
     */
    inReplyTo?: string | null;
    references?: string | null;
}

export async function sendDigest(
    to: string,
    subject: string,
    html: string,
    replyToOrOpts?: string | null | SendOptions,
): Promise<{ messageId: string | null }> {
    const opts: SendOptions =
        typeof replyToOrOpts === 'string' || replyToOrOpts == null
            ? { replyTo: replyToOrOpts ?? null }
            : replyToOrOpts;
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const info = await transporter.sendMail({
        from: `"${IRA_FROM_NAME}" <${IRA_FROM_EMAIL}>`,
        to,
        subject,
        html,
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
        ...(opts.references ?? opts.inReplyTo ? { references: opts.references ?? opts.inReplyTo ?? undefined } : {}),
    });
    return { messageId: (info as { messageId?: string })?.messageId ?? null };
}

export async function buildTodaysDigest() {
    const tasks = await getDailyTasks();
    return { tasks, ...buildDigestHtml(tasks) };
}
