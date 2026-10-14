import type { Action, BrainContext, BrainTask } from './types';

/**
 * "One front door" — Phase 3 of docs/WHATSAPP_BOT_PRODUCTION_PLAN.md (owner decisions 2026-10-11).
 * Only for Smart-chat departments, and only while the "One front door" switch (Task Access panel) is ON.
 *
 *   • Exact commands — "done 2", "done 1 and 3", "done all", "tasks" — are answered by code: no AI call, no YES.
 *     Anything not exact or not valid (a number that is not on the list) goes to the AI exactly as before.
 *   • "undo" reverses the person's OWN last change within 10 minutes: done / in-progress back to what it was, new tasks
 *     removed. A hand-over is NOT undone (only the new holder may pass a task on) — the bot says who to ask instead.
 *   • When the AI is down, old exact commands still reach the old bot; anything else gets one short help line (no menu).
 *
 * Everything here is pure except `runUndo`, which only talks through UndoIO (the existing permission-checked functions).
 */

export const UNDO_WINDOW_MS = 10 * 60_000;

export const AI_DOWN_HELP = "I'm having trouble understanding right now. 🙏 Try *tasks* to see your list, then *done* and the task number (e.g. *done 1*).";
export const UNDO_HINT = 'Reply *undo* within 10 minutes to reverse it.';

export type ExactCommand =
    | { kind: 'done'; numbers: number[] }
    | { kind: 'done_all' }
    | { kind: 'view' }
    | { kind: 'undo' };

/** Only these exact shapes. Anything else (a sentence, a typo, extra words) is NOT exact and goes to the AI. */
export function parseExactCommand(text: string): ExactCommand | null {
    const t = String(text ?? '').trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
    if (!t) return null;
    if (/^(undo|undo that|undo it|undo last|wapas karo|wapas|galti se|galti ho gayi)$/.test(t)) return { kind: 'undo' };
    if (/^(tasks?|my tasks|view tasks|status|today'?s? tasks)$/.test(t)) return { kind: 'view' };
    if (/^(done ?all|done-all|all done|complete all|completed all|finished all)$/.test(t)) return { kind: 'done_all' };
    const m = /^(?:done|complete|completed|finish|finished) ((?:\d{1,2})(?:(?: ?, ?| and | & | )\d{1,2})*)$/.exec(t);
    if (m) {
        const numbers = [...new Set(m[1].split(/ ?, ?| and | & | /).filter(Boolean).map(Number))];
        if (numbers.length && numbers.every(n => Number.isInteger(n) && n >= 1)) return { kind: 'done', numbers };
    }
    return null;
}

// ── what was changed, so it can be undone ───────────────────────────────────

export type ChangeItem =
    | { kind: 'status'; taskId: string; title: string; before: BrainTask['status']; after: BrainTask['status'] }
    | { kind: 'created'; title: string; assigneeId: string; date: string }
    | { kind: 'handover'; title: string; toName: string };

export interface LastChange { at: string; items: ChangeItem[] }

/** The undoable record of an action that was just carried out. null = nothing to undo (a read, a note, …). */
export function changeFromAction(action: Action, ctx: BrainContext, now = new Date()): LastChange | null {
    const task = (id: string) => ctx.tasks.find(t => t.id === id);
    const statusItems = (ids: string[], after: BrainTask['status']) => ids
        .map(task).filter((t): t is BrainTask => !!t && t.status !== after)
        .map(t => ({ kind: 'status' as const, taskId: t.id, title: t.title, before: t.status, after }));
    let items: ChangeItem[] = [];
    switch (action.type) {
        case 'complete_tasks':
            items = statusItems(action.taskIds, 'completed'); break;
        case 'progress_update':
            if (action.state === 'done_all' || action.state === 'done_some') items = statusItems(action.taskIds, 'completed');
            else if (action.state === 'working' || action.state === 'partly_done') items = statusItems(action.taskIds, 'in_progress');
            break;
        case 'create_tasks':
            items = action.tasks.map(t => ({ kind: 'created' as const, title: t.title, assigneeId: action.assigneeId, date: action.date })); break;
        case 'hand_over_task': {
            const t = task(action.taskId);
            if (t) items = [{ kind: 'handover', title: t.title, toName: ctx.people.find(p => p.id === action.toId)?.name || 'the person you gave it to' }];
            break;
        }
        case 'batch':
            // Part B: "undo" after a combined change reverses every part of it.
            items = action.actions.flatMap(a => changeFromAction(a, ctx, now)?.items ?? []); break;
        default:
            return null;
    }
    return items.length ? { at: now.toISOString(), items } : null;
}

/** Validate a stored record (it comes back from the database as plain JSON). */
export function normalizeChange(raw: unknown): LastChange | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { at?: unknown; items?: unknown };
    if (typeof r.at !== 'string' || !Array.isArray(r.items)) return null;
    const ok = (s: unknown) => s === 'pending' || s === 'in_progress' || s === 'completed';
    const items = (r.items as Array<Record<string, unknown> | null>).filter((i): i is ChangeItem & Record<string, unknown> => !!i && typeof i === 'object' && typeof i.title === 'string' && (
        (i.kind === 'status' && typeof i.taskId === 'string' && ok(i.before) && ok(i.after))
        || (i.kind === 'created' && typeof i.assigneeId === 'string' && typeof i.date === 'string')
        || (i.kind === 'handover' && typeof i.toName === 'string')));
    return items.length ? { at: r.at, items } : null;
}

// ── exact commands → what to do ─────────────────────────────────────────────

export type ExactPlan =
    | { kind: 'act'; action: Action }
    | { kind: 'reply'; text: string }
    | { kind: 'undo'; change: LastChange | null };

const since = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });   // "10 Oct"
const list = (tasks: BrainTask[]) => tasks.map(t => `${t.n}. ${t.title}${t.from ? ` (from ${since(t.from)})` : ''} ${t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳'}`).join('\n');

/** null = not something code should answer → the AI handles it as before (e.g. "done 7" when there is no task 7). */
export function planExact(cmd: ExactCommand, ctx: BrainContext): ExactPlan | null {
    if (cmd.kind === 'undo') return { kind: 'undo', change: null };   // the caller fills in the stored change
    if (cmd.kind === 'view') {
        if (!ctx.tasks.length) return { kind: 'reply', text: '📋 You have no tasks today.' };
        // The hint uses a REAL number from this list (the first open task) — never a fixed "done 2".
        const firstOpen = ctx.tasks.find(t => t.status !== 'completed');
        const hint = firstOpen ? `Reply *done ${firstOpen.n}* when you finish task ${firstOpen.n}.` : 'All done for today ✅';
        return { kind: 'reply', text: `📋 *Your tasks today*\n\n${list(ctx.tasks)}\n\n${hint}` };
    }
    const open = ctx.tasks.filter(t => t.status !== 'completed');
    if (cmd.kind === 'done_all') return open.length ? { kind: 'act', action: { type: 'complete_tasks', taskIds: open.map(t => t.id) } } : null;
    const chosen = cmd.numbers.map(n => ctx.tasks.find(t => t.n === n));
    if (chosen.some(t => !t)) return null;                                   // a number not on the list → let the AI explain
    const todo = (chosen as BrainTask[]).filter(t => t.status !== 'completed');
    if (!todo.length) return { kind: 'reply', text: `That ${chosen.length === 1 ? 'task is' : 'is'} already done ✅. Reply *tasks* to see your list.` };
    return { kind: 'act', action: { type: 'complete_tasks', taskIds: todo.map(t => t.id) } };
}

// ── undo ────────────────────────────────────────────────────────────────────

export interface UndoIO {
    currentStatus(taskId: string): Promise<BrainTask['status'] | null>;
    setStatus(actorId: string, taskId: string, status: BrainTask['status']): Promise<void>;
    /** The id of a task this person created for `assigneeId` with this title/date since `since`, still not started. */
    findCreated(actorId: string, assigneeId: string, title: string, date: string, since: string): Promise<string | null>;
    deleteTask(actorId: string, taskId: string): Promise<void>;
}

const bullets = (a: string[]) => a.map(x => `• ${x}`).join('\n');

/** Reverse the last change. Each item is checked again (it may have changed since); permissions are enforced by UndoIO. */
export async function runUndo(change: LastChange | null, actorId: string, io: UndoIO, now = new Date()): Promise<{ text: string; undone: number }> {
    if (!change) return { text: "There's nothing to undo right now.", undone: 0 };
    if (now.getTime() - new Date(change.at).getTime() > UNDO_WINDOW_MS) {
        return { text: 'That was more than 10 minutes ago, so I can\'t undo it here. You can change it in the Tasks tab.', undone: 0 };
    }
    const undone: string[] = []; const skipped: string[] = []; const handovers: string[] = [];
    for (const item of change.items) {
        try {
            if (item.kind === 'handover') { handovers.push(`"${item.title}": ask ${item.toName} to give it back`); continue; }
            if (item.kind === 'status') {
                if ((await io.currentStatus(item.taskId)) !== item.after) { skipped.push(`${item.title} (changed since)`); continue; }
                await io.setStatus(actorId, item.taskId, item.before);
                undone.push(`${item.title} → back to ${item.before === 'in_progress' ? 'in progress' : 'to do'}`);
                continue;
            }
            const id = await io.findCreated(actorId, item.assigneeId, item.title, item.date, change.at);
            if (!id) { skipped.push(`${item.title} (already started or changed)`); continue; }
            await io.deleteTask(actorId, id);
            undone.push(`${item.title} → removed`);
        } catch {
            skipped.push(`${item.title} (not allowed or failed)`);
        }
    }
    const parts: string[] = [];
    if (undone.length) parts.push(`↩️ *Undone*\n${bullets(undone)}`);
    if (skipped.length) parts.push(`Not undone:\n${bullets(skipped)}`);
    if (handovers.length) parts.push(`A hand-over can't be undone by me:\n${bullets(handovers)}`);
    return { text: parts.join('\n\n') || "There's nothing to undo right now.", undone: undone.length };
}
