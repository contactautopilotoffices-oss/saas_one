import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskAccessService } from './TaskAccessService';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { evaluateRuleSchedule } from './NotificationSchedule';
import {
    DEFAULT_REMINDER, MAX_FROM_LABEL, MAX_NOTE, SuperuserReminder, buildPingTemplateParams, buildPingText, buildReminderTemplateParams,
    buildReminderText, isQuarterHour, normalizeReminder,
} from './pingMessage';
import type { AccessDecision } from './TaskAccessService';
import type { Employee } from './types';

/**
 * Working with a superuser (Saniel): a team gives him tasks, reminds him — now, later, or on a regular schedule — and every
 * rule is checked here, on the server. The acting person always comes from the login session, never from the request.
 *
 * All data access goes through `PingIO`, so the rules (who may remind whom about what, what counts as a duplicate, how the
 * scheduler claims a due reminder exactly once) are tested offline. Messages leave through TaskMessagingService, so kill
 * switches and Pretend Mode apply; outside the 24-hour window they use the approved `task_pending_for_you_v1` template.
 */

export class PingError extends Error {
    constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); this.name = 'PingError'; }
}

export interface PingTask { id: string; title: string; status: string; employee_id: string; assigned_by: string | null; assigned_date: string }
export interface PingRow {
    id: string; department_id: string; created_by: string; recipient_id: string; from_label: string; note: string | null;
    task_ids: string[]; send_at: string; status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'; sent_at: string | null; error: string | null;
}

export interface PingIO {
    now(): Date;
    getEmployee(id: string): Promise<Employee | null>;
    access(e: Employee): Promise<AccessDecision>;
    getCollab(): Promise<{ departments: Set<string>; reminders: Map<string, SuperuserReminder> }>;
    saveReminder(departmentId: string, reminder: SuperuserReminder, actor: string): Promise<void>;
    allEmployees(): Promise<Employee[]>;
    tasksByIds(ids: string[]): Promise<PingTask[]>;
    openTasksOf(userId: string): Promise<PingTask[]>;
    insertPing(row: Omit<PingRow, 'id' | 'sent_at' | 'error'> & { status: PingRow['status'] }): Promise<PingRow>;
    claimDue(nowIso: string): Promise<PingRow[]>;
    updatePing(id: string, patch: Partial<Pick<PingRow, 'status' | 'sent_at' | 'error'>>): Promise<void>;
    cancelPing(id: string, departmentId: string): Promise<boolean>;
    listPings(departmentId: string, recipientId: string): Promise<PingRow[]>;
    recentlySent(taskIds: string[], sinceIso: string): Promise<PingRow[]>;
    /** Reminders already SENT to this person since a moment (to match his replies to the right tasks). */
    listRecentSent(recipientId: string, sinceIso: string): Promise<PingRow[]>;
    send(phone: string, text: string, templateParams: string[]): Promise<boolean>;
    audit(event: string, actorId: string | null, details: Record<string, unknown>): Promise<void>;
}

const RECENT_MINUTES = 60;
const MAX_TASKS = 30;
const MAX_DAYS_AHEAD = 30;

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function actorIn(io: PingIO, actorId: string): Promise<{ actor: Employee; collab: Awaited<ReturnType<PingIO['getCollab']>> }> {
    const actor = await io.getEmployee(actorId);
    if (!actor || !actor.active) throw new PingError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
    const access = await io.access(actor);
    if (!access.allowed) throw new PingError(403, access.message, 'LOCKED');
    const collab = await io.getCollab();
    if (!actor.department_id || !collab.departments.has(actor.department_id)) {
        throw new PingError(403, 'Your team has not been set up to send tasks to a superuser yet. Ask an admin to switch it on.', 'NOT_ENABLED');
    }
    return { actor, collab };
}

/** The superusers this team can work with (unlocked ones). */
async function superusersFor(io: PingIO, actor: Employee): Promise<Employee[]> {
    const all = await io.allEmployees();
    const out: Employee[] = [];
    for (const e of all.filter(x => x.role === 'superuser' && x.id !== actor.id && x.active)) if ((await io.access(e)).allowed) out.push(e);
    return out;
}

function pickRecipient(superusers: Employee[], wanted?: string | null): Employee {
    const r = wanted ? superusers.find(s => s.id === wanted) : superusers.length === 1 ? superusers[0] : undefined;
    if (!r) throw new PingError(400, superusers.length ? 'Choose who to send it to.' : 'There is no superuser set up to receive this yet.', 'NO_RECIPIENT');
    return r;
}

/** Tasks the recipient holds that THIS TEAM gave him (the only ones a team may remind him about). */
async function teamTasksOf(io: PingIO, actor: Employee, recipient: Employee) {
    const people = await io.allEmployees();
    const members = new Map(people.filter(p => p.department_id === actor.department_id).map(p => [p.id, p]));
    const open = await io.openTasksOf(recipient.id);
    return { members, tasks: open.filter(t => t.assigned_by && members.has(t.assigned_by)) };
}

// ── the Tasks tab ────────────────────────────────────────────────────────────

export async function getPanel(actorId: string, io: PingIO, recipientId?: string | null) {
    const { actor, collab } = await actorIn(io, actorId);
    const superusers = await superusersFor(io, actor);
    const recipient = superusers.length === 1 ? superusers[0] : superusers.find(s => s.id === recipientId) ?? null;
    const base = {
        enabled: true,
        me: { id: actor.id, name: actor.name },
        department: actor.department_name || '',
        superusers: superusers.map(s => ({ id: s.id, name: s.name })),
        recipient: recipient ? { id: recipient.id, name: recipient.name } : null,
    };
    if (!recipient) return { ...base, tasks: [], myOpen: [], pings: [], reminder: normalizeReminder(collab.reminders.get(actor.department_id!)) };

    const { members, tasks } = await teamTasksOf(io, actor, recipient);
    const mine = (await io.openTasksOf(actor.id)).filter(t => t.status !== 'completed');
    const pings = await io.listPings(actor.department_id!, recipient.id);
    return {
        ...base,
        tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assignedDate: t.assigned_date, assignerId: t.assigned_by, assignerName: members.get(t.assigned_by!)?.name ?? 'Someone' })),
        myOpen: mine.map(t => ({ id: t.id, title: t.title, status: t.status })),
        pings: pings.map(p => ({ id: p.id, status: p.status, sendAt: p.send_at, sentAt: p.sent_at, fromLabel: p.from_label, count: p.task_ids.length, mine: p.created_by === actor.id })),
        reminder: { ...normalizeReminder(collab.reminders.get(actor.department_id!)), recipientId: normalizeReminder(collab.reminders.get(actor.department_id!)).recipientId ?? recipient.id },
    };
}

// ── sending now, or later ────────────────────────────────────────────────────

export interface SendInput { taskIds: string[]; recipientId?: string | null; fromLabel?: string; note?: string; sendAt?: string | null; force?: boolean }

export async function sendPing(actorId: string, input: SendInput, io: PingIO): Promise<{ status: 'sent' | 'scheduled'; pingId: string; sendAt: string }> {
    const { actor } = await actorIn(io, actorId);
    const recipient = pickRecipient(await superusersFor(io, actor), input.recipientId);

    const ids = [...new Set((input.taskIds || []).filter(x => typeof x === 'string'))];
    if (!ids.length) throw new PingError(400, 'Choose at least one task.', 'NO_TASKS');
    if (ids.length > MAX_TASKS) throw new PingError(400, `Choose at most ${MAX_TASKS} tasks at a time.`, 'TOO_MANY');

    const { tasks } = await teamTasksOf(io, actor, recipient);
    const allowed = new Map(tasks.map(t => [t.id, t]));
    const bad = ids.filter(i => !allowed.has(i));
    if (bad.length) throw new PingError(400, `${bad.length === 1 ? 'One of those tasks is' : 'Some of those tasks are'} not an open task your team gave ${recipient.name}. Refresh and try again.`, 'NOT_TEAM_TASK');

    const now = io.now();
    let sendAt = now;
    if (input.sendAt) {
        const t = new Date(input.sendAt);
        if (Number.isNaN(t.getTime())) throw new PingError(400, 'That date and time is not valid.', 'BAD_TIME');
        if (t.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86400000) throw new PingError(400, `You can schedule at most ${MAX_DAYS_AHEAD} days ahead.`, 'TOO_FAR');
        if (t.getTime() > now.getTime() + 60_000) sendAt = t; // within a minute counts as "now"
    }
    const later = sendAt.getTime() > now.getTime();

    if (!later && !input.force) {
        const since = new Date(now.getTime() - RECENT_MINUTES * 60000).toISOString();
        const recent = (await io.recentlySent(ids, since))[0];
        if (recent) {
            const mins = Math.max(1, Math.round((now.getTime() - new Date(recent.sent_at || recent.send_at).getTime()) / 60000));
            throw new PingError(409, `${recipient.name} was already reminded about ${recent.task_ids.some(t => ids.includes(t)) ? 'one of these' : 'these'} ${mins} minute${mins === 1 ? '' : 's'} ago. Send anyway?`, 'RECENT');
        }
    }

    const row = await io.insertPing({
        department_id: actor.department_id!, created_by: actor.id, recipient_id: recipient.id,
        from_label: clip(input.fromLabel, MAX_FROM_LABEL) || actor.name, note: clip(input.note, MAX_NOTE) || null,
        task_ids: ids, send_at: sendAt.toISOString(), status: 'scheduled',
    });

    if (later) {
        await io.audit('task_ping_scheduled', actor.id, { pingId: row.id, recipientId: recipient.id, count: ids.length, sendAt: row.send_at });
        return { status: 'scheduled', pingId: row.id, sendAt: row.send_at };
    }
    const done = await deliver(row, io);
    if (!done.ok) throw new PingError(502, done.reason || 'The message could not be sent.', 'SEND_FAILED');
    return { status: 'sent', pingId: row.id, sendAt: row.send_at };
}

/** Send one stored ping: fresh task titles, drop what is already done, build the message, send, record the outcome. */
export async function deliver(ping: PingRow, io: PingIO): Promise<{ ok: boolean; reason?: string }> {
    const fail = async (reason: string) => { await io.updatePing(ping.id, { status: 'failed', error: reason }); await io.audit('task_ping_failed', ping.created_by, { pingId: ping.id, reason }); return { ok: false, reason }; };
    const recipient = await io.getEmployee(ping.recipient_id);
    if (!recipient || !recipient.active) return fail('The recipient is no longer active.');
    if (!recipient.phone_number || recipient.phone_number.replace(/\D/g, '').length < 10) return fail(`${recipient.name} has no phone number on their profile.`);
    if (!(await io.access(recipient)).allowed) return fail(`${recipient.name} is not switched on for the Task Manager yet.`);

    const rows = await io.tasksByIds(ping.task_ids);
    const open = rows.filter(t => t.employee_id === recipient.id && t.status !== 'completed');
    if (!open.length) return fail('Everything in this reminder has already been completed.');

    const author = await io.getEmployee(ping.created_by);
    const input = { fromLabel: ping.from_label, department: author?.department_name || '', tasks: open.map(t => t.title), note: ping.note };
    const ok = await io.send(recipient.phone_number, buildPingText(input), buildPingTemplateParams(input, recipient.name));
    if (!ok) return fail('WhatsApp did not accept the message.');
    await io.updatePing(ping.id, { status: 'sent', sent_at: io.now().toISOString(), error: null });
    await io.audit('task_ping_sent', ping.created_by, { pingId: ping.id, recipientId: recipient.id, count: open.length });
    return { ok: true };
}

export async function cancelPing(actorId: string, pingId: string, io: PingIO): Promise<void> {
    const { actor } = await actorIn(io, actorId);
    const ok = await io.cancelPing(pingId, actor.department_id!);
    if (!ok) throw new PingError(409, 'That reminder was already sent or cancelled.', 'NOT_SCHEDULED');
    await io.audit('task_ping_cancelled', actor.id, { pingId });
}

// ── the team's one shared regular reminder ───────────────────────────────────

export async function saveTeamReminder(actorId: string, input: { enabled: boolean; time: string; days: number[]; recipientId?: string | null }, io: PingIO): Promise<SuperuserReminder> {
    const { actor, collab } = await actorIn(io, actorId);
    if (!isQuarterHour(input.time)) throw new PingError(400, 'Pick a time in 15-minute steps (for example 09:30).', 'BAD_TIME');
    const days = [...new Set((input.days || []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new PingError(400, 'Pick at least one day.', 'NO_DAYS');
    const recipient = pickRecipient(await superusersFor(io, actor), input.recipientId);
    const previous = normalizeReminder(collab.reminders.get(actor.department_id!));
    const next: SuperuserReminder = { enabled: input.enabled === true, time: input.time, days, recipientId: recipient.id, lastRunDate: previous.lastRunDate };
    await io.saveReminder(actor.department_id!, next, actor.name);
    await io.audit('task_reminder_schedule_saved', actor.id, { departmentId: actor.department_id, enabled: next.enabled, time: next.time, days: next.days });
    return next;
}

// ── the scheduler (called by the existing 15-minute cron) ────────────────────

/** IST day / minutes / date for a moment, computed by hand so it is the same on every runtime. */
export function istParts(now: Date): { dayOfWeek: number; minutes: number; todayIST: string } {
    const ist = new Date(now.getTime() + 330 * 60000);
    return { dayOfWeek: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(), todayIST: ist.toISOString().slice(0, 10) };
}

export interface DueSummary { sent: number; failed: number; reminders: number; skipped: number }

/** Sends every scheduled reminder that is due (each exactly once) and every regular reminder whose time has come. Never throws. */
export async function runDue(io: PingIO): Promise<DueSummary> {
    const out: DueSummary = { sent: 0, failed: 0, reminders: 0, skipped: 0 };
    try {
        const now = io.now();
        const collab = await io.getCollab();
        if (collab.departments.size === 0) return out; // no team has this switched on (the default): do nothing at all

        // 1. reminders scheduled for a time that has come. claimDue() flips scheduled → sending in one step, so no two runs can both send it.
        for (const ping of await io.claimDue(now.toISOString())) {
            if (!collab.departments.has(ping.department_id)) { await io.updatePing(ping.id, { status: 'cancelled', error: 'The team can no longer send tasks to a superuser.' }); out.skipped++; continue; }
            const r = await deliver(ping, io).catch(() => ({ ok: false }));
            if (r.ok) out.sent++; else out.failed++;
        }

        // 2. each team's regular reminder
        const ist = istParts(now);
        const people = collab.reminders.size ? await io.allEmployees() : [];
        for (const [departmentId, rem] of collab.reminders) {
            if (!collab.departments.has(departmentId)) continue;
            const status = evaluateRuleSchedule({ enabled: rem.enabled, daysOfWeek: rem.days, lastRunDate: rem.lastRunDate, targetTimeIST: rem.time }, ist);
            if (status !== 'due') continue;
            try {
                const recipient = people.find(p => p.id === rem.recipientId && p.role === 'superuser' && p.active);
                const members = new Map(people.filter(p => p.department_id === departmentId).map(p => [p.id, p]));
                const open = recipient ? (await io.openTasksOf(recipient.id)).filter(t => t.assigned_by && members.has(t.assigned_by)) : [];
                const groupsMap = new Map<string, string[]>();
                for (const t of open) { const n = members.get(t.assigned_by!)!.name; groupsMap.set(n, [...(groupsMap.get(n) || []), t.title]); }
                const groups = [...groupsMap].map(([assigner, tasks]) => ({ assigner, tasks }));
                const dept = [...members.values()][0]?.department_name || '';
                // Mark today as handled first: a failure below must never turn into a repeat every 15 minutes.
                await io.saveReminder(departmentId, { ...rem, lastRunDate: ist.todayIST }, 'scheduler');
                if (!recipient || !groups.length || !(await io.access(recipient)).allowed || !recipient.phone_number) { out.skipped++; continue; }
                const ok = await io.send(recipient.phone_number, buildReminderText(dept, groups), buildReminderTemplateParams(dept, groups, recipient.name));
                await io.audit(ok ? 'task_reminder_sent' : 'task_reminder_failed', null, { departmentId, recipientId: recipient.id, count: open.length });
                if (ok) out.reminders++; else out.failed++;
            } catch (err) {
                out.failed++;
                console.warn('[SuperuserPing] regular reminder failed:', err instanceof Error ? err.message : err);
            }
        }
    } catch (err) {
        console.warn('[SuperuserPing] scheduler error:', err instanceof Error ? err.message : err);
    }
    return out;
}

// ── tasks he was pinged about (so his reply can be matched to the right people) ────────────

export async function openPingTasksFor(recipientId: string, io: Pick<PingIO, 'listRecentSent' | 'tasksByIds' | 'allEmployees' | 'now'>, days = 3) {
    const since = new Date(io.now().getTime() - days * 86400000).toISOString();
    const pings = await io.listRecentSent(recipientId, since);
    const ids = [...new Set(pings.flatMap(p => p.task_ids))];
    if (!ids.length) return [];
    const rows = (await io.tasksByIds(ids)).filter(t => t.employee_id === recipientId && t.status !== 'completed');
    const people = new Map((await io.allEmployees()).map(e => [e.id, e]));
    return rows.map(t => ({ id: t.id, title: t.title, assignerId: t.assigned_by, assignerName: t.assigned_by ? people.get(t.assigned_by)?.name ?? 'Someone' : 'Someone' }));
}

// ── the real wiring ──────────────────────────────────────────────────────────

const PING_CAMPAIGN = process.env.AISENSY_TASK_PING_CAMPAIGN || 'task_pending_for_you_v1';
const COLS = 'id, department_id, created_by, recipient_id, from_label, note, task_ids, send_at, status, sent_at, error';
const TASK_COLS = 'id, title, status, employee_id, assigned_by, assigned_date';

export function defaultPingIO(): PingIO {
    return {
        now: () => new Date(),
        getEmployee: id => TaskDatabaseService.getEmployeeById(id),
        access: e => TaskAccessService.check({ userId: e.id, departmentId: e.department_id }),
        async getCollab() { const c = await TaskAccessService.getSuperuserCollab(); return { departments: c.departments, reminders: c.reminders }; },
        saveReminder: (departmentId, reminder, actor) => TaskAccessService.saveSuperuserReminder(departmentId, reminder, actor),
        allEmployees: () => TaskDatabaseService.getAllEmployees(),
        async tasksByIds(ids) {
            const { data, error } = await supabaseAdmin.from('task_assignments').select(TASK_COLS).in('id', ids);
            if (error) throw error; return (data || []) as PingTask[];
        },
        async openTasksOf(userId) {
            const { data, error } = await supabaseAdmin.from('task_assignments').select(TASK_COLS).eq('employee_id', userId).neq('status', 'completed').order('created_at', { ascending: true }).limit(200);
            if (error) throw error; return (data || []) as PingTask[];
        },
        async insertPing(row) {
            const { data, error } = await supabaseAdmin.from('task_pings').insert(row).select(COLS).single();
            if (error || !data) throw error || new Error('Could not save the reminder.'); return data as PingRow;
        },
        async claimDue(nowIso) {
            const { data, error } = await supabaseAdmin.from('task_pings').update({ status: 'sending' }).eq('status', 'scheduled').lte('send_at', nowIso).select(COLS);
            if (error) throw error; return (data || []) as PingRow[];
        },
        async updatePing(id, patch) { const { error } = await supabaseAdmin.from('task_pings').update(patch).eq('id', id); if (error) throw error; },
        async cancelPing(id, departmentId) {
            const { data, error } = await supabaseAdmin.from('task_pings').update({ status: 'cancelled' }).eq('id', id).eq('department_id', departmentId).eq('status', 'scheduled').select('id');
            if (error) throw error; return (data || []).length > 0;
        },
        async listPings(departmentId, recipientId) {
            const { data, error } = await supabaseAdmin.from('task_pings').select(COLS).eq('department_id', departmentId).eq('recipient_id', recipientId)
                .in('status', ['scheduled', 'sent', 'failed']).order('created_at', { ascending: false }).limit(20);
            if (error) throw error; return (data || []) as PingRow[];
        },
        async recentlySent(taskIds, sinceIso) {
            const { data, error } = await supabaseAdmin.from('task_pings').select(COLS).eq('status', 'sent').gte('sent_at', sinceIso).overlaps('task_ids', taskIds).limit(1);
            if (error) throw error; return (data || []) as PingRow[];
        },
        async listRecentSent(recipientId, sinceIso) {
            const { data, error } = await supabaseAdmin.from('task_pings').select(COLS).eq('recipient_id', recipientId).eq('status', 'sent').gte('sent_at', sinceIso).limit(50);
            if (error) throw error; return (data || []) as PingRow[];
        },
        send: (phone, text, params) => TaskMessagingService.sendMessage(phone, text, { messageType: 'task_ping', campaignName: PING_CAMPAIGN, templateParams: params }),
        audit: (event, actorId, details) => TaskDatabaseService.logAudit({ eventType: event, actorId, details }),
    };
}

/** What the Tasks tab and the cron call. */
export const SuperuserPingService = {
    panel: (actorId: string, recipientId?: string | null) => getPanel(actorId, defaultPingIO(), recipientId),
    send: (actorId: string, input: SendInput) => sendPing(actorId, input, defaultPingIO()),
    cancel: (actorId: string, pingId: string) => cancelPing(actorId, pingId, defaultPingIO()),
    saveReminder: (actorId: string, input: Parameters<typeof saveTeamReminder>[1]) => saveTeamReminder(actorId, input, defaultPingIO()),
    runDue: () => runDue(defaultPingIO()),
    openPingTasksFor: (recipientId: string) => openPingTasksFor(recipientId, defaultPingIO()),
};

export { DEFAULT_REMINDER };
