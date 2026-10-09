import type { ExecutionResult } from './domain';
import type { Action, BrainContext, ProgressState } from './types';

/**
 * The language brain — step 6: EXECUTE a decision that is already approved (a change that was confirmed, a status note, a read).
 *
 * It never decides anything. Every change goes through the SAME functions the Tasks tab uses (WorkspaceService.assign /
 * setStatus / handOver), so every permission, access and duplicate rule is enforced again, at the moment of the change, by the
 * existing code — the brain's earlier checks are not trusted for this. Failures are reported honestly, task by task; a failure
 * never stops the other tasks, and nothing is claimed that did not happen.
 */

export interface ExecIO {
    setStatus(actorId: string, taskId: string, status: 'pending' | 'in_progress' | 'completed'): Promise<void>;
    assign(actorId: string, input: { targetUserId: string; title: string; description?: string; date: string }): Promise<void>;
    handOver(actorId: string, taskId: string, toId: string): Promise<{ toName: string }>;
    /** Another person's tasks as text, or null when the actor may not see them. */
    readPerson(actorId: string, personId: string): Promise<string | null>;
    /** Superuser overviews (department / pending / whole company) as text. */
    readInsight(actorId: string, kind: 'department_progress' | 'pending_tasks' | 'org_overview', subject: string | null): Promise<string>;
    /** Tell each person who gave these tasks what the reply MEANT (a summary, never the exact words). Only used for replies to a request. */
    relay?(actorId: string, input: { taskIds: string[]; state: ProgressState; note: string | null; titles?: Record<string, string> }): Promise<{ told: string[]; couldNot: string[] }>;
}

export interface ExecOptions {
    /** This is a reply to someone's request: after noting the status, tell the people who gave those tasks. */
    relay?: boolean;
    /** Titles of the tasks in that request (they are not on the person's own list). */
    titles?: Record<string, string>;
}

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

    switch (action.type) {
        case 'complete_tasks': {
            const r = await each(action.taskIds, id => io.setStatus(me, id, 'completed'), titleOf);
            return outcome('Marked', 'mark', { one: 'task as done', many: 'tasks as done' }, r.done, r.failed);
        }

        case 'progress_update': {
            const base = await (async (): Promise<ExecutionResult> => {
            if (action.state === 'done_all' || action.state === 'done_some') {
                const r = await each(action.taskIds, id => io.setStatus(me, id, 'completed'), titleOf);
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
            const r = await each(action.tasks, t => io.assign(me, { targetUserId: action.assigneeId, title: t.title, description: t.details ?? undefined, date: action.date }), t => t.title);
            return outcome('Added', 'add', { one: 'task', many: 'tasks' }, r.done, r.failed, who === 'you' ? ' to your list' : ` for ${who}`);
        }

        case 'hand_over_task': {
            try {
                const { toName } = await io.handOver(me, action.taskId, action.toId);
                return { summary: `Gave the task to ${toName}.`, values: { details: bullets([titleOf(action.taskId)]) } };
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
                const kind = action.scope === 'department' ? 'department_progress' : action.scope === 'pending_overview' ? 'pending_tasks' : 'org_overview';
                const text = await io.readInsight(me, kind, action.department);
                return { summary: action.scope === 'department' ? `How ${action.department} is doing` : 'The company overview', values: { data: text } };
            } catch (err) {
                return { summary: `I could not look that up. ${reason(err)}`, values: {} };
            }
        }

        default:
            return null;
    }
}

/** Does this decision's action need executing (as opposed to just a reply built from what is already known)? */
export const needsExecution = (a: Action): boolean =>
    !(a.type === 'chat' || (a.type === 'view_tasks' && a.scope === 'self') || a.type === 'answer_pending');

/** The status a "working / part-way" note maps to is "in progress"; shown for tests and the spec. */
export const NOTE_STATES: ProgressState[] = ['working', 'partly_done', 'blocked'];
