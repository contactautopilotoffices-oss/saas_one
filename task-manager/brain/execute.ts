import type { ExecutionResult } from './domain';
import type { Action, BrainContext, ProgressState } from './types';
import { FoundTask, ResolvedQuery, formatFound, viewFor } from './findTasks';

/**
 * The language brain — step 6: EXECUTE a decision that is already approved (a change that was confirmed, a status note, a read).
 *
 * It never decides anything. Every change goes through the SAME functions the Tasks tab uses (WorkspaceService.assign /
 * setStatus / handOver), so every permission, access and duplicate rule is enforced again, at the moment of the change, by the
 * existing code — the brain's earlier checks are not trusted for this. Failures are reported honestly, task by task; a failure
 * never stops the other tasks, and nothing is claimed that did not happen.
 */

export interface ExecIO {
    setStatus(actorId: string, taskId: string, status: 'pending' | 'in_progress' | 'completed', opts?: { notifyGiver?: boolean }): Promise<void>;
    /** ONE grouped "task completed" notice to each giver for tasks completed quietly (optional: without it, each completion
     *  notifies on its own). */
    notifyCompleted?(actorId: string, taskIds: string[]): Promise<void>;
    assign(actorId: string, input: { targetUserId: string; title: string; description?: string; date: string; notify?: boolean; /** Owner 2026-10-21: saved as a "Remark:" line and shown in the alert. */ note?: string }): Promise<void>;
    /** ONE "new task" WhatsApp alert for several tasks created together for the same person (optional: without it, each
     *  assign sends its own alert). */
    alertAssigned?(actorId: string, targetUserId: string, titles: string[], date: string): Promise<void>;
    handOver(actorId: string, taskId: string, toId: string, note?: string): Promise<{ toName: string }>;
    /** Delete / rename one of the actor's tasks (the same checked functions as the Tasks tab). Optional: absent → "not available". */
    deleteTask?(actorId: string, taskId: string): Promise<void>;
    renameTask?(actorId: string, taskId: string, title: string): Promise<void>;
    /** Owner 2026-10-20: add a "Remark: …" line to a task (own, or one they gave; checked again by the server). Optional. */
    addNote?(actorId: string, taskId: string, note: string): Promise<void>;
    /** Owner 2026-10-20: remind the people doing tasks the actor gave (checked again by the server). Optional. */
    remindTasks?(actorId: string, taskIds: string[]): Promise<{ reminded: Array<{ name: string; count: number }>; skipped: Array<{ title: string; why: string }> }>;
    /** Owner 2026-10-20: lock / unlock one of the actor's own tasks (same checked function as the Tasks tab). Optional. */
    setLocked?(actorId: string, taskId: string, locked: boolean): Promise<void>;
    /** Another person's tasks as text, or null when the actor may not see them. */
    readPerson(actorId: string, personId: string): Promise<string | null>;
    /** Phase 4 "Team reports": today's progress of the people this person may give work to, as text (null = not available). */
    /** `list` (owner 2026-10-21): every task of each person instead of the progress counts. */
    readTeam?(actorId: string, list?: boolean): Promise<string | null>;
    /** Superuser overviews (department / pending / whole company) as text. */
    readInsight(actorId: string, kind: 'department_progress' | 'pending_tasks' | 'org_overview', subject: string | null): Promise<string>;
    /** Flexible "look up tasks" (read-only): rows matching the form, for people the actor may see — checked AGAIN here
     *  (null = not allowed / not available). */
    findTasks?(actorId: string, query: ResolvedQuery): Promise<FoundTask[] | null>;
    /** Tell each person who gave these tasks what the reply MEANT (a summary, never the exact words). Only used for replies to a request. */
    relay?(actorId: string, input: { taskIds: string[]; state: ProgressState; note: string | null; titles?: Record<string, string> }): Promise<{ told: string[]; couldNot: string[] }>;
}

export interface ExecOptions {
    /** This is a reply to someone's request: after noting the status, tell the people who gave those tasks. */
    relay?: boolean;
    /** Titles of the tasks in that request (they are not on the person's own list). */
    titles?: Record<string, string>;
}

/** Owner 2026-10-20: notes are saved as a "Remark: …" line (the same wording Task import uses, shown on the card). */
export const NOTE_PREFIX = 'Remark: ';

const bullets = (lines: string[]) => lines.map(l => `• ${l}`).join('\n');
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const reason = (err: unknown) => (err instanceof Error && err.message ? err.message : 'something went wrong');

/** Run one change per item, collecting what worked and what did not. */
async function each<T>(items: T[], run: (item: T) => Promise<void>, label: (item: T) => string) {
    const done: string[] = []; const failed: Array<{ label: string; why: string }> = [];
    for (const item of items) {
        try { await run(item); done.push(label(item)); }
        catch (err) { failed.push({ label: label(item), why: reason(err) }); }
    }
    return { done, failed };
}

function outcome(verbPast: string, verbBase: string, noun: { one: string; many: string }, done: string[], failed: Array<{ label: string; why: string }>, suffix = ''): ExecutionResult {
    const total = done.length + failed.length;
    const lines = [...done.map(d => `✅ ${d}`), ...failed.map(f => `⚠️ ${f.label} — ${f.why}`)];
    if (!failed.length) return { summary: `${verbPast} ${done.length} ${plural(done.length, noun.one, noun.many)}${suffix}.`, values: { details: bullets(done) } };
    if (!done.length) return { summary: `I could not ${verbBase} ${plural(total, 'it', 'any of them')}. ${failed[0].why}`, values: { details: lines.join('\n') } };
    return { summary: `${verbPast} ${done.length} of ${total} ${noun.many}${suffix}; ${failed.length} could not be done.`, values: { details: lines.join('\n') } };
}

export async function executeAction(action: Action, ctx: BrainContext, io: ExecIO, opts: ExecOptions = {}): Promise<ExecutionResult | null> {
    const me = ctx.sender.id;
    const titleOf = (id: string) => opts.titles?.[id] ?? ctx.tasks.find(t => t.id === id)?.title ?? 'that task';
    const nameOf = (id: string) => (id === me ? 'you' : ctx.people.find(p => p.id === id)?.name ?? 'them');

    /** Mark tasks done; givers get ONE grouped "task completed" notice (or none when a relay already tells them). */
    const completeAll = async (ids: string[], relayTells: boolean) => {
        const quiet = relayTells || (!!io.notifyCompleted && ids.length > 0);
        const doneIds: string[] = [];
        const r = await each(ids, async id => { await io.setStatus(me, id, 'completed', quiet ? { notifyGiver: false } : undefined); doneIds.push(id); }, titleOf);
        if (!relayTells && io.notifyCompleted && doneIds.length) { try { await io.notifyCompleted(me, doneIds); } catch { /* the tasks are done; a failed notice must not fail them */ } }
        return r;
    };

    switch (action.type) {
        case 'complete_tasks': {
            const r = await completeAll(action.taskIds, false);
            return outcome('Marked', 'mark', { one: 'task as done', many: 'tasks as done' }, r.done, r.failed);
        }

        case 'progress_update': {
            const base = await (async (): Promise<ExecutionResult> => {
            if (action.state === 'done_all' || action.state === 'done_some') {
                // A reply to someone's request is relayed to the givers (with the note), so no separate completion notice then.
                const r = await completeAll(action.taskIds, !!opts.relay && !!io.relay);
                return outcome('Marked', 'mark', { one: 'task as done', many: 'tasks as done' }, r.done, r.failed);
            }
            if (action.state === 'blocked') {
                return { summary: `Noted that you are stuck on ${action.taskIds.length} ${plural(action.taskIds.length, 'task', 'tasks')}.`, values: { details: bullets(action.taskIds.map(titleOf)) } };
            }
            // working / partly done → the task is "in progress"
            const open = action.taskIds.filter(id => ctx.tasks.find(t => t.id === id)?.status !== 'in_progress');
            const r = await each(open, id => io.setStatus(me, id, 'in_progress'), titleOf);
            const already = action.taskIds.length - open.length;
            const done = [...r.done, ...action.taskIds.filter(id => !open.includes(id)).map(titleOf)];
            const res = outcome('Noted', 'note', { one: 'task as in progress', many: 'tasks as in progress' }, done, r.failed);
            return already && !r.failed.length ? { ...res, summary: `Noted ${done.length} ${plural(done.length, 'task', 'tasks')} as in progress.` } : res;
            })();
            if (!opts.relay || !io.relay) return base;
            // A reply to a request: tell the people who gave these tasks, truthfully reporting who could and could not be reached.
            let told: string[] = []; let couldNot: string[] = [];
            try { ({ told, couldNot } = await io.relay(me, { taskIds: action.taskIds, state: action.state, note: action.note, titles: opts.titles })); } catch { /* reported below as not reached */ }
            const names = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
            const tail = [told.length ? `I've let ${names(told)} know.` : '', couldNot.length ? `I couldn't reach ${names(couldNot)} just now.` : ''].filter(Boolean).join(' ');
            return tail ? { ...base, summary: `${base.summary} ${tail}` } : base;
        }

        case 'create_tasks': {
            const who = nameOf(action.assigneeId);
            // Several tasks for one person → create them quietly, then send ONE alert listing the ones that were really created.
            const group = action.tasks.length > 1 && !!io.alertAssigned;
            const r = await each(action.tasks, t => io.assign(me, { targetUserId: action.assigneeId, title: t.title, ...(t.details ? { note: t.details } : {}), date: action.date, ...(group ? { notify: false } : {}) }), t => t.title);
            // Owner 2026-10-21: the grouped alert shows each task's note too ("Onboarding (Note: Satish)").
            const alertTitles = r.done.map(title => { const t = action.tasks.find(x => x.title === title); return t?.details ? `${title} (Note: ${t.details})` : title; });
            if (group && r.done.length) { try { await io.alertAssigned!(me, action.assigneeId, alertTitles, action.date); } catch { /* the tasks exist; a failed alert must not fail them */ } }
            // Owner 2026-10-20: the "Added" reply shows each task's note too, the same as the preview did.
            const shown = r.done.map(title => { const t = action.tasks.find(x => x.title === title); return t?.details ? `${title} (note: ${t.details})` : title; });
            return outcome('Added', 'add', { one: 'task', many: 'tasks' }, shown, r.failed, who === 'you' ? ' to your list' : ` for ${who}`);
        }

        case 'hand_over_task': {
            try {
                const { toName } = await io.handOver(me, action.taskId, action.toId, action.note ?? undefined);
                return { summary: `Gave the task to ${toName}${action.note ? ' with your note' : ''}.`, values: { details: [bullets([titleOf(action.taskId)]), action.note ? `Note: ${action.note}` : ''].filter(Boolean).join('\n') } };
            } catch (err) {
                return { summary: `I could not give that task to ${nameOf(action.toId)}. ${reason(err)}`, values: { details: bullets([titleOf(action.taskId)]) } };
            }
        }

        case 'view_tasks': {
            if (action.scope === 'self') return null;
            try {
                if (action.scope === 'person' && action.personId) {
                    const text = await io.readPerson(me, action.personId);
                    return text === null
                        ? { summary: 'You are not allowed to see that.', values: {} }
                        : { summary: `${nameOf(action.personId)}'s tasks for today`, values: { data: text } };
                }
                if (action.scope === 'team') {
                    // Phase 4 "Team reports": only the people this person may already give work to (re-checked by readTeam).
                    const text = io.readTeam ? await io.readTeam(me, !!action.list) : null;
                    return text === null
                        ? { summary: 'Team reports are not available.', values: {} }
                        : { summary: action.list ? 'What your team is working on today' : 'How your team is doing today', values: { data: text } };
                }
                const kind = action.scope === 'department' ? 'department_progress' : action.scope === 'pending_overview' ? 'pending_tasks' : 'org_overview';
                const text = await io.readInsight(me, kind, action.department);
                return { summary: action.scope === 'department' ? `How ${action.department} is doing` : 'The company overview', values: { data: text } };
            } catch (err) {
                return { summary: `I could not look that up. ${reason(err)}`, values: {} };
            }
        }

        case 'delete_tasks': {
            if (!io.deleteTask) return { summary: 'Deleting tasks from WhatsApp is not available right now.', values: {} };
            const r = await each(action.taskIds, id => io.deleteTask!(me, id), titleOf);
            return outcome('Deleted', 'delete', { one: 'task', many: 'tasks' }, r.done, r.failed);
        }

        case 'rename_task': {
            if (!io.renameTask) return { summary: 'Renaming tasks from WhatsApp is not available right now.', values: {} };
            const from = titleOf(action.taskId);
            try {
                await io.renameTask(me, action.taskId, action.title);
                return { summary: 'Renamed the task.', values: { details: `• ${from} → ${action.title}` } };
            } catch (err) {
                return { summary: `I could not rename it. ${reason(err)}`, values: { details: `• ${from}` } };
            }
        }

        case 'add_note': {
            if (!io.addNote) return { summary: 'Adding notes from WhatsApp is not available right now.', values: {} };
            const line = `• ${action.title}${action.ownerName ? ` (${action.ownerName})` : ''}: ${action.note}`;
            try {
                await io.addNote(me, action.taskId, action.note);
                return { summary: 'Added the note.', values: { details: line } };
            } catch (err) {
                return { summary: `I could not add the note. ${reason(err)}`, values: { details: line } };
            }
        }

        case 'lock_tasks': {
            if (!io.setLocked) return { summary: 'Locking tasks from WhatsApp is not available right now.', values: {} };
            const r = await each(action.taskIds, id => io.setLocked!(me, id, action.lock), titleOf);
            return action.lock
                ? outcome('Locked', 'lock', { one: 'task (it will come back every working day)', many: 'tasks (they will come back every working day)' }, r.done, r.failed)
                : outcome('Unlocked', 'unlock', { one: 'task (it will stop repeating)', many: 'tasks (they will stop repeating)' }, r.done, r.failed);
        }

        case 'remind_tasks': {
            if (!io.remindTasks) return { summary: 'Sending reminders from WhatsApp is not available right now.', values: {} };
            try {
                const r = await io.remindTasks(me, action.taskIds);
                const sent = r.reminded.map(x => `${x.name} (${x.count})`).join(', ');
                const lines = [...r.reminded.map(x => `• Reminded ${x.name} about ${x.count} ${plural(x.count, 'task', 'tasks')}`), ...r.skipped.map(x => `• Not sent: ${x.title} (${x.why})`)];
                return { summary: sent ? `Sent a reminder to ${sent}.` : 'No reminder was sent.', values: { details: lines.join('\n') } };
            } catch (err) {
                return { summary: `I could not send the reminder. ${reason(err)}`, values: {} };
            }
        }

        case 'find_tasks': {
            try {
                const rows = io.findTasks ? await io.findTasks(me, action.query) : null;
                if (rows === null) return { summary: 'You are not allowed to see that.', values: {} };
                const f = formatFound(rows, action.query, viewFor(ctx), me);
                return { summary: f.summary, values: { data: f.text } };
            } catch (err) {
                return { summary: `I could not look that up just now. ${reason(err)}`, values: {} };
            }
        }

        case 'batch': {
            // Part B: several changes confirmed with ONE yes. Each part runs through the same code as on its own (permissions
            // re-checked, failures reported per part); one failing part never stops the others.
            const parts: ExecutionResult[] = [];
            for (const sub of action.actions) {
                if (sub.type === 'batch') continue;                                   // never nested
                try { const r = await executeAction(sub, ctx, io, opts); if (r) parts.push(r); }
                catch (err) { parts.push({ summary: `One part could not be done. ${reason(err)}`, values: {} }); }
            }
            const details = parts.map(p => p.values.details).filter(Boolean).join('\n');
            const left = action.unclear.length ? ` I couldn't work out: ${action.unclear.join('; ')}. Please send it again on its own.` : '';
            return { summary: `${parts.map(p => p.summary).join(' ')}${left}`.trim(), values: details ? { details } : {} };
        }

        default:
            return null;
    }
}

/** Does this decision's action need executing (as opposed to just a reply built from what is already known)? */
export const needsExecution = (a: Action): boolean =>
    !(a.type === 'chat' || (a.type === 'view_tasks' && a.scope === 'self') || a.type === 'answer_pending' || a.type === 'locked_list');

/** The status a "working / part-way" note maps to is "in progress"; shown for tests and the spec. */
export const NOTE_STATES: ProgressState[] = ['working', 'partly_done', 'blocked'];
