/**
 * Owner 2026-10-27: due dates. Pure helpers shared by the server (reminders, validation) and the board (countdown,
 * on-time / late labels). No database or browser code here.
 *
 * A task keeps its start date (assigned_date). The deadline is optional: a date, and optionally a time (IST). Without a
 * time it is due at the end of that day. A task without a due date counts as due on its start date, exactly as today,
 * and gets no countdown or on-time label.
 */

export interface TaskDue {
    date: string;          // YYYY-MM-DD
    time: string | null;   // HH:MM (24 h, IST) or null = end of day
}

export type DueTone = 'late' | 'soon' | 'ok';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR;

/** Furthest a deadline may be set, counted from the start date. */
export const MAX_DUE_DAYS = 366;

export const isDueDate = (s: unknown): s is string =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
    && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export const isDueTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** "17:00:00" from the database → "17:00". */
export const shortTime = (t: string | null | undefined): string | null => (t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null);

export const addDueDays = (date: string, days: number): string => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
export const istDateOf = (ms: number): string => new Date(ms + IST_OFFSET).toISOString().slice(0, 10);

/** The moment the task is due (ms). Without a time: the last second of the due day, IST. */
export function dueInstant(due: TaskDue): number {
    return Date.parse(`${due.date}T${due.time ? `${due.time}:00` : '23:59:59'}+05:30`);
}

/** When the one "due soon" reminder goes out: 2 hours before a set time, or 5 pm IST the day before a date-only deadline. */
export function reminderAt(due: TaskDue): number {
    return due.time ? dueInstant(due) - 2 * HOUR : Date.parse(`${addDueDays(due.date, -1)}T17:00:00+05:30`);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "40 min", "3 h 20 min", "1 day 4 h". */
export function spanLabel(ms: number): string {
    const mins = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${plural(d, 'day')} ${rh} h` : plural(d, 'day');
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5:00 pm". */
export function timeLabel(time: string): string {
    const [h, m] = time.split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** "Tue 3 Nov". */
export function dayLabel(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "Tue 3 Nov, 5:00 pm" or "Fri 30 Oct". */
export function dueLabel(due: TaskDue): string {
    return due.time ? `${dayLabel(due.date)}, ${timeLabel(due.time)}` : dayLabel(due.date);
}

/** Countdown for an OPEN task. `dayOf` ("Day 3 of 5") only for a task that spans several days and has started. */
export function openDueStatus(due: TaskDue, startDate: string, now: number): { tone: DueTone; label: string; dayOf: { n: number; total: number } | null } {
    const today = istDateOf(now);
    const at = dueInstant(due);
    const total = daysBetween(startDate, due.date) + 1;
    const n = daysBetween(startDate, today) + 1;
    const dayOf = total > 1 && n >= 1 && n <= total ? { n, total } : null;

    if (now > at) {
        const label = due.time ? `Overdue by ${spanLabel(now - at)}` : `Overdue by ${plural(Math.max(1, daysBetween(due.date, today)), 'day')}`;
        return { tone: 'late', label, dayOf: null };
    }
    if (due.date === today) return { tone: 'soon', label: due.time ? `Due in ${spanLabel(at - now)}` : 'Due today', dayOf };
    const left = daysBetween(today, due.date);
    return { tone: 'ok', label: left === 1 ? 'Due tomorrow' : `Due in ${plural(left, 'day')}`, dayOf };
}

/** On time or late, for a FINISHED task. In minutes / hours when a time was set, in days otherwise. */
export function doneDueStatus(due: TaskDue, completedAt: string): { onTime: boolean; label: string; lateMs: number } {
    const done = Date.parse(completedAt);
    if (due.time) {
        const diff = done - dueInstant(due);
        if (diff <= 0) return { onTime: true, label: -diff >= MINUTE ? `Done on time · ${spanLabel(diff)} early` : 'Done on time', lateMs: 0 };
        return { onTime: false, label: `Done ${spanLabel(diff)} late`, lateMs: diff };
    }
    const days = daysBetween(due.date, istDateOf(done));
    if (days <= 0) return { onTime: true, label: days < 0 ? `Done on time · ${plural(-days, 'day')} early` : 'Done on time', lateMs: 0 };
    return { onTime: false, label: `Done ${plural(days, 'day')} late`, lateMs: days * DAY };
}

/**
 * Checks a deadline sent by a person. Returns the cleaned value, or a message to show them.
 * `undefined` date = "not sent" (leave as is); `null` or '' = "no deadline".
 */
export function checkDue(startDate: string, date: unknown, time: unknown): { ok: true; due: TaskDue | null } | { ok: false; error: string } {
    if (date === null || date === '' || date === undefined) {
        if (time) return { ok: false, error: 'Choose a due date for that time.' };
        return { ok: true, due: null };
    }
    if (!isDueDate(date)) return { ok: false, error: 'That due date is not valid.' };
    if (time !== undefined && time !== null && time !== '' && !isDueTime(time)) return { ok: false, error: 'That due time is not valid.' };
    if (date < startDate) return { ok: false, error: 'The due date cannot be before the start date.' };
    if (daysBetween(startDate, date) > MAX_DUE_DAYS) return { ok: false, error: 'The due date can be at most a year after the start date.' };
    return { ok: true, due: { date, time: isDueTime(time) ? time : null } };
}
