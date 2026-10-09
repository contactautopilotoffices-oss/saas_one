/**
 * Working with a superuser — the message wording and the small shared types. PURE (no imports, no I/O), so the Tasks tab can
 * show a live preview that is EXACTLY what the server will send, and tests can check every line.
 */

export const MAX_LISTED_TASKS = 8;       // beyond this the message says "and N more" (keeps it, and the template, short)
export const MAX_FROM_LABEL = 60;
export const MAX_NOTE = 300;

export interface PingMessageInput {
    /** Who the message says it is from. Defaults to the person who sends it, but they may type another name. */
    fromLabel: string;
    department: string;
    tasks: string[];
    note?: string | null;
}

const oneLine = (s: string, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function shown(tasks: string[]): { lines: string[]; more: number } {
    const lines = tasks.slice(0, MAX_LISTED_TASKS).map(t => oneLine(t, 120));
    return { lines, more: Math.max(0, tasks.length - MAX_LISTED_TASKS) };
}

/** The WhatsApp message Saniel sees (sent as-is inside the 24-hour window). */
export function buildPingText(i: PingMessageInput): string {
    const { lines, more } = shown(i.tasks);
    const out = [`🔔 *Pending for you* — from ${oneLine(i.fromLabel, MAX_FROM_LABEL)}, ${oneLine(i.department, 60)}`, '', ...lines.map((t, n) => `${n + 1}. ${t}`)];
    if (more) out.push(`…and ${more} more`);
    const note = oneLine(i.note || '', MAX_NOTE);
    if (note) out.push('', `📝 ${note}`);
    out.push('', 'Swipe-reply to this message.');
    return out.join('\n');
}

const firstName = (name: string) => oneLine(name, 60).split(' ')[0] || 'there';

/**
 * The three blanks of the approved ping template ("Hi {{1}}, {{2}} tagged you regarding the following pending task…")
 *   ({{1}} = who it goes to, {{2}} = who it is from, {{3}} = the tasks on ONE line — Meta forbids line breaks inside a variable).
 */
export function buildPingTemplateParams(i: PingMessageInput, recipientName = ''): [string, string, string] {
    const { lines, more } = shown(i.tasks);
    const list = [...lines.map((t, n) => `${n + 1}. ${t}`), ...(more ? [`and ${more} more`] : [])].join(' | ');
    return [firstName(recipientName), oneLine(`${i.fromLabel} (${i.department})`, 100), oneLine(list, 600)];
}

export interface ReminderGroup { assigner: string; tasks: string[] }

/** The regular reminder: his pending work from the team, grouped by who gave it to him. */
export function buildReminderText(department: string, groups: ReminderGroup[]): string {
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    const out = [`🔔 *Your pending work from ${oneLine(department, 60)}* (${total})`];
    let budget = MAX_LISTED_TASKS * 2;
    for (const g of groups) {
        const take = g.tasks.slice(0, Math.max(0, budget));
        budget -= take.length;
        out.push('', `*From ${oneLine(g.assigner, MAX_FROM_LABEL)}*`, ...take.map((t, n) => `${n + 1}. ${oneLine(t, 120)}`));
        if (g.tasks.length > take.length) out.push(`…and ${g.tasks.length - take.length} more`);
    }
    out.push('', 'Swipe-reply to this message.');
    return out.join('\n');
}

export function buildReminderTemplateParams(department: string, groups: ReminderGroup[], recipientName = ''): [string, string, string] {
    const list = groups.map(g => `${oneLine(g.assigner, 40)}: ${g.tasks.slice(0, 4).map(t => oneLine(t, 60)).join(', ')}${g.tasks.length > 4 ? ` and ${g.tasks.length - 4} more` : ''}`).join(' | ');
    return [firstName(recipientName), oneLine(`${department} team`, 100), oneLine(list, 600)];
}

// ── the team's shared schedule ──────────────────────────────────────────────

export interface SuperuserReminder {
    enabled: boolean;
    /** HH:MM, India time, in 15-minute steps (the scheduler runs every 15 minutes). */
    time: string;
    /** 0 = Sunday … 6 = Saturday */
    days: number[];
    recipientId: string | null;
    lastRunDate: string | null;
}

export const DEFAULT_REMINDER: SuperuserReminder = { enabled: false, time: '09:30', days: [1, 2, 3, 4, 5, 6], recipientId: null, lastRunDate: null };

export function normalizeReminder(raw: unknown): SuperuserReminder {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_REMINDER.time;
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_REMINDER.days;
    return {
        enabled: r.enabled === true,
        time,
        days: days.length ? days : DEFAULT_REMINDER.days,
        recipientId: typeof r.recipientId === 'string' && r.recipientId ? r.recipientId : null,
        lastRunDate: typeof r.lastRunDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastRunDate) ? r.lastRunDate : null,
    };
}

export const isQuarterHour = (time: string) => /^([01]\d|2[0-3]):(00|15|30|45)$/.test(time);
