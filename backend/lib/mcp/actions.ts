import { createCode, verifyCode, confirmKey, consumeNonce, paramsHash, remainingActions, actionLimits, CONFIRM_TTL_SECONDS, type ActionName, type NonceStore } from './confirm';
import { fetchAsUser } from './fetchAsUser';
import { logMcpCall } from './log';
import type { McpCaller } from './token';
import type { UserScope } from './scope';
import { EXTERNAL_ROLES } from '@/backend/lib/auth/callerAccess';

/**
 * The FMS MCP's write actions: creates, and updates of one existing record (ticket status,
 * reassignment, HR ticket status, CRM lead fields, task status). No deletes.
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
 *
 * Updates also carry the record's current values from the preview. Right before acting, the
 * record is read again (PRECHECK) and the action is refused if it changed in between, so a yes
 * given to "open to closed" can never close a ticket someone else already reopened.
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

/** Today's date and the minutes past midnight in India time, which is how the FMS reads booking times. */
function nowIst(now = Date.now()): { date: string; minutes: number } {
    const d = new Date(now + 330 * 60000);
    return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function minutes(t: string): number {
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
}

async function issue(ctx: ActionContext, action: ActionName, params: Record<string, unknown>, lines: string[], kind: 'create' | 'change' = 'create'): Promise<ActionResult> {
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
            kind === 'change'
                ? 'This changes ONE existing record. To change another, prepare a separate preview and get a separate yes.'
                : 'This creates ONE record. To create another, prepare a separate preview and get a separate yes.',
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
    if (minutes(a.end_time) - minutes(a.start_time) < 30) return { ok: false, text: 'A booking must be at least 30 minutes, as on the booking screen.' };
    const now = nowIst();
    if (a.date < now.date || (a.date === now.date && minutes(a.start_time) <= now.minutes)) {
        return { ok: false, text: `That start time has already passed (it is now ${now.date} ${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')} India time). The FMS does not book past times.` };
    }
    if (a.date > addDays(now.date, 14)) return { ok: false, text: 'The booking screen allows booking up to 14 days ahead. Pick an earlier date.' };

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
    // Credits, read the way the booking screen reads them. Admins see everyone's, so the FMS decides for them.
    const cr = await call(ctx, '/api/meeting-room-credits', { propertyId: prop.id });
    const credits = parseJson(cr.text) as { credit?: { remaining_hours?: number } | null; credits?: unknown[] } | null;
    let creditLine = 'The FMS checks meeting room credits when it books.';
    if (cr.ok && credits && 'credit' in credits) {
        const left = Number(credits.credit?.remaining_hours);
        if (!credits.credit) creditLine = 'No credit limit applies to you at this property.';
        else if (Number.isFinite(left)) {
            if (left < hours) return { ok: false, text: `Not enough meeting room credits: this needs ${hours} hour${hours === 1 ? '' : 's'} and ${left} remain${left === 1 ? 's' : ''}. Book a shorter slot, or ask your admin for more credits.` };
            creditLine = `Credits: ${left} hours left; this uses ${hours}, leaving ${Math.round((left - hours) * 100) / 100}.`;
        }
    } else if (cr.ok && Array.isArray(credits?.credits)) {
        creditLine = 'As an admin, the FMS checks the credits of the person or company the booking is for.';
    }
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
        creditLine,
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
    const now = nowIst();
    const day = clean(b.booking_date, 10);
    if (day && (day < now.date || (day === now.date && minutes(b.start_time) <= now.minutes))) {
        return { ok: false, text: 'That booking has already started or is in the past. The FMS only cancels bookings before they start.' };
    }
    const params = { booking_id: b.id, property_id: b.property_id };
    return issue(ctx, 'cancel_booking', params, [
        'Cancel this booking?',
        `Room: ${clean(b.meeting_room?.name) || clean(b.meeting_room_id)}`,
        `When: ${clean(b.booking_date, 10)}, ${clean(b.start_time, 5)} to ${clean(b.end_time, 5)}`,
        'If credits were used, the FMS gives the hours back (unless your role does not use credits).',
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

    // Updates: the record must still look the way it did in the preview. Checked before the code
    // is used up, so the user can simply ask for a fresh preview.
    const stale = PRECHECK[action] ? await PRECHECK[action]!(ctx, p).catch(() => 'could not re-read the record to check it') : null;
    if (stale) {
        await log(false, `confirm_action:${action}`, path, null, `stale: ${stale}`, p);
        return { ok: false, text: `Not done: ${stale}. Nothing was changed. Ask for a new preview if it is still needed.` };
    }

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
        let extra = '';
        if (target.then) {
            const t2 = await call(ctx, target.then.path, target.then.query || {}, target.then.method, target.then.body);
            await log(t2.ok, `confirm_action:${action} (then)`, target.then.path, t2.status, t2.ok ? null : t2.text.slice(0, 300), p);
            extra = t2.ok ? '' : ` But the follow-up step (${target.then.path}) failed (HTTP ${t2.status}); add it in the FMS app.`;
        }
        return { ok: true, text: DONE[action](data, p) + extra };
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

const numOrUndef = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Readings: staff only (as the logging screens and routes require), and never a future date. */
function readingGate(ctx: ActionContext, propertyId: string, date: string): ActionResult | null {
    if (!ctx.scope.propertyIds.has(propertyId)) return need('You do not have access to that property.');
    if (!isStaffAt(ctx, propertyId)) return need('Only staff of this property can record readings, not tenants or vendors.');
    if (!DATE.test(date)) return need('reading_date must be YYYY-MM-DD.');
    if (date > nowIst().date) return need('That date is in the future. The logging screens allow today or an earlier date.');
    return null;
}

type BoardPerson = { id: string; full_name?: string };
/** The Task Manager board as the user sees it: who they are there, and who they may assign to. */
async function taskBoard(ctx: ActionContext, query: Record<string, string>): Promise<{ actor: { id?: string; role?: string } | null; assignable: BoardPerson[]; tasks: TaskRow[] } | null> {
    const res = await call(ctx, '/api/task-manager/tasks', query);
    const d = parseJson(res.text) as { actor?: { id?: string; role?: string }; assignableEmployees?: BoardPerson[]; employees?: BoardPerson[]; tasks?: TaskRow[] } | null;
    if (!res.ok || !d) return null;
    return { actor: d.actor || null, assignable: d.assignableEmployees || d.employees || [], tasks: d.tasks || [] };
}

export async function previewRaiseHrTicket(ctx: ActionContext, a: {
    organization_id: string; category_id: string; subject: string; description: string;
    property_id?: string; is_confidential?: boolean; is_anonymous?: boolean;
}): Promise<ActionResult> {
    if (!orgOk(ctx, a.organization_id)) return need('You do not belong to that organisation. Use whoami.');
    if (a.property_id && !ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    const res = await call(ctx, '/api/hr/admin/categories', {});
    const cats = asList(parseJson(res.text));
    const cat = cats.find(c => c.id === a.category_id);
    if (!cat) return need('That HR category does not exist or is not active. Use hr_categories to see the categories.');
    if (cat.organization_id && cat.organization_id !== a.organization_id) return need('That HR category belongs to another organisation. Use hr_categories.');
    // As on the HR form: confidential and anonymous are kinds of ticket, chosen through their category.
    const confCat = (c: Record<string, unknown>) => c.ticket_type === 'confidential_feedback' || Boolean(c.is_confidential);
    const anonCat = (c: Record<string, unknown>) => c.ticket_type === 'anonymous_feedback' || Boolean(c.is_anonymous);
    const names = (f: (c: Record<string, unknown>) => boolean) => cats.filter(f).map(c => clean(c.category_name, 40)).join(', ') || 'none set up';
    if (a.is_anonymous && !anonCat(cat)) return need(`Anonymous feedback uses an anonymous category (${names(anonCat)}). Ask the user which one, then use its id.`);
    if (a.is_confidential && !confCat(cat)) return need(`Confidential feedback uses a confidential category (${names(confCat)}). Ask the user which one, then use its id.`);
    const is_anonymous = cat.ticket_type === 'anonymous_feedback' || (anonCat(cat) && !!a.is_anonymous);
    const is_confidential = !is_anonymous && (cat.ticket_type === 'confidential_feedback' || (confCat(cat) && !!a.is_confidential));
    const params = {
        organization_id: a.organization_id, category_id: a.category_id, subject: a.subject.trim(), description: a.description.trim(),
        ...(a.property_id ? { property_id: a.property_id } : {}), priority: 'medium', is_confidential, is_anonymous,
    };
    return issue(ctx, 'raise_hr_ticket', params, [
        'Raise this HR ticket in your name?',
        `Category: ${clean(cat.category_name)} (${clean(cat.ticket_type, 40)})`,
        `Subject: ${params.subject}`,
        `Details: ${params.description}`,
        is_anonymous ? 'Anonymous: your name is hidden from the people handling it.' : is_confidential ? 'Confidential: only senior HR and the assigned handler see it, not your manager.' : 'Normal HR ticket: your reporting manager and HR can see it.',
        'Priority: medium (the HR form always uses medium; HR can change it).',
    ]);
}

export async function previewAddTicketComment(ctx: ActionContext, a: { ticket_id?: string; ticket_number?: string; comment: string }): Promise<ActionResult> {
    const found = await findTicket(ctx, a);
    if (isResult(found)) return found;
    const { t } = found;
    const params = { ticket_id: t.id, comment: a.comment.trim() };
    const status = String(t.status || '');
    return issue(ctx, 'add_ticket_comment', params, [
        'Add this comment to the ticket?',
        `Ticket: ${ticketLabel(t)}`,
        `Property: ${clean(t.property?.name) || t.property_id}, now ${clean(status, 30) || 'unknown'}, assigned to ${t.assigned_to === ctx.caller.userId ? 'you' : clean(t.assignee?.full_name) || (t.assigned_to ? 'someone else' : 'nobody')}`,
        `Comment: ${params.comment}`,
        'Everyone who can see the ticket sees the comment, clients included.',
        ...(['closed', 'resolved'].includes(status) ? [`The ticket is ${status}; the comment is added but does not reopen it.`] : []),
    ]);
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
    // CRM access, as the CRM screen needs it.
    const acc = await call(ctx, '/api/crm/statuses', { org_id: a.organization_id });
    if (acc.status === 401 || acc.status === 403) return need('You have no CRM access in this organisation, so you cannot create leads there.');
    const params: Record<string, unknown> = { organization_id: a.organization_id };
    for (const k of ['company_name', 'contact_person', 'email', 'contact_number', 'city', 'location', 'requirement', 'seats', 'lead_source', 'priority', 'remarks'] as const) {
        const v = a[k];
        if (v !== undefined && v !== '') params[k] = typeof v === 'string' ? v.trim() : v;
    }
    // The CRM does not stop duplicates, so the preview shows any lead with the same email, phone or company.
    const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
    const same: string[] = [];
    for (const [field, value] of [['email', params.email], ['contact_number', params.contact_number], ['company_name', params.company_name]] as const) {
        if (!value) continue;
        const r = await call(ctx, '/api/crm/leads', { org_id: a.organization_id, search: String(value).slice(0, 80), page_size: '10' });
        const leads = ((parseJson(r.text) as { leads?: Record<string, unknown>[] } | null)?.leads || []);
        for (const l of leads) {
            const hit = field === 'contact_number' ? digits(l.contact_number) !== '' && digits(l.contact_number) === digits(value)
                : String(l[field] ?? '').trim().toLowerCase() === String(value).trim().toLowerCase();
            const label = `${clean(l.company_name) || clean(l.contact_person) || 'a lead'} (same ${field.replace(/_/g, ' ')}, lead id ${clean(l.id, 40)})`;
            if (hit && !same.includes(label)) same.push(label);
        }
    }
    return issue(ctx, 'create_crm_lead', params, [
        'Create this CRM lead?',
        ...['company_name', 'contact_person', 'email', 'contact_number', 'city', 'requirement', 'seats', 'lead_source', 'priority']
            .filter(k => params[k] !== undefined).map(k => `${k.replace(/_/g, ' ')}: ${params[k]}`),
        ...(same.length ? [`POSSIBLE DUPLICATE: ${same.slice(0, 3).join('; ')}. Check with the user that this is a new lead before confirming.`] : ['No existing lead with the same email, phone or company was found.']),
    ]);
}

export async function previewAddCrmNote(ctx: ActionContext, a: { lead_id: string; note: string }): Promise<ActionResult> {
    const l = await leadFor(ctx, a.lead_id);
    if (isLeadResult(l)) return l;
    const params = { lead_id: l.id, note: a.note.trim() };
    if (!params.note) return need('The note is empty.');
    return issue(ctx, 'add_crm_note', params, ['Add this note to the lead?', ...leadFacts(l), `Note: ${params.note}`]);
}

const ACTIVITY_TYPES = ['call', 'meeting', 'site_visit', 'proposal_sent', 'followup_scheduled', 'email_sent'] as const;
export async function previewLogCrmActivity(ctx: ActionContext, a: { lead_id: string; activity_type: typeof ACTIVITY_TYPES[number]; description?: string }): Promise<ActionResult> {
    if (!ACTIVITY_TYPES.includes(a.activity_type)) return need(`activity_type must be one of ${ACTIVITY_TYPES.join(', ')}.`);
    const l = await leadFor(ctx, a.lead_id);
    if (isLeadResult(l)) return l;
    const params = { lead_id: l.id, activity_type: a.activity_type, ...(a.description ? { description: a.description.trim() } : {}) };
    const contact = ['call', 'meeting', 'site_visit', 'email_sent'].includes(a.activity_type);
    return issue(ctx, 'log_crm_activity', params, [
        'Log this activity on the lead?', ...leadFacts(l), `Activity: ${a.activity_type.replace(/_/g, ' ')}`,
        ...(params.description ? [`Details: ${params.description}`] : []),
        ...(contact ? ['The FMS also sets the lead\'s "last contacted" to now.'] : []),
    ]);
}

export async function previewAssignTask(ctx: ActionContext, a: { target_employee_id: string; title: string; description?: string; assigned_date?: string }): Promise<ActionResult> {
    if (!UUID.test(a.target_employee_id)) return need('target_employee_id must be a person\'s id from my_tasks (its assignable people) or list_users.');
    if (a.assigned_date && !DATE.test(a.assigned_date)) return need('assigned_date must be YYYY-MM-DD.');
    const title = a.title.trim();
    if (!title) return need('The task needs a title.');
    const today = nowIst().date;
    if (a.assigned_date && a.assigned_date < today) return need('That date is in the past. Give today or a later date.');
    if (a.assigned_date && a.assigned_date > addDays(today, 366)) return need('That date is more than a year ahead.');
    const board = await taskBoard(ctx, {});
    if (!board) return need('Could not open your task list in the FMS. You may not have a Task Manager profile.');
    const me = ctx.caller.userId;
    const target = board.assignable.find(e => e.id === a.target_employee_id);
    if (a.target_employee_id !== me) {
        if (!['reporting_manager', 'superuser'].includes(String(board.actor?.role))) return need('On the task screen only reporting managers and superusers assign tasks to other people. You can add a task for yourself.');
        if (!target) return need('That person is not in the list of people you can assign tasks to. Use my_tasks to see who you can assign to.');
    }
    const params = {
        action: 'assign_task', actorId: me, targetEmployeeId: a.target_employee_id, title,
        ...(a.description ? { description: a.description.trim() } : {}), ...(a.assigned_date ? { assignedDate: a.assigned_date } : {}),
    };
    return issue(ctx, 'assign_task', params, [
        'Assign this task?', `To: ${a.target_employee_id === me ? 'yourself' : clean(target?.full_name) || a.target_employee_id}`, `Task: ${title}`,
        ...(a.description ? [`Details: ${a.description.trim()}`] : []), `Date: ${a.assigned_date || `today (${today})`}`,
        ...(a.target_employee_id === me ? [] : ['The FMS makes the final check: the person must report to you (directly or further down), and their department must use the Task Manager.']),
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
    const stop = readingGate(ctx, a.property_id, a.reading_date);
    if (stop) return stop;
    for (const k of ['opening_hours', 'closing_hours', 'opening_diesel_level', 'closing_diesel_level', 'diesel_added_litres', 'opening_kwh', 'closing_kwh'] as const) {
        const bad = num(a[k], k); if (bad) return need(bad);
    }
    if (a.closing_hours === undefined || a.closing_kwh === undefined || a.closing_diesel_level === undefined) {
        return need('The diesel logging screen needs the closing run hours, the closing kWh and the closing diesel level. Ask the user for the missing ones.');
    }
    const gen = await findAtProperty(ctx, a.property_id, 'generators', a.generator_id);
    if (!gen) return need('That generator is not at this property. Use utilities with view "generators".');
    const res = await call(ctx, `/api/properties/${a.property_id}/diesel-readings`, { generatorId: a.generator_id });
    const rows = res.ok ? asList(parseJson(res.text)).filter(r => r.generator_id === a.generator_id || r.generator_id === undefined) : [];
    const existing = rows.find(r => r.reading_date === a.reading_date);
    const prev = rows.find(r => String(r.reading_date) < a.reading_date);
    // Openings: as on the screen, from the last reading before this date, else the generator's starting values.
    const from = (k: string, initial: string) => prev?.[k] ?? gen[initial];
    const opening_hours = a.opening_hours ?? numOrUndef(from('closing_hours', 'initial_run_hours'));
    const opening_kwh = a.opening_kwh ?? numOrUndef(from('closing_kwh', 'initial_kwh_reading'));
    const opening_diesel_level = a.opening_diesel_level ?? numOrUndef(from('closing_diesel_level', 'initial_diesel_level'));
    if (opening_hours !== undefined && a.closing_hours < opening_hours) return need(`Closing hours (${a.closing_hours}) cannot be less than opening hours (${opening_hours}).`);
    if (opening_kwh !== undefined && a.closing_kwh < opening_kwh) return need(`Closing kWh (${a.closing_kwh}) cannot be less than opening kWh (${opening_kwh}).`);
    const params: Record<string, unknown> = { property_id: a.property_id, generator_id: a.generator_id, reading_date: a.reading_date };
    for (const [k, v] of Object.entries({ ...a, opening_hours, opening_kwh, opening_diesel_level })) {
        if (v !== undefined && !['property_id', 'generator_id', 'reading_date'].includes(k)) params[k] = typeof v === 'string' ? v.trim() : v;
    }
    return issue(ctx, 'record_diesel_reading', params, [
        'Record this diesel reading?', `Generator: ${clean(gen.name) || a.generator_id}`, `Date: ${a.reading_date}`,
        `Run hours: ${opening_hours ?? '?'} -> ${a.closing_hours}; kWh: ${opening_kwh ?? '?'} -> ${a.closing_kwh}; diesel level: ${opening_diesel_level ?? '?'} -> ${a.closing_diesel_level}${a.diesel_added_litres ? `; diesel added ${a.diesel_added_litres} L` : ''}`,
        prev ? `Openings come from the last reading, on ${clean(prev.reading_date, 10)}.` : 'No earlier reading: openings come from the generator\'s starting values.',
        ...(existing ? [`A reading for this generator on ${a.reading_date} already exists (closing hours ${clean(existing.closing_hours, 20)}). Saving REPLACES it.`] : []),
        ...(a.notes ? [`Note: ${a.notes.trim()}`] : []),
    ]);
}

export async function previewRecordElectricityReading(ctx: ActionContext, a: {
    property_id: string; meter_id: string; reading_date: string; opening_reading?: number; closing_reading: number; notes?: string;
}): Promise<ActionResult> {
    const stop = readingGate(ctx, a.property_id, a.reading_date);
    if (stop) return stop;
    for (const k of ['opening_reading', 'closing_reading'] as const) { const bad = num(a[k], k); if (bad) return need(bad); }
    const meter = await findAtProperty(ctx, a.property_id, 'electricity-meters', a.meter_id);
    if (!meter) return need('That meter is not at this property. Use utilities with view "meters".');
    const res = await call(ctx, `/api/properties/${a.property_id}/electricity-readings`, { meterId: a.meter_id });
    const rows = res.ok ? asList(parseJson(res.text)).filter(r => r.meter_id === a.meter_id || r.meter_id === undefined) : [];
    const existing = rows.find(r => r.reading_date === a.reading_date);
    const prev = rows.find(r => String(r.reading_date) < a.reading_date);
    const opening = a.opening_reading ?? numOrUndef(prev?.closing_reading ?? meter.last_reading);
    if (opening !== undefined && !(a.closing_reading > opening)) return need(`The closing reading (${a.closing_reading}) must be more than the opening reading (${opening}), as on the electricity logging screen.`);
    const params: Record<string, unknown> = { property_id: a.property_id, meter_id: a.meter_id, reading_date: a.reading_date, closing_reading: a.closing_reading };
    if (opening !== undefined) params.opening_reading = opening;
    if (a.notes) params.notes = a.notes.trim();
    return issue(ctx, 'record_electricity_reading', params, [
        'Record this electricity reading?', `Meter: ${clean(meter.name ?? meter.meter_name) || a.meter_id}`, `Date: ${a.reading_date}`,
        `Reading: ${opening ?? '?'} -> ${a.closing_reading}${opening !== undefined ? ` (${Math.round((a.closing_reading - opening) * 100) / 100} units before the multiplier)` : ''}`,
        prev ? `Opening comes from the last reading, on ${clean(prev.reading_date, 10)}.` : a.opening_reading !== undefined ? 'Opening as given.' : 'Opening comes from the meter\'s last recorded value.',
        ...(existing ? [`A reading for this meter on ${a.reading_date} already exists (closing ${clean(existing.closing_reading, 20)}). Saving REPLACES it.`] : []),
    ]);
}

export async function previewRecordWaterReading(ctx: ActionContext, a: { property_id: string; source_id: string; reading_date: string; quantity: number }): Promise<ActionResult> {
    const stop = readingGate(ctx, a.property_id, a.reading_date);
    if (stop) return stop;
    const bad = num(a.quantity, 'quantity'); if (bad) return need(bad);
    const src = await findAtProperty(ctx, a.property_id, 'water/sources', a.source_id);
    if (!src) return need('That water source is not at this property. Use utilities with view "water_sources".');
    const res = await call(ctx, `/api/properties/${a.property_id}/water/readings`, { month: a.reading_date.slice(0, 7) });
    const existing = res.ok ? asList(parseJson(res.text)).find(r => r.source_id === a.source_id && r.reading_date === a.reading_date) : undefined;
    const params = { property_id: a.property_id, source_id: a.source_id, reading_date: a.reading_date, quantity: a.quantity };
    return issue(ctx, 'record_water_reading', params, [
        'Record this water reading?', `Source: ${clean(src.name ?? src.source_name) || a.source_id}`, `Date: ${a.reading_date}`, `Quantity: ${a.quantity}`,
        ...(existing ? [`A reading for this source on ${a.reading_date} already exists (quantity ${clean(existing.quantity, 20)}). Saving REPLACES it.`] : []),
    ]);
}

export async function previewRecordStockMovement(ctx: ActionContext, a: { property_id: string; item_id: string; action: 'add' | 'remove'; quantity: number; notes?: string }): Promise<ActionResult> {
    if (!ctx.scope.propertyIds.has(a.property_id)) return need('You do not have access to that property.');
    if (!isStaffAt(ctx, a.property_id)) return need('Only staff of this property can move stock, not tenants or vendors.');
    if (!UUID.test(a.item_id)) return need('item_id must be an item id from stock.');
    if (!(a.quantity > 0 && a.quantity <= 100000)) return need('quantity must be between 1 and 100000.');
    const res = await call(ctx, `/api/properties/${a.property_id}/stock/items/${a.item_id}`, {});
    const item = (parseJson(res.text) as { item?: Record<string, unknown> } | null)?.item;
    if (!res.ok || !item) return need('That stock item is not at this property.');
    const have = Number(item.quantity);
    if (a.action === 'remove' && Number.isFinite(have) && a.quantity > have) {
        return need(`Only ${have} ${clean(item.unit, 20)} of ${clean(item.name ?? item.item_name)} in stock; ${a.quantity} cannot be issued. The stock screen does not allow taking more than is in stock.`.replace('  ', ' '));
    }
    const params = { property_id: a.property_id, itemId: a.item_id, action: a.action, quantity: a.quantity, ...(a.notes ? { notes: a.notes.trim() } : {}) };
    return issue(ctx, 'record_stock_movement', params, [
        `${a.action === 'add' ? 'Add to' : 'Issue from'} stock?`, `Item: ${clean(item.name ?? item.item_name) || a.item_id}`,
        `Quantity: ${a.quantity}${Number.isFinite(have) ? ` (in stock now: ${have}, after this: ${a.action === 'add' ? have + a.quantity : have - a.quantity})` : ''}`, ...(a.notes ? [`Note: ${a.notes.trim()}`] : []),
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
    const purpose = a.purpose.trim();
    if (!purpose) return need('A purpose is required.');
    // The properties the petty cash screen offers this person.
    const res = await call(ctx, '/api/petty-cash/context', { org_id: a.organization_id });
    if (res.status === 401 || res.status === 403) return need('You cannot use petty cash in this organisation.');
    const props = ((parseJson(res.text) as { properties?: { id: string; name?: string }[] } | null)?.properties || []);
    if (res.ok && !props.some(x => x.id === a.property_id)) {
        return need(`You cannot raise petty cash for that property. The properties you can use: ${props.map(x => clean(x.name, 40)).join(', ') || 'none'}.`);
    }
    const params: Record<string, unknown> = {
        organization_id: a.organization_id, property_id: a.property_id, purpose, amount_requested: a.amount_requested,
        category: (a.category || 'Multi-purpose').trim(), payment_mode: (a.payment_mode || 'Cash').trim(), save_draft: true,
        ...(a.expected_date ? { expected_date: a.expected_date } : {}),
    };
    return issue(ctx, 'draft_petty_cash_request', params, [
        'Save this petty cash request as a DRAFT? (It is not submitted for approval; you submit it in the FMS app.)',
        `Property: ${clean(props.find(x => x.id === a.property_id)?.name) || a.property_id}`,
        `Amount: ${a.amount_requested}`, `Purpose: ${purpose}`, `Category: ${params.category}, paid by ${params.payment_mode}`,
    ]);
}

// ---------- updates: one existing record each ----------

/** Staff, not tenants, clients or vendors, at this property (directly or through its organisation). */
function isStaffAt(ctx: ActionContext, propertyId: string): boolean {
    const prop = ctx.scope.properties.find(p => p.id === propertyId);
    if (!prop) return false;
    const org = ctx.scope.orgs.find(o => o.id === prop.organization_id);
    const roles = [...prop.roles, ...(org?.roles || [])].map(r => String(r).toLowerCase().trim());
    return roles.some(r => r && !EXTERNAL_ROLES.includes(r));
}

type TicketRow = {
    id: string; ticket_number?: string | number; title?: string; status?: string | null; priority?: string | null; internal?: boolean | null;
    property_id?: string; organization_id?: string | null; assigned_to?: string | null; created_at?: string;
    assignee?: { full_name?: string } | null; property?: { name?: string } | null;
};
type LoadedTicket = { t: TicketRow; validationEnabled: boolean };
/** One service ticket, read as the user. (For procurement users this GET also marks its material requests as seen, as opening the ticket in the app does.) */
async function loadTicket(ctx: ActionContext, id: string): Promise<LoadedTicket | null> {
    const res = await call(ctx, `/api/tickets/${id}`, {});
    const d = parseJson(res.text) as { ticket?: TicketRow; validationEnabled?: boolean } | null;
    return res.ok && d?.ticket?.id ? { t: d.ticket, validationEnabled: d.validationEnabled !== false } : null;
}
const ticketLabel = (t: TicketRow) => `${t.ticket_number ? `#${clean(t.ticket_number, 30)} ` : ''}${clean(t.title) || t.id}`;
const TICKET_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_\-/]{0,39}$/;

/**
 * Find the ticket the user means, from the FMS only: by id, or by its number among the tickets
 * this user can see. Zero or several matches stop here with what was found; nothing is guessed.
 */
async function findTicket(ctx: ActionContext, a: { ticket_id?: string; ticket_number?: string }): Promise<LoadedTicket | ActionResult> {
    let id = a.ticket_id;
    const number = (a.ticket_number || '').trim().replace(/^#/, '');
    if (!id && !number) return need('Say which ticket: its ticket_number (for example TKT-42) or its ticket_id from list_tickets.');
    if (id && !UUID.test(id)) return need('ticket_id must be the id of a ticket from list_tickets.');
    if (!id) {
        if (!TICKET_NUMBER.test(number)) return need('That does not look like a ticket number. Use the number shown in the FMS, for example TKT-42.');
        const res = await call(ctx, '/api/tickets', { search: number, limit: '20' });
        const list = ((parseJson(res.text) as { tickets?: TicketRow[] } | null)?.tickets || []);
        const hits = list.filter(x => String(x.ticket_number ?? '').toLowerCase() === number.toLowerCase());
        if (!res.ok) return need(`Could not search your tickets (HTTP ${res.status}).`);
        if (!hits.length) return need(`No ticket numbered ${number} among the tickets you can see. Check the number with the user, or use list_tickets. Do not guess another ticket.`);
        if (hits.length > 1) {
            return need([`${hits.length} tickets you can see have the number ${number}. Ask the user which one, then use its ticket_id:`,
                ...hits.slice(0, 10).map(x => `- ${ticketLabel(x)}, ${clean(x.property?.name) || 'property ?'}, ${clean(x.status, 30)} (ticket_id ${x.id})`)].join('\n'));
        }
        id = hits[0].id;
    }
    const loaded = await loadTicket(ctx, id);
    if (!loaded || !loaded.t.property_id) return need('You cannot see that ticket. Use list_tickets to find it.');
    if (number && String(loaded.t.ticket_number ?? '').toLowerCase() !== number.toLowerCase()) {
        return need(`ticket_id and ticket_number point to different tickets (${ticketLabel(loaded.t)}). Check with the user which one is meant.`);
    }
    if (!ctx.scope.propertyIds.has(loaded.t.property_id)) return need('You do not have access to that ticket\'s property.');
    return loaded;
}
const isResult = (x: LoadedTicket | ActionResult): x is ActionResult => 'ok' in x;

/** The same roles as the ticket screen: who manages tickets at this property (Force Close, Reassign, priority). */
const TICKET_MANAGER_ORG_ROLES = ['master_admin', 'org_super_admin', 'ops_super_admin', 'org_admin', 'owner', 'super_admin'];
const TICKET_MANAGER_PROPERTY_ROLES = ['property_admin', 'ops_super_admin', 'org_super_admin', 'org_admin', 'master_admin', 'owner'];
function canManageTicket(ctx: ActionContext, t: TicketRow): boolean {
    const prop = ctx.scope.properties.find(p => p.id === t.property_id);
    const orgId = t.organization_id || prop?.organization_id;
    const orgRoles = (ctx.scope.orgs.find(o => o.id === orgId)?.roles || []).map(r => r.toLowerCase().trim());
    const propRoles = (prop?.roles || []).map(r => r.toLowerCase().trim());
    return orgRoles.some(r => TICKET_MANAGER_ORG_ROLES.includes(r)) || propRoles.some(r => TICKET_MANAGER_PROPERTY_ROLES.includes(r));
}
const isTenantAt = (ctx: ActionContext, t: TicketRow) =>
    (ctx.scope.properties.find(p => p.id === t.property_id)?.roles || []).some(r => r.toLowerCase().trim() === 'tenant');

export const TICKET_CHANGES = ['close', 'start_work', 'complete', 'force_close', 'approve_completed_work', 'reject_completed_work', 'set_priority'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
type TicketChange = typeof TICKET_CHANGES[number];
const START_FROM = ['assigned', 'open', 'waitlist'];

/**
 * Change one service ticket the way the ticket screen does, never a raw status write:
 *  - the assigned person starts work (assigned, open or waiting) and completes it (in progress);
 *    completing closes it, or sends it to the client for approval when the property uses that;
 *  - a ticket manager (org or property admin) can force close it, or change its priority;
 *  - a tenant approves or rejects work that waits for their approval.
 * "close" works out which of these fits this user and this ticket. When the ticket is not theirs
 * but they may force close it, the preview says so plainly and asks the user to confirm a FORCE close.
 */
export async function previewUpdateTicket(ctx: ActionContext, a: {
    ticket_id?: string; ticket_number?: string; change: TicketChange; note?: string; priority?: typeof TICKET_PRIORITIES[number];
}): Promise<ActionResult> {
    const found = await findTicket(ctx, a);
    if (isResult(found)) return found;
    const { t, validationEnabled } = found;
    const me = ctx.caller.userId;
    const status = String(t.status || '');
    const mine = t.assigned_to === me;
    const manager = canManageTicket(ctx, t);
    const tenant = isTenantAt(ctx, t);
    const note = (a.note || '').trim();
    const who = clean(t.assignee?.full_name) || (t.assigned_to ? 'someone else' : 'nobody');
    const facts = [
        `Ticket: ${ticketLabel(t)}`,
        `Property: ${clean(t.property?.name) || t.property_id}`,
        `Now: ${clean(status, 30) || 'unknown'}, assigned to ${mine ? 'you' : who}${t.priority ? `, priority ${clean(t.priority, 20)}` : ''}${t.created_at ? `, raised ${clean(t.created_at, 10)}` : ''}`,
    ];
    const flow = `In the FMS the assigned person starts and completes the work${validationEnabled && !t.internal ? ', the client then approves it,' : ''} and an org or property admin can force close it.`;
    const refuse = (why: string) => need([`Not prepared: ${why}`, ...facts, flow, 'Tell the user this. Do not try another action to get around it unless the user asks for that action.'].join('\n'));

    let change: Exclude<TicketChange, 'close'>;
    if (a.change === 'close') {
        if (status === 'closed') return refuse('the ticket is already closed.');
        if (tenant && !manager && !mine) {
            if (status !== 'pending_validation') return refuse('as the client you close a ticket by approving the completed work, and this ticket is not waiting for your approval.');
            change = 'approve_completed_work';
        } else if (mine && status === 'in_progress') change = 'complete';
        else if (manager) change = 'force_close';
        else if (mine && START_FROM.includes(status)) return refuse('work on it has not been started. Ask the user whether to start work first (change "start_work"), then complete it.');
        else if (mine) return refuse(`it is ${status} and is not waiting for you; there is nothing for you to complete.`);
        else return refuse(`it is assigned to ${who}, not to you, and you are not an org or property admin who could force close it. You can add a comment instead.`);
    } else change = a.change;

    const params: Record<string, unknown> = {
        ticket_id: t.id, property_id: t.property_id, change,
        expect_status: t.status ?? null, expect_assigned_to: t.assigned_to ?? null, expect_priority: t.priority ?? null,
    };
    const done = (title: string, lines: string[]) => issue(ctx, 'update_ticket', params, [title, ...facts, ...lines], 'change');

    switch (change) {
        case 'start_work':
            if (!mine) return refuse(`only the assigned person (${who}) can start work on it.`);
            if (!START_FROM.includes(status)) return refuse(`it is ${status}; work can be started only when it is assigned, open or waiting.`);
            return done('Start work on this ticket?', ['Status: -> in progress.']);
        case 'complete': {
            if (!mine) return refuse(`only the assigned person (${who}) can complete it.${manager ? ' As an admin you could force close it instead, if the user wants that.' : ''}`);
            if (status !== 'in_progress') return refuse(`it is ${status}; it can be completed only while work is in progress${START_FROM.includes(status) ? ' (start work first)' : ''}.`);
            if (note) params.resolution_notes = note;
            const next = t.internal || !validationEnabled ? 'closed (this property does not ask the client to approve)' : 'waiting for the client to approve the work; it closes when they approve';
            return done('Complete this ticket?', [`Status: in progress -> ${next}.`, ...(note ? [`Resolution notes: ${note}`] : [])]);
        }
        case 'force_close': {
            if (!manager) return refuse('only an org or property admin can force close a ticket.');
            if (status === 'closed') return refuse('the ticket is already closed.');
            if (note) params.resolution_notes = note;
            const why = mine ? '' : `It is assigned to ${who}, not to you. `;
            const skips = status === 'pending_validation' ? ' It also skips the client\'s approval, which is still pending.' : '';
            const recorded = ['resolved'].includes(status) ? '' : ' The FMS records this as a FORCE CLOSE in the ticket history.';
            return done(`FORCE CLOSE this ticket? ${why}As an admin you can close it without the normal completion flow.${skips}${recorded}`,
                [`Status: ${status} -> closed.`, ...(note ? [`Reason / resolution notes: ${note}`] : ['No reason given. Ask the user if they want to add one (note).'])]);
        }
        case 'approve_completed_work':
        case 'reject_completed_work': {
            if (!tenant) return refuse('only a tenant of this property can approve or reject completed work.');
            if (status !== 'pending_validation') return refuse(`it is ${status}, not waiting for the client's approval.`);
            const ok = change === 'approve_completed_work';
            if (!ok && note.length < 5) return refuse('to reject the work, say what is still wrong (note).');
            params.validation_approved = ok;
            if (note) params.validation_note = note;
            return done(ok ? 'Approve the completed work?' : 'Reject the completed work?',
                [ok ? 'Status: waiting for your approval -> resolved.' : 'Status: waiting for your approval -> open again, back to the team.', ...(note ? [`Note: ${note}`] : [])]);
        }
        case 'set_priority':
            if (!manager) return refuse('only an org or property admin can change a ticket\'s priority.');
            if (!a.priority) return refuse('say the new priority (low, medium, high or urgent).');
            if (a.priority === t.priority) return refuse(`the priority is already ${a.priority}.`);
            params.priority = a.priority;
            return done('Change this ticket\'s priority?', [`Priority: ${clean(t.priority, 20) || 'none'} -> ${a.priority}.`]);
    }
}

export async function previewReassignTicket(ctx: ActionContext, a: { ticket_id?: string; ticket_number?: string; assignee_id: string }): Promise<ActionResult> {
    if (!UUID.test(a.assignee_id)) return need('assignee_id must be a person\'s id from list_users.');
    const found = await findTicket(ctx, a);
    if (isResult(found)) return found;
    const { t } = found;
    if (!isStaffAt(ctx, t.property_id!)) return need('Only staff can reassign tickets.');
    if (t.assigned_to === a.assignee_id) return need('The ticket is already assigned to that person.');
    // The people list answers only for organisation and property admins: the same people who reassign in the app.
    const res = await call(ctx, '/api/users/list', { propertyId: String(t.property_id) });
    if (!res.ok) return need(`Only organisation or property admins can reassign tickets through the assistant (the FMS said HTTP ${res.status}).`);
    type U = { id?: string; full_name?: string; email?: string; propertyRole?: string; is_active?: boolean };
    const users = ((parseJson(res.text) as { users?: U[] } | null)?.users || []);
    const u = users.find(x => x.id === a.assignee_id && x.is_active !== false);
    if (!u) return need('That person is not an active member of this property. Use list_users with the property id.');
    if ([...EXTERNAL_ROLES, 'guest'].includes(String(u.propertyRole || '').toLowerCase().trim())) return need('Tickets can only be assigned to staff, not to tenants, clients, vendors or guests.');
    const params = { ticket_id: t.id, property_id: t.property_id, assigned_to: a.assignee_id, expect_assigned_to: t.assigned_to ?? null };
    return issue(ctx, 'reassign_ticket', params, [
        'Reassign this ticket?',
        `Ticket: ${ticketLabel(t)}`,
        `Property: ${clean(t.property?.name) || t.property_id}, now ${clean(t.status, 30)}`,
        `From: ${clean(t.assignee?.full_name) || (t.assigned_to ? t.assigned_to : 'nobody')}`,
        `To: ${clean(u.full_name) || clean(u.email) || a.assignee_id}${u.propertyRole ? ` (${clean(u.propertyRole, 30)})` : ''}`,
        ...(['closed', 'resolved', 'pending_validation'].includes(String(t.status)) ? [`This ticket is ${clean(t.status, 30)}. Reassigning REOPENS it: its status becomes "assigned".`] : ['Its status becomes "assigned".']),
        'The new assignee is notified, as when reassigning on the ticket screen.',
    ], 'change');
}

type HrTicketRow = { id: string; organization_id?: string; ticket_number?: string; subject?: string; title?: string; status?: string | null; raised_by_user_id?: string | null; assigned_to_user_id?: string | null; assigned_to?: { full_name?: string } | null };
async function loadHrTicket(ctx: ActionContext, id: string): Promise<{ t: HrTicketRow | null; status: number }> {
    const res = await call(ctx, `/api/hr/tickets/${id}`, {});
    const t = (parseJson(res.text) as { data?: HrTicketRow } | null)?.data;
    return { t: res.ok && t?.id ? t : null, status: res.status };
}
export const HR_CHANGES = ['in_progress', 'resolve', 'accept_resolution', 'reopen'] as const;
const HR_CHANGE_LABEL: Record<typeof HR_CHANGES[number], string> = {
    in_progress: 'in progress',
    resolve: 'resolved (waiting for the person who raised it to accept)',
    accept_resolution: 'closed (resolution accepted)',
    reopen: 'reopened',
};

export async function previewUpdateHrTicket(ctx: ActionContext, a: { ticket_id: string; change: typeof HR_CHANGES[number]; note?: string }): Promise<ActionResult> {
    if (!UUID.test(a.ticket_id)) return need('ticket_id must be the id of an HR ticket from list_hr_tickets.');
    const note = (a.note || '').trim();
    if (a.change === 'resolve' && note.length < 5) return need('To resolve an HR ticket, give a resolution note (what was done).');
    const { t, status } = await loadHrTicket(ctx, a.ticket_id);
    if (!t || !t.organization_id) return need(`You cannot see that HR ticket (HTTP ${status}). Use list_hr_tickets.`);
    if (!ctx.scope.orgIds.has(t.organization_id)) return need('You do not belong to that HR ticket\'s organisation.');
    // The HR flow, checked on the ticket as it is now, before anything is prepared.
    const st = String(t.status || '');
    const waitingToAccept = ['pending_acknowledgement', 'resolved'].includes(st);
    const raisedByMe = t.raised_by_user_id === ctx.caller.userId;
    const handler = clean(t.assigned_to?.full_name) || 'the assigned handler';
    const stop = (why: string) => need(`Not prepared: ${why} (HR ticket ${clean(t.ticket_number, 30)}, now ${clean(st, 40) || 'unknown'}, handled by ${handler}). Tell the user; do not try another action to get around it unless they ask for it.`);
    if (a.change === 'in_progress' && (st === 'closed' || waitingToAccept || st === 'in_progress')) return stop(st === 'in_progress' ? 'it is already in progress' : 'it is already resolved or closed');
    if (a.change === 'resolve' && (st === 'closed' || waitingToAccept)) return stop('it is already resolved or closed');
    if (a.change === 'resolve' && raisedByMe) return stop('the person who raised a ticket cannot resolve it; the handler or HR does');
    if (a.change === 'accept_resolution' && !waitingToAccept) return stop('there is no resolution waiting to be accepted');
    if (a.change === 'accept_resolution' && !raisedByMe) return stop('only the person who raised it can accept the resolution');
    if (a.change === 'reopen' && !(waitingToAccept || st === 'closed')) return stop('only a resolved or closed ticket can be reopened');
    const params: Record<string, unknown> = {
        ticket_id: t.id, organization_id: t.organization_id, change: a.change, actor: ctx.caller.userId, expect_status: t.status ?? null,
        ...(note ? { note } : {}),
    };
    return issue(ctx, 'update_hr_ticket', params, [
        'Update this HR ticket?',
        `Ticket: ${clean(t.ticket_number, 30)} ${clean(t.subject ?? t.title)}`.trim(),
        `Status: ${clean(t.status, 40) || 'none'} -> ${HR_CHANGE_LABEL[a.change]}`,
        ...(note ? [`Note: ${note}`] : []),
        'The FMS checks you may do this: only the current handler or HR can start or resolve it, and only the person who raised it can accept the resolution.',
    ], 'change');
}

type LeadRow = { id: string; organization_id?: string; company_name?: string; contact_person?: string; status?: string | null; priority?: string | null; assigned_to?: string | null; next_followup_date?: string | null; is_archived?: boolean | null; status_name?: string | null; status_info?: { name?: string } | null };
async function loadLead(ctx: ActionContext, id: string): Promise<LeadRow | null> {
    const res = await call(ctx, `/api/crm/leads/${id}`, {});
    const l = (parseJson(res.text) as { lead?: LeadRow } | null)?.lead;
    return res.ok && l?.id ? l : null;
}
/** The lead the user means, read from the FMS; refused when it cannot be seen. */
async function leadFor(ctx: ActionContext, id: string): Promise<LeadRow | ActionResult> {
    if (!UUID.test(id)) return need('lead_id must be a lead id from list_crm_leads. Do not make one up.');
    const l = await loadLead(ctx, id);
    if (!l || !l.organization_id) return need('You cannot see that lead. Use list_crm_leads to find it.');
    if (!ctx.scope.orgIds.has(l.organization_id)) return need('You do not belong to that lead\'s organisation.');
    return l;
}
const isLeadResult = (x: LeadRow | ActionResult): x is ActionResult => 'ok' in x && 'text' in x && !('id' in x);
const leadFacts = (l: LeadRow) => [
    `Lead: ${clean(l.company_name) || clean(l.contact_person) || l.id}${l.company_name && l.contact_person ? ` (${clean(l.contact_person)})` : ''}`,
    ...(l.is_archived ? ['This lead is ARCHIVED. Check with the user that it is the right one.'] : []),
];

const LEAD_FIELDS = ['status', 'assigned_to', 'next_followup_date', 'priority'] as const;

export async function previewUpdateCrmLead(ctx: ActionContext, a: {
    lead_id: string; status_id?: string; assigned_to?: string; next_followup_date?: string; priority?: 'Low' | 'Medium' | 'High' | 'Urgent'; reason?: string;
}): Promise<ActionResult> {
    if (a.status_id && !UUID.test(a.status_id)) return need('status_id must be a status id from fetch_endpoint /api/crm/statuses.');
    if (a.assigned_to && !UUID.test(a.assigned_to)) return need('assigned_to must be a person\'s id from list_users.');
    if (a.next_followup_date && !DATE.test(a.next_followup_date)) return need('next_followup_date must be YYYY-MM-DD.');
    if (a.next_followup_date && a.next_followup_date < nowIst().date) return need('That follow-up date is in the past. Give today or a later date.');
    const found = await leadFor(ctx, a.lead_id);
    if (isLeadResult(found)) return found;
    const l = found;
    const changes: Record<string, string> = {};
    if (a.status_id && a.status_id !== l.status) changes.status = a.status_id;
    if (a.assigned_to && a.assigned_to !== l.assigned_to) changes.assigned_to = a.assigned_to;
    if (a.next_followup_date && a.next_followup_date !== String(l.next_followup_date || '').slice(0, 10)) changes.next_followup_date = a.next_followup_date;
    if (a.priority && a.priority !== l.priority) changes.priority = a.priority;
    if (!Object.keys(changes).length) return need('Nothing to change: the lead already has those values.');
    const reason = (a.reason || '').trim();
    let statusLine: string[] = [];
    let reasonNote: string | null = null;
    if (changes.status) {
        const res = await call(ctx, '/api/crm/statuses', { org_id: l.organization_id! });
        const list = ((parseJson(res.text) as { statuses?: { id: string; name?: string }[] } | null)?.statuses || []);
        const to = list.find(s => s.id === changes.status);
        if (!to) return need('That status is not one of this organisation\'s lead statuses. Use fetch_endpoint /api/crm/statuses with org_id.');
        const from = list.find(s => s.id === l.status);
        const toName = String(to.name || '').toLowerCase().trim();
        // As on the lead screen: Lost and Disqualified need a reason, saved as a note on the lead.
        if (['lost', 'disqualified'].includes(toName)) {
            if (reason.length < 3) return need(`Moving a lead to "${clean(to.name)}" needs a reason, as on the lead screen. Ask the user why.`);
            reasonNote = `[${clean(to.name, 40)}] ${reason}`;
        }
        // "Future" stages need a reminder date, which the lead screen sets up with the move.
        if (/future/i.test(toName)) return need(`Moving a lead to "${clean(to.name)}" also sets a future reminder in the FMS. Do this in the FMS app.`);
        statusLine = [`Status: ${clean(from?.name) || 'none'} -> ${clean(to.name)}`, ...(reasonNote ? [`Reason (saved as a note on the lead): ${reason}`] : [])];
    }
    let ownerLine: string[] = [];
    if (changes.assigned_to) {
        // The people list answers for admins; for others the FMS itself checks the new owner is in the organisation.
        const res = await call(ctx, '/api/users/list', { orgId: l.organization_id! });
        type U = { id?: string; full_name?: string; email?: string; is_active?: boolean };
        const users = res.ok ? ((parseJson(res.text) as { users?: U[] } | null)?.users || []) : null;
        const u = users?.find(x => x.id === changes.assigned_to);
        if (users && (!u || u.is_active === false)) return need('That person is not an active member of this organisation. Use list_users.');
        ownerLine = [`Owner: ${l.assigned_to || 'nobody'} -> ${u ? clean(u.full_name) || clean(u.email) : `${changes.assigned_to} (the FMS checks they are in this organisation)`}`];
    }
    const expect = Object.fromEntries(LEAD_FIELDS.map(f => [f, f === 'next_followup_date' ? (String(l[f] || '').slice(0, 10) || null) : (l[f] ?? null)]));
    const params = { lead_id: l.id, organization_id: l.organization_id, ...changes, expect, ...(reasonNote ? { reason_note: reasonNote } : {}) };
    return issue(ctx, 'update_crm_lead', params, [
        'Update this lead?',
        ...leadFacts(l),
        ...statusLine,
        ...ownerLine,
        ...(changes.next_followup_date ? [`Next follow-up: ${String(l.next_followup_date || '').slice(0, 10) || 'none'} -> ${changes.next_followup_date}`] : []),
        ...(changes.priority ? [`Priority: ${clean(l.priority, 20) || 'none'} -> ${changes.priority}`] : []),
    ], 'change');
}

type TaskRow = { id: string; status?: string | null; title?: string; employee_id?: string; template?: { title?: string; name?: string } | null; employee?: { full_name?: string } | null; assigned_date?: string };
async function loadTask(ctx: ActionContext, id: string): Promise<{ task: TaskRow; actor: { id?: string; role?: string } | null } | null> {
    const until = addDays(nowIst().date, 60);
    const board = await taskBoard(ctx, { from: '2000-01-01', to: until });
    const task = board?.tasks.find(x => x.id === id);
    return board && task ? { task, actor: board.actor } : null;
}
export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;

export async function previewUpdateTaskStatus(ctx: ActionContext, a: { task_id: string; status: typeof TASK_STATUSES[number] }): Promise<ActionResult> {
    if (!UUID.test(a.task_id)) return need('task_id must be a task id from my_tasks.');
    const found = await loadTask(ctx, a.task_id);
    if (!found) return need('That task is not in your task list. Use my_tasks to find it.');
    const { task: t, actor } = found;
    if (t.status === a.status) return need(`Nothing to change: the task is already ${a.status}.`);
    // The Task Manager's rule: your own tasks; a manager also those of people below them; a superuser only their own.
    const own = t.employee_id === ctx.caller.userId || (actor?.id && t.employee_id === actor.id);
    if (!own && actor?.role === 'superuser') return need('A superuser can change only their own tasks.');
    if (!own && actor?.role !== 'reporting_manager') return need(`This task belongs to ${clean(t.employee?.full_name) || 'someone else'}. You can change only your own tasks.`);
    const params = { task_id: t.id, status: a.status, actor: ctx.caller.userId, expect_status: t.status ?? null };
    return issue(ctx, 'update_task_status', params, [
        'Change this task\'s status?',
        `Task: ${clean(t.title ?? t.template?.title ?? t.template?.name) || t.id}${t.assigned_date ? ` (${clean(t.assigned_date, 10)})` : ''}`,
        `Person: ${own ? 'you' : clean(t.employee?.full_name) || 'someone else'}`,
        `Status: ${clean(t.status, 20) || 'none'} -> ${a.status}`,
        ...(own ? [] : ['The FMS makes the final check: the person must report to you.']),
        ...(t.status === 'completed' ? ['This reopens a completed task.'] : []),
    ], 'change');
}

/** Re-read before acting: a reason string when the record changed since the preview, otherwise null. */
const changedSince = (what: string, now: unknown) => `the ${what} changed since the preview (it is now ${clean(now, 40) || 'empty'})`;
const PRECHECK: Partial<Record<ActionName, (ctx: ActionContext, p: Record<string, unknown>) => Promise<string | null>>> = {
    update_ticket: async (ctx, p) => {
        const l = await loadTicket(ctx, String(p.ticket_id));
        if (!l) return 'the ticket can no longer be read';
        if ((l.t.status ?? null) !== p.expect_status) return changedSince('ticket status', l.t.status);
        if ((l.t.assigned_to ?? null) !== p.expect_assigned_to) return changedSince('ticket assignee', l.t.assignee?.full_name || l.t.assigned_to);
        if ((l.t.priority ?? null) !== p.expect_priority) return changedSince('ticket priority', l.t.priority);
        return null;
    },
    reassign_ticket: async (ctx, p) => {
        const l = await loadTicket(ctx, String(p.ticket_id));
        if (!l) return 'the ticket can no longer be read';
        return (l.t.assigned_to ?? null) !== p.expect_assigned_to ? changedSince('ticket assignee', l.t.assignee?.full_name || l.t.assigned_to) : null;
    },
    update_hr_ticket: async (ctx, p) => {
        const { t } = await loadHrTicket(ctx, String(p.ticket_id));
        if (!t) return 'the HR ticket can no longer be read';
        return (t.status ?? null) !== p.expect_status ? changedSince('HR ticket status', t.status) : null;
    },
    update_crm_lead: async (ctx, p) => {
        const l = await loadLead(ctx, String(p.lead_id));
        if (!l) return 'the lead can no longer be read';
        const expect = (p.expect || {}) as Record<string, unknown>;
        for (const f of LEAD_FIELDS) {
            const now = f === 'next_followup_date' ? (String(l[f] || '').slice(0, 10) || null) : (l[f] ?? null);
            if (now !== (expect[f] ?? null)) return changedSince(`lead ${f.replace(/_/g, ' ')}`, now);
        }
        return null;
    },
    update_task_status: async (ctx, p) => {
        const f = await loadTask(ctx, String(p.task_id));
        if (!f) return 'the task can no longer be read';
        return (f.task.status ?? null) !== p.expect_status ? changedSince('task status', f.task.status) : null;
    },
};

const pick = (p: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
const HR_BODY: Record<typeof HR_CHANGES[number], (p: Record<string, unknown>) => Record<string, unknown>> = {
    in_progress: () => ({ status: 'in_progress' }),
    resolve: p => ({ status: 'pending_acknowledgement', action: 'resolve', resolution_note: p.note, resolved_by_user_id: p.actor }),
    accept_resolution: p => ({ status: 'closed', action: 'acknowledge', ...(p.note ? { acknowledgement_note: p.note } : {}) }),
    reopen: p => ({ status: 'reopened', action: 'reopen', ...(p.note ? { acknowledgement_note: p.note } : {}) }),
};

// ---------- where each confirmed action goes, and what "done" says ----------

type Target = { path: string; method: 'POST' | 'PATCH'; body: unknown; query?: Record<string, string>; then?: Omit<Target, 'then'> };
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
    // Updates: only the listed fields are ever sent, for one record.
    // Ticket changes go exactly as the ticket screen sends them.
    update_ticket: p => {
        if (!UUID.test(String(p.ticket_id || ''))) return null;
        const notes = p.resolution_notes ? { resolution_notes: p.resolution_notes } : {};
        const body: Record<string, unknown> | null =
            p.change === 'start_work' ? { status: 'in_progress' }
                : p.change === 'complete' ? { action: 'complete', ...notes }
                    : p.change === 'force_close' ? { status: 'closed', ...notes }
                        : p.change === 'approve_completed_work' || p.change === 'reject_completed_work'
                            ? { action: 'validate', validation_approved: p.change === 'approve_completed_work', ...(p.validation_note ? { validation_note: p.validation_note } : {}) }
                            : p.change === 'set_priority' && TICKET_PRIORITIES.includes(p.priority as typeof TICKET_PRIORITIES[number]) ? { priority: p.priority }
                                : null;
        return body ? { path: `/api/tickets/${p.ticket_id}`, method: 'PATCH', body } : null;
    },
    // The ticket screen's own reassign call.
    reassign_ticket: p => (UUID.test(String(p.ticket_id || '')) && UUID.test(String(p.assigned_to || '')) ? { path: '/api/tickets/reassign', method: 'POST', body: { ticketId: p.ticket_id, newAssigneeId: p.assigned_to, forceAssign: true } } : null),
    update_hr_ticket: p => {
        const change = p.change as typeof HR_CHANGES[number];
        if (!UUID.test(String(p.ticket_id || '')) || !HR_CHANGES.includes(change)) return null;
        return { path: `/api/hr/tickets/${p.ticket_id}`, method: 'PATCH', body: { ...HR_BODY[change](p), actor_user_id: p.actor } };
    },
    // A Lost or Disqualified move also adds the reason as a note, as the lead screen does.
    update_crm_lead: p => (UUID.test(String(p.lead_id || '')) ? {
        path: `/api/crm/leads/${p.lead_id}`, method: 'PATCH', body: pick(p, [...LEAD_FIELDS]), query: { org_id: String(p.organization_id) },
        ...(p.reason_note ? { then: { path: '/api/crm/notes', method: 'POST' as const, body: { lead_id: p.lead_id, note: p.reason_note } } } : {}),
    } : null),
    update_task_status: p => (UUID.test(String(p.task_id || '')) && TASK_STATUSES.includes(p.status as typeof TASK_STATUSES[number])
        ? { path: '/api/task-manager/tasks', method: 'POST', body: { action: 'update_status', actorId: p.actor, taskId: p.task_id, status: p.status } } : null),
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
    update_ticket: (d, p) => {
        const t = (d.ticket || {}) as TicketRow;
        const what = p.change === 'force_close' ? 'force closed' : p.change === 'start_work' ? 'started' : p.change === 'complete' ? 'completed'
            : p.change === 'approve_completed_work' ? 'approved' : p.change === 'reject_completed_work' ? 'sent back to the team' : 'updated';
        return `Done. Ticket ${what}${t.status ? `; its status is now ${clean(t.status, 30)}` : ''}${p.change === 'set_priority' && t.priority ? `, priority ${clean(t.priority, 20)}` : ''}.`;
    },
    reassign_ticket: () => 'Done. Ticket reassigned; the new assignee is notified.',
    update_hr_ticket: d => { const t = (d.data || {}) as HrTicketRow; return `Done. HR ticket updated${t.status ? `: status is now ${clean(t.status, 40)}` : ''}.`; },
    update_crm_lead: (_d, p) => `Done. Lead updated${p.reason_note ? ', and the reason is saved as a note' : ''}.`,
    update_task_status: (_d, p) => `Done. Task marked ${p.status}.`,
};
