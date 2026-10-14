import { FACILITY_INTENTS, TASK_INTENTS, type BrainContext, type Intent, type Outcome } from './brain/types';
/* eslint-disable @typescript-eslint/no-explicit-any -- replay snapshots accept legacy/context JSON and validate every retained field */

export type LearningTrigger = 'unknown' | 'repeated_clarify' | 'apology' | 'correction' | 'undo';
export interface ReviewLabel { intent: Intent; outcome: Outcome; expect: Record<string, unknown>; mustNotMutate?: boolean; mustClarify?: boolean }

const CORRECTION = /^(?:no\b|nope\b|nah\b|nahi\b|nahin\b|galat\b)|\b(?:i meant|meant to|mera matlab|my mistake)\b/i;

export function learningTriggers(input: { intent?: string | null; outcome?: string | null; previousOutcome?: string | null; apology?: boolean; text?: string; exact?: string | null }): LearningTrigger[] {
    const out: LearningTrigger[] = [];
    if (input.intent === 'unknown') out.push('unknown');
    if (input.outcome === 'CLARIFY' && input.previousOutcome === 'CLARIFY') out.push('repeated_clarify');
    if (input.apology) out.push('apology');
    if (input.text && CORRECTION.test(input.text.trim())) out.push('correction');
    if (input.exact === 'undo') out.push('undo');
    return out;
}

/** Store only facts the model/code need for replay. Contact details and conversation text outside this turn are excluded. */
export function sanitizeReplayContext(ctx: Partial<BrainContext> & Record<string, any>): Record<string, unknown> {
    const clean = (v: unknown, max = 200) => String(v ?? '').replace(/(?:\+?\d[\s().-]*){10,15}/g, '[phone redacted]').slice(0, max);
    const person = (p: any) => p && typeof p === 'object' ? { id: String(p.id || ''), name: clean(p.name, 100), department: p.department == null ? null : clean(p.department, 100), role: p.role ?? null } : null;
    const pending = (() => {
        const p: any = ctx.pending;
        if (!p || typeof p !== 'object') return null;
        if (p.kind === 'confirm') return { kind: 'confirm', summary: clean(p.summary, 500) };
        if (p.kind === 'pick') return { kind: 'pick', options: Array.isArray(p.options) ? p.options.slice(0, 20).map((x: unknown) => clean(x, 200)) : [] };
        if (p.kind === 'preview') return { kind: 'preview', count: Number(p.count || 0) };
        if (p.kind === 'ping_reply') return { kind: 'ping_reply', assigner: clean(p.assigner, 100), taskIds: Array.isArray(p.taskIds) ? p.taskIds.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [], taskTitles: Array.isArray(p.taskTitles) ? p.taskTitles.slice(0, 100).map((x: unknown) => clean(x, 200)) : [], assigners: Array.isArray(p.assigners) ? p.assigners.slice(0, 100).map((x: unknown) => clean(x, 100)) : undefined };
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
