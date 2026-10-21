/**
 * Date ranges for the task screens (owner 2026-10-15): every screen can show several days at once, at most 31 days.
 * `from` / `to` are YYYY-MM-DD and inclusive. A request with only `date` is the old single day, exactly as before.
 */

export const MAX_RANGE_DAYS = 31;
/** Owner 2026-10-15: "All time" = from this day to today. The only range allowed to be longer than 31 days. */
export const ALL_TIME_FROM = '2000-01-01';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (s: string | null | undefined): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const addDaysIso = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export type RangeResult = { ok: true; from: string; to: string } | { ok: false; error: string };

/** Read `from` / `to` (or the old `date`) from a request. Bad or too-long ranges are refused with a plain message. */
export function parseRange(params: { get(name: string): string | null }, today = new Date().toISOString().slice(0, 10)): RangeResult {
    const date = params.get('date');
    const from = params.get('from') || date || today;
    const to = params.get('to') || params.get('from') || date || today;
    if (!valid(from) || !valid(to)) return { ok: false, error: 'Dates must look like 2026-10-15.' };
    if (from > to) return { ok: false, error: 'The start date must be on or before the end date.' };
    if (from !== ALL_TIME_FROM && spanDays(from, to) > MAX_RANGE_DAYS) return { ok: false, error: `Choose at most ${MAX_RANGE_DAYS} days at a time, or "All time".` };
    return { ok: true, from, to };
}
