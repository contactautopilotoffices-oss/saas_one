/**
 * Server-side checks for diesel, electricity and water readings: the same rules the logging
 * screens apply, so a request from anywhere else is held to them too.
 *
 *  - every reading: numbers must be numbers, and none may be negative;
 *  - a single reading (the logging cards, the assistant): no date after today (India time), and the
 *    closing value may not be below the opening value.
 * Batches (the month spreadsheet and the CSV imports) keep their own handling: the spreadsheet
 * saves the whole month including the days still to come, and an import may leave a closing blank.
 */
type Kind = 'diesel' | 'electricity' | 'water';

const NUMBERS: Record<Kind, string[]> = {
    diesel: ['opening_hours', 'closing_hours', 'opening_kwh', 'closing_kwh', 'opening_diesel_level', 'closing_diesel_level', 'diesel_added_litres'],
    electricity: ['opening_reading', 'closing_reading'],
    water: ['quantity'],
};
const PAIRS: Record<Kind, [string, string, string][]> = {
    diesel: [['opening_hours', 'closing_hours', 'run hours'], ['opening_kwh', 'closing_kwh', 'kWh']],
    electricity: [['opening_reading', 'closing_reading', 'meter reading']],
    water: [],
};

const given = (v: unknown) => v !== undefined && v !== null && v !== '';

/** Today's date in India time (the screens' "today"; never earlier than the UTC date they use). */
export function istToday(now = Date.now()): string {
    return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

/** A reason to refuse the readings, or null when they are fine. */
export function checkReadings(kind: Kind, rows: unknown[], now = Date.now()): string | null {
    if (!Array.isArray(rows) || !rows.length) return null;
    for (const raw of rows) {
        const r = (raw || {}) as Record<string, unknown>;
        for (const f of NUMBERS[kind]) {
            if (!given(r[f])) continue;
            const n = Number(r[f]);
            if (!Number.isFinite(n)) return `${f} must be a number`;
            if (n < 0) return `${f} cannot be negative`;
        }
    }
    if (rows.length === 1) {
        const r = (rows[0] || {}) as Record<string, unknown>;
        if (given(r.reading_date) && String(r.reading_date).slice(0, 10) > istToday(now)) return 'The reading date cannot be in the future';
        for (const [open, close, label] of PAIRS[kind]) {
            if (!given(r[open]) || !given(r[close])) continue;
            const o = Number(r[open]);
            const c = Number(r[close]);
            // A closing of 0 is how a blank field arrives; only a real value below the opening is refused.
            if (c > 0 && c < o) return `The closing ${label} (${c}) cannot be less than the opening (${o})`;
        }
    }
    return null;
}
