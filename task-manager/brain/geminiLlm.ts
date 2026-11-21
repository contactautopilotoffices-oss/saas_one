import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai';
import { geminiKeys, withProviderKeys } from '@/backend/lib/llm/providerKeys';
import type { BrainLlm, LlmRequest, LlmResponse } from './llm';

/**
 * Google Gemini behind the brain's BrainLlm interface — used ONLY to DRAFT improved AI instructions in the Phase 5 nightly
 * learning loop (a different model family from the live bot, doctrine L6). The live bot and the safety test do not use it.
 * Reuses the repo's existing `@google/generative-ai` library (already used by aiProcessor / TaskNaturalLanguageService).
 *
 * Keys: the shared Gemini keys GEMINI_API_KEY → _2 → _3 (then the older GOOGLE_AI_API_KEY), used in turn (owner 2026-11-15:
 * nothing dedicated to any job; backend/lib/llm/providerKeys.ts). GEMINI_AUTOTUNE_API_KEY is no longer read.
 * Models, in order: BOT_AUTOTUNE_DRAFT_MODELS (comma list) → else the newest Flash available on our key, then a stable one.
 * Flash models are on Gemini's free tier; Pro models are not (or only with a tiny daily quota).
 */

export const DEFAULT_GEMINI_DRAFT_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash'] as const;

export function geminiKey(): string | null {
    return geminiKeys()[0] ?? null;
}

export function geminiDraftModels(): string[] {
    const fromEnv = (process.env.BOT_AUTOTUNE_DRAFT_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    return fromEnv.length ? fromEnv : [...DEFAULT_GEMINI_DRAFT_MODELS];
}

/** null when no key is configured (the caller then uses the existing provider). */
export function geminiLlm(key: string | null = geminiKey(), timeoutMs = 45_000): BrainLlm | null {
    if (!key) return null;
    // The shared keys in turn; a key passed in that is not one of them (a test) is used on its own.
    const shared = geminiKeys().includes(key);
    const clients = new Map<string, GoogleGenerativeAI>();
    const clientFor = (k: string) => { let c = clients.get(k); if (!c) clients.set(k, (c = new GoogleGenerativeAI(k))); return c; };
    return {
        async complete(req: LlmRequest): Promise<LlmResponse> {
            // gemini-2.5-flash thinks by default and that counts against maxOutputTokens: JSON replies were cut off mid-string.
            // thinkingConfig is a REST field this SDK version has no type for; the SDK passes it through as-is.
            const thinkingOff = /^gemini-2\.5-flash/.test(req.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
            const modelFor = (k: string) => clientFor(k).getGenerativeModel(
                { model: req.model, systemInstruction: req.system, generationConfig: { maxOutputTokens: req.maxTokens ?? 1200, ...(req.json ? { responseMimeType: 'application/json' } : {}), ...thinkingOff } as GenerationConfig },
                { timeout: timeoutMs },
            );
            const res = shared ? await withProviderKeys('gemini', k => modelFor(k).generateContent(req.user)) : await modelFor(key).generateContent(req.user);
            const text = res.response.text();
            if (!text || !text.trim()) throw new Error(`${req.model}: empty reply`);
            const u = res.response.usageMetadata;
            return { text, tokensIn: u?.promptTokenCount ?? 0, tokensOut: u?.candidatesTokenCount ?? 0, finishReason: res.response.candidates?.[0]?.finishReason };
        },
    };
}

/** Image types Gemini accepts inline, and the inline request limit we keep under (base64 is ~4/3 of this). */
const GEMINI_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const GEMINI_IMAGE_MAX_BYTES = 3_750_000;

/**
 * Owner 2026-11-19: read one image with Gemini (ticket photos, backend/lib/ticketing/ticketPhoto.ts), so a Gemini Flash
 * model can be chosen for "Reading ticket photos" in Brain → AI models. The shared Gemini keys in turn, like geminiLlm;
 * never logged. Throws on any problem (no key, wrong type, too big, error, empty), so the caller moves on to its backup.
 */
export async function geminiVision(input: { model: string; image: Buffer; mimeType: string; instruction: string; maxTokens: number; timeoutMs: number }): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
    if (!geminiKeys().length) throw new Error('GEMINI_API_KEY is not set');
    const mime = input.mimeType.toLowerCase().split(';')[0].trim();
    if (!GEMINI_IMAGE_TYPES.has(mime)) throw new Error(`Gemini cannot read ${mime || 'this file type'}`);
    if (input.image.length > GEMINI_IMAGE_MAX_BYTES) throw new Error('the image is too large for Gemini');
    const thinkingOff = /^gemini-2\.5-flash/.test(input.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
    const res = await withProviderKeys('gemini', k => new GoogleGenerativeAI(k)
        .getGenerativeModel({ model: input.model, generationConfig: { maxOutputTokens: input.maxTokens, responseMimeType: 'application/json', ...thinkingOff } as GenerationConfig }, { timeout: input.timeoutMs })
        .generateContent([{ inlineData: { data: input.image.toString('base64'), mimeType: mime } }, { text: input.instruction }]));
    const text = res.response.text();
    if (!text || !text.trim()) throw new Error(`${input.model}: empty reply`);
    const u = res.response.usageMetadata;
    return { text, tokensIn: u?.promptTokenCount ?? 0, tokensOut: u?.candidatesTokenCount ?? 0 };
}
