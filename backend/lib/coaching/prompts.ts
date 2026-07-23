import { LAYER_KEYS, LAYER_DESCRIPTIONS, LAYER_LABELS, type CoachingReport } from './schema';

/**
 * Build the system prompt for the 5-layer scoring pass.
 * Keep this short and directive — Groq 70B is good but loses focus on long
 * instructions.
 */
export function buildCoachSystemPrompt(): string {
    const layers = LAYER_KEYS.map((k) => `- ${k}: ${LAYER_DESCRIPTIONS[k]}`).join('\n');

    return `You are an expert sales-call coach evaluating a Business Development (BD) representative's recorded call with a prospect.

Score the rep on EXACTLY these 5 layers, each 0–10:
${layers}

Return ONLY a JSON object matching the requested schema. No prose, no markdown, no code fences.

Scoring rules:
- Be evidence-driven: cite the exact phrases that justify each score in \`evidence\`.
- 0–3 = poor or absent, 4–6 = present but weak, 7–8 = solid, 9–10 = exceptional.
- \`overall_score\` is the weighted average of the 5 layer scores (weights equal unless one layer was catastrophically bad, in which case lower it).
- \`rep_talk_ratio\` is the fraction of total talk time spoken by the rep (0.0–1.0). Ideal is 0.40–0.55. Above 0.70 means the rep dominated.
- \`avg_rep_talk_seconds\` is the average length of an uninterrupted rep monologue.
- \`did_right\` lists concrete things the rep did well (1–6 items, each 5–20 words).
- \`missed\` lists concrete things the rep failed to do that hurt the call (1–6 items).
- \`could_improve\` lists concrete actionable improvements (1–6 items, each 5–20 words).
- \`next_call_focus\` is the SINGLE highest-leverage behavior to fix next call.
- \`summary\` is 2–3 sentences in plain English describing what happened on the call.`;
}

/**
 * Build the user message containing the transcript.
 * We pass the transcript as a single numbered string — Groq handles it well
 * for the sizes we expect (most BD calls are 5–30 minutes → ~5k–30k tokens).
 */
export function buildCoachUserPrompt(args: {
    transcriptText: string;
    leadCompanyName?: string | null;
    bdRepName?: string | null;
    durationSeconds?: number | null;
}): string {
    const header = [
        'Evaluate the following sales call.',
        args.leadCompanyName ? `Prospect / company: ${args.leadCompanyName}` : null,
        args.bdRepName ? `BD rep: ${args.bdRepName}` : null,
        args.durationSeconds != null
            ? `Duration: ${Math.round(args.durationSeconds / 60)} min ${args.durationSeconds % 60}s`
            : null,
        '',
        'Transcript:',
        '"""',
        args.transcriptText,
        '"""',
        '',
        `Return JSON with this exact shape:
{
  "layers": {
    "${LAYER_KEYS[0]}":    { "score": <0..10>, "evidence": "<quoted phrase>", "tip": "<one action>" },
    "${LAYER_KEYS[1]}":    { "score": <0..10>, "evidence": "<quoted phrase>", "tip": "<one action>" },
    "${LAYER_KEYS[2]}":   { "score": <0..10>, "evidence": "<quoted phrase>", "tip": "<one action>" },
    "${LAYER_KEYS[3]}":      { "score": <0..10>, "evidence": "<quoted phrase>", "tip": "<one action>" },
    "${LAYER_KEYS[4]}":     { "score": <0..10>, "evidence": "<quoted phrase>", "tip": "<one action>" }
  },
  "overall_score": <0..10>,
  "rep_talk_ratio": <0..1>,
  "avg_rep_talk_seconds": <number>,
  "did_right":   ["..."],
  "missed":      ["..."],
  "could_improve": ["..."],
  "next_call_focus": "...",
  "summary": "..."
}`,
    ].filter(Boolean);

    return header.join('\n');
}

/** Helper to compute the weighted overall from a parsed report (defensive). */
export function computeOverall(report: Pick<CoachingReport, 'layers'>): number {
    const scores = LAYER_KEYS.map((k) => report.layers[k].score);
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round((sum / scores.length) * 100) / 100;
}

/** Layer labels exported for convenience. */
export { LAYER_LABELS };
