/**
 * Periods in India time (Asia/Kolkata, UTC+5:30, no daylight saving). "Today" means today in India, not in UTC.
 */
export const PERIODS = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_month'] as const;
export type Period = typeof PERIODS[number];

const IST_OFFSET_MS = 330 * 60_000;

/** YYYY-MM-DD of an instant, in India time. */
export function istDate(at: Date): string {
    return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant at which an India-time calendar date starts. */
export function istStart(date: string): Date {
    return new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);
}

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export interface Range {
    /** Inclusive start date and exclusive end date, India time. */
    fromDate: string;
    toDate: string;
    /** The same range as UTC instants, for timestamp columns. */
    fromIso: string;
    toIso: string;
}

export function rangeFor(period: Period, now: Date = new Date()): Range {
    const today = istDate(now);
    let fromDate: string; let toDate: string;
    switch (period) {
        case 'today': fromDate = today; toDate = addDays(today, 1); break;
        case 'yesterday': fromDate = addDays(today, -1); toDate = today; break;
        case 'last_7_days': fromDate = addDays(today, -6); toDate = addDays(today, 1); break;
        case 'this_week': {
            const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
            fromDate = addDays(today, -((dow + 6) % 7)); // weeks start on Monday
            toDate = addDays(today, 1);
            break;
        }
        case 'this_month': fromDate = `${today.slice(0, 7)}-01`; toDate = addDays(today, 1); break;
        case 'last_month': {
            const first = `${today.slice(0, 7)}-01`;
            const prev = addDays(first, -1);
            fromDate = `${prev.slice(0, 7)}-01`; toDate = first;
            break;
        }
    }
    return { fromDate, toDate, fromIso: istStart(fromDate).toISOString(), toIso: istStart(toDate).toISOString() };
}

/** The same-length range just before this one (for "vs last period"). */
export function previousRange(r: Range): Range {
    const days = Math.round((Date.parse(`${r.toDate}T00:00:00Z`) - Date.parse(`${r.fromDate}T00:00:00Z`)) / 86_400_000);
    const fromDate = addDays(r.fromDate, -days);
    return { fromDate, toDate: r.fromDate, fromIso: istStart(fromDate).toISOString(), toIso: istStart(r.fromDate).toISOString() };
}
