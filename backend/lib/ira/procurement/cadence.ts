/**
 * SCAN CADENCE — ball by ball, innings by innings, match by match.
 * -----------------------------------------------------------------------------
 * A daily scan that reports every duplicate in 5,310 historical POs is not a
 * daily scan. It is the same backlog re-read every morning, and the only thing it
 * reliably produces is the feeling that nothing is under control.
 *
 * The rule: A DAILY SCAN REPORTS WHAT ENTERED EXISTENCE SINCE THE LAST ONE.
 *
 *   daily      what changed since yesterday's scan, plus today up to the cutoff
 *   weekly     the week's new findings, plus anything still open from prior weeks
 *   monthly    the month, with per-week movement
 *   quarterly  the quarter, trends and repeat offenders
 *
 * A finding "enters existence" at the moment it BECOMES TRUE, not when the data
 * was first created. A duplicate pair comes into being when the SECOND PO is
 * raised — so a pair whose later PO was raised in April is April's news, however
 * old the first PO is, and it must never appear in September's daily.
 *
 * WHAT DOES NOT ROLL OFF: anything still open. A daily is a delta of NEW
 * problems, not a delta of ALL problems — an unanswered critical from three days
 * ago stays, because dropping it would let a real issue age out silently. That is
 * the one exception, and it is deliberate.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export const CADENCES: readonly Cadence[] = ['daily', 'weekly', 'monthly', 'quarterly'] as const;

export interface CadenceWindow {
    cadence: Cadence;
    /** Inclusive start of the window. */
    from: Date;
    /** Exclusive end — the cutoff. */
    to: Date;
    /** Human label for the email header, e.g. "4 Sep 10:00 → 5 Sep 10:00". */
    label: string;
    /** What the reader should expect to see. Rendered, so scope is never implicit. */
    scope: string;
}

/** IST. Every site, every approver and every cutoff in this business is Indian. */
const TZ_OFFSET_MIN = 330;

function istParts(d: Date) {
    const shifted = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
    return {
        y: shifted.getUTCFullYear(),
        m: shifted.getUTCMonth(),
        d: shifted.getUTCDate(),
        h: shifted.getUTCHours(),
    };
}

/** Build a UTC instant from IST wall-clock parts. */
function istInstant(y: number, m: number, d: number, hour: number): Date {
    return new Date(Date.UTC(y, m, d, hour, 0, 0) - TZ_OFFSET_MIN * 60_000);
}

const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);

const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    }).format(d);

/**
 * The window a scan running at `now` should cover.
 *
 * `cutoffHour` is the daily boundary — 10:00 by default, so the 5 Sep daily
 * covers 4 Sep 10:00 to 5 Sep 10:00. Anything raised after the cutoff belongs to
 * tomorrow's scan, which is what makes two consecutive dailies non-overlapping
 * and the pair of them complete.
 */
export function windowFor(cadence: Cadence, now: Date, cutoffHour = 10): CadenceWindow {
    const p = istParts(now);

    if (cadence === 'daily') {
        // Before the cutoff, "today's" window has not closed yet — report the one
        // that ended at the most recent cutoff.
        const endDay = p.h >= cutoffHour ? p.d : p.d - 1;
        const to = istInstant(p.y, p.m, endDay, cutoffHour);
        const from = new Date(to.getTime() - 24 * 3600_000);
        return {
            cadence, from, to,
            label: `${fmt(from)} → ${fmt(to)}`,
            scope: `New since the last scan. Anything raised after ${String(cutoffHour).padStart(2, '0')}:00 today is in tomorrow's.`,
        };
    }

    if (cadence === 'weekly') {
        const to = istInstant(p.y, p.m, p.d, cutoffHour);
        const from = new Date(to.getTime() - 7 * 24 * 3600_000);
        return { cadence, from, to, label: `${fmtDay(from)} → ${fmtDay(to)}`, scope: 'The week’s new findings, plus everything still open.' };
    }

    if (cadence === 'monthly') {
        const from = istInstant(p.y, p.m, 1, cutoffHour);
        const to = istInstant(p.y, p.m + 1, 1, cutoffHour);
        return { cadence, from, to, label: fmtDay(from).slice(3), scope: 'The month in full, with repeat offenders called out.' };
    }

    const qStart = Math.floor(p.m / 3) * 3;
    const from = istInstant(p.y, qStart, 1, cutoffHour);
    const to = istInstant(p.y, qStart + 3, 1, cutoffHour);
    return { cadence, from, to, label: `Q${Math.floor(qStart / 3) + 1} ${p.y}`, scope: 'The quarter: trends, repeat offenders and what never got closed.' };
}

/** True when an instant falls inside the window. */
export function inWindow(w: CadenceWindow, at: string | Date | null | undefined): boolean {
    if (!at) return false;
    const t = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(t.getTime())) return false;
    return t >= w.from && t < w.to;
}
