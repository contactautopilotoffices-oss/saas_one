/**
 * AI Assistant learning loop (owner 2026-11-04), modelled on the Task Manager's (task-manager/LearningLoop.ts,
 * BotLearningService.ts): flag likely mistakes → an org super admin teaches the right answer → taught examples guide
 * the AI and become test cases → instruction versions go live only after a test run.
 *
 * Doctrine L7 [BAA pp.100-103]: memory only where work repeats (people ask the same things every day), and the write
 * path rejects unknown scope keys [BAA p.101]: a taught example must name a real catalog entry and valid fields.
 */
import { isRephrase, learningTriggers } from '@/task-manager/LearningLoop';
import { CATALOG, type CatalogEntry, type QuestionEntry } from './catalog';
import type { Channel } from './types';

export type FlagTrigger = 'unknown' | 'correction' | 'rephrase' | 'repeated_clarify' | 'too_many_questions';

export interface Example { id?: string; messageText: string; entryId: string; fields: Record<string, unknown> }

export interface LearningContext {
    enabled: boolean;
    examples: Example[];
    instructions: string | null;
}

export interface ReviewFlag {
    orgId: string; userId: string; channel: Channel;
    messageText: string; followUpText?: string | null; botReply?: string | null;
    entryId?: string | null; triggers: FlagTrigger[];
}

/** Pseudo-entries a teacher may pick besides the catalog: "it's about tasks" and "the AI should say it can't help". */
export const TEACHABLE_SPECIAL = ['tasks', 'none'] as const;

/** Phone numbers, long ids and emails are masked before anything is stored for review. */
export function maskText(text: string, max = 600): string {
    return String(text || '')
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••')
        .replace(/\d[\d\s-]{5,}\d/g, '•••')
        .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "no / galat / I meant…" and "asked the same thing again" reuse the Task Manager's rules exactly. */
export function followUpTriggers(prev: { text: string; at: string } | null | undefined, text: string, now: Date): FlagTrigger[] {
    if (!prev) return [];
    const gap = now.getTime() - Date.parse(prev.at);
    const t = learningTriggers({ text, rephrase: isRephrase(prev.text, text, gap) });
    const out: FlagTrigger[] = [];
    if (t.includes('correction') && gap <= 10 * 60_000) out.push('correction');
    if (t.includes('rephrase')) out.push('rephrase');
    return out;
}

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2));

/** The taught examples most like this message (word overlap), only for entries this person may use, at most k. */
export function selectExamples(message: string, examples: Example[], allowedEntryIds: string[], k = 8): Example[] {
    const allowed = new Set([...allowedEntryIds, ...TEACHABLE_SPECIAL]);
    const m = words(message);
    return examples
        .filter(e => allowed.has(e.entryId))
        .map(e => {
            const w = words(e.messageText); let shared = 0;
            for (const x of w) if (m.has(x)) shared++;
            return { e, score: shared / Math.max(1, Math.min(w.size, m.size)) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(x => x.e);
}

/** Prompt block: this organization's taught examples. Message text is data, wrapped and stripped of tags. */
export function examplesBlock(examples: Example[]): string {
    if (!examples.length) return '';
    const safe = (s: string) => s.replace(/<\/?message>/gi, ' ').replace(/\s+/g, ' ').slice(0, 300);
    return ['', 'Examples taught by this organization (follow them for similar messages):',
        ...examples.map(e => `<message>${safe(e.messageText)}</message> → ${JSON.stringify({ entry: e.entryId, fields: e.fields })}`)].join('\n');
}

/** Prompt block: the live instruction version. It guides understanding only; the rules above and all access checks in code still apply. */
export function instructionsBlock(text: string | null): string {
    if (!text || !text.trim()) return '';
    return ['', "Guidance written by this organization's admin (it can't change the rules or steps above):",
        text.replace(/<\/?message>/gi, ' ').slice(0, 4000)].join('\n');
}

/**
 * Validate a taught answer before saving (L7: reject unknown scope keys). Returns the cleaned fields, or an error.
 * Free-text fields (description, location) are not kept: an example teaches the KIND of request, not someone's words.
 */
export function validateExample(entryId: string, fields: unknown): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
    if ((TEACHABLE_SPECIAL as readonly string[]).includes(entryId)) return { ok: true, fields: {} };
    const entry = CATALOG.find(e => e.id === entryId);
    if (!entry) return { ok: false, error: `Unknown question or action: ${entryId}` };
    const raw = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields as Record<string, unknown> : {};
    if (entry.kind === 'question') {
        const parsed = (entry as QuestionEntry<Record<string, unknown>>).fields.safeParse(raw);
        if (!parsed.success) return { ok: false, error: `Invalid details for ${entryId}` };
        const clean = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== null && v !== undefined));
        return { ok: true, fields: clean };
    }
    // ticket.create: only the shape is taught
    return { ok: true, fields: { urgent: raw.urgent === true } };
}

/** Did the AI give the taught answer? Same entry, and every taught field (other than free text) the same. */
export function examplePasses(expected: Example, got: { entry: string; fields?: Record<string, unknown> }): boolean {
    if (expected.entryId !== got.entry) return false;
    const entry = CATALOG.find(e => e.id === expected.entryId) as CatalogEntry | undefined;
    if (!entry || entry.kind !== 'question') return true;
    const parsed = (entry as QuestionEntry<Record<string, unknown>>).fields.safeParse(got.fields ?? {});
    const g = parsed.success ? parsed.data : {};
    return Object.entries(expected.fields).every(([k, v]) => k === 'property_name'
        ? String(g[k] ?? '').toLowerCase().trim() === String(v ?? '').toLowerCase().trim()
        : g[k] === v);
}

export interface TestReport { total: number; passed: number; passRate: number; failures: Array<{ message: string; expected: string; got: string }> }

/**
 * Run the taught examples as tests (at most 30, 5 at a time). Each example is tested with the OTHER examples as
 * guidance, so a test can't pass just by seeing its own answer.
 */
export async function runExampleTests(
    examples: Example[],
    classify: (message: string, others: Example[]) => Promise<{ entry: string; fields?: Record<string, unknown> }>,
): Promise<TestReport> {
    const cases = examples.slice(0, 30);
    const results: Array<{ e: Example; got: { entry: string; fields?: Record<string, unknown> } | null }> = [];
    for (let i = 0; i < cases.length; i += 5) {
        const batch = cases.slice(i, i + 5);
        results.push(...await Promise.all(batch.map(async e => ({
            e, got: await classify(e.messageText, examples.filter(x => x !== e)).catch(() => null),
        }))));
    }
    const failures = results.filter(r => !r.got || !examplePasses(r.e, r.got)).map(r => ({
        message: r.e.messageText,
        expected: `${r.e.entryId} ${JSON.stringify(r.e.fields)}`,
        got: r.got ? `${r.got.entry} ${JSON.stringify(r.got.fields ?? {})}` : 'AI error',
    }));
    const passed = results.length - failures.length;
    return { total: results.length, passed, passRate: results.length ? passed / results.length : 1, failures };
}
