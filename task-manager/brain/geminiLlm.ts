import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BrainLlm, LlmRequest, LlmResponse } from './llm';

/**
 * Google Gemini behind the brain's BrainLlm interface — used ONLY to DRAFT improved AI instructions in the Phase 5 nightly
 * learning loop (a different model family from the live bot, doctrine L6). The live bot and the safety test do not use it.
 * Reuses the repo's existing `@google/generative-ai` library (already used by aiProcessor / TaskNaturalLanguageService).
 *
 * Key: GEMINI_AUTOTUNE_API_KEY (a dedicated key, e.g. a free AI Studio key) → else GEMINI_API_KEY → else GOOGLE_AI_API_KEY.
 * Models, in order: BOT_AUTOTUNE_DRAFT_MODELS (comma list) → else the newest Flash available on our key, then a stable one.
 * Flash models are on Gemini's free tier; Pro models are not (or only with a tiny daily quota).
 */

export const DEFAULT_GEMINI_DRAFT_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash'] as const;

export function geminiKey(): string | null {
    return process.env.GEMINI_AUTOTUNE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
}

export function geminiDraftModels(): string[] {
    const fromEnv = (process.env.BOT_AUTOTUNE_DRAFT_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    return fromEnv.length ? fromEnv : [...DEFAULT_GEMINI_DRAFT_MODELS];
}

/** null when no key is configured (the caller then uses the existing provider). */
export function geminiLlm(key: string | null = geminiKey(), timeoutMs = 45_000): BrainLlm | null {
    if (!key) return null;
    const client = new GoogleGenerativeAI(key);
    return {
        async complete(req: LlmRequest): Promise<LlmResponse> {
            const model = client.getGenerativeModel(
                { model: req.model, systemInstruction: req.system, generationConfig: { maxOutputTokens: req.maxTokens ?? 1200, ...(req.json ? { responseMimeType: 'application/json' } : {}) } },
                { timeout: timeoutMs },
            );
            const res = await model.generateContent(req.user);
            const text = res.response.text();
            if (!text || !text.trim()) throw new Error(`${req.model}: empty reply`);
            const u = res.response.usageMetadata;
            return { text, tokensIn: u?.promptTokenCount ?? 0, tokensOut: u?.candidatesTokenCount ?? 0, finishReason: res.response.candidates?.[0]?.finishReason };
        },
    };
}
