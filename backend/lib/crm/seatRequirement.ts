/**
 * Seat requirement helpers.
 *
 * A seat requirement is free text as the rep typed it — "70 workstations and
 * 4 cabins", "50 seats", "2 cabins" — stored in `crm_leads.seats_detail`.
 * `crm_leads.seats` keeps the leading number so the seat-range filters, buckets
 * and reports that already depend on an integer keep working.
 */

/** First number in a seat requirement. "70 workstations and 4 cabins" -> 70. */
export function parseSeatCount(text: string | null | undefined): number | null {
    if (text == null) return null;
    const m = String(text).match(/\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return !isNaN(n) && n > 0 ? n : null;
}

/** Bucket label for a seat count, matching the seats_range filter options. */
export function seatBucket(count: number | null | undefined): string | null {
    if (count == null || count <= 0) return null;
    return count < 25 ? '<25' : count <= 50 ? '25–50' : count <= 100 ? '50–100' : '100+';
}

/** What to show for a lead's seat requirement: the typed text, else the number. */
export function seatRequirementText(lead: { seats_detail?: string | null; seats?: number | null }): string | null {
    const detail = (lead.seats_detail || '').trim();
    if (detail) return detail;
    return lead.seats != null ? String(lead.seats) : null;
}

/**
 * True when PostgREST rejected a write because `column` does not exist on the
 * table yet (undefined_column, 42703). `seats_detail` ships with a migration the
 * team runs by hand, so writes retry without it instead of failing the save.
 */
export function isMissingColumnError(
    error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
    column: string
): boolean {
    if (!error) return false;
    const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
    return error.code === '42703' || (msg.includes(column) && /does not exist|could not find/i.test(msg));
}
