/**
 * Task Manager Usage Report: when a scheduled report is next due, and which days it covers. Pure, no database.
 *
 * All schedule times are IST. Vercel crons are fixed, so one cron checks every 15 minutes and only does work when an
 * organisation's `next_run_at` has passed; that is why times come in 15-minute steps.
 */

export type ReportFrequency = 'weekly' | 'fortnightly' | 'monthly';

export interface ReportSchedule {
    enabled: boolean;
    frequency: ReportFrequency;
    /** 0 = Sunday ... 6 = Saturday. Used by weekly and fortnightly. */
    dayOfWeek: number;
    /** 1 to 28, so every month has the day. Used by monthly. */
    dayOfMonth: number;
    /** HH:MM in IST, on a 15-minute step. */
    timeIst: string;
    /** How many days each report covers, ending the day before it runs. */
    coverageDays: number;
}

export const MAX_REPORT_DAYS = 366;

export const DEFAULT_SCHEDULE: ReportSchedule = {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeIst: '09:00',
    coverageDays: 7,
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

/** The instant a given IST calendar day and time happens. */
function istInstant(year: number, monthIndex: number, day: number, timeIst: string): number {
    const [h, m] = timeIst.split(':').map(Number);
    return Date.UTC(year, monthIndex, day, h, m) - IST_OFFSET_MS;
}

/** Plain-language problem with a schedule, or null when it is usable. */
export function validateSchedule(input: unknown): { ok: true; schedule: ReportSchedule } | { ok: false; error: string } {
    const s = (input ?? {}) as Partial<ReportSchedule>;
    if (typeof s.enabled !== 'boolean') return { ok: false, error: 'Say whether the schedule is on or off.' };
    if (s.frequency !== 'weekly' && s.frequency !== 'fortnightly' && s.frequency !== 'monthly') return { ok: false, error: 'Choose weekly, fortnightly or monthly.' };
    if (!Number.isInteger(s.dayOfWeek) || (s.dayOfWeek as number) < 0 || (s.dayOfWeek as number) > 6) return { ok: false, error: 'Choose a day of the week.' };
    if (!Number.isInteger(s.dayOfMonth) || (s.dayOfMonth as number) < 1 || (s.dayOfMonth as number) > 28) return { ok: false, error: 'Choose a day of the month from 1 to 28.' };
    if (typeof s.timeIst !== 'string' || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(s.timeIst)) return { ok: false, error: 'Choose a time on a 15-minute step.' };
    if (!Number.isInteger(s.coverageDays) || (s.coverageDays as number) < 1 || (s.coverageDays as number) > MAX_REPORT_DAYS) {
        return { ok: false, error: `Each report can cover 1 to ${MAX_REPORT_DAYS} days.` };
    }
    return {
        ok: true,
        schedule: {
            enabled: s.enabled,
            frequency: s.frequency,
            dayOfWeek: s.dayOfWeek as number,
            dayOfMonth: s.dayOfMonth as number,
            timeIst: s.timeIst,
            coverageDays: s.coverageDays as number,
        },
    };
}

/** The first run strictly after `afterMs`. */
export function nextRunAfter(schedule: ReportSchedule, afterMs: number): number {
    const ist = new Date(afterMs + IST_OFFSET_MS);
    const year = ist.getUTCFullYear();
    const month = ist.getUTCMonth();

    if (schedule.frequency === 'monthly') {
        for (let i = 0; ; i++) {
            const run = istInstant(year, month + i, schedule.dayOfMonth, schedule.timeIst);
            if (run > afterMs) return run;
        }
    }
    const day = ist.getUTCDate();
    for (let i = 0; ; i++) {
        const run = istInstant(year, month, day + i, schedule.timeIst);
        const weekday = new Date(run + IST_OFFSET_MS).getUTCDay();
        if (weekday === schedule.dayOfWeek && run > afterMs) return run;
    }
}

/**
 * The run after one that was due at `scheduledMs`. A run picked up late never replays what was missed: the next run is
 * always in the future. A fortnightly schedule stays on its own alternate weeks.
 */
export function followingRun(schedule: ReportSchedule, scheduledMs: number, nowMs: number): number {
    const step = schedule.frequency === 'fortnightly' ? 13 * DAY_MS : 0;
    let run = nextRunAfter(schedule, scheduledMs + step);
    while (run <= nowMs) run = nextRunAfter(schedule, run + step);
    return run;
}

/** The days a report running at `runMs` covers: `coverageDays` days ending the day before, in IST. */
export function coveragePeriod(schedule: Pick<ReportSchedule, 'coverageDays'>, runMs: number): { from: string; to: string } {
    const runDay = new Date(runMs + IST_OFFSET_MS).toISOString().slice(0, 10);
    const day = (offset: number) => new Date(Date.parse(`${runDay}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
    return { from: day(-schedule.coverageDays), to: day(-1) };
}
