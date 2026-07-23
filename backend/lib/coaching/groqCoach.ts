/**
 * Groq-based 5-layer scoring for transcribed sales calls.
 *
 * Pattern is intentionally identical to backend/lib/llm/groq.ts:105-265 so
 * failure modes, fallbacks, and timeouts behave consistently across the app.
 */

import { CoachingReportSchema, type CoachingReport } from './schema';
import { computeOverall } from './prompts';
import { buildCoachSystemPrompt, buildCoachUserPrompt } from './prompts';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// 70B is materially better at the nuanced sales-rubric task than 8B.
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 60_000;

export interface CoachInput {
    transcriptText: string;
    leadCompanyName?: string | null;
    bdRepName?: string | null;
    durationSeconds?: number | null;
}

export interface CoachSuccess {
    success: true;
    report: CoachingReport;
    latencyMs: number;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface CoachError {
    success: false;
    error: string;
    latencyMs: number;
    fallbackUsed: true;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function scoreCallWithGroq(input: CoachInput): Promise<CoachSuccess | CoachError> {
    const startTime = Date.now();

    if (!input.transcriptText || input.transcriptText.trim().length < 50) {
        return {
            success: false,
            error: 'Transcript too short to score (< 50 chars)',
            latencyMs: Date.now() - startTime,
            fallbackUsed: true,
        };
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return {
            success: false,
            error: 'GROQ_API_KEY not configured',
            latencyMs: Date.now() - startTime,
            fallbackUsed: true,
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: buildCoachSystemPrompt() },
                    {
                        role: 'user',
                        content: buildCoachUserPrompt(input),
                    },
                ],
                temperature: 0.2,
                max_tokens: 1800,
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[GroqCoach] API error:', response.status, errorText.slice(0, 500));
            return {
                success: false,
                error: `Groq API error: ${response.status}`,
                latencyMs: Date.now() - startTime,
                fallbackUsed: true,
            };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        const usage = data.usage
            ? {
                  prompt_tokens: data.usage.prompt_tokens,
                  completion_tokens: data.usage.completion_tokens,
                  total_tokens: data.usage.total_tokens,
              }
            : undefined;

        if (!content) {
            return {
                success: false,
                error: 'Empty response from Groq',
                latencyMs: Date.now() - startTime,
                fallbackUsed: true,
                usage,
            };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            console.error('[GroqCoach] Invalid JSON:', content.slice(0, 500));
            return {
                success: false,
                error: 'Invalid JSON from Groq',
                latencyMs: Date.now() - startTime,
                fallbackUsed: true,
                usage,
            };
        }

        const validation = CoachingReportSchema.safeParse(parsed);
        if (!validation.success) {
            console.error('[GroqCoach] Schema mismatch:', validation.error.message);
            return {
                success: false,
                error: `Schema validation failed: ${validation.error.message}`,
                latencyMs: Date.now() - startTime,
                fallbackUsed: true,
                usage,
            };
        }

        // Defensive: recompute overall_score from layers in case LLM drifted.
        const report: CoachingReport = {
            ...validation.data,
            overall_score: computeOverall(validation.data),
        };

        return {
            success: true,
            report,
            latencyMs: Date.now() - startTime,
            usage,
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                success: false,
                error: 'Groq request timed out',
                latencyMs: Date.now() - startTime,
                fallbackUsed: true,
            };
        }
        console.error('[GroqCoach] Unexpected error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            latencyMs: Date.now() - startTime,
            fallbackUsed: true,
        };
    }
}

// Re-export for convenience
export { CoachingReportSchema };
export type { CoachingReport };
