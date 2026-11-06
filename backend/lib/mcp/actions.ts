import { createCode, verifyCode, confirmKey, consumeNonce, paramsHash, remainingActions, actionLimits, CONFIRM_TTL_SECONDS, type ActionName, type NonceStore } from './confirm';
import { fetchAsUser } from './fetchAsUser';
import { logMcpCall } from './log';
import type { McpCaller } from './token';
import type { UserScope } from './scope';

/**
 * The FMS MCP's write actions. Creates only (and cancelling one's own booking); no deletes.
 *
 * Two steps, always. previewX() checks the request and returns a plain-language preview with a
 * one-time code; nothing changes. confirmAction(code) re-checks and then calls the app's own
 * route AS the user, so every existing rule (sign-in, roles, credits, double bookings) still
 * decides. Only the routes in ROUTES below can ever be written to through the MCP.
 *
 * Guardrails against bulk inserts ("create 100 test tickets"):
 *  - one record per action: no tool accepts a list, and every body sent holds exactly one record;
 *  - every action needs its own preview and the user's own yes; each code works once;
 *  - per-user limits (default 10 per hour, 30 per day, all actions together) and no identical
 *    repeat within 15 minutes, checked and recorded in one locked database step
 *    (mcp_consume_action), so parallel confirmations cannot slip past;
 *  - text fields have length caps; lists inside a record are not accepted.
 */

export type ActionContext = {
    caller: McpCaller;
    scope: UserScope;
    origin: string;
    supabaseUrl: string;
    deps?: {
        fetcher?: typeof fetchAsUser;
        nonceStore?: NonceStore;
        key?: Buffer | null;
        remaining?: (userId: string) => Promise<{ hour: number; day: number } | null>;
    };
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

async function issue(ctx: ActionContext, action: ActionName, params: Record<string, unknown>, lines: string[]): Promise<ActionResult> {
    const key = keyOf(ctx);
    if (!key) return { ok: false, text: 'Actions are not available: the FMS server is missing its signing key.' };
    // Tell the user now, rather than after they confirm, when the limit is already reached.
    const left = await (ctx.deps?.remaining || remainingActions)(ctx.caller.userId).catch(() => null);
    if (left && (left.hour <= 0 || left.day <= 0)) {
        const l = actionLimits();
        return { ok: false, text: `Not prepared: the limit of ${left.hour <= 0 ? `${l.perHour} actions per hour` : `${l.perDay} actions per day`} through the assistant has been reached. Try later, or use the FMS app.` };
    }
    await logMcpCall({ userId: ctx.caller.userId, clientId: ctx.caller.clientId, tool: `${action} (preview)`, args: params, ok: true });
    const { code } = createCode(key, { userId: ctx.caller.userId, clientId: ctx.caller.clientId, action, params });
    return {
        ok: true,
        text: [
            'PREVIEW ONLY. Nothing has been done yet.',
            ...lines,
            '',
            'This creates ONE record. To create another, prepare a separate preview and get a separate yes.',
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
    const orgId = String(p.organization_id || p.org_id || '');
    if (orgId && !ctx.scope.orgIds.has(orgId)) {
        await log(false, `confirm_action:${action}`, null, null, 'organisation no longer in scope', p);
        return { ok: false, text: 'Not done: you no longer have access to that organisation.' };
    }

    const target = ROUTES[action]?.(p);
    if (!target) return { ok: false, text: 'Not done: this action is not available.' };
    const { path, method, body, query } = target;

    const used = await (ctx.deps?.nonceStore || consumeNonce)(v.payload.n, ctx.caller.userId, action, paramsHash(action, p));
    if (!used.ok) {
        await log(false, `confirm_action:${action}`, path, null, used.reason, p);
        return { ok: false, text: `Not done: ${used.reason}.` };
    }

    try {
        const res = await call(ctx, path, query || {}, method, body);
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
        return { ok: true, text: DONE[action](data, p) };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await log(false, `confirm_action:${action}`, path, null, msg, p);
        return { ok: false, text: 'The FMS could not be reached. The code has been used up, so ask for a new preview and check whether the action went through before trying again.' };
    }
}

// ---------- more previews: one record each ----------

const NUM_MAX = 1_000_000_000;
const need = (text: string): ActionResult => ({ ok: false, text });
const asList = (d: unknown): Record<string, unknown>[] => {
    if (Array.isArray(d)) return d as Record<string, unknown>[];
    const o = (d || {}) as Record<string, unknown>;
    for (const k of ['data', 'items', 'generators', 'meters', 'sources', 'categories']) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    return [];
};
function orgOk(ctx: ActionContext, orgId: string) {
    return ctx.scope.orgIds.has(orgId);
}
function num(v: number | undefined, label: string, max = NUM_MAX): string | null {
    if (v === undefined) return null;
    if (!Number.isFinite(v) || v < 0 || v > max) return `${label} must be between 0 and ${max}.`;
    return null;
}

export async function previewRaiseHrTicket(ctx: ActionContext, a: {
    organization_id: string; category_id: string; subject: string; description: string;
    property_id?: string; priority?: 'low' | 'medium' | 'high' | 'urgent'; is_confidential?: boolean; is_anonymous?: boolean;
}): Promise<ActionResult> {
    if (!orgOk(ctx, a.organization_id)) return need('You do not belong to that organisation. Use whoami.');
    if (a.property_id && !ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    const res = await call(ctx, '/api/hr/admin/categories', {});
    const cat = asList(parseJson(res.text)).find(c => c.id === a.category_id);
    if (!cat) return need('That HR category does not exist. Use hr_categories to see the categories.');
    const params = {
        organization_id: a.organization_id, category_id: a.category_id, subject: a.subject.trim(), description: a.description.trim(),
        ...(a.property_id ? { property_id: a.property_id } : {}), priority: a.priority || 'medium',
        is_confidential: !!a.is_confidential, is_anonymous: !!a.is_anonymous,
    };
    return issue(ctx, 'raise_hr_ticket', params, [
        'Raise this HR ticket in your name?',
        `Category: ${clean(cat.category_name)} (${clean(cat.ticket_type, 40)})`,
        `Subject: ${params.subject}`,
        `Details: ${params.description}`,
        `Priority: ${params.priority}${params.is_confidential ? ', confidential' : ''}${params.is_anonymous ? ', anonymous' : ''}`,
    ]);
}

export async function previewAddTicketComment(ctx: ActionContext, a: { ticket_id: string; comment: string }): Promise<ActionResult> {
    if (!UUID.test(a.ticket_id)) return need('ticket_id must be the id of a ticket from list_tickets.');
    const res = await call(ctx, `/api/tickets/${a.ticket_id}/comments`, {});
    if (!res.ok) return need(`You cannot comment on that ticket (HTTP ${res.status}).`);
    const params = { ticket_id: a.ticket_id, comment: a.comment.trim() };
    return issue(ctx, 'add_ticket_comment', params, ['Add this comment to the ticket?', `Comment: ${params.comment}`]);
}

export async function previewCreateCrmLead(ctx: ActionContext, a: {
    organization_id: string; company_name?: string; contact_person?: string; email?: string; contact_number?: string;
    city?: string; location?: string; requirement?: string; seats?: number; lead_source?: string;
    priority?: 'Low' | 'Medium' | 'High' | 'Urgent'; remarks?: string;
}): Promise<ActionResult> {
    if (!orgOk(ctx, a.organization_id)) return need('You do not belong to that organisation. Use whoami.');
    if (!a.company_name && !a.contact_person && !a.email && !a.contact_number) {
        return need('Give at least a company name, a contact person, an email or a phone number.');
    }
    const bad = num(a.seats, 'seats', 100000);
    if (bad) return need(bad);
    const params: Record<string, unknown> = { organization_id: a.organization_id };
    for (const k of ['company_name', 'contact_person', 'email', 'contact_number', 'city', 'location', 'requirement', 'seats', 'lead_source', 'priority', 'remarks'] as const) {
        const v = a[k];
        if (v !== undefined && v !== '') params[k] = typeof v === 'string' ? v.trim() : v;
    }
    return issue(ctx, 'create_crm_lead', params, [
        'Create this CRM lead?',
        ...['company_name', 'contact_person', 'email', 'contact_number', 'city', 'requirement', 'seats', 'lead_source', 'priority']
            .filter(k => params[k] !== undefined).map(k => `${k.replace(/_/g, ' ')}: ${params[k]}`),
    ]);
}

export async function previewAddCrmNote(ctx: ActionContext, a: { lead_id: string; note: string }): Promise<ActionResult> {
    if (!UUID.test(a.lead_id)) return need('lead_id must be a lead id from list_crm_leads.');
    const params = { lead_id: a.lead_id, note: a.note.trim() };
    return issue(ctx, 'add_crm_note', params, ['Add this note to the lead?', `Note: ${params.note}`]);
}

const ACTIVITY_TYPES = ['call', 'meeting', 'site_visit', 'proposal_sent', 'followup_scheduled', 'email_sent'] as const;
export async function previewLogCrmActivity(ctx: ActionContext, a: { lead_id: string; activity_type: typeof ACTIVITY_TYPES[number]; description?: string }): Promise<ActionResult> {
    if (!UUID.test(a.lead_id)) return need('lead_id must be a lead id from list_crm_leads.');
    if (!ACTIVITY_TYPES.includes(a.activity_type)) return need(`activity_type must be one of ${ACTIVITY_TYPES.join(', ')}.`);
    const params = { lead_id: a.lead_id, activity_type: a.activity_type, ...(a.description ? { description: a.description.trim() } : {}) };
    return issue(ctx, 'log_crm_activity', params, ['Log this activity on the lead?', `Activity: ${a.activity_type.replace(/_/g, ' ')}`, ...(params.description ? [`Details: ${params.description}`] : [])]);
}

export async function previewAssignTask(ctx: ActionContext, a: { target_employee_id: string; title: string; description?: string; assigned_date?: string }): Promise<ActionResult> {
    if (!UUID.test(a.target_employee_id)) return need('target_employee_id must be a person\'s id (use list_users).');
    if (a.assigned_date && !DATE.test(a.assigned_date)) return need('assigned_date must be YYYY-MM-DD.');
    const params = {
        action: 'assign_task', actorId: ctx.caller.userId, targetEmployeeId: a.target_employee_id, title: a.title.trim(),
        ...(a.description ? { description: a.description.trim() } : {}), ...(a.assigned_date ? { assignedDate: a.assigned_date } : {}),
    };
    return issue(ctx, 'assign_task', params, [
        'Assign this task?', `To: ${a.target_employee_id}`, `Task: ${params.title}`,
        ...(a.description ? [`Details: ${a.description.trim()}`] : []), `Date: ${a.assigned_date || 'today'}`,
        'The FMS checks that you are allowed to assign tasks to this person.',
    ]);
}

async function findAtProperty(ctx: ActionContext, propertyId: string, sub: string, id: string) {
    const res = await call(ctx, `/api/properties/${propertyId}/${sub}`, {});
    return res.ok ? asList(parseJson(res.text)).find(x => x.id === id) || null : null;
}

export async function previewRecordDieselReading(ctx: ActionContext, a: {
    property_id: string; generator_id: string; reading_date: string;
    opening_hours?: number; closing_hours?: number; opening_diesel_level?: number; closing_diesel_level?: number;
    diesel_added_litres?: number; opening_kwh?: number; closing_kwh?: number; notes?: string;
}): Promise<ActionResult> {
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!DATE.test(a.reading_date)) return need('reading_date must be YYYY-MM-DD.');
    for (const k of ['opening_hours', 'closing_hours', 'opening_diesel_level', 'closing_diesel_level', 'diesel_added_litres', 'opening_kwh', 'closing_kwh'] as const) {
        const bad = num(a[k], k); if (bad) return need(bad);
    }
    const gen = await findAtProperty(ctx, a.property_id, 'generators', a.generator_id);
    if (!gen) return need('That generator is not at this property. Use utilities with view "generators".');
    const params: Record<string, unknown> = { property_id: a.property_id };
    for (const [k, v] of Object.entries(a)) if (v !== undefined && k !== 'property_id') params[k] = typeof v === 'string' ? v.trim() : v;
    return issue(ctx, 'record_diesel_reading', params, [
        'Record this diesel reading?', `Generator: ${clean(gen.name) || a.generator_id}`, `Date: ${a.reading_date}`,
        ...Object.entries(params).filter(([k]) => !['property_id', 'generator_id', 'reading_date'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`),
        'If a reading for this generator and date already exists, the FMS updates it.',
    ]);
}

export async function previewRecordElectricityReading(ctx: ActionContext, a: {
    property_id: string; meter_id: string; reading_date: string; opening_reading?: number; closing_reading: number; notes?: string;
}): Promise<ActionResult> {
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!DATE.test(a.reading_date)) return need('reading_date must be YYYY-MM-DD.');
    for (const k of ['opening_reading', 'closing_reading'] as const) { const bad = num(a[k], k); if (bad) return need(bad); }
    const meter = await findAtProperty(ctx, a.property_id, 'electricity-meters', a.meter_id);
    if (!meter) return need('That meter is not at this property. Use utilities with view "meters".');
    const params: Record<string, unknown> = { property_id: a.property_id, meter_id: a.meter_id, reading_date: a.reading_date, closing_reading: a.closing_reading };
    if (a.opening_reading !== undefined) params.opening_reading = a.opening_reading;
    if (a.notes) params.notes = a.notes.trim();
    return issue(ctx, 'record_electricity_reading', params, [
        'Record this electricity reading?', `Meter: ${clean(meter.name ?? meter.meter_name) || a.meter_id}`, `Date: ${a.reading_date}`,
        ...(a.opening_reading !== undefined ? [`Opening: ${a.opening_reading}`] : []), `Closing: ${a.closing_reading}`,
    ]);
}

export async function previewRecordWaterReading(ctx: ActionContext, a: { property_id: string; source_id: string; reading_date: string; quantity: number }): Promise<ActionResult> {
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!DATE.test(a.reading_date)) return need('reading_date must be YYYY-MM-DD.');
    const bad = num(a.quantity, 'quantity'); if (bad) return need(bad);
    const src = await findAtProperty(ctx, a.property_id, 'water/sources', a.source_id);
    if (!src) return need('That water source is not at this property. Use utilities with view "water_sources".');
    const params = { property_id: a.property_id, source_id: a.source_id, reading_date: a.reading_date, quantity: a.quantity };
    return issue(ctx, 'record_water_reading', params, ['Record this water reading?', `Source: ${clean(src.name ?? src.source_name) || a.source_id}`, `Date: ${a.reading_date}`, `Quantity: ${a.quantity}`]);
}

export async function previewRecordStockMovement(ctx: ActionContext, a: { property_id: string; item_id: string; action: 'add' | 'remove'; quantity: number; notes?: string }): Promise<ActionResult> {
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!UUID.test(a.item_id)) return need('item_id must be an item id from stock.');
    if (!(a.quantity > 0 && a.quantity <= 100000)) return need('quantity must be between 1 and 100000.');
    const res = await call(ctx, `/api/properties/${a.property_id}/stock/items/${a.item_id}`, {});
    const item = (parseJson(res.text) as { item?: Record<string, unknown> } | null)?.item;
    if (!res.ok || !item) return need('That stock item is not at this property.');
    const params = { property_id: a.property_id, itemId: a.item_id, action: a.action, quantity: a.quantity, ...(a.notes ? { notes: a.notes.trim() } : {}) };
    return issue(ctx, 'record_stock_movement', params, [
        `${a.action === 'add' ? 'Add to' : 'Issue from'} stock?`, `Item: ${clean(item.name ?? item.item_name) || a.item_id}`,
        `Quantity: ${a.quantity}${item.quantity !== undefined ? ` (in stock now: ${Number(item.quantity)})` : ''}`, ...(a.notes ? [`Note: ${a.notes.trim()}`] : []),
    ]);
}

export async function previewDraftPettyCash(ctx: ActionContext, a: {
    organization_id: string; property_id: string; purpose: string; amount_requested: number;
    category?: string; expected_date?: string; payment_mode?: string;
}): Promise<ActionResult> {
    if (!orgOk(ctx, a.organization_id)) return need('You do not belong to that organisation. Use whoami.');
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!(a.amount_requested > 0 && a.amount_requested <= 10_000_000) || Math.round(a.amount_requested * 100) !== a.amount_requested * 100) {
        return need('amount_requested must be more than 0, at most 1,00,00,000, with at most 2 decimals.');
    }
    if (a.expected_date && !DATE.test(a.expected_date)) return need('expected_date must be YYYY-MM-DD.');
    const params: Record<string, unknown> = {
        organization_id: a.organization_id, property_id: a.property_id, purpose: a.purpose.trim(), amount_requested: a.amount_requested,
        request_type: 'advance', save_draft: true,
    };
    for (const k of ['category', 'expected_date', 'payment_mode'] as const) if (a[k]) params[k] = String(a[k]).trim();
    return issue(ctx, 'draft_petty_cash_request', params, [
        'Save this petty cash request as a DRAFT? (It is not submitted for approval; you submit it in the FMS app.)',
        `Amount: ${a.amount_requested}`, `Purpose: ${params.purpose}`, ...(params.category ? [`Category: ${params.category}`] : []),
    ]);
}

// ---------- where each confirmed action goes, and what "done" says ----------

type Target = { path: string; method: 'POST' | 'PATCH'; body: unknown; query?: Record<string, string> };
const idOf = (o: unknown) => ((o || {}) as { id?: string }).id;

const ROUTES: Record<ActionName, (p: Record<string, unknown>) => Target | null> = {
    create_ticket: p => ({ path: '/api/tickets', method: 'POST', body: p }),
    book_meeting_room: p => ({ path: '/api/meeting-room-bookings', method: 'POST', body: p }),
    cancel_booking: p => (UUID.test(String(p.booking_id || '')) ? { path: `/api/meeting-room-bookings/${p.booking_id}`, method: 'PATCH', body: { status: 'cancelled' } } : null),
    raise_hr_ticket: p => ({ path: '/api/hr/tickets', method: 'POST', body: p }),
    add_ticket_comment: p => (UUID.test(String(p.ticket_id || '')) ? { path: `/api/tickets/${p.ticket_id}/comments`, method: 'POST', body: { comment: p.comment, is_internal: false } } : null),
    create_crm_lead: p => ({ path: '/api/crm/leads', method: 'POST', body: p, query: { org_id: String(p.organization_id) } }),
    add_crm_note: p => ({ path: '/api/crm/notes', method: 'POST', body: p }),
    log_crm_activity: p => ({ path: '/api/crm/activities', method: 'POST', body: p }),
    assign_task: p => ({ path: '/api/task-manager/tasks', method: 'POST', body: p }),
    record_diesel_reading: p => {
        const { property_id, ...reading } = p;
        return UUID.test(String(property_id)) ? { path: `/api/properties/${property_id}/diesel-readings`, method: 'POST', body: reading } : null;
    },
    record_electricity_reading: p => {
        const { property_id, ...reading } = p;
        return UUID.test(String(property_id)) ? { path: `/api/properties/${property_id}/electricity-readings`, method: 'POST', body: reading } : null;
    },
    // The route takes a list; it always gets exactly one reading.
    record_water_reading: p => (UUID.test(String(p.property_id)) ? { path: `/api/properties/${p.property_id}/water/readings`, method: 'POST', body: { readings: [{ source_id: p.source_id, reading_date: p.reading_date, quantity: p.quantity }] } } : null),
    record_stock_movement: p => {
        const { property_id, ...move } = p;
        return UUID.test(String(property_id)) ? { path: `/api/properties/${property_id}/stock/movements`, method: 'POST', body: move } : null;
    },
    draft_petty_cash_request: p => ({ path: '/api/petty-cash', method: 'POST', body: p, query: { org_id: String(p.organization_id) } }),
};

const DONE: Record<ActionName, (d: Json, p: Record<string, unknown>) => string> = {
    create_ticket: d => { const t = d.ticket || {}; return `Done. Ticket raised${t.ticket_number ? `: #${t.ticket_number}` : ''}${t.id ? ` (id ${t.id})` : ''}.`; },
    book_meeting_room: (d, p) => { const b = d.booking || {}; return `Done. Room booked${b.id ? ` (booking id ${b.id})` : ''} for ${p.date}, ${p.startTime} to ${p.endTime}.`; },
    cancel_booking: () => 'Done. The booking is cancelled.',
    raise_hr_ticket: d => { const t = (d.data || {}) as { ticket_number?: string }; return `Done. HR ticket raised${t.ticket_number ? `: ${t.ticket_number}` : ''}.`; },
    add_ticket_comment: () => 'Done. Comment added.',
    create_crm_lead: d => `Done. Lead created${idOf(d.lead) ? ` (id ${idOf(d.lead)})` : ''}.`,
    add_crm_note: () => 'Done. Note added to the lead.',
    log_crm_activity: () => 'Done. Activity logged on the lead.',
    assign_task: d => `Done. Task assigned${idOf(d.task) ? ` (id ${idOf(d.task)})` : ''}.`,
    record_diesel_reading: () => 'Done. Diesel reading recorded.',
    record_electricity_reading: () => 'Done. Electricity reading recorded.',
    record_water_reading: () => 'Done. Water reading recorded.',
    record_stock_movement: (_d, p) => `Done. Stock ${p.action === 'add' ? 'added' : 'issued'}.`,
    draft_petty_cash_request: d => `Done. Petty cash request saved as a draft${idOf(d.request) ? ` (id ${idOf(d.request)})` : ''}. Submit it in the FMS app when ready.`,
};
