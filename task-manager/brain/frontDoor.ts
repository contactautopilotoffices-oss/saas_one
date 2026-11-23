import type { Action, BrainContext, BrainTask } from './types';
import { sectionedList } from './text';

/**
 * "One front door" — Phase 3 of docs/WHATSAPP_BOT_PRODUCTION_PLAN.md (owner decisions 2026-10-11).
 * Only for Smart-chat departments, and only while the "One front door" switch (Task Access panel) is ON.
 *
 *   • Exact commands — "done 2", "done 1 and 3", "done all", "tasks" — are answered by code: no AI call, no YES.
 *     Owner 2026-10-27: also the "Accept" button of the request template — accepted at once when exactly ONE request from
 *     another department is waiting (several → the AI asks which one). "Can't do it" still goes to the AI and one YES.
 *     Anything not exact or not valid (a number that is not on the list) goes to the AI exactly as before.
 *   • "undo" reverses the person's OWN last change within 10 minutes: done / in-progress back to what it was, new tasks
 *     removed. Owner 2026-11-21 ("ask for a yes only for a Delete option. nothing else"): also a hand-over, a change of day
 *     or person, a rename, a note, a lock, a reminder and an answer to a request. Messages to other people wait 1 minute
 *     (heldMessages.ts): undo before then cancels them; after it, the person who was told gets a short "taken back" note.
 *   • When the AI is down, old exact commands still reach the old bot; anything else gets one short help line (no menu).
 *
 * Everything here is pure except `runUndo`, which only talks through UndoIO (the existing permission-checked functions).
 */

export const UNDO_WINDOW_MS = 10 * 60_000;

export const AI_DOWN_HELP = "I'm having trouble understanding right now. 🙏 Try *tasks* to see your list, then *done* and the task number (e.g. *done 1*).";
export const UNDO_HINT = 'Reply *undo* within 10 minutes to reverse it.';
/** Owner 2026-11-21: added when the change tells someone else and messages really wait (the table exists). */
export const HOLD_HINT = 'Anyone else is told after 1 minute, so an undo before then means they never hear about it.';

export type ExactCommand =
    | { kind: 'done'; numbers: number[] }
    | { kind: 'done_all' }
    | { kind: 'view' }
    | { kind: 'undo' }
    | { kind: 'accept' };

/** Only these exact shapes. Anything else (a sentence, a typo, extra words) is NOT exact and goes to the AI. */
export function parseExactCommand(text: string): ExactCommand | null {
    const t = String(text ?? '').trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
    if (!t) return null;
    if (/^(undo|undo that|undo it|undo last|wapas karo|wapas|galti se|galti ho gayi)$/.test(t)) return { kind: 'undo' };
    if (/^(tasks?|my tasks|view tasks|status|today'?s? tasks)$/.test(t)) return { kind: 'view' };
    if (t === 'accept') return { kind: 'accept' };   // the template's quick-reply button (exact text only)
    if (/^(done ?all|done-all|all done|complete all|completed all|finished all)$/.test(t)) return { kind: 'done_all' };
    const m = /^(?:done|complete|completed|finish|finished)(?: (?:my )?tasks?)? ((?:\d{1,2})(?:(?: ?, ?| and | & | )\d{1,2})*)$/.exec(t)
        // 2026-11-02 (Lohitaksha's "TASK 4 DONE", 28 Oct): the number first — "task 4 done", "4 done", "#4 done", "tasks 2, 3 completed"
        ?? /^(?:(?:my )?tasks? ?(?:no\.? ?|number )?|#)?((?:\d{1,2})(?:(?: ?, ?| and | & | )\d{1,2})*) (?:is |are )?(?:done|completed|complete|finished)$/.exec(t);
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
    /** Owner 2026-11-21: taskId and toId make it reversible (older records without them only say who to ask). */
    | { kind: 'handover'; title: string; toName: string; taskId?: string; toId?: string }
    | { kind: 'rename'; taskId: string; title: string; before: string }
    | { kind: 'change'; taskId: string; title: string; beforeOwnerId: string; beforeDate: string; toId: string | null; date: string | null }
    | { kind: 'note'; taskId: string; title: string; note: string }
    | { kind: 'lock'; taskId: string; title: string; locked: boolean }
    | { kind: 'remind'; title: string; toIds: string[] }
    | { kind: 'answer'; requestId: string; title: string; fromName: string; accept: boolean };

/** Does this change tell anyone else (so its messages wait 1 minute and the reply says so)? */
export function tellsOthers(change: LastChange | null, senderId: string): boolean {
    return !!change?.items.some(i => (i.kind === 'created' && i.assigneeId !== senderId) || i.kind === 'handover' || i.kind === 'remind' || i.kind === 'answer'
        || (i.kind === 'change' && !!i.toId && i.toId !== senderId));
}

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
            if (t) items = [{ kind: 'handover', title: t.title, toName: ctx.people.find(p => p.id === action.toId)?.name || 'the person you gave it to', taskId: t.id, toId: action.toId }];
            break;
        }
        case 'rename_task': {
            const t = task(action.taskId);
            if (t && t.title !== action.title) items = [{ kind: 'rename', taskId: t.id, title: action.title, before: t.title }];
            break;
        }
        case 'change_task': {
            // Before: on their own list (today, or the day it was carried from) or given to someone (ctx.noteTargets).
            const own = task(action.taskId);
            const given = (ctx.noteTargets ?? []).find(n => n.id === action.taskId);
            const beforeOwnerId = own ? ctx.sender.id : given?.ownerId;
            const beforeDate = own ? (own.from ?? ctx.today) : given?.date;
            if (beforeOwnerId && beforeDate) items = [{ kind: 'change', taskId: action.taskId, title: action.title, beforeOwnerId, beforeDate, toId: action.toId, date: action.date }];
            break;
        }
        case 'add_note':
            items = [{ kind: 'note', taskId: action.taskId, title: action.title, note: action.note }]; break;
        case 'lock_tasks':
            items = action.taskIds.map(task).filter((t): t is BrainTask => !!t && !!t.locked !== action.lock)
                .map(t => ({ kind: 'lock' as const, taskId: t.id, title: t.title, locked: action.lock })); break;
        case 'remind_tasks': {
            const toIds = [...new Set(action.taskIds.map(id => (ctx.noteTargets ?? []).find(n => n.id === id)?.ownerId).filter((x): x is string => !!x))];
            items = [{ kind: 'remind', title: action.lines.length === 1 ? action.lines[0] : `${action.lines.length} tasks`, toIds }]; break;
        }
        case 'answer_request':
            items = [{ kind: 'answer', requestId: action.requestId, title: action.title, fromName: action.fromName, accept: action.accept }]; break;
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
    const str = (s: unknown) => typeof s === 'string';
    const items = (r.items as Array<Record<string, unknown> | null>).filter((i): i is ChangeItem & Record<string, unknown> => !!i && typeof i === 'object' && typeof i.title === 'string' && (
        (i.kind === 'status' && str(i.taskId) && ok(i.before) && ok(i.after))
        || (i.kind === 'created' && str(i.assigneeId) && str(i.date))
        || (i.kind === 'handover' && str(i.toName))
        || (i.kind === 'rename' && str(i.taskId) && str(i.before))
        || (i.kind === 'change' && str(i.taskId) && str(i.beforeOwnerId) && str(i.beforeDate))
        || (i.kind === 'note' && str(i.taskId) && str(i.note))
        || (i.kind === 'lock' && str(i.taskId) && typeof i.locked === 'boolean')
        || (i.kind === 'remind' && Array.isArray(i.toIds))
        || (i.kind === 'answer' && str(i.requestId) && typeof i.accept === 'boolean')));
    return items.length ? { at: r.at, items } : null;
}

// ── exact commands → what to do ─────────────────────────────────────────────

export type ExactPlan =
    | { kind: 'act'; action: Action }
    | { kind: 'reply'; text: string }
    | { kind: 'undo'; change: LastChange | null };

const since = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });   // "10 Oct"
// Three sections (owner 2026-10-16): carry forward → pending today → completed; the numbers stay the same.
const list = (tasks: BrainTask[]) => sectionedList(tasks.map(t => ({ carried: !!t.from, done: t.status === 'completed', line: `${t.n}. ${t.title}${t.from ? ` (from ${since(t.from)})` : ''} ${t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳'}` })));

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
    if (cmd.kind === 'accept') {
        // Only when there is no doubt which request: exactly one waiting. Otherwise the AI asks which one (or explains).
        const waiting = ctx.supportRequests ?? [];
        if (waiting.length !== 1) return null;
        const r = waiting[0];
        return { kind: 'act', action: { type: 'answer_request', requestId: r.id, title: r.title, fromName: r.fromName, accept: true, reason: null } };
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
    /** Owner 2026-11-21 (optional: without them those changes are not undone). Each checks permissions again on the server. */
    cancelHeld?(actorId: string, since: string): Promise<{ cancelled: number; toldUserIds: string[] }>;
    undoHandOver?(actorId: string, taskId: string, toId: string, since: string): Promise<void>;
    changeBack?(actorId: string, taskId: string, to: { date: string; ownerId: string }): Promise<void>;
    renameTask?(actorId: string, taskId: string, title: string): Promise<void>;
    removeNote?(actorId: string, taskId: string, note: string): Promise<void>;
    setLocked?(actorId: string, taskId: string, locked: boolean): Promise<void>;
    undoAnswer?(actorId: string, requestId: string, since: string): Promise<void>;
    /** "X took back …" to someone who was already told (app bell, and WhatsApp when their chat window is open). */
    tellTakenBack?(actorId: string, userId: string, title: string): Promise<void>;
    /** People's names, for the reply ("Vidya was told"). */
    nameOf?(userId: string): string | null;
}

const bullets = (a: string[]) => a.map(x => `• ${x}`).join('\n');

/**
 * Reverse the last change. Messages still waiting are cancelled first (nobody hears about it); then each part is checked
 * again (it may have changed since) and put back; permissions are enforced by UndoIO. Someone who was already told gets a
 * short "taken back" note. Never throws.
 */
export async function runUndo(change: LastChange | null, actorId: string, io: UndoIO, now = new Date()): Promise<{ text: string; undone: number }> {
    if (!change) return { text: "There's nothing to undo right now.", undone: 0 };
    if (now.getTime() - new Date(change.at).getTime() > UNDO_WINDOW_MS) {
        return { text: 'That was more than 10 minutes ago, so I can\'t undo it here. You can change it in the Tasks tab.', undone: 0 };
    }
    const held = io.cancelHeld ? await io.cancelHeld(actorId, change.at).catch(() => ({ cancelled: 0, toldUserIds: [] as string[] })) : { cancelled: 0, toldUserIds: [] as string[] };
    const told = new Set(held.toldUserIds);
    const undone: string[] = []; const skipped: string[] = []; const handovers: string[] = []; const toldBack = new Set<string>();
    const takeBack = async (userId: string | null | undefined, title: string) => {
        if (!userId || userId === actorId || !told.has(userId) || !io.tellTakenBack) return;
        try { await io.tellTakenBack(actorId, userId, title); toldBack.add(io.nameOf?.(userId) || 'them'); } catch { /* the undo itself worked */ }
    };
    const missing = (title: string) => skipped.push(`${title} (can't undo this here)`);
    for (const item of change.items) {
        try {
            switch (item.kind) {
                case 'handover': {
                    if (!item.taskId || !item.toId || !io.undoHandOver) { handovers.push(`"${item.title}": ask ${item.toName} to give it back`); break; }
                    await io.undoHandOver(actorId, item.taskId, item.toId, change.at);
                    undone.push(`${item.title} → back on your list`);
                    await takeBack(item.toId, item.title);
                    break;
                }
                case 'status': {
                    if ((await io.currentStatus(item.taskId)) !== item.after) { skipped.push(`${item.title} (changed since)`); break; }
                    await io.setStatus(actorId, item.taskId, item.before);
                    undone.push(`${item.title} → back to ${item.before === 'in_progress' ? 'in progress' : 'to do'}`);
                    break;
                }
                case 'created': {
                    const id = await io.findCreated(actorId, item.assigneeId, item.title, item.date, change.at);
                    if (!id) { skipped.push(`${item.title} (already started or changed)`); break; }
                    await io.deleteTask(actorId, id);
                    undone.push(`${item.title} → removed`);
                    await takeBack(item.assigneeId, item.title);
                    break;
                }
                case 'rename':
                    if (!io.renameTask) { missing(item.title); break; }
                    await io.renameTask(actorId, item.taskId, item.before);
                    undone.push(`${item.title} → back to "${item.before}"`);
                    break;
                case 'change':
                    if (!io.changeBack) { missing(item.title); break; }
                    await io.changeBack(actorId, item.taskId, { date: item.beforeDate, ownerId: item.beforeOwnerId });
                    undone.push(`${item.title} → back as it was`);
                    if (item.toId && item.toId !== item.beforeOwnerId) await takeBack(item.toId, item.title);
                    break;
                case 'note':
                    if (!io.removeNote) { missing(item.title); break; }
                    await io.removeNote(actorId, item.taskId, item.note);
                    undone.push(`${item.title} → note removed`);
                    break;
                case 'lock':
                    if (!io.setLocked) { missing(item.title); break; }
                    await io.setLocked(actorId, item.taskId, !item.locked);
                    undone.push(`${item.title} → ${item.locked ? 'unlocked' : 'locked'} again`);
                    break;
                case 'remind': {
                    // Nothing to put back: either the reminder was still waiting (cancelled above) or it has gone.
                    const gone = item.toIds.filter(id => told.has(id));
                    if (gone.length || !held.cancelled) skipped.push(`Reminder about ${item.title} (already sent${gone.length ? ` to ${gone.map(id => io.nameOf?.(id) || 'them').join(', ')}` : ''})`);
                    else undone.push(`Reminder about ${item.title} → not sent`);
                    break;
                }
                case 'answer':
                    if (!io.undoAnswer) { missing(item.title); break; }
                    await io.undoAnswer(actorId, item.requestId, change.at);
                    undone.push(`${item.title} → waiting for your answer again`);
                    break;
            }
        } catch (err) {
            // Only reasons written for people (WorkspaceError / a permission refusal) are shown; anything else stays generic.
            const readable = err instanceof Error && (err.name === 'WorkspaceError' || err.name === 'PermissionDeniedError') && err.message.length < 120;
            const why = readable ? err.message.replace(/\.$/, '') : 'not allowed or failed';
            skipped.push(`${item.title} (${why})`);
        }
    }
    const parts: string[] = [];
    if (undone.length) parts.push(`↩️ *Undone*\n${bullets(undone)}`);
    if (skipped.length) parts.push(`Not undone:\n${bullets(skipped)}`);
    if (handovers.length) parts.push(`A hand-over can't be undone by me:\n${bullets(handovers)}`);
    if (toldBack.size) parts.push(`${[...toldBack].join(', ')} had already been told, so I let ${toldBack.size === 1 ? 'them' : 'them all'} know it was taken back.`);
    else if (undone.length && held.cancelled) parts.push('Nobody else was told about it.');
    return { text: parts.join('\n\n') || "There's nothing to undo right now.", undone: undone.length };
}
