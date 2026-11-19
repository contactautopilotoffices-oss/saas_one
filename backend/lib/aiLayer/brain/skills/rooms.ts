/**
 * Meeting room skills. Availability is read here; the booking itself goes through the same database function the
 * WhatsApp assistant already uses, which checks access, credits and the slot again inside one transaction.
 */
import { z } from 'zod';
import { istDate } from '../../dates';
import { bt } from '../text';
import type { BookingRow, ReadSkill, RoomRow, SkillContext, WriteSkill } from '../types';
import { checkWindow, clip, dayLabel, nullableStr, pickProperty, schema, scopeProperties, str, type PropertyPick } from './common';

// ── Which property, for rooms (2026-11-18) ───────────────────────────────────────────────────────────────────────
// The owner's chat: a person with one property that has no rooms was told "no rooms" three times, and a person with
// 22 properties would be asked to pick from 12 names, most without rooms. For rooms, only properties that HAVE rooms
// are offered, and when exactly one has rooms it is used without asking.

const MAX_SCAN = 30;

/** The person's properties that have at least one active meeting room (at most 30 looked at). */
async function propertiesWithRooms(ctx: SkillContext): Promise<string[]> {
    const ids = ctx.actor.propertyIds.slice(0, MAX_SCAN);
    const counts = await Promise.all(ids.map(id => ctx.data.listRooms(id).then(r => r.length).catch(() => 0)));
    return ids.filter((_, i) => counts[i] > 0);
}

async function roomProperty(ctx: SkillContext, name: string | null | undefined): Promise<PropertyPick> {
    const picked = pickProperty(ctx, name);
    if (picked.ok || (name && name.trim())) return picked;
    const withRooms = await propertiesWithRooms(ctx);
    if (withRooms.length === 1) return { ok: true, propertyId: withRooms[0] };
    if (!withRooms.length) return { ok: false, problem: 'None of this person\'s properties has meeting rooms set up in the app. Say so plainly and suggest they ask their property team; do not ask which property.' };
    return { ok: false, problem: `MISSING property. Call ask_user with the question "Which property?" and these options (the person's properties that have meeting rooms): ${withRooms.slice(0, 8).map(id => ctx.actor.propertyNames[id]).join(' | ')}` };
}

/** "X has no meeting rooms set up", plus where the person CAN book, so the answer is not a dead end. */
async function noRoomsAt(ctx: SkillContext, propertyId: string): Promise<{ text: string; display: string }> {
    const name = ctx.actor.propertyNames[propertyId];
    const elsewhere = (await propertiesWithRooms(ctx)).filter(id => id !== propertyId).map(id => ctx.actor.propertyNames[id]);
    const en = `${name} has no meeting rooms set up in the app.${elsewhere.length ? ` Your properties that have rooms: ${elsewhere.slice(0, 8).join(', ')}.` : ' Your property team can tell you about other options.'}`;
    const hn = `${name} mein app par koi meeting room set up nahi hai.${elsewhere.length ? ` Aapki properties jahan rooms hain: ${elsewhere.slice(0, 8).join(', ')}.` : ' Aapki property team doosre options bata sakti hai.'}`;
    return { text: en, display: ctx.lang === 'en' ? en : hn };
}

const roomLine = (r: RoomRow) => `${r.name}${r.capacity ? `, seats ${r.capacity}` : ''}${r.location ? `, ${clip(r.location, 40)}` : ''}`;

/** Consecutive free slots joined into windows: 10:00-11:00 + 11:00-12:00 = 10:00 to 12:00. */
export function freeWindows(slots: Array<{ start: string; end: string }>): Array<{ start: string; end: string }> {
    const out: Array<{ start: string; end: string }> = [];
    for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
        const last = out.at(-1);
        if (last && last.end === s.start) last.end = s.end; else out.push({ ...s });
    }
    return out;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// ── rooms.availability ─────────────────────────────────────────────────────────────────────────────────────────────

const availabilityArgs = z.object({ property: z.string().trim().max(120).nullish(), date: z.string().trim().max(12), start_time: z.string().trim().max(6), end_time: z.string().trim().max(6) }).strip();

export const roomsAvailabilitySkill: ReadSkill<z.infer<typeof availabilityArgs>> = {
    id: 'rooms.availability', module: 'rooms', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Which meeting rooms at one property are free for ONE date and time window. Each free room gets a handle (R1, R2…) for room_book. Use for "is the 4th floor room free at 4", "any room tomorrow 10 to 11", and BEFORE proposing a booking. Work out the date from "today" in the context. If the person gave no end time, assume one hour. A bare hour from 1 to 7 ("at 4") means the afternoon (16:00). Do NOT use when they ask WHEN a room is free or for the next free time (use rooms_free_slots), or to see their existing bookings (use rooms_my_bookings).',
    input: schema({
        property: nullableStr('The property name as the person said it, or null. Example: "Andheri".'),
        date: str('The date as YYYY-MM-DD. Example: "2026-11-14".'),
        start_time: str('Start in 24-hour HH:MM. Example: "16:00".'),
        end_time: str('End in 24-hour HH:MM. Example: "17:00".'),
    }),
    args: availabilityArgs,
    examples: ['is any meeting room free at 4 today', 'kal 10 se 11 koi room khali hai', 'rooms available tomorrow afternoon at Lower Parel'],
    ability: { en: 'check free meeting rooms', hi: 'खाली मीटिंग रूम देखना', hinglish: 'free meeting rooms dekhna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async run(ctx, a) {
        const bad = checkWindow(ctx.now, a.date, a.start_time, a.end_time);
        if (bad) return { text: `Cannot check: ${bad}.` };
        const prop = await roomProperty(ctx, a.property);
        if (!prop.ok) return { text: prop.problem };
        const [all, free] = await Promise.all([ctx.data.listRooms(prop.propertyId), ctx.data.availableRooms(prop.propertyId, a.date, a.start_time, a.end_time)]);
        const name = ctx.actor.propertyNames[prop.propertyId];
        const when = `${dayLabel(a.date)} (${a.date}), ${a.start_time} to ${a.end_time}`;
        if (!all.length) return noRoomsAt(ctx, prop.propertyId);
        if (!free.length) return { text: `No room is free at ${name} on ${when}. Rooms there: ${all.map(r => r.name).join(', ')}.`, display: ctx.lang === 'en' ? `No room is free at ${name} on ${when}.` : `${name} mein ${when} koi room free nahi hai.` };
        const lines = free.map(r => `${ctx.handle('room', r.id, r.name, r.propertyId)} | ${r.name}`);
        return {
            text: `Free at ${name} on ${when}:\n${lines.join('\n')}`,
            display: `${ctx.lang === 'en' ? `Free at ${name} on ${when}:` : `${name}, ${when} free rooms:`}\n${free.map(r => `• ${r.name}`).join('\n')}`,
        };
    },
};

// ── rooms.my_bookings ──────────────────────────────────────────────────────────────────────────────────────────────

const bookingsArgs = z.object({ property: z.string().trim().max(120).nullish() }).strip();

export const roomsMyBookingsSkill: ReadSkill<z.infer<typeof bookingsArgs>> = {
    id: 'rooms.my_bookings', module: 'rooms', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The person\'s own meeting room bookings from the last 14 days onward (past and upcoming), newest first. Use for "my bookings", "which room did I book yesterday", "book the same room as last time" (read this first, then check availability), and BEFORE room_cancel or room_move to get the booking\'s B handle. Do NOT use to see other people\'s bookings (not available).',
    input: schema({ property: nullableStr('The property name as the person said it, or null for all. Example: null.') }),
    args: bookingsArgs,
    examples: ['what have I booked this week', 'meri bookings dikhao', 'which room did I have yesterday'],
    ability: { en: 'see my room bookings', hi: 'मेरी रूम बुकिंग देखना', hinglish: 'meri room bookings dekhna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async run(ctx, a) {
        const scope = scopeProperties(ctx, a.property);
        if (!scope.ok) return { text: scope.problem };
        const from = istDate(new Date(ctx.now.getTime() - 14 * 86_400_000));
        const rows = (await ctx.data.myBookings(ctx.actor.userId, scope.propertyIds, from)).slice(0, 10);
        if (!rows.length) return { text: 'This person has no bookings in the last 14 days or ahead.', display: ctx.lang === 'en' ? 'You have no recent or upcoming room bookings.' : 'Aapki koi recent ya upcoming room booking nahi hai.' };
        const line = (r: typeof rows[number]) => `${r.roomName} | ${ctx.actor.propertyNames[r.propertyId] ?? ''} | ${r.date} ${r.startTime.slice(0, 5)}-${r.endTime.slice(0, 5)} | ${r.status}`;
        return {
            text: `Bookings (newest first):\n${rows.map(r => `${ctx.handle('booking', r.id, `${r.roomName} ${r.date}`, r.propertyId)} | ${line(r)}`).join('\n')}`,
            display: rows.map(r => `• ${r.roomName}, ${dayLabel(r.date)} ${r.startTime.slice(0, 5)} to ${r.endTime.slice(0, 5)} (${r.status})`).join('\n'),
        };
    },
};

// ── room.book ──────────────────────────────────────────────────────────────────────────────────────────────────────

const bookArgs = z.object({
    room: z.string().trim().min(1).max(120), property: z.string().trim().max(120).nullish(),
    date: z.string().trim().max(12), start_time: z.string().trim().max(6), end_time: z.string().trim().max(6), purpose: z.string().trim().max(200).nullish(),
}).strip();
const bookPayload = z.object({ propertyId: z.string().uuid(), roomId: z.string().uuid(), roomName: z.string().max(120), date: day, startTime: hm, endTime: hm, purpose: z.string().max(200).nullable() }).strict();

async function findRoom(ctx: SkillContext, ref: string, propertyName: string | null | undefined): Promise<{ ok: true; room: RoomRow } | { ok: false; problem: string }> {
    const fromHandle = ctx.resolve(ref, 'room');
    if (fromHandle?.propertyId && ctx.actor.propertyIds.includes(fromHandle.propertyId)) return { ok: true, room: { id: fromHandle.id, name: fromHandle.label, propertyId: fromHandle.propertyId } };
    const prop = await roomProperty(ctx, propertyName);
    if (!prop.ok) return prop;
    const rooms = await ctx.data.listRooms(prop.propertyId);
    const want = ref.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hits = rooms.filter(r => norm(r.name) === want);
    const loose = hits.length ? hits : rooms.filter(r => want.length >= 3 && (norm(r.name).includes(want) || want.includes(norm(r.name))));
    if (loose.length === 1) return { ok: true, room: loose[0] };
    return { ok: false, problem: `No single room matches "${clip(ref, 40)}" at ${ctx.actor.propertyNames[prop.propertyId]}. Rooms there: ${rooms.map(r => r.name).join(' | ') || 'none'}. Call rooms_availability and use a handle, or ask_user which room.` };
}

export const roomBookSkill: WriteSkill<z.infer<typeof bookArgs>, z.infer<typeof bookPayload>> = {
    id: 'room.book', module: 'rooms', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose booking one meeting room for the person. Calling it does NOT book: it shows a confirmation card and they must say Yes. Use only after rooms_availability or rooms_free_slots showed the room free for that window, or when the person named an exact room, date and time. A bare hour from 1 to 7 means the afternoon. Do NOT use to cancel or move an existing booking (use room_cancel or room_move), or to book for someone else.',
    input: schema({
        room: str('A room handle from rooms_availability (preferred), or the room name the person said. Example: "R1".'),
        property: nullableStr('The property name as the person said it, or null. Not needed with a handle. Example: null.'),
        date: str('YYYY-MM-DD. Example: "2026-11-14".'),
        start_time: str('24-hour HH:MM. Example: "16:00".'),
        end_time: str('24-hour HH:MM. Example: "17:00".'),
        purpose: nullableStr('What the meeting is for, in the person\'s words, or null. Example: "client review".'),
    }),
    args: bookArgs,
    payload: bookPayload,
    examples: ['book the board room tomorrow 3 to 4', 'kal 11 baje ek ghante ke liye room book kar do', 'book the same room as yesterday at 4'],
    ability: { en: 'book a meeting room', hi: 'मीटिंग रूम बुक करना', hinglish: 'meeting room book karna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async prepare(ctx, a) {
        const bad = checkWindow(ctx.now, a.date, a.start_time, a.end_time);
        if (bad) return { ok: false, problem: `Cannot book: ${bad}. Fix it or call ask_user.` };
        const found = await findRoom(ctx, a.room, a.property);
        if (!found.ok) return found;
        const { room } = found;
        const free = await ctx.data.availableRooms(room.propertyId, a.date, a.start_time, a.end_time);
        if (!free.some(r => r.id === room.id)) {
            return { ok: false, problem: `${room.name} is NOT free on ${a.date} ${a.start_time}-${a.end_time}. Free then: ${free.map(r => `${ctx.handle('room', r.id, r.name, r.propertyId)} ${r.name}`).join(' | ') || 'no rooms'}. Tell the person and offer what is free.` };
        }
        const purpose = a.purpose && a.purpose.trim() ? a.purpose.trim() : null;
        return {
            ok: true,
            payload: { propertyId: room.propertyId, roomId: room.id, roomName: room.name, date: a.date, startTime: a.start_time, endTime: a.end_time, purpose },
            card: `${bt('room_card', ctx.lang, { room: room.name, property: ctx.actor.propertyNames[room.propertyId] ?? '', date: dayLabel(a.date), start: a.start_time, end: a.end_time, purpose: purpose ? `\n📝 ${clip(purpose, 80)}` : '' })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { property_id: room.propertyId, date: a.date, start_time: a.start_time, end_time: a.end_time },
        };
    },
    async execute(ctx, p, opId) {
        if (!ctx.actor.propertyIds.includes(p.propertyId)) return { ok: false, reply: bt('access_changed', ctx.lang) };
        const bad = checkWindow(ctx.now, p.date, p.startTime, p.endTime);
        if (bad) return { ok: false, reply: bt('expired', ctx.lang) };
        const property = ctx.actor.propertyNames[p.propertyId] ?? '';
        try {
            const booked = await ctx.data.bookRoom({ opId, userId: ctx.actor.userId, propertyId: p.propertyId, roomId: p.roomId, date: p.date, startTime: p.startTime, endTime: p.endTime, purpose: p.purpose });
            return {
                ok: true, resultRef: booked.bookingId,
                reply: bt('room_done', ctx.lang, { room: p.roomName, property, date: dayLabel(p.date), start: p.startTime, end: p.endTime }),
                episode: `Booked ${p.roomName} at ${property} on ${p.date} ${p.startTime}-${p.endTime}`,
            };
        } catch (err) {
            const code = (err as { code?: string } | null)?.code;
            if (code === 'SLOT_UNAVAILABLE') return { ok: false, reply: bt('room_taken', ctx.lang) };
            if (code === 'INSUFFICIENT_CREDITS') return { ok: false, reply: bt('room_credits', ctx.lang) };
            if (code === 'ACCESS_REVOKED' || code === 'MULTIPLE_COMPANIES') return { ok: false, reply: bt('access_changed', ctx.lang) };
            throw err;
        }
    },
};


// ── rooms.list (2026-11-18) ───────────────────────────────────────────────────────────────────────────────────────

const listArgs = z.object({ property: z.string().trim().max(120).nullish() }).strip();

export const roomsListSkill: ReadSkill<z.infer<typeof listArgs>> = {
    id: 'rooms.list', module: 'rooms', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The meeting rooms set up at one property, with seats and location when known. Each room gets a handle (R1, R2…). Use for "which meeting rooms are there", "show rooms at Andheri", "is there a room for 8 people". Do NOT use to check whether a room is free (use rooms_availability or rooms_free_slots).',
    input: schema({ property: nullableStr('The property name as the person said it, or null. Example: "Andheri".') }),
    args: listArgs,
    examples: ['what meeting rooms are there', 'Andheri mein kaun se rooms hain', 'is there a room for 10 people at Lower Parel'],
    ability: { en: 'see the meeting rooms', hi: 'मीटिंग रूम देखना', hinglish: 'meeting rooms dekhna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async run(ctx, a) {
        const prop = await roomProperty(ctx, a.property);
        if (!prop.ok) return { text: prop.problem };
        const rooms = await ctx.data.listRooms(prop.propertyId);
        if (!rooms.length) return noRoomsAt(ctx, prop.propertyId);
        const name = ctx.actor.propertyNames[prop.propertyId];
        return {
            text: `Meeting rooms at ${name} (${rooms.length}):\n${rooms.map(r => `${ctx.handle('room', r.id, r.name, r.propertyId)} | ${roomLine(r)}`).join('\n')}`,
            display: `${ctx.lang === 'en' ? `Meeting rooms at ${name}:` : `${name} ke meeting rooms:`}\n${rooms.map(r => `• ${roomLine(r)}`).join('\n')}`,
        };
    },
};

// ── rooms.free_slots (2026-11-18) ─────────────────────────────────────────────────────────────────────────────────

const slotsArgs = z.object({ property: z.string().trim().max(120).nullish(), room: z.string().trim().max(120).nullish(), date: z.string().trim().max(12) }).strip();

export const roomsFreeSlotsSkill: ReadSkill<z.infer<typeof slotsArgs>> = {
    id: 'rooms.free_slots', module: 'rooms', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'When each meeting room at one property is still free on one day: the free time windows that have not started yet. Use for "when is the board room free today", "what time is it next available", "any slot tomorrow after 3", "free rooms tomorrow". Give a room to see only that room. Work out the date from "today" in the context. Do NOT use for one exact window (use rooms_availability) or for the person\'s own bookings (use rooms_my_bookings).',
    input: schema({
        property: nullableStr('The property name as the person said it, or null. Example: null.'),
        room: nullableStr('A room handle (R1) or the room name as the person said it, or null for every room. Example: "Board Room".'),
        date: str('The date as YYYY-MM-DD. Example: "2026-11-14".'),
    }),
    args: slotsArgs,
    examples: ['when is the board room free today', 'kal kaun sa room kab free hai', 'what time is the next available slot'],
    ability: { en: 'see free meeting room times', hi: 'मीटिंग रूम का खाली समय देखना', hinglish: 'meeting room ka free time dekhna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async run(ctx, a) {
        const bad = checkWindow(ctx.now, a.date, '23:58', '23:59');
        if (bad && !/start time has already passed/.test(bad)) return { text: `Cannot check: ${bad}.` };
        let rooms: RoomRow[];
        let propertyId: string;
        if (a.room && a.room.trim()) {
            const found = await findRoom(ctx, a.room, a.property);
            if (!found.ok) return { text: found.problem };
            rooms = [found.room]; propertyId = found.room.propertyId;
        } else {
            const prop = await roomProperty(ctx, a.property);
            if (!prop.ok) return { text: prop.problem };
            propertyId = prop.propertyId;
            rooms = await ctx.data.listRooms(propertyId);
            if (!rooms.length) return noRoomsAt(ctx, propertyId);
        }
        const name = ctx.actor.propertyNames[propertyId];
        const day = `${dayLabel(a.date)} (${a.date})`;
        const perRoom = await Promise.all(rooms.slice(0, 12).map(async r => ({ r, windows: freeWindows(await ctx.data.roomFreeSlots(propertyId, r.id, a.date)) })));
        const span = (w: { start: string; end: string }[]) => w.map(x => `${x.start} to ${x.end}`).join(', ');
        if (perRoom.every(p => !p.windows.length)) {
            const en = `Nothing is free at ${name} on ${day}${rooms.length === 1 ? ` in ${rooms[0].name}` : ''}. Try another day.`;
            return { text: en, display: ctx.lang === 'en' ? en : `${name} mein ${day} kuch free nahi hai. Koi aur din try kijiye.` };
        }
        return {
            text: `Free times at ${name} on ${day}:\n${perRoom.map(p => `${ctx.handle('room', p.r.id, p.r.name, p.r.propertyId)} | ${p.r.name}: ${p.windows.length ? span(p.windows) : 'fully booked'}`).join('\n')}`,
            display: `${ctx.lang === 'en' ? `Free times at ${name}, ${dayLabel(a.date)}:` : `${name}, ${dayLabel(a.date)} free time:`}\n${perRoom.map(p => `• ${p.r.name}: ${p.windows.length ? span(p.windows) : (ctx.lang === 'en' ? 'fully booked' : 'full')}`).join('\n')}`,
        };
    },
};

// ── the person's own booking, for cancel and move (2026-11-18) ───────────────────────────────────────────────────

async function ownBooking(ctx: SkillContext, ref: string): Promise<{ ok: true; booking: BookingRow } | { ok: false; problem: string }> {
    const handle = ctx.resolve(ref, 'booking');
    if (!handle) return { ok: false, problem: `"${clip(ref, 20)}" is not a booking handle from this conversation. Call rooms_my_bookings first and use the B handle of the booking they mean.` };
    // Read again NOW, and only the person's own bookings: a handle never reaches someone else's booking.
    const rows = await ctx.data.myBookings(ctx.actor.userId, ctx.actor.propertyIds, istDate(ctx.now));
    const booking = rows.find(b => b.id === handle.id);
    if (!booking) return { ok: false, problem: 'That booking is not one of this person\'s current or upcoming bookings. Tell them; offer to show their bookings.' };
    if (booking.status !== 'confirmed') return { ok: false, problem: `That booking is ${booking.status || 'not active'}, so it cannot be changed. Tell the person.` };
    if (checkWindow(ctx.now, booking.date, booking.startTime.slice(0, 5), booking.endTime.slice(0, 5))) return { ok: false, problem: 'That booking has already started or is over, so it cannot be changed. Tell the person.' };
    return { ok: true, booking };
}

const bookingLine = (ctx: SkillContext, b: { roomName: string; propertyId: string; date: string; startTime: string; endTime: string }) =>
    `${b.roomName}, ${ctx.actor.propertyNames[b.propertyId] ?? ''}, ${dayLabel(b.date)} ${b.startTime.slice(0, 5)} to ${b.endTime.slice(0, 5)}`;

// ── room.cancel (2026-11-18) ──────────────────────────────────────────────────────────────────────────────────────

const cancelArgs = z.object({ booking: z.string().trim().min(1).max(20) }).strip();
const cancelPayload = z.object({ bookingId: z.string().uuid(), roomName: z.string().max(120), propertyId: z.string().uuid(), date: day, startTime: hm, endTime: hm }).strict();

export const roomCancelSkill: WriteSkill<z.infer<typeof cancelArgs>, z.infer<typeof cancelPayload>> = {
    id: 'room.cancel', module: 'rooms', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose cancelling ONE of the person\'s own upcoming room bookings. Calling it does NOT cancel: it shows a confirmation card and they must say Yes. Call rooms_my_bookings first and pass the B handle of the booking they mean. Do NOT use for a booking that already started, for someone else\'s booking, or to drop a confirmation card that is still waiting (use close_topic).',
    input: schema({ booking: str('The booking handle from rooms_my_bookings. Example: "B1".') }),
    args: cancelArgs,
    payload: cancelPayload,
    examples: ['cancel my board room booking tomorrow', 'kal wali booking cancel kar do', 'I don\'t need the room at 3 anymore'],
    ability: { en: 'cancel my room booking', hi: 'मेरी रूम बुकिंग रद्द करना', hinglish: 'meri room booking cancel karna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async prepare(ctx, a) {
        const own = await ownBooking(ctx, a.booking);
        if (!own.ok) return own;
        const b = own.booking;
        const start = b.startTime.slice(0, 5), end = b.endTime.slice(0, 5);
        return {
            ok: true,
            payload: { bookingId: b.id, roomName: b.roomName, propertyId: b.propertyId, date: b.date, startTime: start, endTime: end },
            card: `${bt('room_cancel_card', ctx.lang, { room: b.roomName, property: ctx.actor.propertyNames[b.propertyId] ?? '', date: dayLabel(b.date), start, end })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { property_id: b.propertyId, date: b.date, start_time: start, end_time: end },
        };
    },
    async execute(ctx, p) {
        if (!ctx.actor.propertyIds.includes(p.propertyId)) return { ok: false, reply: bt('access_changed', ctx.lang) };
        const out = await ctx.data.cancelBooking({ bookingId: p.bookingId, userId: ctx.actor.userId });
        if (out.ok) return { ok: true, resultRef: p.bookingId, reply: bt('room_cancelled', ctx.lang, { room: p.roomName, date: dayLabel(p.date), start: p.startTime, end: p.endTime }), episode: `Cancelled ${p.roomName} on ${p.date} ${p.startTime}-${p.endTime}` };
        if (out.code === 'already_cancelled') return { ok: false, reply: bt('room_already_cancelled', ctx.lang) };
        if (out.code === 'started') return { ok: false, reply: bt('room_cancel_started', ctx.lang) };
        if (out.code === 'forbidden' || out.code === 'not_found') return { ok: false, reply: bt('access_changed', ctx.lang) };
        return { ok: false, reply: bt('failed', ctx.lang) };
    },
};

// ── room.move (2026-11-18) ────────────────────────────────────────────────────────────────────────────────────────
// There is no "change booking" in the app, only book and cancel. A move books the new time FIRST (the transactional
// booking checks the slot and credits), and only then cancels the old booking. If the new booking fails, nothing
// changed; if the old one then cannot be cancelled, the person is told plainly, never left thinking it moved.

const moveArgs = z.object({
    booking: z.string().trim().min(1).max(20), room: z.string().trim().max(120).nullish(),
    date: z.string().trim().max(12), start_time: z.string().trim().max(6), end_time: z.string().trim().max(6),
}).strip();
const movePayload = z.object({
    oldBookingId: z.string().uuid(), oldLabel: z.string().max(300),
    propertyId: z.string().uuid(), roomId: z.string().uuid(), roomName: z.string().max(120), date: day, startTime: hm, endTime: hm,
}).strict();

export const roomMoveSkill: WriteSkill<z.infer<typeof moveArgs>, z.infer<typeof movePayload>> = {
    id: 'room.move', module: 'rooms', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose moving ONE of the person\'s own upcoming bookings to another time, day or room. Calling it does NOT change anything: it shows a confirmation card and they must say Yes. Call rooms_my_bookings first and pass its B handle. Leave room null to keep the same room. A bare hour from 1 to 7 means the afternoon. Do NOT use to make a second booking (use room_book) or for a booking that already started.',
    input: schema({
        booking: str('The booking handle from rooms_my_bookings. Example: "B1".'),
        room: nullableStr('A room handle (R1) or name for a different room, or null to keep the same room. Example: null.'),
        date: str('The new date, YYYY-MM-DD. Example: "2026-11-14".'),
        start_time: str('New start, 24-hour HH:MM. Example: "17:00".'),
        end_time: str('New end, 24-hour HH:MM. Example: "18:00".'),
    }),
    args: moveArgs,
    payload: movePayload,
    examples: ['move my 3 pm booking to 5', 'kal wali booking parso kar do', 'shift my board room booking to Huddle 2'],
    ability: { en: 'move my room booking', hi: 'मेरी रूम बुकिंग बदलना', hinglish: 'meri room booking shift karna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async prepare(ctx, a) {
        const bad = checkWindow(ctx.now, a.date, a.start_time, a.end_time);
        if (bad) return { ok: false, problem: `Cannot move it there: ${bad}. Fix it or call ask_user.` };
        const own = await ownBooking(ctx, a.booking);
        if (!own.ok) return own;
        const old = own.booking;
        let room: RoomRow;
        if (a.room && a.room.trim()) {
            const found = await findRoom(ctx, a.room, ctx.actor.propertyNames[old.propertyId]);
            if (!found.ok) return found;
            room = found.room;
        } else {
            if (!old.roomId) return { ok: false, problem: 'The room of that booking is not known. Ask which room, or call rooms_free_slots.' };
            room = { id: old.roomId, name: old.roomName, propertyId: old.propertyId };
        }
        const same = room.id === old.roomId && a.date === old.date;
        if (same && a.start_time === old.startTime.slice(0, 5) && a.end_time === old.endTime.slice(0, 5)) return { ok: false, problem: 'That is the time it is already booked for. Tell the person nothing needs to change.' };
        if (same && a.start_time < old.endTime.slice(0, 5) && a.end_time > old.startTime.slice(0, 5)) {
            return { ok: false, problem: 'The new time overlaps the booking being moved, in the same room, so it cannot be booked before the old one is cancelled. Tell the person to cancel it first (room_cancel) and then book the new time, or to pick a time that does not overlap.' };
        }
        const free = await ctx.data.availableRooms(room.propertyId, a.date, a.start_time, a.end_time);
        if (!free.some(r => r.id === room.id)) {
            return { ok: false, problem: `${room.name} is NOT free on ${a.date} ${a.start_time}-${a.end_time}. Free then: ${free.map(r => `${ctx.handle('room', r.id, r.name, r.propertyId)} ${r.name}`).join(' | ') || 'no rooms'}. Tell the person and offer what is free, or call rooms_free_slots.` };
        }
        const from = bookingLine(ctx, old);
        const to = bookingLine(ctx, { roomName: room.name, propertyId: room.propertyId, date: a.date, startTime: a.start_time, endTime: a.end_time });
        return {
            ok: true,
            payload: { oldBookingId: old.id, oldLabel: from, propertyId: room.propertyId, roomId: room.id, roomName: room.name, date: a.date, startTime: a.start_time, endTime: a.end_time },
            card: `${bt('room_move_card', ctx.lang, { from, to })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { property_id: room.propertyId, date: a.date, start_time: a.start_time, end_time: a.end_time },
        };
    },
    async execute(ctx, p, opId) {
        if (!ctx.actor.propertyIds.includes(p.propertyId)) return { ok: false, reply: bt('access_changed', ctx.lang) };
        if (checkWindow(ctx.now, p.date, p.startTime, p.endTime)) return { ok: false, reply: bt('expired', ctx.lang) };
        const to = bookingLine(ctx, { roomName: p.roomName, propertyId: p.propertyId, date: p.date, startTime: p.startTime, endTime: p.endTime });
        let newId: string;
        try {
            newId = (await ctx.data.bookRoom({ opId, userId: ctx.actor.userId, propertyId: p.propertyId, roomId: p.roomId, date: p.date, startTime: p.startTime, endTime: p.endTime, purpose: null })).bookingId;
        } catch (err) {
            const code = (err as { code?: string } | null)?.code;
            if (code === 'SLOT_UNAVAILABLE') return { ok: false, reply: bt('room_taken', ctx.lang) };
            if (code === 'INSUFFICIENT_CREDITS') return { ok: false, reply: bt('room_move_credits', ctx.lang) };
            if (code === 'ACCESS_REVOKED' || code === 'MULTIPLE_COMPANIES') return { ok: false, reply: bt('access_changed', ctx.lang) };
            throw err;
        }
        const cancelled = await ctx.data.cancelBooking({ bookingId: p.oldBookingId, userId: ctx.actor.userId }).catch(() => ({ ok: false as const, code: 'failed' as const }));
        // Already cancelled elsewhere is fine: the person ends up with only the new booking.
        if (!cancelled.ok && cancelled.code !== 'already_cancelled') {
            return { ok: true, resultRef: newId, reply: bt('room_move_partial', ctx.lang, { to, from: p.oldLabel }), episode: `Booked ${p.roomName} on ${p.date} ${p.startTime}-${p.endTime}; old booking not cancelled` };
        }
        return { ok: true, resultRef: newId, reply: bt('room_moved', ctx.lang, { to }), episode: `Moved a booking to ${p.roomName} on ${p.date} ${p.startTime}-${p.endTime}` };
    },
};

export const ROOM_SKILLS = [roomsListSkill, roomsAvailabilitySkill, roomsFreeSlotsSkill, roomsMyBookingsSkill, roomBookSkill, roomCancelSkill, roomMoveSkill] as const;
