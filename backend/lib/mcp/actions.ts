import { createCode, verifyCode, confirmKey, consumeNonce, CONFIRM_TTL_SECONDS, type ActionName, type NonceStore } from './confirm';
import { fetchAsUser } from './fetchAsUser';
import { logMcpCall } from './log';
import type { McpCaller } from './token';
import type { UserScope } from './scope';

/**
 * The FMS MCP's write actions: raise a ticket, book a meeting room, cancel a booking.
 *
 * Two steps, always. previewX() checks the request and returns a plain-language preview with a
 * one-time code; nothing changes. confirmAction(code) re-checks and then calls the app's own
 * route AS the user, so every existing rule (sign-in, credits, double bookings, who may cancel)
 * still decides. Only these three routes can ever be written to through the MCP.
 */

export type ActionContext = {
    caller: McpCaller;
    scope: UserScope;
    origin: string;
    supabaseUrl: string;
    deps?: { fetcher?: typeof fetchAsUser; nonceStore?: NonceStore; key?: Buffer | null };
};

export type ActionResult = { ok: true; text: string } | { ok: false; text: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fetcherOf(ctx: ActionContext) {
    return ctx.deps?.fetcher || fetchAsUser;
}
function keyOf(ctx: ActionContext) {
    return ctx.deps && 'key' in ctx.deps ? ctx.deps.key ?? null : confirmKey();
}

function call(ctx: ActionContext, path: string, query: Record<string, string>, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) {
    return fetcherOf(ctx)({
        origin: ctx.origin, supabaseUrl: ctx.supabaseUrl, accessToken: ctx.caller.accessToken, expiresAt: ctx.caller.expiresAt,
        path, query, method, body,
    });
}

type Json = Record<string, unknown> & {
    error?: string;
    rooms?: Room[];
    bookings?: Booking[];
    ticket?: { id?: string; ticket_number?: string };
    booking?: { id?: string };
};
type Room = { id: string; name?: string; location?: string; capacity?: number; bookings?: { start_time: string; end_time: string }[] };
type Booking = { id: string; property_id: string; meeting_room_id?: string; booking_date?: string; start_time: string; end_time: string; meeting_room?: { name?: string } };

function parseJson(text: string): Json | null {
    try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' ? (v as Json) : null;
    } catch {
        return null;
    }
}

/** Text from the FMS shown in a preview: one line, no control characters, capped, so it cannot fake preview lines. */
export function clean(v: unknown, max = 80): string {
    return String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function property(ctx: ActionContext, propertyId: string) {
    return ctx.scope.properties.find(p => p.id === propertyId) || null;
}

function minutes(t: string): number {
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
}

function issue(ctx: ActionContext, action: ActionName, params: Record<string, unknown>, lines: string[]): ActionResult {
    const key = keyOf(ctx);
    if (!key) return { ok: false, text: 'Actions are not available: the FMS server is missing its signing key.' };
    const { code } = createCode(key, { userId: ctx.caller.userId, clientId: ctx.caller.clientId, action, params });
    return {
        ok: true,
        text: [
            'PREVIEW ONLY. Nothing has been done yet.',
            ...lines,
            '',
            `Show this preview to the user exactly as written and ask them to confirm. Only if they reply yes, call confirm_action with this code (valid ${CONFIRM_TTL_SECONDS / 60} minutes, one use):`,
            code,
        ].join('\n'),
    };
}

// ---------- previews ----------

export async function previewCreateTicket(ctx: ActionContext, a: { property_id: string; description: string; title?: string }): Promise<ActionResult> {
    const prop = property(ctx, a.property_id);
    if (!prop || !prop.organization_id) return { ok: false, text: 'You do not have access to that property. Use whoami to see your properties.' };
    const description = a.description.trim();
    const title = (a.title || '').trim();
    if (description.length < 5) return { ok: false, text: 'The description is too short. Say what the problem is and where.' };
    const params = { property_id: prop.id, organization_id: prop.organization_id, description, ...(title ? { title } : {}) };
    await logMcpCall({ userId: ctx.caller.userId, clientId: ctx.caller.clientId, tool: 'create_ticket (preview)', args: params, ok: true });
    return issue(ctx, 'create_ticket', params, [
        'Raise this ticket?',
        `Property: ${clean(prop.name) || prop.id}`,
        ...(title ? [`Title: ${title}`] : []),
        `Description: ${description}`,
        'The FMS will set the category, priority and assignee itself, as it does for tickets raised in the app.',
    ]);
}

export async function previewBookRoom(
    ctx: ActionContext,
    a: { property_id: string; meeting_room_id: string; date: string; start_time: string; end_time: string; comment?: string },
): Promise<ActionResult> {
    const prop = property(ctx, a.property_id);
    if (!prop) return { ok: false, text: 'You do not have access to that property. Use whoami to see your properties.' };
    if (!UUID.test(a.meeting_room_id)) return { ok: false, text: 'meeting_room_id must be a room id from find_meeting_rooms.' };
    if (!DATE.test(a.date) || !TIME.test(a.start_time) || !TIME.test(a.end_time)) {
        return { ok: false, text: 'Use date YYYY-MM-DD and times HH:MM (24-hour, India time).' };
    }
    if (minutes(a.end_time) <= minutes(a.start_time)) return { ok: false, text: 'The end time must be after the start time.' };

    const res = await call(ctx, '/api/meeting-rooms/available', { propertyId: prop.id, date: a.date });
    const rooms = parseJson(res.text)?.rooms;
    if (!res.ok || !Array.isArray(rooms)) return { ok: false, text: `Could not check that room (HTTP ${res.status}). Try again shortly.` };
    const room = rooms.find(r => r.id === a.meeting_room_id);
    if (!room) return { ok: false, text: 'That room is not an active room at this property. Use find_meeting_rooms to see the rooms.' };
    const clash = (room.bookings || []).find(b => minutes(b.start_time) < minutes(a.end_time) && minutes(a.start_time) < minutes(b.end_time));
    if (clash) {
        return { ok: false, text: `That room is already booked from ${String(clash.start_time).slice(0, 5)} to ${String(clash.end_time).slice(0, 5)} on ${a.date}. Pick another time or room.` };
    }

    const hours = (minutes(a.end_time) - minutes(a.start_time)) / 60;
    const comment = (a.comment || '').trim();
    const params = {
        meetingRoomId: room.id, propertyId: prop.id, date: a.date, startTime: a.start_time, endTime: a.end_time,
        ...(comment ? { comment } : {}),
    };
    await logMcpCall({ userId: ctx.caller.userId, clientId: ctx.caller.clientId, tool: 'book_meeting_room (preview)', args: params, ok: true });
    return issue(ctx, 'book_meeting_room', params, [
        'Book this meeting room?',
        `Room: ${clean(room.name) || room.id}${room.location ? ` (${clean(room.location)})` : ''}${room.capacity ? `, seats ${Number(room.capacity) || ''}` : ''}`,
        `Property: ${clean(prop.name) || prop.id}`,
        `When: ${a.date}, ${a.start_time} to ${a.end_time} (India time), ${hours} hour${hours === 1 ? '' : 's'}`,
        ...(comment ? [`Note: ${comment}`] : []),
        `If you or your company have meeting room credits here, ${hours} hour${hours === 1 ? '' : 's'} will be used, and the FMS refuses the booking if there are not enough.`,
    ]);
}

export async function previewCancelBooking(ctx: ActionContext, a: { booking_id: string }): Promise<ActionResult> {
    if (!UUID.test(a.booking_id)) return { ok: false, text: 'booking_id must be a booking id from my_bookings.' };
    const res = await call(ctx, '/api/meeting-room-bookings', { status: 'confirmed' });
    const bookings = parseJson(res.text)?.bookings;
    if (!res.ok || !Array.isArray(bookings)) return { ok: false, text: `Could not look up your bookings (HTTP ${res.status}). Try again shortly.` };
    const b = bookings.find(x => x.id === a.booking_id);
    if (!b) return { ok: false, text: 'That booking is not one of your active bookings. Use my_bookings to see them.' };
    if (!ctx.scope.propertyIds.has(b.property_id)) return { ok: false, text: 'You do not have access to that booking\'s property.' };
    const params = { booking_id: b.id, property_id: b.property_id };
    await logMcpCall({ userId: ctx.caller.userId, clientId: ctx.caller.clientId, tool: 'cancel_booking (preview)', args: params, ok: true });
    return issue(ctx, 'cancel_booking', params, [
        'Cancel this booking?',
        `Room: ${clean(b.meeting_room?.name) || clean(b.meeting_room_id)}`,
        `When: ${clean(b.booking_date, 10)}, ${clean(b.start_time, 5)} to ${clean(b.end_time, 5)}`,
        'The FMS decides whether it can still be cancelled (for example, not after it has started) and refunds credits by its own rules.',
    ]);
}

// ---------- confirm ----------

/** Re-check, use up the code, then perform the action through the app's own route as the user. */
export async function confirmAction(ctx: ActionContext, code: string): Promise<ActionResult> {
    const started = Date.now();
    const key = keyOf(ctx);
    if (!key) return { ok: false, text: 'Actions are not available: the FMS server is missing its signing key.' };
    const v = verifyCode(key, code, { userId: ctx.caller.userId, clientId: ctx.caller.clientId });
    const log = (ok: boolean, tool: string, endpoint: string | null, status: number | null, error: string | null, args: unknown) =>
        logMcpCall({ userId: ctx.caller.userId, clientId: ctx.caller.clientId, tool, endpoint, args, httpStatus: status, ok, error, durationMs: Date.now() - started });
    if (!v.ok) {
        await log(false, 'confirm_action', null, null, v.reason, null);
        return { ok: false, text: `Not done: ${v.reason}.` };
    }
    const { a: action, p } = v.payload;

    // Memberships may have changed since the preview: check again before acting.
    const propId = String(p.property_id || p.propertyId || '');
    if (propId && !ctx.scope.propertyIds.has(propId)) {
        await log(false, `confirm_action:${action}`, null, null, 'property no longer in scope', p);
        return { ok: false, text: 'Not done: you no longer have access to that property.' };
    }

    let path: string;
    let method: 'POST' | 'PATCH';
    let body: unknown;
    if (action === 'create_ticket') {
        path = '/api/tickets'; method = 'POST'; body = p;
    } else if (action === 'book_meeting_room') {
        path = '/api/meeting-room-bookings'; method = 'POST'; body = p;
    } else {
        const id = String(p.booking_id || '');
        if (!UUID.test(id)) return { ok: false, text: 'Not done: the booking id is not valid.' };
        path = `/api/meeting-room-bookings/${id}`; method = 'PATCH'; body = { status: 'cancelled' };
    }

    const used = await (ctx.deps?.nonceStore || consumeNonce)(v.payload.n, ctx.caller.userId, action);
    if (!used.ok) {
        await log(false, `confirm_action:${action}`, path, null, used.reason, p);
        return { ok: false, text: `Not done: ${used.reason}.` };
    }

    try {
        const res = await call(ctx, path, {}, method, body);
        await log(res.ok, `confirm_action:${action}`, path, res.status, res.ok ? null : res.text.slice(0, 300), p);
        if (!res.ok) {
            const msg = parseJson(res.text)?.error || res.text.slice(0, 300);
            if (res.status >= 500) {
                // A server error can happen after the change was saved, so do not claim nothing happened.
                return { ok: false, text: `The FMS hit an error (HTTP ${res.status}): ${msg}. It may or may not have gone through: check in the FMS app (or with list_tickets / my_bookings) before trying again.` };
            }
            return { ok: false, text: `The FMS refused this (HTTP ${res.status}): ${msg}. Nothing was changed.` };
        }
        const data: Json = parseJson(res.text) || {};
        if (action === 'create_ticket') {
            const t = data.ticket || {};
            return { ok: true, text: `Done. Ticket raised${t.ticket_number ? `: #${t.ticket_number}` : ''}${t.id ? ` (id ${t.id})` : ''}.` };
        }
        if (action === 'book_meeting_room') {
            const b = data.booking || {};
            return { ok: true, text: `Done. Room booked${b.id ? ` (booking id ${b.id})` : ''} for ${p.date}, ${p.startTime} to ${p.endTime}.` };
        }
        return { ok: true, text: 'Done. The booking is cancelled.' };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await log(false, `confirm_action:${action}`, path, null, msg, p);
        return { ok: false, text: 'The FMS could not be reached. The code has been used up, so ask for a new preview and check whether the action went through before trying again.' };
    }
}
