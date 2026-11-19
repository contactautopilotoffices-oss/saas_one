/**
 * Ticket sorting that learns (owner 2026-11-19): one ticket, the new way. Used by resolver.ts while the organisation's
 * setting (Brain → Switches → Ticket sorting learns) is "watch only" or "on".
 *
 *   1. Find the most similar examples of the organisation (shared words; by meaning too when that is switched on),
 *      only of categories this ticket's property can use.
 *   2. A repeat of at least two tickets all sorted the same way: that category, no AI (sortLearning.repeatShortcut).
 *   3. Otherwise the AI sorts it with those examples in front of it (aiClassifier.classifyWithAi).
 *   4. The confidence saved is measured (sortLearning.measuredConfidence), with the reason in plain words.
 * Throws only when the AI was needed and every model failed (the caller then sorts the old way). Returns null when
 * the organisation has no examples yet (a new organisation, or migration 20261119000001 not applied): the old way
 * then sorts it, exactly as today.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyWithAi, type AiDeps, type AiVerdict, type CategoryOption, type Correction } from './aiClassifier';
import { measuredConfidence, mergeNeighbours, noteOf, repeatShortcut, similarByWords, type CalibrationTable, type Example, type Neighbour, type NeighbourNote } from './sortLearning';
import { learningSetting, loadCalibration, loadExamples, meaningNeighbours, type LearningSetting } from './sortLearningStore';

/** For tests (and scripts): everything the new way reads, handed in instead of read from the database. */
export interface LearningDeps {
    setting?: LearningSetting;
    examples?: Example[];
    calibration?: CalibrationTable;
    meaningSearch?: (text: string, allowed: ReadonlySet<string>) => Promise<Neighbour[]>;
    admin?: SupabaseClient;
}

export interface NewWayResult {
    verdict: AiVerdict;
    /** 'learned-examples' for a shortcut, else the model that answered. */
    model: string;
    method: 'ai' | 'shortcut';
    search: 'words' | 'meaning';
    /** The AI's own rating (null for a shortcut). verdict.confidence is the measured one. */
    modelConfidence: number | null;
    why: string;
    neighbours: NeighbourNote[];
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    failures: Array<{ model: string; error: string }>;
}

export const SHORTCUT_MODEL = 'learned-examples';

export async function settingFor(orgId: string | null | undefined, ld: LearningDeps = {}): Promise<LearningSetting> {
    return ld.setting ?? learningSetting(orgId, ld.admin);
}

/** The examples as the AI sees them: what the team decided, and whether it corrected or confirmed the AI. */
export function examplesForPrompt(neighbours: readonly Neighbour[]): Correction[] {
    return neighbours.map(n => ({ text: n.example.text, code: n.example.code, team: n.example.team, kind: n.example.source === 'judged_right' ? 'confirmed' : 'corrected' }));
}

export async function sortNewWay(text: string, options: readonly CategoryOption[], orgId: string, setting: LearningSetting, deps: AiDeps = {}, ld: LearningDeps = {}): Promise<NewWayResult | null> {
    const started = Date.now();
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('the ticket has no text');
    if (!options.length) throw new Error('the category list is empty');
    const allowed = new Set(options.map(o => o.code));
    const name = (code: string) => options.find(o => o.code === code)?.name ?? code;

    const [examples, calibration] = await Promise.all([
        ld.examples ? Promise.resolve(ld.examples) : loadExamples(orgId, ld.admin).then(x => x.list),
        ld.calibration ? Promise.resolve(ld.calibration) : loadCalibration(orgId, ld.admin),
    ]);
    if (!examples.length) return null;
    const byWords = similarByWords(clean, examples, allowed);
    let neighbours = byWords;
    let search: 'words' | 'meaning' = 'words';
    if (setting.meaning) {
        const byMeaning = await (ld.meaningSearch ? ld.meaningSearch(clean, allowed).catch(() => []) : meaningNeighbours(orgId, clean, examples, allowed, ld.admin));
        if (byMeaning.length) { neighbours = mergeNeighbours(byWords, byMeaning); search = 'meaning'; }
    }

    const short = repeatShortcut(clean, neighbours, options);
    if (short) {
        const why = `Sorted without the AI: the ticket is nearly the same as ${short.agreeing.length} earlier tickets your team sorted to ${name(short.verdict.code!)}, and no similar ticket was sorted differently.`;
        return { verdict: short.verdict, model: SHORTCUT_MODEL, method: 'shortcut', search, modelConfidence: null, why, neighbours: neighbours.map(noteOf), latencyMs: Date.now() - started, tokensIn: 0, tokensOut: 0, failures: [] };
    }

    const sorted = await classifyWithAi(clean, options, deps, examplesForPrompt(neighbours));
    const measured = measuredConfidence(sorted.verdict.confidence, sorted.verdict.code, neighbours, calibration, name);
    return {
        verdict: { ...sorted.verdict, confidence: measured.confidence },
        model: sorted.model, method: 'ai', search, modelConfidence: sorted.verdict.confidence, why: measured.why,
        neighbours: neighbours.map(noteOf), latencyMs: Date.now() - started, tokensIn: sorted.tokensIn, tokensOut: sorted.tokensOut, failures: sorted.failures,
    };
}
