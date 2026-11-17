/**
 * Owner 2026-10-29: "Send notes on WhatsApp" — one message per person present, as a Meta-approved template (free text is
 * rejected by WhatsApp outside the 24-hour window, see taskAlerts.ts). Until the template is approved in AiSensy / Meta,
 * the send fails and the screen says so.
 *
 *   meeting_notes_v1   Hello {{1}} · meeting "{{2}}" on {{3}} · Summary: {{4}} · Decisions: {{5}} · Your tasks: {{6}}
 *
 * Kept free of database imports so it is tested offline.
 */

export const MEETING_NOTES_CAMPAIGN = process.env.AISENSY_MEETING_NOTES_CAMPAIGN || 'meeting_notes_v1';

/** One line: Meta rejects line breaks, tabs and long runs of spaces inside a template variable. */
const one = (s: unknown, max: number) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d;
};

/** "1) a 2) b 3) c" — numbered on one line, cut to fit. */
const numbered = (items: string[], max: number, none: string) =>
    items.length ? one(items.map((x, i) => `${i + 1}) ${x}`).join(' '), max) : none;

export interface NotesMessageInput {
    name: string;
    meetingTitle: string;
    meetingDate: string;
    summary: string;
    decisions: string[];
    /** This person's tasks from the meeting (title, and due date if any) */
    tasks: string[];
}

/** WhatsApp's whole body limit is 1024 characters: the variables are capped so the message always fits. */
export function notesParams(i: NotesMessageInput): [string, string, string, string, string, string] {
    return [
        one(i.name.split(' ')[0] || 'there', 40),
        one(i.meetingTitle, 80),
        dateLabel(i.meetingDate),
        one(i.summary, 420) || 'No summary.',
        numbered(i.decisions, 220, 'None recorded.'),
        numbered(i.tasks, 200, 'None for you from this meeting.'),
    ];
}

/** What the person receives, filled in (Pretend-Mode preview and logs). Must match the approved template text. */
export function notesPreview(p: string[]): string {
    return `Hello ${p[0]},\n\nHere are the notes from the meeting "${p[1]}" held on ${p[2]}.\n\n`
        + `Summary: ${p[3]}\n\nDecisions: ${p[4]}\n\nYour tasks: ${p[5]}\n\nYour tasks are also in the Task Manager.`;
}
