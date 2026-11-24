/**
 * Ticket sorting that learns from the Tech team's judgements (owner 2026-11-19: "with corrections, it must improve the
 * classification accuracy and confidence"). Pure: no database, no model. The store (sortLearningStore.ts) reads and
 * writes; the resolver (resolver.ts) runs it. Phases of the plan:
 *
 *   1. Similar examples. Every judged ticket (right ones too) and every ticket re-sorted with the Override button is a
 *      learning example. For a new ticket the most similar examples of its organisation are found, only those whose
 *      category this ticket's property can use, and shown to the AI. Before: the newest 30 corrections, whatever they
 *      were about.
 *   2. Measured confidence. The confidence saved is no longer the AI's own rating. It is that rating corrected by the
 *      AI's track record ("its 90% has been right 74% of the time"), mixed with how many similar past tickets agree.
 *   3. Repeats. A ticket nearly identical to at least two past tickets that were all sorted the same way, with no
 *      disagreeing example, takes that category without the AI. Never for danger words (fire, smoke, sparks...): those
 *      always go to the AI, which may raise the priority.
 *
 * Similarity is a "strength" from 0 to 1 whatever found it: shared words (sortLearningStats.similarity), or meaning
 * (embedding cosine, rescaled by meaningStrength so the same thresholds work for both).
 */
import { similarity, wordsOf } from './sortLearningStats';
import type { AiVerdict, CategoryOption, Priority } from './aiClassifier';
import type { SkillGroup } from './classifyTicket';

export type ExampleSource = 'judged_right' | 'judged_wrong' | 'override';

/** One learning example: a ticket whose right category a person confirmed or chose. Text already masked. */
export interface Example {
    id: string;
    ticketId: string | null;
    propertyId: string | null;
    text: string;
    code: string;
    team: SkillGroup | null;
    source: ExampleSource;
    at: string;
}

export interface Neighbour { example: Example; strength: number; by: 'words' | 'meaning' }

/** From here an example is shown to the AI. */
export const SHOW_FROM = 0.2;
/** From here an example counts when measuring confidence ("similar"). */
export const STRONG = 0.5;
/** From here an example counts as the same ticket again (the repeat shortcut). */
export const SAME = 0.8;
/** At most this many examples are shown to the AI. */
export const MAX_SHOWN = 8;

/** Embedding cosine → strength. 0.6 or less is unrelated; 0.8 counts as similar; 0.92 as the same ticket again. */
export function meaningStrength(cosine: number): number {
    return Math.max(0, Math.min(1, (cosine - 0.6) / 0.4));
}

/**
 * The most similar examples by shared words, strongest first. Only examples whose category is in `allowed` (the
 * property's own list), and never the ticket itself.
 */
export function similarByWords(text: string, examples: readonly Example[], allowed: ReadonlySet<string>, opts: { ticketId?: string | null; max?: number } = {}): Neighbour[] {
    const words = wordsOf(text);
    if (!words.size) return [];
    const out: Neighbour[] = [];
    for (const e of examples) {
        if (!allowed.has(e.code) || (opts.ticketId && e.ticketId === opts.ticketId)) continue;
        const s = similarity(words, wordsOfCached(e));
        if (s >= SHOW_FROM) out.push({ example: e, strength: s, by: 'words' });
    }
    return out.sort((a, b) => b.strength - a.strength || b.example.at.localeCompare(a.example.at)).slice(0, opts.max ?? MAX_SHOWN);
}

const wordCache = new WeakMap<Example, Set<string>>();
function wordsOfCached(e: Example): Set<string> {
    let w = wordCache.get(e);
    if (!w) { w = wordsOf(e.text); wordCache.set(e, w); }
    return w;
}

/** Joins two neighbour lists (words and meaning): one entry per example, the stronger kept. */
export function mergeNeighbours(a: readonly Neighbour[], b: readonly Neighbour[], max = MAX_SHOWN): Neighbour[] {
    const best = new Map<string, Neighbour>();
    for (const n of [...a, ...b]) {
        const had = best.get(n.example.id);
        if (!had || n.strength > had.strength) best.set(n.example.id, n);
    }
    return [...best.values()].sort((x, y) => y.strength - x.strength || y.example.at.localeCompare(x.example.at)).slice(0, max);
}

// ── Phase 3: the repeat shortcut ────────────────────────────────────────────────────────────────────────────────────

/** Words that may mean danger: such a ticket always goes to the AI, which may raise the priority. */
export const DANGER = /\b(fire|smoke|smok|spark|sparking|burn|burning|shock|short ?circuit|flood|flooding|stuck|trapped|injur|bleed|faint|emergency|urgent|gas|explo|collapse|aag|dhuan|dhua|jal|current|chingari|phas)/i;

export interface ShortcutResult { verdict: AiVerdict; agreeing: Neighbour[] }

/**
 * A ticket nearly identical (strength ≥ SAME) to at least two examples that all have the same category, with no similar
 * example (≥ STRONG) pointing elsewhere, takes that category without the AI. null = ask the AI.
 */
export function repeatShortcut(text: string, neighbours: readonly Neighbour[], options: readonly CategoryOption[]): ShortcutResult | null {
    if (wordsOf(text).size < 2 || DANGER.test(text)) return null;
    const same = neighbours.filter(n => n.strength >= SAME);
    if (same.length < 2) return null;
    const code = same[0].example.code;
    if (same.some(n => n.example.code !== code)) return null;
    if (neighbours.some(n => n.strength >= STRONG && n.example.code !== code)) return null;
    const option = options.find(o => o.code === code);
    if (!option) return null;
    const team = option.team ?? same.find(n => n.example.team)?.example.team ?? null;
    if (!team) return null;
    const priority: Priority = option.priority ?? 'medium';
    const confidence = Math.min(95, 86 + 3 * same.length);
    return {
        agreeing: same,
        verdict: {
            code, team, priority, risk: null, vague: false, confidence,
            reason: `Same as ${same.length} earlier tickets your team sorted to ${option.name}`,
        },
    };
}

// ── Phase 2: measured confidence ────────────────────────────────────────────────────────────────────────────────────

/** How often the AI's rating has been right, per band of its rating. Built from history by calibrationFrom. */
export interface CalibrationBand { lo: number; hi: number; tickets: number; right: number }
export type CalibrationTable = readonly CalibrationBand[];

export const CAL_BANDS: ReadonlyArray<readonly [number, number]> = [[0, 49], [50, 59], [60, 69], [70, 79], [80, 84], [85, 89], [90, 94], [95, 100]];
/** How many past tickets a band needs before its record counts as much as the AI's own word. */
const SHRINK = 10;

/** Groups past sortings (the AI's own rating, and whether it was right) into the bands. */
export function calibrationFrom(history: ReadonlyArray<{ confidence: number; right: boolean }>): CalibrationTable {
    return CAL_BANDS.map(([lo, hi]) => {
        const inBand = history.filter(h => h.confidence >= lo && h.confidence <= hi);
        return { lo, hi, tickets: inBand.length, right: inBand.filter(h => h.right).length };
    });
}

/**
 * The AI's rating corrected by its track record. With few past tickets in that band the AI's own number counts more;
 * with many, the record does: (right + rating × SHRINK) / (tickets + SHRINK).
 */
export function calibrated(rating: number, table: CalibrationTable): { value: number; band: CalibrationBand | null } {
    const band = table.find(b => rating >= b.lo && rating <= b.hi) ?? null;
    if (!band || !band.tickets) return { value: rating, band };
    return { value: (100 * band.right + rating * SHRINK) / (band.tickets + SHRINK), band };
}

export interface Measured { confidence: number; why: string; agreeing: number; disagreeing: number }

/**
 * The confidence that is saved and shown. Starts from the calibrated rating; similar past tickets then pull it up when
 * they agree with the chosen category and down when they point elsewhere. Up to three similar tickets count, and
 * together they weigh at most 60%.
 */
export function measuredConfidence(rating: number, chosen: string | null, neighbours: readonly Neighbour[], table: CalibrationTable, name: (code: string) => string = c => c): Measured {
    const cal = calibrated(rating, table);
    const strong = neighbours.filter(n => n.strength >= STRONG).slice(0, 5);
    const agree = strong.filter(n => n.example.code === chosen);
    const total = strong.reduce((s, n) => s + n.strength, 0);
    const agreement = total ? agree.reduce((s, n) => s + n.strength, 0) / total : 0;
    const weight = strong.length ? 0.6 * Math.min(1, strong.length / 3) : 0;
    const value = (1 - weight) * cal.value + weight * 100 * agreement;
    const confidence = Math.round(Math.max(1, Math.min(99, value)));

    const parts: string[] = [`The AI said ${Math.round(rating)}%.`];
    if (cal.band?.tickets) parts.push(`When it said ${cal.band.lo}-${cal.band.hi}% before, it was right ${cal.band.right} of ${cal.band.tickets} times.`);
    else parts.push('There is no track record for that rating yet, so its own number is used.');
    if (strong.length) {
        const others = strong.filter(n => n.example.code !== chosen).map(n => name(n.example.code));
        parts.push(`${agree.length} of ${strong.length} similar past tickets went to the same category${others.length ? ` (others: ${[...new Set(others)].join(', ')})` : ''}.`);
    } else parts.push('No similar past ticket was found.');
    return { confidence, why: parts.join(' '), agreeing: agree.length, disagreeing: strong.length - agree.length };
}

// ── Phase 5: examples that disagree ────────────────────────────────────────────────────────────────────────────────

export interface ExampleConflict { a: Example; b: Example; strength: number }

/** Near-identical examples of one organisation with different categories: a person decides which one stands. */
export function exampleConflicts(examples: readonly Example[], max = 20): ExampleConflict[] {
    const out: ExampleConflict[] = [];
    const list = examples.filter(e => wordsOfCached(e).size >= 2);
    for (let i = 0; i < list.length && out.length < max; i++) {
        for (let k = i + 1; k < list.length && out.length < max; k++) {
            const a = list[i], b = list[k];
            if (a.code === b.code) continue;
            const s = similarity(wordsOfCached(a), wordsOfCached(b));
            if (s >= SAME) out.push({ a, b, strength: Math.round(s * 100) / 100 });
        }
    }
    return out;
}

/** How a neighbour is kept with the ticket (trace) and shown on the Review screen: short, masked text only. */
export interface NeighbourNote { id: string; text: string; code: string; source: ExampleSource; strength: number; by: 'words' | 'meaning' }
export const noteOf = (n: Neighbour): NeighbourNote => ({ id: n.example.id, text: n.example.text.replace(/\s+/g, ' ').trim().slice(0, 140), code: n.example.code, source: n.example.source, strength: Math.round(n.strength * 100) / 100, by: n.by });
