import { CONVERSATION_LINES } from './brain/prompt';
import { FACILITY_INTENTS, TASK_INTENTS, type BrainContext, type Intent, type Outcome } from './brain/types';
/* eslint-disable @typescript-eslint/no-explicit-any -- replay snapshots accept legacy/context JSON and validate every retained field */

export type LearningTrigger = 'unknown' | 'repeated_clarify' | 'apology' | 'correction' | 'undo' | 'rephrase';
export interface ReviewLabel { intent: Intent; outcome: Outcome; expect: Record<string, unknown>; mustNotMutate?: boolean; mustClarify?: boolean }

// "wrong" / "galat" only at the start: "something is wrong with the AC" is a facility request, not a correction.
const CORRECTION = /^(?:no\b|nope\b|nah\b|nahi\b|nahin\b|galat\b|wrong\b|not this\b|not that\b)|\b(?:i meant|meant to|mera matlab|my mistake)\b/i;
// While the bot is waiting for an answer, a bare "no" / "nahi" just answers its question. Only these still count then.
const STRONG_CORRECTION = /^(?:galat\b|wrong\b|not this\b|not that\b)|\b(?:i meant|meant to|mera matlab|my mistake)\b/i;

/** Triggers that say the PREVIOUS answer was wrong: the review item is the earlier message, this one is its follow-up. */
export const FOLLOW_UP_TRIGGERS: readonly LearningTrigger[] = ['correction', 'undo', 'rephrase'];
export const REPHRASE_WINDOW_MS = 2 * 60_000;
/** How long the last answered message is kept so a follow-up can find it. */
export const RECENT_KEEP_MS = 10 * 60_000;

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2));

/** "Asked again": the same person sends a message within 2 minutes that shares most of its words with the previous one. */
export function isRephrase(previous: string | null | undefined, text: string, gapMs: number): boolean {
    if (!previous || !(gapMs >= 0) || gapMs > REPHRASE_WINDOW_MS) return false;
    const a = words(previous), b = words(text);
    if (a.size < 2 || b.size < 2) return false;
    let shared = 0; for (const w of a) if (b.has(w)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.6;
}

export function learningTriggers(input: { intent?: string | null; outcome?: string | null; previousOutcome?: string | null; apology?: boolean; text?: string; exact?: string | null; rephrase?: boolean; pending?: boolean }): LearningTrigger[] {
    const out: LearningTrigger[] = [];
    if (input.intent === 'unknown') out.push('unknown');
    if (input.outcome === 'CLARIFY' && input.previousOutcome === 'CLARIFY') out.push('repeated_clarify');
    if (input.apology) out.push('apology');
    if (input.text && (input.pending ? STRONG_CORRECTION : CORRECTION).test(input.text.trim())) out.push('correction');
    if (input.exact === 'undo') out.push('undo');
    if (input.rephrase && !out.includes('correction')) out.push('rephrase');
    return out;
}

/** The bot's reply as shown on the review card: phone numbers removed, length capped. */
export const sanitizeReplyText = (text: string): string => String(text ?? '').replace(/(?:\+?\d[\s().-]*){10,15}/g, '[phone redacted]').slice(0, 3000);

/** Owner 2026-11-05: one chat line kept with a test: long enough to follow the chat, with no phone number or email address. */
const MAX_CHAT_LINE_CHARS = 300;
const redactChat = (v: unknown, max: number) => String(v ?? '').replace(/(?:\+?\d[\s().-]*){10,15}/g, '[phone redacted]').replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, '[email redacted]').slice(0, max);

/**
 * Store only facts the model/code need for replay. Contact details are excluded.
 * Owner 2026-11-05: the recent chat and an unfinished request are kept too, because the live bot reads them: without them a
 * follow-up like "add this too" was tested on less than the bot really had. See "Changes 2026-11-05" in docs/TASK_BRAIN_SPEC.md.
 */
export function sanitizeReplayContext(ctx: Partial<BrainContext> & Record<string, any>): Record<string, unknown> {
    const clean = (v: unknown, max = 200) => String(v ?? '').replace(/(?:\+?\d[\s().-]*){10,15}/g, '[phone redacted]').slice(0, max);
    const conversation = Array.isArray(ctx.conversation) ? ctx.conversation.filter((x: unknown) => typeof x === 'string').slice(-CONVERSATION_LINES).map((x: unknown) => redactChat(x, MAX_CHAT_LINE_CHARS)) : [];
    const person = (p: any) => p && typeof p === 'object' ? { id: String(p.id || ''), name: clean(p.name, 100), department: p.department == null ? null : clean(p.department, 100), role: p.role ?? null } : null;
    const pending = (() => {
        const p: any = ctx.pending;
        if (!p || typeof p !== 'object') return null;
        if (p.kind === 'confirm') return { kind: 'confirm', summary: clean(p.summary, 500) };
        if (p.kind === 'pick') return { kind: 'pick', options: Array.isArray(p.options) ? p.options.slice(0, 20).map((x: unknown) => clean(x, 200)) : [] };
        if (p.kind === 'preview') return { kind: 'preview', count: Number(p.count || 0) };
        if (p.kind === 'ping_reply') return { kind: 'ping_reply', assigner: clean(p.assigner, 100), taskIds: Array.isArray(p.taskIds) ? p.taskIds.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [], taskTitles: Array.isArray(p.taskTitles) ? p.taskTitles.slice(0, 100).map((x: unknown) => clean(x, 200)) : [], assigners: Array.isArray(p.assigners) ? p.assigners.slice(0, 100).map((x: unknown) => clean(x, 100)) : undefined };
        if (p.kind === 'draft') return { kind: 'draft', request: redactChat(p.request, 500), question: p.question == null ? null : redactChat(p.question, MAX_CHAT_LINE_CHARS), at: String(p.at ?? ''), ...(p.suggested ? { suggested: redactChat(p.suggested, 200) } : {}) };
        return null;
    })();
    return {
        today: typeof ctx.today === 'string' ? ctx.today : null,
        sender: person(ctx.sender),
        people: Array.isArray(ctx.people) ? ctx.people.slice(0, 100).map(person).filter(Boolean) : [],
        assignableIds: Array.isArray(ctx.assignableIds) ? ctx.assignableIds.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [],
        tasks: Array.isArray(ctx.tasks) ? ctx.tasks.slice(0, 100).map((t: any) => ({ n: Number(t.n || 0), id: String(t.id || ''), title: clean(t.title), status: t.status })) : [],
        departments: Array.isArray(ctx.departments) ? ctx.departments.filter((x: unknown) => typeof x === 'string').slice(0, 50).map((x: unknown) => clean(x, 100)) : [],
        pending,
        recent: Array.isArray(ctx.recent) ? ctx.recent.filter((x: unknown) => typeof x === 'string').slice(-4).map((x: unknown) => clean(x, 500)) : [],
        // Absent when there was no chat, as in a live turn: the replay then behaves exactly as it does for older tests.
        ...(conversation.length ? { conversation } : {}),
    };
}

export function validateReviewLabel(value: unknown): { ok: true; value: ReviewLabel } | { ok: false; error: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Label must be an object.' };
    const v = value as Record<string, unknown>;
    const intents = new Set<string>([...TASK_INTENTS, ...FACILITY_INTENTS]);
    const outcomes = new Set(['ACT', 'CONFIRM', 'CLARIFY', 'REFUSE', 'HANDOFF']);
    if (!intents.has(String(v.intent))) return { ok: false, error: 'Unknown intent.' };
    if (!outcomes.has(String(v.outcome))) return { ok: false, error: 'Unknown outcome.' };
    if (!v.expect || typeof v.expect !== 'object' || Array.isArray(v.expect)) return { ok: false, error: 'Expected details are required.' };
    const e = v.expect as Record<string, unknown>;
    const allowed = new Set(['scope', 'personId', 'taskIds', 'taskCount', 'date', 'state', 'answer', 'pick', 'department', 'assignee', 'reason']);
    if (Object.keys(e).some(k => !allowed.has(k))) return { ok: false, error: 'Expected details contain an unknown field.' };
    if (e.scope !== undefined && !['self', 'person', 'team', 'department', 'org', 'pending_overview'].includes(String(e.scope))) return { ok: false, error: 'Invalid scope.' };
    if (e.taskIds !== undefined && (!Array.isArray(e.taskIds) || e.taskIds.some(x => typeof x !== 'string'))) return { ok: false, error: 'taskIds must be strings.' };
    if (e.taskCount !== undefined && (!Array.isArray(e.taskCount) || e.taskCount.some(x => !Number.isInteger(x)))) return { ok: false, error: 'taskCount must contain whole numbers.' };
    if (e.date !== undefined && (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
    if (e.state !== undefined && !['working', 'partly_done', 'blocked', 'done_all', 'done_some', 'other'].includes(String(e.state))) return { ok: false, error: 'Invalid progress state.' };
    if (e.answer !== undefined && !['yes', 'no', 'pick', 'edit', 'unsure'].includes(String(e.answer))) return { ok: false, error: 'Invalid answer.' };
    for (const k of ['personId', 'department', 'assignee', 'reason']) if (e[k] !== undefined && typeof e[k] !== 'string') return { ok: false, error: `${k} must be text.` };
    if (e.pick !== undefined && !Number.isInteger(e.pick)) return { ok: false, error: 'pick must be a whole number.' };
    return { ok: true, value: { intent: v.intent as Intent, outcome: v.outcome as Outcome, expect: v.expect as Record<string, unknown>, mustNotMutate: v.mustNotMutate === true, mustClarify: v.mustClarify === true } };
}

/** Intents that change something: the bot proposes them, or does them straight away, depending on the confirmation rules. */
const CHANGE_INTENTS: readonly Intent[] = ['complete_tasks', 'progress_update', 'create_tasks', 'hand_over_task', 'delete_tasks', 'rename_task', 'add_note', 'remind_tasks', 'lock_task', 'change_task', 'answer_request'];
/** The details each intent's action really carries, so the only ones scoreCase can compare. Any other detail can never match. */
const COMPARABLE: Partial<Record<Intent, readonly string[]>> = {
    view_tasks: ['scope', 'personId', 'department'], complete_tasks: ['taskIds'], progress_update: ['state', 'taskIds'],
    create_tasks: ['assignee', 'taskCount', 'date'], hand_over_task: ['assignee', 'taskIds'], answer_pending: ['answer', 'pick'],
    delete_tasks: ['taskIds'], rename_task: ['taskIds'], add_note: ['taskIds'], remind_tasks: ['taskIds'], lock_task: ['taskIds'],
    change_task: ['assignee', 'date', 'taskIds'],
};

/**
 * Owner 2026-11-05: 16 of 23 saved tests could not be passed, so every new prompt was rejected. Make a label one the scorer can
 * really judge, using only its replay context, or say why no answer could be right. Used when a test is loaded and when one is
 * written, so old rows are repaired without touching the database and new ones never go wrong.
 *   • mustNotMutate on an expected proposal contradicts itself (scoreCase counts any proposal as unsafe). A proposal already
 *     waits for YES, so the expected outcome stands and the flag goes.
 *   • a person is compared by id, so a name becomes that person's id; details the action does not carry are dropped.
 *   • no answer can be right: a reply to a question the snapshot never saved, or "unknown" with an action to take.
 */
export function repairReviewLabel(label: ReviewLabel, ctx: Record<string, any> | null | undefined): { ok: true; value: ReviewLabel } | { ok: false; error: string } {
    const proposes = label.outcome === 'ACT' || label.outcome === 'CONFIRM';
    if (label.mustClarify && label.outcome !== 'CLARIFY') return { ok: false, error: 'It must ask a question, but expects another outcome.' };
    if (label.intent === 'unknown' && proposes) return { ok: false, error: 'It expects an action for a message the bot cannot read.' };
    if (label.intent === 'answer_pending' && !ctx?.pending) return { ok: false, error: 'It answers a question that was not saved with the test.' };

    const keep = COMPARABLE[label.intent] ?? [];
    const expect = Object.fromEntries(Object.entries(label.expect).filter(([k]) => k === 'reason' || keep.includes(k)));
    if (typeof expect.assignee === 'string') {
        const wanted = expect.assignee.trim().toLowerCase();
        const person = [ctx?.sender, ...(Array.isArray(ctx?.people) ? ctx.people : [])].find((p: any) => p && (p.id === expect.assignee || String(p.name ?? '').trim().toLowerCase() === wanted));
        if (person) expect.assignee = person.id; else delete expect.assignee;
    }
    if (Array.isArray(expect.taskIds)) {
        const known = new Set((Array.isArray(ctx?.tasks) ? ctx.tasks : []).map((t: any) => t?.id));
        expect.taskIds = expect.taskIds.filter(id => known.has(id));
        if (!(expect.taskIds as unknown[]).length) delete expect.taskIds;
    }
    const mustNotMutate = !!label.mustNotMutate && !(proposes && CHANGE_INTENTS.includes(label.intent));
    return { ok: true, value: { ...label, expect, mustNotMutate } };
}

/** Asking first or acting straight away is set by the confirmation rules (One front door), not by the prompt: a test accepts both. */
export function acceptedOutcomes(label: Pick<ReviewLabel, 'intent' | 'outcome'>): Outcome[] {
    const proposes = label.outcome === 'ACT' || label.outcome === 'CONFIRM';
    return proposes && CHANGE_INTENTS.includes(label.intent) ? ['ACT', 'CONFIRM'] : [label.outcome];
}
