/**
 * Meeting room skills. Availability is read here; the booking itself goes through the same database function the
 * WhatsApp assistant already uses, which checks access, credits and the slot again inside one transaction.
 */
import { z } from 'zod';
import { istDate } from '../../dates';
import { bt } from '../text';
import type { ReadSkill, RoomRow, SkillContext, WriteSkill } from '../types';
import { checkWindow, clip, dayLabel, nullableStr, pickProperty, schema, scopeProperties, str } from './common';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// ── rooms.availability ─────────────────────────────────────────────────────────────────────────────────────────────

const availabilityArgs = z.object({ property: z.string().trim().max(120).nullish(), date: z.string().trim().max(12), start_time: z.string().trim().max(6), end_time: z.string().trim().max(6) }).strip();

export const roomsAvailabilitySkill: ReadSkill<z.infer<typeof availabilityArgs>> = {
    id: 'rooms.availability', module: 'rooms', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Which meeting rooms at one property are free for a date and time window. Each free room gets a handle (R1, R2…) for room_book. Use for "is the 4th floor room free at 4", "any room tomorrow 10 to 11", and BEFORE proposing a booking. Work out the date from "today" in the context. If the person gave no end time, assume one hour. Do NOT use to see the person\'s existing bookings (use rooms_my_bookings).',
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
        const prop = pickProperty(ctx, a.property);
        if (!prop.ok) return { text: prop.problem };
        const [all, free] = await Promise.all([ctx.data.listRooms(prop.propertyId), ctx.data.availableRooms(prop.propertyId, a.date, a.start_time, a.end_time)]);
        const name = ctx.actor.propertyNames[prop.propertyId];
        const when = `${dayLabel(a.date)} (${a.date}), ${a.start_time} to ${a.end_time}`;
        if (!all.length) return { text: `${name} has no meeting rooms set up.`, display: ctx.lang === 'en' ? `${name} has no meeting rooms set up.` : `${name} mein koi meeting room set up nahi hai.` };
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
    description: 'The person\'s own meeting room bookings from the last 14 days onward (past and upcoming), newest first. Use for "my bookings", "which room did I book yesterday", "book the same room as last time" (read this first, then check availability). Do NOT use to see other people\'s bookings (not available).',
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
    const prop = pickProperty(ctx, propertyName);
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
    description: 'Propose booking one meeting room for the person. Calling it does NOT book: it shows a confirmation card and they must say Yes. Use only after rooms_availability showed the room free for that window, or when the person named an exact room, date and time. Do NOT use to cancel or change a booking (done in the app), or to book for someone else.',
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

export const ROOM_SKILLS = [roomsAvailabilitySkill, roomsMyBookingsSkill, roomBookSkill] as const;
