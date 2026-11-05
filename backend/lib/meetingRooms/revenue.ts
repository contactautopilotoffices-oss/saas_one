/**
 * Meeting room revenue for one property and one month.
 *
 * Pure calculation, no database access, so it can be unit tested on its own.
 * The API route (app/api/meeting-rooms/revenue) loads the rows and calls buildRevenueReport.
 *
 * How hours are split for each client (a company, or an individual booker with no company):
 *   - The client's free allowance is the monthly_hours on their meeting_room_credits record.
 *   - Their confirmed bookings in the month are taken in date and time order.
 *   - Hours are drawn from the allowance first ("credit hours"). Once it is used up, every
 *     further hour is an "exceeded hour", which is the billable part.
 *   - A client with no credit record has no allowance, so all their hours are exceeded hours.
 *
 * Who counts as a client (see classifyBooker):
 *   - Internal: internal teams (HR, CRM/BD, IT, Design), whose bookings are free by policy,
 *     and anyone who is neither in a company nor a tenant (staff, admins and so on).
 *     Internal hours are shown per person but are never revenue.
 *   - Client: a booking linked to a company, or a booker with a tenant role at the property.
 *
 * The view picks which bookings the report covers: 'clients' (the default), 'internal' or 'all'.
 *
 * Money for each hour is that room's hourly_rate, so the same client can have hours at
 * different prices in one month. A room with no rate set is valued at 0 and listed in
 * roomsWithoutRate so the sheet can flag it.
 */

export interface RevenueRoom {
    id: string;
    name: string;
    hourly_rate: number | string | null;
}

export interface RevenueBooking {
    id: string;
    meeting_room_id: string;
    user_id: string | null;
    company_id: string | null;
    booking_date: string; // YYYY-MM-DD
    start_time: string; // HH:MM or HH:MM:SS
    end_time: string;
    comment?: string | null;
}

export interface RevenueCompany {
    id: string;
    name: string;
}

export interface RevenueCredit {
    company_id: string | null;
    user_id: string | null;
    monthly_hours: number | string | null;
}

export type RevenueView = 'clients' | 'internal' | 'all';
export type RevenueCategory = 'client' | 'internal';

export interface RevenueInput {
    rooms: RevenueRoom[];
    bookings: RevenueBooking[];
    credits: RevenueCredit[];
    companies?: RevenueCompany[];
    companyNames: Record<string, string>;
    userNames: Record<string, string>;
    /** user_ids whose bookings are free by policy (HR, CRM/BD, IT, Design). */
    internalUserIds: Set<string>;
    /** user_ids with a tenant role (tenant, super_tenant) at the property. */
    tenantUserIds: Set<string>;
    view?: RevenueView;
}

export interface RevenueBookingLine {
    bookingId: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId: string;
    roomName: string;
    bookedBy: string;
    comment: string | null;
    clientMatchedFromNote?: boolean;
    hours: number;
    hourlyRate: number;
    creditHours: number;
    exceededHours: number;
    creditValue: number;
    exceededRevenue: number;
    totalValue: number;
}

export interface RevenueClient {
    key: string;
    category: RevenueCategory;
    type: 'company' | 'individual';
    name: string;
    hasCreditPlan: boolean;
    monthlyCreditHours: number;
    bookingCount: number;
    bookedHours: number;
    creditHours: number;
    exceededHours: number;
    internalHours: number;
    unusedCreditHours: number;
    creditValue: number;
    exceededRevenue: number;
    totalValue: number;
    bookings: RevenueBookingLine[];
}

export interface RevenueRoomTotals {
    roomId: string;
    roomName: string;
    hourlyRate: number;
    rateSet: boolean;
    bookingCount: number;
    bookedHours: number;
    creditHours: number;
    exceededHours: number;
    internalHours: number;
    creditValue: number;
    exceededRevenue: number;
    totalValue: number;
}

export interface RevenueTotals {
    bookingCount: number;
    bookedHours: number;
    creditHours: number;
    exceededHours: number;
    internalHours: number;
    creditValue: number;
    exceededRevenue: number;
    totalValue: number;
}

export interface RevenueReport {
    view: RevenueView;
    totals: RevenueTotals;
    clients: RevenueClient[];
    rooms: RevenueRoomTotals[];
    internal: { bookingCount: number; hours: number; bookings: RevenueBookingLine[] };
    roomsWithoutRate: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const toNumber = (v: number | string | null | undefined): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const minutesOf = (time: string): number => {
    const [h, m] = String(time).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

/** Booked hours for one booking. Never negative. */
export function bookingHours(startTime: string, endTime: string): number {
    return Math.max(0, minutesOf(endTime) - minutesOf(startTime)) / 60;
}

/** First and last calendar day of a YYYY-MM month, or null when the input is not a valid month. */
export function monthRange(month: string): { start: string; end: string } | null {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
    if (!match) return null;
    const year = Number(match[1]);
    const mon = Number(match[2]);
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

const GENERIC_NOTE_WORDS = new Set([
    'test', 'demo', 'sample', 'company', 'office', 'offices', 'group', 'team',
    'meeting', 'room', 'booked', 'for', 'the', 'and', 'with', 'via', 'client',
    'clients', 'director', 'directors', 'staff', 'internal', 'requested', 'discussion',
]);

export function cleanNoteString(str: string): string {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches a booking comment/note against registered property companies.
 * Internal staff (e.g. Meena Chavan, Nilesh Mane) frequently book for clients
 * and record the client name in the comment (e.g. "booked for light years",
 * "Booked for Lightyear", "Bliss net", "Bhavik Onads").
 */
export function matchCompanyFromNote(
    comment: string | null | undefined,
    companies: { id: string; name: string }[],
): { id: string; name: string } | null {
    if (!comment || !companies || companies.length === 0) return null;
    const cleanComment = cleanNoteString(comment);
    if (!cleanComment) return null;

    // Prefer more specific (longer) names first
    const sorted = [...companies].sort((a, b) => cleanNoteString(b.name).length - cleanNoteString(a.name).length);

    for (const comp of sorted) {
        const cleanComp = cleanNoteString(comp.name);
        if (!cleanComp || cleanComp.length < 3) continue;

        // Skip generic "test company" matching "testing booking" unless explicitly "testcompany"
        if (cleanComp === 'testcompany') {
            if (cleanComment.includes('testcompany')) return comp;
            continue;
        }

        // 1. Direct normalized substring match
        if (cleanComment.includes(cleanComp)) {
            return comp;
        }

        // 2. Singular / plural stem match (e.g. "lightyears" vs "lightyear")
        if (cleanComp.endsWith('s') && cleanComp.length > 4 && cleanComment.includes(cleanComp.slice(0, -1))) {
            return comp;
        }
        if (cleanComment.endsWith('s') && cleanComp.length > 4 && cleanComp.includes(cleanComment.slice(0, -1))) {
            return comp;
        }

        // 3. Match on distinctive company words (min 4 chars)
        const compWords = comp.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const distinctiveCompWords = compWords.filter(w => !GENERIC_NOTE_WORDS.has(w) && w.length >= 3);

        for (const w of distinctiveCompWords) {
            if (w.length >= 4) {
                if (cleanComment.includes(w)) return comp;
                if (w.endsWith('s') && cleanComment.includes(w.slice(0, -1))) return comp;
            }
        }

        // Check if distinctive words in comment match distinctive parts of company
        const commentWords = comment.toLowerCase().split(/[^a-z0-9]+/).filter(w => !GENERIC_NOTE_WORDS.has(w) && w.length >= 4);
        for (const cw of commentWords) {
            if (cleanComp.includes(cw)) return comp;
            if (cw.endsWith('s') && cleanComp.includes(cw.slice(0, -1))) return comp;
        }
    }
    return null;
}

/** Client or internal, for one booking. If staff booked on behalf of a matched company, it is a client booking. */
export function classifyBooker(
    booking: Pick<RevenueBooking, 'user_id' | 'company_id'>,
    internalUserIds: Set<string>,
    tenantUserIds: Set<string>,
    matchedCompanyId?: string | null,
): RevenueCategory {
    // If staff booked on behalf of a client and the company was resolved from notes, it counts as client revenue.
    if (matchedCompanyId) return 'client';
    // Same rule as the booking API: an internal-team booker never draws credits, company or not.
    if (booking.user_id && internalUserIds.has(booking.user_id)) return 'internal';
    if (booking.company_id) return 'client';
    if (booking.user_id && tenantUserIds.has(booking.user_id)) return 'client';
    return 'internal';
}

export function buildRevenueReport(input: RevenueInput): RevenueReport {
    const view: RevenueView = input.view || 'clients';
    const roomById = new Map(input.rooms.map(r => [r.id, r]));

    const companyCredit = new Map<string, number>();
    const userCredit = new Map<string, number>();
    for (const c of input.credits) {
        if (c.company_id) companyCredit.set(c.company_id, toNumber(c.monthly_hours));
        else if (c.user_id) userCredit.set(c.user_id, toNumber(c.monthly_hours));
    }

    const roomTotals = new Map<string, RevenueRoomTotals>();
    const roomTotalsFor = (roomId: string): RevenueRoomTotals => {
        let t = roomTotals.get(roomId);
        if (!t) {
            const room = roomById.get(roomId);
            const rate = toNumber(room?.hourly_rate);
            t = {
                roomId,
                roomName: room?.name || 'Unknown room',
                hourlyRate: rate,
                rateSet: room?.hourly_rate !== null && room?.hourly_rate !== undefined && room?.hourly_rate !== '',
                bookingCount: 0, bookedHours: 0, creditHours: 0, exceededHours: 0, internalHours: 0,
                creditValue: 0, exceededRevenue: 0, totalValue: 0,
            };
            roomTotals.set(roomId, t);
        }
        return t;
    };
    // Every room appears in the room sheet, even with no bookings this month.
    for (const room of input.rooms) roomTotalsFor(room.id);

    const inView = input.bookings.filter(b => {
        const matched = !b.company_id && b.comment ? matchCompanyFromNote(b.comment, input.companies || []) : null;
        const category = classifyBooker(b, input.internalUserIds, input.tenantUserIds, matched?.id);
        if (view === 'all') return true;
        return view === 'clients' ? category === 'client' : category === 'internal';
    });

    const sorted = [...inView].sort((a, b) =>
        a.booking_date.localeCompare(b.booking_date)
        || minutesOf(a.start_time) - minutesOf(b.start_time)
        || a.id.localeCompare(b.id));

    const clients = new Map<string, RevenueClient & { remaining: number }>();
    const internal = { bookingCount: 0, hours: 0, bookings: [] as RevenueBookingLine[] };

    for (const b of sorted) {
        const hours = bookingHours(b.start_time, b.end_time);
        const room = roomTotalsFor(b.meeting_room_id);
        const rate = room.hourlyRate;
        const bookedBy = (b.user_id && input.userNames[b.user_id]) || 'Unknown user';
        const matchedCompany = !b.company_id && b.comment ? matchCompanyFromNote(b.comment, input.companies || []) : null;
        const effectiveCompanyId = b.company_id || matchedCompany?.id || null;
        const clientMatchedFromNote = !b.company_id && !!matchedCompany;

        const line: RevenueBookingLine = {
            bookingId: b.id,
            date: b.booking_date,
            startTime: b.start_time.slice(0, 5),
            endTime: b.end_time.slice(0, 5),
            roomId: b.meeting_room_id,
            roomName: room.roomName,
            bookedBy,
            comment: b.comment || null,
            clientMatchedFromNote,
            hours: round2(hours),
            hourlyRate: rate,
            creditHours: 0, exceededHours: 0, creditValue: 0, exceededRevenue: 0, totalValue: 0,
        };

        room.bookingCount += 1;
        room.bookedHours += hours;

        const category = classifyBooker(b, input.internalUserIds, input.tenantUserIds, matchedCompany?.id);
        if (category === 'internal') {
            internal.bookingCount += 1;
            internal.hours += hours;
            internal.bookings.push(line);
            room.internalHours += hours;

            const key = `internal:${b.user_id || 'unknown'}`;
            let person = clients.get(key);
            if (!person) {
                person = {
                    key, category: 'internal', type: 'individual', name: bookedBy,
                    hasCreditPlan: false, monthlyCreditHours: 0,
                    bookingCount: 0, bookedHours: 0, creditHours: 0, exceededHours: 0, internalHours: 0,
                    unusedCreditHours: 0, creditValue: 0, exceededRevenue: 0, totalValue: 0,
                    bookings: [], remaining: 0,
                };
                clients.set(key, person);
            }
            person.bookingCount += 1;
            person.bookedHours += hours;
            person.internalHours += hours;
            person.bookings.push(line);
            continue;
        }

        const key = effectiveCompanyId ? `company:${effectiveCompanyId}` : `user:${b.user_id || 'unknown'}`;
        let client = clients.get(key);
        if (!client) {
            const allowance = effectiveCompanyId ? companyCredit.get(effectiveCompanyId) : (b.user_id ? userCredit.get(b.user_id) : undefined);
            client = {
                key,
                category: 'client',
                type: effectiveCompanyId ? 'company' : 'individual',
                name: effectiveCompanyId ? (input.companyNames[effectiveCompanyId] || matchedCompany?.name || 'Unknown company') : bookedBy,
                hasCreditPlan: allowance !== undefined,
                monthlyCreditHours: allowance ?? 0,
                bookingCount: 0, bookedHours: 0, creditHours: 0, exceededHours: 0, internalHours: 0,
                unusedCreditHours: 0, creditValue: 0, exceededRevenue: 0, totalValue: 0,
                bookings: [],
                remaining: allowance ?? 0,
            };
            clients.set(key, client);
        }

        const fromCredit = Math.min(hours, Math.max(0, client.remaining));
        const exceeded = hours - fromCredit;
        client.remaining -= fromCredit;

        line.creditHours = round2(fromCredit);
        line.exceededHours = round2(exceeded);
        line.creditValue = round2(fromCredit * rate);
        line.exceededRevenue = round2(exceeded * rate);
        line.totalValue = round2(hours * rate);

        client.bookingCount += 1;
        client.bookedHours += hours;
        client.creditHours += fromCredit;
        client.exceededHours += exceeded;
        client.creditValue += fromCredit * rate;
        client.exceededRevenue += exceeded * rate;
        client.totalValue += hours * rate;
        client.bookings.push(line);

        room.creditHours += fromCredit;
        room.exceededHours += exceeded;
        room.creditValue += fromCredit * rate;
        room.exceededRevenue += exceeded * rate;
        room.totalValue += hours * rate;
    }

    const clientList: RevenueClient[] = Array.from(clients.values()).map(({ remaining, ...c }) => ({
        ...c,
        bookedHours: round2(c.bookedHours),
        creditHours: round2(c.creditHours),
        exceededHours: round2(c.exceededHours),
        internalHours: round2(c.internalHours),
        unusedCreditHours: round2(Math.max(0, remaining)),
        creditValue: round2(c.creditValue),
        exceededRevenue: round2(c.exceededRevenue),
        totalValue: round2(c.totalValue),
    }));
    // Clients before internal people, then biggest billable amount, total value, hours, name.
    clientList.sort((a, b) =>
        (a.category === b.category ? 0 : a.category === 'client' ? -1 : 1)
        || b.exceededRevenue - a.exceededRevenue || b.totalValue - a.totalValue
        || b.bookedHours - a.bookedHours || a.name.localeCompare(b.name));

    const roomList: RevenueRoomTotals[] = Array.from(roomTotals.values()).map(r => ({
        ...r,
        bookedHours: round2(r.bookedHours),
        creditHours: round2(r.creditHours),
        exceededHours: round2(r.exceededHours),
        internalHours: round2(r.internalHours),
        creditValue: round2(r.creditValue),
        exceededRevenue: round2(r.exceededRevenue),
        totalValue: round2(r.totalValue),
    }));
    roomList.sort((a, b) => b.totalValue - a.totalValue || b.bookedHours - a.bookedHours || a.roomName.localeCompare(b.roomName));

    // bookedHours = creditHours + exceededHours + internalHours, for every row and the totals.
    const totals: RevenueTotals = {
        bookingCount: clientList.reduce((s, c) => s + c.bookingCount, 0),
        bookedHours: round2(clientList.reduce((s, c) => s + c.bookedHours, 0)),
        creditHours: round2(clientList.reduce((s, c) => s + c.creditHours, 0)),
        exceededHours: round2(clientList.reduce((s, c) => s + c.exceededHours, 0)),
        internalHours: round2(internal.hours),
        creditValue: round2(clientList.reduce((s, c) => s + c.creditValue, 0)),
        exceededRevenue: round2(clientList.reduce((s, c) => s + c.exceededRevenue, 0)),
        totalValue: round2(clientList.reduce((s, c) => s + c.totalValue, 0)),
    };

    const roomsWithoutRate = roomList.filter(r => !r.rateSet && (r.bookedHours > 0 || r.internalHours > 0)).map(r => r.roomName);

    return {
        view,
        totals,
        clients: clientList,
        rooms: roomList,
        internal: { bookingCount: internal.bookingCount, hours: round2(internal.hours), bookings: internal.bookings },
        roomsWithoutRate,
    };
}
