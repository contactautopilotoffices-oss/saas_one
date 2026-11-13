/**
 * Who is on shift at a property right now, from the roster (staff_rosters + shift_configurations).
 *
 * Used by ticket assignment (backend/lib/ticketing/assignment.ts) and by the ticket call (a person the
 * roster puts off shift is not phoned). Read-only.
 *
 * Rules:
 * - A roster entry is a date plus a shift; the shift holds start and end times, in the property's
 *   local time. Properties have no timezone column yet, so India time (Asia/Kolkata) is used.
 * - A shift whose end is at or before its start crosses midnight (e.g. 22:00 to 06:00): it covers the
 *   rest of its own date and the start of the next date. So yesterday's entries are read too.
 * - Week off, leave, or a shift with no times (is_working_day false, or no start/end) is not on shift.
 * - A property "uses the roster" when it has any entry from yesterday to tomorrow. A property that
 *   does not use it gets the old assignment method.
 */

const PROPERTY_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RosterSnapshot {
    /** The property has roster entries around today, so the roster decides who is on shift. */
    inUse: boolean;
    /** Users on shift right now. */
    onShift: Set<string>;
    /** Users with any roster entry today or yesterday (on shift or not). */
    rostered: Set<string>;
    /** For users not on shift now: when their next shift in the coming 24 hours starts. */
    nextShiftStart: Map<string, Date>;
}

const EMPTY: RosterSnapshot = { inUse: false, onShift: new Set(), rostered: new Set(), nextShiftStart: new Map() };

/** Local calendar date (YYYY-MM-DD) and minutes since local midnight, for `at` in the property's time zone. */
function localParts(at: Date): { date: string; minutes: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: PROPERTY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMinutes(time: string | null | undefined): number | null {
    if (!time) return null;
    const [h, m] = time.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/** Real instant of local `date` + `minutes` (India has no daylight saving, so a fixed +05:30 is exact). */
function localInstant(date: string, minutes: number): Date {
    const base = new Date(`${date}T00:00:00+05:30`).getTime();
    return new Date(base + minutes * 60 * 1000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers pass either Supabase client type
export async function getRosterSnapshot(client: any, propertyId: string, at: Date = new Date()): Promise<RosterSnapshot> {
    try {
        const today = localParts(at).date;
        const yesterday = localParts(new Date(at.getTime() - DAY_MS)).date;
        const tomorrow = localParts(new Date(at.getTime() + DAY_MS)).date;

        const { data: rows, error } = await client
            .from('staff_rosters')
            .select('user_id, roster_date, shift:shift_configurations(start_time, end_time, is_working_day)')
            .eq('property_id', propertyId)
            .in('roster_date', [yesterday, today, tomorrow]);
        if (error) {
            console.error('[Roster] Could not read roster:', error.message);
            return EMPTY;
        }
        if (!rows || rows.length === 0) return EMPTY;

        const now = at.getTime();
        const snapshot: RosterSnapshot = { inUse: true, onShift: new Set(), rostered: new Set(), nextShiftStart: new Map() };

        type Shift = { start_time: string | null; end_time: string | null; is_working_day: boolean | null };
        type Row = { user_id: string; roster_date: string; shift: Shift | Shift[] | null };
        for (const row of rows as Row[]) {
            const userId = String(row.user_id);
            const shift = Array.isArray(row.shift) ? row.shift[0] : row.shift;
            if (row.roster_date !== tomorrow) snapshot.rostered.add(userId);
            if (!shift || shift.is_working_day === false) continue;
            const start = toMinutes(shift.start_time);
            const end = toMinutes(shift.end_time);
            if (start === null || end === null || start === end) continue;

            const startAt = localInstant(row.roster_date, start).getTime();
            // Overnight shift: the end falls on the next date.
            const endAt = localInstant(row.roster_date, end).getTime() + (end <= start ? DAY_MS : 0);

            if (startAt <= now && now < endAt) {
                snapshot.onShift.add(userId);
            } else if (startAt > now && startAt - now <= DAY_MS) {
                const known = snapshot.nextShiftStart.get(userId);
                if (!known || startAt < known.getTime()) snapshot.nextShiftStart.set(userId, new Date(startAt));
            }
        }

        for (const userId of snapshot.onShift) snapshot.nextShiftStart.delete(userId);
        return snapshot;
    } catch (err) {
        console.error('[Roster] Snapshot failed:', err);
        return EMPTY;
    }
}

/**
 * True when the roster says this person is off shift right now: the property uses the roster, the
 * person is on it today or yesterday, and none of their shifts covers this moment. People who are not
 * on the roster at all (e.g. a property manager) are never "off shift".
 */
export function isRosteredOff(snapshot: RosterSnapshot, userId: string): boolean {
    return snapshot.inUse && snapshot.rostered.has(userId) && !snapshot.onShift.has(userId);
}
