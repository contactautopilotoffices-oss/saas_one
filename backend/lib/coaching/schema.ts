import { z } from 'zod';

/**
 * The 5 layers of a sales conversation we score the BD rep on.
 * Order matters — the UI renders them in this exact order.
 */
export const LAYER_KEYS = [
    'opening',
    'rapport',
    'requirements',
    'core',
    'closing',
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

export const LAYER_LABELS: Record<LayerKey, string> = {
    opening: 'Opening',
    rapport: 'Rapport',
    requirements: 'Requirement Discovery',
    core: 'Core Conversation',
    closing: 'Closing',
};

export const LAYER_DESCRIPTIONS: Record<LayerKey, string> = {
    opening: 'Greeting, self-introduction, reason for the call, agenda-setting.',
    rapport: 'Personal connection, empathy, active listening signals before pitching.',
    requirements: 'Discovery questions, pain-point mapping, confirming understanding.',
    core: 'Value articulation, objection handling, evidence/proof, fit-mapping.',
    closing: 'Next-step commitment, recap, follow-up scheduled, professional sign-off.',
};

/**
 * Transcript segment as returned by OpenAI Whisper with diarization hints.
 * `speaker` is best-effort (Whisper doesn't natively diarize; we infer from
 * channel / energy heuristics in `whisper.ts` if a stereo file is provided,
 * otherwise every segment is marked 'unknown').
 */
export const TranscriptSegmentSchema = z.object({
    speaker: z.enum(['rep', 'client', 'unknown']),
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string().min(1),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** A single layer's score card. */
export const LayerScoreSchema = z.object({
    score: z.number().min(0).max(10),
    /** 1–2 quoted phrases from the transcript that justify the score. */
    evidence: z.string().min(1),
    /** One concrete action the rep can take next call to improve this layer. */
    tip: z.string().min(1),
});
export type LayerScore = z.infer<typeof LayerScoreSchema>;

export const CoachingReportSchema = z.object({
    layers: z.object({
        opening: LayerScoreSchema,
        rapport: LayerScoreSchema,
        requirements: LayerScoreSchema,
        core: LayerScoreSchema,
        closing: LayerScoreSchema,
    }),
    /** Weighted average of the 5 layer scores (0..10). */
    overall_score: z.number().min(0).max(10),
    /** Fraction of total talk time spoken by the rep (0..1). */
    rep_talk_ratio: z.number().min(0).max(1),
    /** Avg continuous talk length by the rep in seconds. */
    avg_rep_talk_seconds: z.number().min(0),
    did_right: z.array(z.string().min(1)).min(1).max(6),
    missed: z.array(z.string().min(1)).min(1).max(6),
    could_improve: z.array(z.string().min(1)).min(1).max(6),
    /** One single behavior to focus on in the next call. */
    next_call_focus: z.string().min(1),
    /** 2–3 sentence plain-English summary of the call. */
    summary: z.string().min(1),
});

export type CoachingReport = z.infer<typeof CoachingReportSchema>;

/** Helper: layer scores in the canonical order (for radar/bar rendering). */
export function layerScoresInOrder(report: CoachingReport): Array<{ key: LayerKey; score: LayerScore }> {
    return LAYER_KEYS.map((key) => ({ key, score: report.layers[key] }));
}
