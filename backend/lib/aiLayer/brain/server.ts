/**
 * Real implementations of the brain's dependencies (database, storage, model, sender). Server only.
 *
 * Reads use the service-role client, so EVERY query here is limited in code to the person's propertyIds, organisation
 * and record rule (a client: tickets they raised; a vendor: tickets assigned to them). Those values come from
 * loadActor(), never from the model or the browser. Writes do not get a new path: tickets go through the same
 * functions the app and the WhatsApp assistant already use, bookings through the same database function, task files
 * through the Task Manager's own upload, and task actions through the Task Manager's own WorkspaceService (as the task
 * assistant does), which each apply their own access checks again.
 */
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAiData, supabaseAuditStore } from '../server';
import type { ActorContext } from '../types';
import { parseBrainSettings, type BrainSettings, type RoleClass } from './config';
import { NO_LEARNING, toLesson, type Learned } from './learning/lessons';
import type { TurnDeps, TurnOutput } from './loop/turn';
import { liveBrainModel } from './providers/router';
import type { AttachmentRef, BookingRow, BrainChannel, BrainData, EpisodeRow, MemoryFact, RoomRow, StagedFile, TicketDetail } from './types';

const CLOSED_STATUSES = ['resolved', 'completed', 'closed'];
/** Staged files share the Task Manager's private bucket, under their own folder. */
export const STAGING_BUCKET = 'task-attachments';
export const STAGING_PREFIX = 'brain-staging';
export const STAGING_HOURS = 24;
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42703', 'PGRST204']);
const isMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as T;
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The org's brain settings. A missing table or row means OFF (fail closed). */
export async function loadBrainSettings(admin: SupabaseClient, orgId: string): Promise<{ settings: BrainSettings; tableMissing: boolean }> {
    const { data, error } = await admin.from('ai_brain_settings').select('config').eq('organization_id', orgId).maybeSingle();
    if (error) {
        if (!isMissing(error)) throw new Error(error.message);
        return { settings: parseBrainSettings({ mode: 'off' }), tableMissing: true };
    }
    return { settings: parseBrainSettings(data?.config ?? { mode: 'off' }), tableMissing: false };
}

/** Property nicknames live in the AI Access settings ("DMC", "Mafatlal"); the brain reads them, nothing else from there. */
export async function loadAliases(admin: SupabaseClient, orgId: string): Promise<Record<string, string[]>> {
    const { data, error } = await admin.from('ai_access_settings').select('config').eq('organization_id', orgId).maybeSingle();
    const aliases = error ? null : (data?.config as { aliases?: unknown } | null)?.aliases;
    if (!aliases || typeof aliases !== 'object') return {};
    return Object.fromEntries(Object.entries(aliases as Record<string, unknown>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 10)]));
}

// ── Thread, staged files, trace ───────────────────────────────────────────────────────────────────────────────────

export function supabaseThreadStore(admin: SupabaseClient) {
    return {
        async load(orgId: string, userId: string, shadow: boolean): Promise<unknown | null> {
            const { data, error } = await admin.from('ai_brain_threads').select('state').eq('organization_id', orgId).eq('user_id', userId).eq('shadow', shadow).maybeSingle();
            return error || !data ? null : data.state;
        },
        async save(orgId: string, userId: string, shadow: boolean, state: unknown): Promise<void> {
            const { error } = await admin.from('ai_brain_threads').upsert(
                { organization_id: orgId, user_id: userId, shadow, state, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,user_id,shadow' });
            if (error) throw new Error(error.message);
        },
    };
}

interface AttachmentRecord { id: string; handle: string; kind: 'image' | 'document'; mime: string; caption: string | null; received_at: string; storage_path: string; sha256: string }
const toRef = (r: AttachmentRecord): AttachmentRef => ({ id: r.id, handle: r.handle, kind: r.kind, mime: r.mime, caption: r.caption, receivedAt: r.received_at });

export function supabaseAttachmentStore(admin: SupabaseClient) {
    const open = (orgId: string, userId: string) => admin.from('ai_brain_attachments')
        .select('id, handle, kind, mime, caption, received_at, storage_path, sha256')
        .eq('organization_id', orgId).eq('user_id', userId).is('used_at', null).gt('expires_at', new Date().toISOString()).order('received_at', { ascending: true }).limit(10);
    return {
        async listOpen(orgId: string, userId: string): Promise<AttachmentRef[]> {
            const { data, error } = await open(orgId, userId);
            return error ? [] : ((data || []) as AttachmentRecord[]).map(toRef);
        },
        /** The same bytes sent again within the window are the same file, not a second one. */
        async findOpenBySha(orgId: string, userId: string, sha256: string): Promise<AttachmentRef | null> {
            const { data, error } = await open(orgId, userId);
            const hit = error ? null : ((data || []) as AttachmentRecord[]).find(r => r.sha256 === sha256);
            return hit ? toRef(hit) : null;
        },
        async save(input: { orgId: string; userId: string; handle: string; kind: 'image' | 'document'; mime: string; bytes: Buffer; sha256: string; caption: string | null; channel: BrainChannel; messageId: string | null; extension: string }): Promise<AttachmentRef> {
            const path = `${STAGING_PREFIX}/${input.orgId}/${input.userId}/${crypto.randomUUID()}.${input.extension}`;
            const up = await admin.storage.from(STAGING_BUCKET).upload(path, input.bytes, { contentType: input.mime, upsert: false });
            if (up.error) throw new Error(`staging upload failed: ${up.error.message}`);
            const now = new Date();
            const { data, error } = await admin.from('ai_brain_attachments').insert({
                organization_id: input.orgId, user_id: input.userId, handle: input.handle, kind: input.kind, mime: input.mime, size_bytes: input.bytes.length,
                sha256: input.sha256, storage_path: path, caption: input.caption, channel: input.channel, message_id: input.messageId,
                received_at: now.toISOString(), expires_at: new Date(now.getTime() + STAGING_HOURS * 3600_000).toISOString(),
            }).select('id, handle, kind, mime, caption, received_at, storage_path, sha256').single();
            if (error || !data) throw new Error(`staging row failed: ${error?.message ?? 'no row'}`);
            return toRef(data as AttachmentRecord);
        },
    };
}

export interface TurnRecord {
    orgId: string; userId: string; channel: BrainChannel; shadow: boolean; messageId: string | null;
    userText: string | null; hadFile: boolean; out: TurnOutput;
    /** The kind of login (staff / client / vendor): lets the console judge an answer without showing who the person is. */
    roleClass?: RoleClass | null;
}

/**
 * Columns of ai_brain_turns that arrive with later migrations (role_class: 20261114000003, learning: 20261114000004).
 * Until a migration is applied its column is left out of the write; it is looked for again after five minutes, so
 * applying the migration needs no restart.
 */
const laterColumns = new Map<string, number>();

/** One trace row per turn. Never throws: the record must not break a conversation. */
export async function recordTurn(admin: SupabaseClient, r: TurnRecord): Promise<void> {
    const t = r.out.trace;
    // An HR matter is never kept as text, here or anywhere else.
    const hr = t.reason === 'hr_matter';
    try {
        const row: Record<string, unknown> = {
            organization_id: r.orgId, user_id: hr ? null : r.userId, channel: r.channel, shadow: r.shadow, message_id: r.messageId,
            user_text: hr ? null : (r.userText ? r.userText.slice(0, 1500) : null), reply_text: hr ? null : (r.out.reply?.text.slice(0, 2000) ?? null),
            outcome: t.outcome, reason: t.reason, skill_id: t.skillId, handoff_to: r.out.handoffTo, lang: r.out.lang,
            model: t.modelCalls.at(-1)?.model ?? null, key_slot: t.modelCalls.at(-1)?.keySlot ?? null,
            tokens_in: t.tokensIn, tokens_out: t.tokensOut, cache_read: t.modelCalls.reduce((n, c) => n + c.cacheRead, 0), cost_usd: t.costUsd,
            latency_ms: t.latencyMs, grounded: t.grounded, had_file: r.hadFile,
            model_calls: t.modelCalls, tool_calls: hr ? [] : t.toolCalls, hops: t.hops,
        };
        const extra: Record<string, unknown> = {};
        if (r.roleClass) extra.role_class = r.roleClass;
        if (t.lessons?.length || t.guidance != null) extra.learning = { lessons: t.lessons ?? [], guidance: t.guidance ?? null };
        for (const [col, at] of laterColumns) if (Date.now() - at > 300_000) laterColumns.delete(col);
        let cols = Object.keys(extra).filter(c => !laterColumns.has(c));
        const write = () => admin.from('ai_brain_turns').insert({ ...row, ...Object.fromEntries(cols.map(c => [c, extra[c]])) });
        let { error } = await write();
        while (error && cols.length) {
            const message = error.message || '';
            const absent = cols.find(c => new RegExp(`\\b${c}\\b`).test(message));
            if (!absent) break;
            laterColumns.set(absent, Date.now());
            cols = cols.filter(c => c !== absent);
            ({ error } = await write());
        }
        if (error && !isMissing(error)) console.warn('[Brain] turn record skipped:', error.message);
    } catch (err) {
        console.warn('[Brain] turn record skipped:', err instanceof Error ? err.message : err);
    }
}

// ── Learning: lessons and guidance ────────────────────────────────────────────────────────────────────────────────

const learnedCache = new Map<string, { at: number; value: Learned }>();
const LEARNED_TTL_MS = 60_000;

/** Drop the cached lessons and guidance of an organisation (after a judgement or a guidance change on this server). */
export const forgetLearning = (orgId: string): void => { learnedCache.delete(orgId); };

/**
 * What this organisation's Tech team has taught the brain: the active judged cases (as lessons) and the live guidance
 * note. Read at most once a minute per organisation. Never throws: a missing table or a database error means "nothing
 * learned", and the brain answers as it would without learning.
 */
export async function loadLearning(admin: SupabaseClient, orgId: string): Promise<Learned> {
    const hit = learnedCache.get(orgId);
    if (hit && Date.now() - hit.at < LEARNED_TTL_MS) return hit.value;
    let value: Learned = NO_LEARNING;
    try {
        const [cases, guide] = await Promise.all([
            admin.from('ai_brain_eval_cases').select('id, message_text, role_class, verdict, expected_outcome, expected_skill, note')
                .eq('organization_id', orgId).eq('active', true).order('created_at', { ascending: false }).limit(300),
            admin.from('ai_brain_guidance').select('version, body').eq('organization_id', orgId).eq('status', 'live').maybeSingle(),
        ]);
        if (cases.error && !isMissing(cases.error)) console.warn('[Brain] lessons could not be read:', cases.error.message);
        if (guide.error && !isMissing(guide.error)) console.warn('[Brain] guidance could not be read:', guide.error.message);
        const lessons = cases.error ? [] : ((cases.data || []) as Parameters<typeof toLesson>[0][]).map(toLesson).filter((l): l is NonNullable<typeof l> => !!l);
        const g = guide.error ? null : guide.data as { version: number; body: string } | null;
        value = { lessons, guidance: g?.body ? { version: Number(g.version) || 0, text: String(g.body) } : null };
    } catch (err) {
        console.warn('[Brain] learning could not be read:', err instanceof Error ? err.message : err);
    }
    if (learnedCache.size > 500) learnedCache.clear();
    learnedCache.set(orgId, { at: Date.now(), value });
    return value;
}

// ── Data ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LiveDataContext {
    orgId: string;
    userId: string;
    channel: BrainChannel;
    /** WhatsApp: the person's number, for the ticket function the WhatsApp assistant already uses. */
    phone?: string;
    /** In-app chat: the request URL, so a ticket is raised through the app's own handler as the logged-in person. */
    requestUrl?: string;
    episodeDays: number;
}

type TicketScope = { orgId: string; propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string };

export function liveBrainData(admin: SupabaseClient, c: LiveDataContext): BrainData {
    const base = supabaseAiData(admin, c.requestUrl ?? 'http://localhost');
    const SELECT = 'id, ticket_number, title, status, priority, property_id, created_at, assigned_to, photo_before_url';
    type Row = { id: string; ticket_number: string | null; title: string | null; status: string | null; priority: string | null; property_id: string; created_at: string | null; assigned_to: string | null; photo_before_url: string | null };

    const scoped = (q: TicketScope) => {
        let query = admin.from('tickets').select(SELECT).eq('organization_id', q.orgId).in('property_id', q.propertyIds);
        if (q.recordRule === 'raised_by_me') query = query.eq('raised_by', q.userId);
        if (q.recordRule === 'assigned_to_me') query = query.eq('assigned_to', q.userId);
        return query;
    };
    const names = async (ids: Array<string | null>): Promise<Map<string, string>> => {
        const wanted = [...new Set(ids.filter((x): x is string => !!x))];
        if (!wanted.length) return new Map();
        const { data } = await admin.from('users').select('id, full_name').in('id', wanted);
        return new Map(((data || []) as Array<{ id: string; full_name: string | null }>).map(u => [u.id, (u.full_name || '').split(' ')[0]])); // first name only
    };
    const detail = (r: Row, who: Map<string, string>): TicketDetail => ({
        id: r.id, ticketNumber: String(r.ticket_number ?? ''), title: String(r.title ?? ''), status: String(r.status ?? ''), priority: r.priority ?? null,
        propertyId: r.property_id, createdAt: String(r.created_at ?? ''), assigneeName: (r.assigned_to && who.get(r.assigned_to)) || null, hasPhoto: !!r.photo_before_url,
    });
    /**
     * Puts a staged photo on a ticket of THIS organisation that has none. true only when a row really changed: a ticket
     * that got a photo in the meantime, or is not this org's, reads as "not attached". Never undoes the ticket.
     */
    const attachPhoto = async (ticketId: string, photo: StagedFile): Promise<boolean> => {
        const mine = await admin.from('tickets').select('id').eq('id', ticketId).eq('organization_id', c.orgId).is('photo_before_url', null).maybeSingle();
        if (mine.error || !mine.data) return false;
        const { uploadMediaToStorage } = await import('@/backend/lib/whatsapp/processMessage');
        const url = await uploadMediaToStorage('staged', ticketId, undefined, Buffer.from(photo.bytes));
        if (!url) return false;
        const { data, error } = await admin.from('tickets').update({ photo_before_url: url }).eq('id', ticketId).eq('organization_id', c.orgId).is('photo_before_url', null).select('id');
        return !error && (data || []).length === 1;
    };

    return {
        countTickets: q => base.countTickets(q),
        listTickets: (q, limit) => base.listTickets(q, limit),
        readingsStatus: (ids, date) => base.readingsStatus(ids, date),
        consumption: (ids, from, to) => base.consumption(ids, from, to),

        async ticketDetail(q) {
            if (!q.propertyIds.length) return null;
            const { data, error } = await scoped(q).eq('ticket_number', q.ticketNumber).limit(1);
            if (error) throw new Error(error.message);
            const row = ((data || []) as Row[])[0];
            return row ? detail(row, await names([row.assigned_to])) : null;
        },
        async recentTickets(q, limit) {
            if (!q.propertyIds.length) return [];
            let query = scoped(q).gte('created_at', new Date(Date.now() - 180 * 86_400_000).toISOString());
            if (q.openOnly) query = query.not('status', 'in', `(${CLOSED_STATUSES.join(',')})`);
            const rows = must(await query.order('created_at', { ascending: false }).limit(limit)) as Row[];
            const who = await names(rows.map(r => r.assigned_to));
            return rows.map(r => detail(r, who));
        },
        async createTicket(input) {
            let ticket: { id?: string; ticket_number?: string; status?: string; assigned_to?: string | null } | null | undefined;
            if (c.channel === 'whatsapp') {
                if (!c.phone) throw new Error('no phone for a WhatsApp ticket');
                // The same helper the WhatsApp assistant uses, as the identified person, for a building already checked
                // against their scope. requestId = the confirmed operation id, so one confirmation can never create two.
                const { processIncomingMessage } = await import('@/backend/lib/whatsapp/processMessage');
                ticket = await processIncomingMessage(c.phone, input.description, null, null, false, null, null, false, input.propertyId, null,
                    { userId: c.userId, requestId: input.opId, suppressReply: true, throwOnError: true, skipTaskRouting: true }) as typeof ticket;
            } else {
                // The app's own ticket handler, as the logged-in person (cookie session of this request).
                if (!c.requestUrl) throw new Error('no request for an in-app ticket');
                const prop = await admin.from('properties').select('organization_id').eq('id', input.propertyId).single();
                if (prop.error || !prop.data) throw new Error('property not found');
                const { POST } = await import('@/app/api/tickets/route');
                const res = await POST(new NextRequest(new URL('/api/tickets', c.requestUrl), {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: input.description, title: input.title, propertyId: input.propertyId, organizationId: prop.data.organization_id, ...(input.priority ? { priority: input.priority } : {}) }),
                }));
                const body = await res.json().catch(() => ({}));
                if (!res.ok || !body?.ticket) throw new Error(`ticket route returned ${res.status}`);
                ticket = body.ticket;
            }
            if (!ticket?.ticket_number || !ticket.id) throw new Error('the ticket helper returned no ticket');
            const photoAttached = input.photo
                ? await attachPhoto(ticket.id, input.photo).catch(err => { console.warn('[Brain] ticket photo could not be attached:', err instanceof Error ? err.message : err); return false; })
                : false;
            const who = await names([ticket.assigned_to ?? null]);
            return { ticketNumber: String(ticket.ticket_number), status: String(ticket.status || 'open'), assigneeName: (ticket.assigned_to && who.get(ticket.assigned_to)) || null, photoAttached };
        },
        async addTicketPhoto(input) {
            if (!(await attachPhoto(input.ticketId, input.photo))) throw new Error('the photo could not be stored');
        },

        async listRooms(propertyId): Promise<RoomRow[]> {
            const { assistantRoomServices } = await import('@/backend/lib/whatsapp/assistant/runtime');
            return (await assistantRoomServices.rooms(propertyId)).map(r => ({ id: r.id, name: r.name, propertyId: r.property_id }));
        },
        async availableRooms(propertyId, date, startTime, endTime): Promise<RoomRow[]> {
            const { assistantRoomServices } = await import('@/backend/lib/whatsapp/assistant/runtime');
            return (await assistantRoomServices.availableRooms(propertyId, date, startTime, endTime)).map(r => ({ id: r.id, name: r.name, propertyId: r.property_id }));
        },
        async myBookings(userId, propertyIds, fromDate): Promise<BookingRow[]> {
            if (!propertyIds.length) return [];
            const rows = must(await admin.from('meeting_room_bookings').select('id, property_id, booking_date, start_time, end_time, status, room:meeting_rooms(name)')
                .eq('user_id', userId).in('property_id', propertyIds).gte('booking_date', fromDate).order('booking_date', { ascending: false }).order('start_time', { ascending: false }).limit(20)) as unknown as
                Array<{ id: string; property_id: string; booking_date: string; start_time: string; end_time: string; status: string | null; room: { name: string } | { name: string }[] | null }>;
            return rows.map(r => ({ id: r.id, propertyId: r.property_id, date: r.booking_date, startTime: r.start_time, endTime: r.end_time, status: String(r.status ?? ''), roomName: (Array.isArray(r.room) ? r.room[0]?.name : r.room?.name) ?? 'Room' }));
        },
        async bookRoom(input) {
            // The same transactional function the WhatsApp assistant books with: it checks access, credits and the slot
            // again, and treats the same request id as the same booking.
            const { assistantRoomServices } = await import('@/backend/lib/whatsapp/assistant/runtime');
            const booking = await assistantRoomServices.bookRange({ userId: input.userId, propertyId: input.propertyId, roomId: input.roomId, date: input.date, startTime: input.startTime, endTime: input.endTime, requestId: input.opId, interpreter: true, purpose: input.purpose });
            return { bookingId: String((booking as { id?: string } | null)?.id ?? input.opId) };
        },

        async myTasks(userId) {
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            const { TaskAccessService } = await import('@/task-manager/TaskAccessService');
            const { todayInIndia } = await import('@/task-manager/TaskImportParser');
            const emp = await TaskDatabaseService.getEmployeeById(userId);
            if (!emp || !emp.active) return null;
            const access = await TaskAccessService.check({ userId: emp.id, departmentId: emp.department_id });
            if (!access.allowed) return null;
            const rows = await TaskDatabaseService.getNumberedList({ employeeId: emp.id, date: todayInIndia(), departmentId: emp.department_id ?? null });
            return rows.filter(t => t.status !== 'completed').map(t => ({ id: t.id, n: t.listNumber, title: String(t.title ?? ''), status: String(t.status ?? '') }));
        },
        async addTaskFile(input) {
            // The Task Manager's own upload: it checks that this person may see the task, the file type and the limits.
            const { TaskAttachmentService } = await import('@/task-manager/TaskAttachmentService');
            await TaskAttachmentService.upload(input.userId, { taskIds: [input.taskId], fileName: input.file.fileName, bytes: input.file.bytes });
        },

        // ── Tasks in the brain (owner 2026-11-15) ──
        // The same functions, with the same arguments, as the task assistant's own (task-manager/brain/live.ts): each
        // re-checks that this person may do this to this task or this colleague, and sends the alerts it always sends.
        async taskPeople(userId) {
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            const { TaskAccessService } = await import('@/task-manager/TaskAccessService');
            const { PermissionService } = await import('@/task-manager/PermissionService');
            const actor = await TaskDatabaseService.getEmployeeById(userId);
            if (!actor || !actor.active) return null;
            if (!(await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id })).allowed) return null;
            // "May give work to": the rule assigning uses, only people in departments where the Task Manager is ON and
            // who are unlocked, never someone hidden from this person (the task assistant's readTeam does the same).
            const [pool, active] = await Promise.all([TaskDatabaseService.getAllEmployees(), TaskAccessService.activeDepartmentIds()]);
            const candidates = (await PermissionService.visibleAndAssignable(actor, pool))
                .filter(e => e.id !== actor.id && e.active !== false && !!e.department_id && active.has(e.department_id) && !PermissionService.hiddenFrom(actor, e));
            return (await TaskAccessService.partition(candidates)).allowed.map(e => ({ id: e.id, name: e.name, department: e.department_name ?? null }));
        },
        async tasksGiven(userId) {
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            const { TaskAccessService } = await import('@/task-manager/TaskAccessService');
            const { WorkspaceService } = await import('@/task-manager/WorkspaceService');
            const actor = await TaskDatabaseService.getEmployeeById(userId);
            if (!actor || !actor.active) return null;
            if (!(await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id })).allowed) return null;
            const [given, people] = await Promise.all([WorkspaceService.openTasksGivenBy(actor.id, 30), TaskDatabaseService.getAllEmployees()]);
            const rows = given.slice(0, 30);
            const name = new Map(people.map(p => [p.id, p.name]));
            const status = new Map<string, string>();
            if (rows.length) {
                const { data } = await admin.from('task_assignments').select('id, status').in('id', rows.map(r => r.id));
                for (const s of (data || []) as Array<{ id: string; status: string | null }>) status.set(s.id, String(s.status ?? 'pending'));
            }
            return rows.map(r => ({ id: r.id, title: String(r.title ?? ''), assigneeName: name.get(r.employee_id) ?? 'a colleague', status: status.get(r.id) ?? 'pending', date: r.assigned_date }));
        },
        async createTasks(input) {
            const { WorkspaceService } = await import('@/task-manager/WorkspaceService');
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            // Several tasks for one person: created quietly, then ONE "new task" alert listing those really created.
            const group = input.titles.length > 1;
            const done: string[] = [], failed: Array<{ label: string; why: string }> = [];
            for (const title of input.titles) {
                try {
                    await WorkspaceService.assign(input.userId, { targetUserId: input.assigneeId, title, date: input.date, ...(input.note ? { note: input.note } : {}), ...(group ? { notify: false } : {}) });
                    done.push(title);
                } catch (err) { failed.push({ label: title, why: err instanceof Error && err.message ? err.message : 'something went wrong' }); }
            }
            if (group && done.length) await WorkspaceService.alertAssigned(input.userId, input.assigneeId, done, input.date).catch(() => undefined); // the tasks exist; a failed alert must not fail them
            const who = await TaskDatabaseService.getEmployeeById(input.assigneeId).catch(() => null);
            return { done, failed, assigneeName: who?.name ?? '' };
        },
        async completeTasks(input) {
            const { WorkspaceService } = await import('@/task-manager/WorkspaceService');
            // Quietly, then ONE grouped "task completed" notice to each giver, as the task assistant does.
            const done: string[] = [], failed: Array<{ label: string; why: string }> = [];
            for (const taskId of input.taskIds) {
                try {
                    await WorkspaceService.setStatus(input.userId, { taskId, status: 'completed', notifyGiver: false, ...(input.remark ? { remark: input.remark } : {}) });
                    done.push(taskId);
                } catch (err) { failed.push({ label: taskId, why: err instanceof Error && err.message ? err.message : 'something went wrong' }); }
            }
            if (done.length) await WorkspaceService.notifyCompleted(done).catch(() => undefined); // the tasks are done; a failed notice must not fail them
            return { done, failed };
        },
        async handOverTask(input) {
            const { WorkspaceService } = await import('@/task-manager/WorkspaceService');
            const r = await WorkspaceService.handOver(input.userId, { taskId: input.taskId, targetUserId: input.toId, ...(input.note ? { note: input.note } : {}) });
            return { toName: r.toName };
        },
        async remindTasks(input) {
            const { WorkspaceService } = await import('@/task-manager/WorkspaceService');
            return WorkspaceService.remindTasks(input.userId, { taskIds: input.taskIds, via: 'whatsapp' });
        },

        async askKnowledge(input) {
            try {
                const { askWiki } = await import('@/backend/lib/wiki/ask');
                const out = await askWiki(input);
                return { found: out.status === 'answered' && !!out.answer.trim(), answer: out.answer };
            } catch (err) {
                console.warn('[Brain] wiki lookup failed:', err instanceof Error ? err.message : err);
                return { found: false, answer: '' };
            }
        },

        async listMemory(orgId, userId): Promise<MemoryFact[]> {
            const { data, error } = await admin.from('ai_brain_memory').select('key, value, label, source, confirmed_at, last_used_at').eq('organization_id', orgId).eq('user_id', userId).limit(20);
            if (error) { if (isMissing(error)) return []; throw new Error(error.message); }
            return ((data || []) as Array<{ key: string; value: string; label: string; source: string | null; confirmed_at: string | null; last_used_at: string | null }>)
                .map(m => ({ key: m.key, value: m.value, label: m.label, source: m.source, confirmedAt: m.confirmed_at, lastUsedAt: m.last_used_at }));
        },
        async saveMemory(input) {
            const { error } = await admin.from('ai_brain_memory').upsert(
                { organization_id: input.orgId, user_id: input.userId, key: input.key, value: input.value, label: input.label, source: input.source, confirmed_at: new Date().toISOString() },
                { onConflict: 'organization_id,user_id,key' });
            if (error) throw new Error(error.message);
        },
        async forgetMemory(orgId, userId, key) {
            let q = admin.from('ai_brain_memory').delete({ count: 'exact' }).eq('organization_id', orgId).eq('user_id', userId);
            if (key) q = q.eq('key', key);
            const { error, count } = await q;
            if (error) throw new Error(error.message);
            return count ?? 0;
        },
        async recallEpisodes(orgId, userId, query, limit): Promise<EpisodeRow[]> {
            const since = new Date(Date.now() - c.episodeDays * 86_400_000).toISOString();
            const mine = () => admin.from('ai_brain_episodes').select('summary, created_at').eq('organization_id', orgId).eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(limit);
            // Plain words only: anything else would be read as search syntax.
            const words = (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 8);
            let rows = words.length ? await mine().textSearch('fts', words.join(' | '), { config: 'simple' }) : await mine();
            // Nothing matched the words: the latest actions are still the best answer to "last time".
            if (!rows.error && !(rows.data || []).length && words.length) rows = await mine();
            if (rows.error) { if (isMissing(rows.error)) return []; throw new Error(rows.error.message); }
            return ((rows.data || []) as Array<{ summary: string; created_at: string }>).map(r => ({ at: r.created_at, summary: r.summary }));
        },
        async addEpisode(input) {
            const { error } = await admin.from('ai_brain_episodes').insert({ organization_id: input.orgId, user_id: input.userId, skill_id: input.skillId, summary: input.summary.slice(0, 400) });
            if (error) throw new Error(error.message);
        },

        async loadAttachment(id) {
            // Only this person's own open file, in this org: the id alone is never enough.
            const { data, error } = await admin.from('ai_brain_attachments').select('storage_path, mime, kind')
                .eq('id', id).eq('organization_id', c.orgId).eq('user_id', c.userId).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
            if (error || !data) return null;
            const file = await admin.storage.from(STAGING_BUCKET).download(String(data.storage_path));
            if (file.error || !file.data) return null;
            const ext = String(data.storage_path).split('.').pop() || 'bin';
            return { bytes: new Uint8Array(await file.data.arrayBuffer()), mime: String(data.mime), fileName: `${data.kind === 'image' ? 'photo' : 'file'}.${ext}` };
        },
        async markAttachmentUsed(id, usedBy) {
            const { error } = await admin.from('ai_brain_attachments').update({ used_by: usedBy.slice(0, 120), used_at: new Date().toISOString() }).eq('id', id).eq('organization_id', c.orgId).eq('user_id', c.userId);
            if (error) throw new Error(error.message);
        },
    };
}

// ── Everything a turn needs, for one person on one channel ────────────────────────────────────────────────────────

export function liveTurnDeps(admin: SupabaseClient, c: LiveDataContext & { keyOrder: readonly number[]; allowMessage: TurnDeps['allowMessage'] }): TurnDeps {
    return {
        data: liveBrainData(admin, c),
        model: liveBrainModel(c.keyOrder),
        // Main model and backups as saved in the Control Center ("AI models" → Unified brain); never empty.
        chain: async () => (await import('@/task-manager/ai/AiModelSettings')).chainFor('brain_turn'),
        audit: supabaseAuditStore(admin),
        now: () => new Date(),
        allowMessage: c.allowMessage,
        learning: () => loadLearning(admin, c.orgId),
    };
}

// ── Housekeeping (runs at most once an hour per server instance, after a reply has gone out) ──────────────────────

let lastSweep = 0;

/** Removes expired staged files and clears old conversation text. Best effort; never throws. */
export async function sweepBrain(admin: SupabaseClient, orgId: string, settings: BrainSettings): Promise<void> {
    if (Date.now() - lastSweep < 3600_000) return;
    lastSweep = Date.now();
    try {
        const nowIso = new Date().toISOString();
        const expired = await admin.from('ai_brain_attachments').select('id, storage_path').eq('organization_id', orgId).is('used_at', null).lt('expires_at', nowIso).limit(50);
        const rows = (expired.data || []) as Array<{ id: string; storage_path: string }>;
        if (rows.length) {
            await admin.storage.from(STAGING_BUCKET).remove(rows.map(r => r.storage_path));
            await admin.from('ai_brain_attachments').delete().in('id', rows.map(r => r.id));
        }
        const textCutoff = new Date(Date.now() - settings.textRetentionDays * 86_400_000).toISOString();
        const cleared = await admin.from('ai_brain_turns').update({ user_text: null, reply_text: null }).eq('organization_id', orgId).lt('created_at', textCutoff).not('user_text', 'is', null).select('id');
        // A test case made from one of those turns keeps its masked message (it is what the brain is tested on) but loses
        // its link to the turn, so after the retention period nothing ties the case to the person who wrote it.
        const ids = ((cleared.data || []) as Array<{ id: string }>).map(r => r.id);
        for (let i = 0; i < ids.length; i += 100) await admin.from('ai_brain_eval_cases').update({ source_turn_id: null }).eq('organization_id', orgId).in('source_turn_id', ids.slice(i, i + 100));
        await admin.from('ai_brain_episodes').delete().eq('organization_id', orgId).lt('created_at', new Date(Date.now() - settings.memory.episodeDays * 86_400_000).toISOString());
    } catch (err) {
        console.warn('[Brain] housekeeping skipped:', err instanceof Error ? err.message : err);
    }
}
