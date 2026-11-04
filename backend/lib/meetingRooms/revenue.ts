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

/** Client or internal, for one booking. Internal-team roles win over company and tenant. */
export function classifyBooker(
    booking: Pick<RevenueBooking, 'user_id' | 'company_id'>,
    internalUserIds: Set<string>,
    tenantUserIds: Set<string>,
): RevenueCategory {
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
        if (view === 'all') return true;
        const category = classifyBooker(b, input.internalUserIds, input.tenantUserIds);
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

        const line: RevenueBookingLine = {
            bookingId: b.id,
            date: b.booking_date,
            startTime: b.start_time.slice(0, 5),
            endTime: b.end_time.slice(0, 5),
            roomId: b.meeting_room_id,
            roomName: room.roomName,
            bookedBy,
            hours: round2(hours),
            hourlyRate: rate,
            creditHours: 0, exceededHours: 0, creditValue: 0, exceededRevenue: 0, totalValue: 0,
        };

        room.bookingCount += 1;
        room.bookedHours += hours;

        if (classifyBooker(b, input.internalUserIds, input.tenantUserIds) === 'internal') {
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

        const key = b.company_id ? `company:${b.company_id}` : `user:${b.user_id || 'unknown'}`;
        let client = clients.get(key);
        if (!client) {
            const allowance = b.company_id ? companyCredit.get(b.company_id) : (b.user_id ? userCredit.get(b.user_id) : undefined);
            client = {
                key,
                category: 'client',
                type: b.company_id ? 'company' : 'individual',
                name: b.company_id ? (input.companyNames[b.company_id] || 'Unknown company') : bookedBy,
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
