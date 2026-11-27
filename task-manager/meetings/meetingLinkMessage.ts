/**
 * Owner 2026-11-26: "Send meeting link" (WhatsApp via Meta-approved AiSensy template + Email) for online meetings.
 * Kept free of database imports so it can be tested offline.
 *
 * Meta / AiSensy template (`meeting_link_v1`, category UTILITY, language en):
 *   Hello {{1}},
 *
 *   You are invited to the online meeting "{{2}}" hosted by {{3}}.
 *
 *   When: {{4}}
 *   Join link: {{5}}
 *
 *   Please open the link at the meeting time to join the call.
 */

export const MEETING_LINK_CAMPAIGN = process.env.AISENSY_MEETING_LINK_CAMPAIGN || 'meeting_link_v1';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One line: Meta rejects line breaks, tabs and 4+ consecutive spaces inside a template variable. */
const one = (s: unknown, max: number) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const dateLabel = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d;
};

/** Deterministic IST date/time label so formatting never varies by runtime locale. */
export function meetingWhenLabel(scheduledFor: string | null | undefined, meetingDate: string): string {
    if (scheduledFor) {
        const ms = Date.parse(scheduledFor);
        if (Number.isFinite(ms)) {
            const d = new Date(ms + 330 * 60_000);
            const h = d.getUTCHours();
            const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
            return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${time} (IST)`;
        }
    }
    return `Starting now (${dateLabel(meetingDate)})`;
}

export interface LinkMessageInput {
    recipientName: string;
    meetingTitle: string;
    hostName: string;
    when: string;
    joinUrl: string;
}

/** Five single-line variables for `meeting_link_v1`, kept well within Meta's 1024-char body limit. */
export function linkParams(i: LinkMessageInput): [string, string, string, string, string] {
    return [
        one(i.recipientName.split(' ')[0] || 'there', 40) || 'there',
        one(i.meetingTitle, 80) || 'Online meeting',
        one(i.hostName, 60) || 'Your team',
        one(i.when, 60) || 'Scheduled meeting',
        one(i.joinUrl, 240),
    ];
}

/** Filled template text (Pretend-Mode preview and logs). Matches `meeting_link_v1`. */
export function linkPreview(p: string[]): string {
    return `Hello ${p[0]},\n\nYou are invited to the online meeting "${p[1]}" hosted by ${p[2]}.\n\n`
        + `When: ${p[3]}\nJoin link: ${p[4]}\n\nPlease open the link at the meeting time to join the call.`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function linkEmailSubject(meetingTitle: string, when: string): string {
    return `Meeting invite: ${one(meetingTitle, 80) || 'Online meeting'} · ${one(when, 60)}`;
}

export function linkEmailHtml(i: LinkMessageInput & { isExternal?: boolean }): string {
    const first = i.recipientName.trim().split(/\s+/)[0] || 'there';
    const note = i.isExternal
        ? 'Open the link at the meeting time, enter your name, and wait briefly to be let in. The call audio is recorded for meeting notes.'
        : 'Team members go straight into the call with their login. The call audio is recorded for meeting notes.';
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">`
        + `<p style="font-size:16px;font-weight:600;margin-bottom:12px">Hello ${esc(first)},</p>`
        + `<p style="margin-bottom:14px">You are invited to join an online meeting on Autopilot.</p>`
        + `<table style="border-collapse:collapse;font-size:14px;margin-bottom:18px">`
        + `<tr><td style="padding:4px 14px 4px 0;color:#64748b;vertical-align:top">Meeting</td><td style="padding:4px 0;font-weight:600">${esc(i.meetingTitle)}</td></tr>`
        + `<tr><td style="padding:4px 14px 4px 0;color:#64748b;vertical-align:top">Host</td><td style="padding:4px 0">${esc(i.hostName)}</td></tr>`
        + `<tr><td style="padding:4px 14px 4px 0;color:#64748b;vertical-align:top">When</td><td style="padding:4px 0">${esc(i.when)}</td></tr>`
        + `</table>`
        + `<p style="margin:18px 0"><a href="${esc(i.joinUrl)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Join the call</a></p>`
        + `<p style="font-size:12px;color:#64748b;word-break:break-all">Or open: <a href="${esc(i.joinUrl)}" style="color:#4f46e5">${esc(i.joinUrl)}</a></p>`
        + `<p style="font-size:12px;color:#64748b;margin-top:16px">${esc(note)}</p>`
        + `</div>`;
}
