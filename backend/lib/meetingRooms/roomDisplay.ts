import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Owner 2026-11-24: the data behind the meeting-room door panels (ESP32-S3 7" screens, 1024x600).
 *
 * The panel hangs in a corridor with no signed-in user, so this is read through the service role.
 *
 * What it shows, as specified by the product owner on 2026-11-25 -- schedule information only:
 *
 *   - the NAME of whoever booked
 *   - their company, only when the booking actually has one
 *   - the booking `comment` ("Booked for XYZ"), which is often who the room is really for
 *
 * Deliberately NOT here: phone numbers (asked for, then dropped -- the panel is a schedule board,
 * not a contact directory), e-mail addresses, user ids and company ids.
 *
 * SECURITY NOTE: this feed is unauthenticated -- the room's id is the only credential -- so the
 * names and notes above are readable by anyone who learns that id, from anywhere, not only by
 * someone standing in the corridor. Before these panels roll out widely the endpoint should
 * require a per-device token; see the panel README.
 *
 * The same shaping feeds /api/public/room-display/[roomId] and the /display preview page, so the
 * firmware and the browser can never show different things.
 */

/** The working day the booking screens already assume (AdminBookingList: 08:00 - 20:00). */
export const DISPLAY_DAY_START_HOUR = 8;
export const DISPLAY_DAY_END_HOUR = 20;

/** How long the panel should wait before polling again. Firmware honours this. */
export const DISPLAY_POLL_SECONDS = 30;

/**
 * Gaps shorter than this are changeover time, not a bookable slot, so they are not advertised.
 * Without this the agenda fills with "Free, 10 min" rows nobody can use.
 */
const MIN_ADVERTISED_GAP_MIN = 20;

export interface DisplayBooking {
    /** "HH:MM", IST. */
    start: string;
    /** "HH:MM", IST. */
    end: string;
    /** Whoever booked it; "Reserved" when the name cannot be resolved. */
    booked_by: string;
    /** Tenant company — null when the booking has none, and then nothing is shown. */
    company: string | null;
    /** The note the booker typed, e.g. "Booked for XYZ". Null when they typed nothing. */
    comment: string | null;
    /** Minutes from midnight IST, so the firmware does not have to parse clock strings. */
    start_min: number;
    end_min: number;
}

/** One line of the day's agenda: either a booking or a bookable gap between bookings. */
export type AgendaRow =
    | (DisplayBooking & {
          kind: 'booking';
          /** 'done' past, 'now' running, 'next' the next one up, 'upcoming' after that. */
          state: 'done' | 'now' | 'next' | 'upcoming';
      })
    | {
          kind: 'free';
          start: string;
          end: string;
          start_min: number;
          end_min: number;
          /** Pre-formatted for the panel, e.g. "Free, 1 hr 30 min". */
          label: string;
      };

export interface RoomDisplayState {
    /** ISO instant the payload was built, so the panel can detect a stale cache. */
    server_time: string;
    /** Minutes from midnight IST at build time; the panel's own clock may be unset. */
    now_min: number;
    /** IST calendar date the schedule belongs to ("YYYY-MM-DD"). */
    date: string;
    /** Pre-formatted for the panel header, e.g. "Tuesday, 24 November". */
    date_label: string;
    room: {
        id: string;
        name: string;
        location: string | null;
        capacity: number | null;
        amenities: string[];
        property_name: string | null;
        /** "Floor 3 · Seats 12 · Display + VC", already joined for the panel. */
        meta_line: string;
    };
    /**
     * The other active rooms in the same property, for the header's room menu.
     *
     * Carried in this payload on purpose rather than served from a listing endpoint: you already
     * need a valid room id to get here, so this never lets anyone enumerate the estate from
     * nothing. Names and ids only.
     */
    property_rooms: { id: string; name: string }[];
    day: { start_hour: number; end_hour: number };
    /** 'busy' while a booking is running, otherwise 'free'. */
    state: 'free' | 'busy';
    /** The booking running right now, if any. */
    current: (DisplayBooking & { ends_in_min: number; elapsed_pct: number }) | null;
    /** The next booking still to start today, if any. */
    next: (DisplayBooking & { starts_in_min: number }) | null;
    /**
     * While free: minutes until the next booking starts, or until the day ends when nothing
     * follows. Null while busy.
     */
    free_for_min: number | null;
    /** Every non-cancelled booking for the day, in time order. */
    bookings: DisplayBooking[];
    /** Bookings and bookable gaps interleaved — what the panel actually lists. */
    agenda: AgendaRow[];
    poll_after_sec: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
    return UUID_RE.test(value);
}

/** "HH:MM" from a Postgres time ("HH:MM:SS" or "HH:MM"). */
function toHhMm(time: string): string {
    const [h = '0', m = '0'] = String(time).split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function toMinutes(time: string): number {
    const [h, m] = toHhMm(time).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
}

function fromMinutes(total: number): string {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 90 -> "1 hr 30 min", 30 -> "30 min". Matches the wording on the panel mock-up. */
export function humanDuration(total: number): string {
    const mins = Math.max(0, Math.round(total));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} hr`;
    return `${h} hr ${m} min`;
}

/** Today's date and wall-clock minute in IST, however the server itself is set. */
function istNow(): { date: string; nowMin: number; dateLabel: string } {
    const now = new Date();

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
    // en-GB gives hour "24" at midnight; fold it back to 0 so now_min stays in [0, 1439].
    const hour = Number(get('hour')) % 24;

    const dateLabel = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    }).format(now);

    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        nowMin: hour * 60 + Number(get('minute')),
        dateLabel,
    };
}

/** "Floor 3 · Seats 12 · Display + VC" from whatever the room actually has. */
export function buildMetaLine(
    location: string | null,
    capacity: number | null,
    amenities: string[]
): string {
    const bits: string[] = [];
    if (location) bits.push(location);
    if (capacity != null) bits.push(`Seats ${capacity}`);
    // Two amenities is all that fits on one line at panel type size.
    if (amenities.length > 0) bits.push(amenities.slice(0, 2).join(' + '));
    return bits.join(' · ');
}

/**
 * Interleaves bookings with the bookable gaps between them.
 *
 * Gaps are only worth printing when someone could still use them, so anything already finished,
 * or shorter than MIN_ADVERTISED_GAP_MIN, is left out.
 */
function buildAgenda(bookings: DisplayBooking[], nowMin: number): AgendaRow[] {
    const dayStart = DISPLAY_DAY_START_HOUR * 60;
    const dayEnd = DISPLAY_DAY_END_HOUR * 60;
    const rows: AgendaRow[] = [];

    const nextIdx = bookings.findIndex(b => b.start_min > nowMin);

    const pushGap = (from: number, to: number) => {
        const start = Math.max(from, dayStart);
        const end = Math.min(to, dayEnd);
        const len = end - start;
        if (len < MIN_ADVERTISED_GAP_MIN) return;
        // A gap that has already passed is not an offer.
        if (end <= nowMin) return;
        rows.push({
            kind: 'free',
            start: fromMinutes(start),
            end: fromMinutes(end),
            start_min: start,
            end_min: end,
            label: `Free, ${humanDuration(len)}`,
        });
    };

    let cursor = dayStart;

    bookings.forEach((b, i) => {
        pushGap(cursor, b.start_min);

        let state: 'done' | 'now' | 'next' | 'upcoming';
        if (b.end_min <= nowMin) state = 'done';
        else if (b.start_min <= nowMin) state = 'now';
        else if (i === nextIdx) state = 'next';
        else state = 'upcoming';

        rows.push({ ...b, kind: 'booking', state });
        cursor = Math.max(cursor, b.end_min);
    });

    // Whatever is left of the working day after the last booking.
    pushGap(cursor, dayEnd);

    return rows;
}

/**
 * Builds the panel payload for one room, or null when the room id is unknown.
 *
 * Read-only: nothing here writes, so a panel that is power-cycled or hammered by a retry loop
 * cannot change any booking.
 */
export async function getRoomDisplayState(roomId: string): Promise<RoomDisplayState | null> {
    if (!isUuid(roomId)) return null;

    /*
     * Two plain queries rather than a `properties(name)` embed.
     *
     * The embed made this whole endpoint 404 on rooms that plainly exist: PostgREST has to infer
     * the meeting_rooms -> properties relationship, and when it cannot the select errors and the
     * room reads as missing. Caught by calling the deployed endpoint with a room id the property
     * endpoint had just listed. Not worth re-introducing to save one round trip.
     */
    const { data: room, error: roomError } = await supabaseAdmin
        .from('meeting_rooms')
        .select('id, name, location, capacity, amenities, property_id')
        .eq('id', roomId)
        .maybeSingle();

    if (roomError) {
        console.error('[room-display] room lookup failed:', roomError);
        return null;
    }
    if (!room) return null;

    const { data: propertyRow } = await supabaseAdmin
        .from('properties')
        .select('name')
        .eq('id', room.property_id)
        .maybeSingle();

    const { date, nowMin, dateLabel } = istNow();

    const { data: rows, error: bookingError } = await supabaseAdmin
        .from('meeting_room_bookings')
        .select('id, start_time, end_time, status, user_id, company_id, comment')
        .eq('meeting_room_id', roomId)
        .eq('booking_date', date)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });

    if (bookingError) {
        // A room with an unreadable schedule is still worth showing as a room; the panel prints
        // the name and an empty day rather than going blank.
        console.error('[room-display] booking lookup failed:', bookingError);
    }

    // Siblings for the header's room menu. Active rooms only — a panel should not offer to show
    // a room that has been taken out of service.
    const { data: siblingRows } = await supabaseAdmin
        .from('meeting_rooms')
        .select('id, name')
        .eq('property_id', room.property_id)
        .eq('status', 'active')
        .order('name', { ascending: true });

    const propertyRooms = (siblingRows || []).map(r => ({ id: r.id, name: r.name }));

    const bookingRows = rows || [];

    // Resolve who booked each slot and which company they belong to.
    const companyIds = Array.from(new Set(bookingRows.map(b => b.company_id).filter(Boolean)));
    const userIds = Array.from(new Set(bookingRows.map(b => b.user_id).filter(Boolean)));

    const companyById = new Map<string, string>();
    const nameById = new Map<string, string>();

    const [companiesRes, usersRes] = await Promise.all([
        companyIds.length > 0
            ? supabaseAdmin.from('companies').select('id, name').in('id', companyIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        userIds.length > 0
            ? supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
            : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);

    for (const c of companiesRes.data || []) {
        if (c.name) companyById.set(c.id, c.name);
    }
    for (const u of usersRes.data || []) {
        if (u.full_name) nameById.set(u.id, u.full_name);
    }

    const bookings: DisplayBooking[] = bookingRows
        .map(b => {
            const start = toHhMm(b.start_time);
            const end = toHhMm(b.end_time);
            // An empty comment box comes back as '' rather than null; treat both as "no note".
            const comment = typeof b.comment === 'string' && b.comment.trim() ? b.comment.trim() : null;
            return {
                start,
                end,
                booked_by: nameById.get(b.user_id) || 'Reserved',
                company: (b.company_id ? companyById.get(b.company_id) : null) || null,
                comment,
                start_min: toMinutes(start),
                end_min: toMinutes(end),
            };
        })
        // A malformed time would otherwise sort to the front and be read as 00:00.
        .filter(b => Number.isFinite(b.start_min) && Number.isFinite(b.end_min))
        .sort((a, b) => a.start_min - b.start_min);

    const currentRaw = bookings.find(b => b.start_min <= nowMin && nowMin < b.end_min) || null;
    const nextRaw = bookings.find(b => b.start_min > nowMin) || null;

    let current: RoomDisplayState['current'] = null;
    if (currentRaw) {
        const span = currentRaw.end_min - currentRaw.start_min;
        current = {
            ...currentRaw,
            ends_in_min: currentRaw.end_min - nowMin,
            // Drives the progress bar. Guard the zero-length case rather than divide by it.
            elapsed_pct:
                span > 0
                    ? Math.min(100, Math.max(0, Math.round(((nowMin - currentRaw.start_min) / span) * 100)))
                    : 0,
        };
    }

    const next = nextRaw ? { ...nextRaw, starts_in_min: nextRaw.start_min - nowMin } : null;

    const dayEndMin = DISPLAY_DAY_END_HOUR * 60;
    let freeForMin: number | null = null;
    if (!current) {
        const until = next ? next.start_min : dayEndMin;
        // Past the end of the working day there is no "free for" window left to advertise.
        freeForMin = until > nowMin ? until - nowMin : null;
    }

    const amenities: string[] = Array.isArray(room.amenities)
        ? room.amenities.filter((a): a is string => typeof a === 'string')
        : [];

    return {
        server_time: new Date().toISOString(),
        now_min: nowMin,
        date,
        date_label: dateLabel,
        room: {
            id: room.id,
            name: room.name,
            location: room.location ?? null,
            capacity: room.capacity ?? null,
            amenities,
            property_name: propertyRow?.name ?? null,
            meta_line: buildMetaLine(room.location ?? null, room.capacity ?? null, amenities),
        },
        property_rooms: propertyRooms,
        day: { start_hour: DISPLAY_DAY_START_HOUR, end_hour: DISPLAY_DAY_END_HOUR },
        state: current ? 'busy' : 'free',
        current,
        next,
        free_for_min: freeForMin,
        bookings,
        agenda: buildAgenda(bookings, nowMin),
        poll_after_sec: DISPLAY_POLL_SECONDS,
    };
}
