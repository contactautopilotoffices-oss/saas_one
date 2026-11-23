/**
 * Vision extraction against an OpenAI-compatible endpoint — base64 only.
 * -----------------------------------------------------------------------------
 * ENGY's documentation is explicit that an image must arrive as a base64 `data:`
 * URI and that HTTP(S) URLs are rejected. The API says so too, verbatim:
 *
 *     "external image URLs are not fetched; inline the image as a base64 data: URI"
 *
 * That is a real behavioural difference from Groq, whose vision path this repo
 * feeds with a signed Supabase URL (documentBank/ocr.ts, ocr/meter/route.ts). So
 * the two are NOT interchangeable by swapping a model id, and this module exists
 * to make the difference impossible to get wrong: it accepts BUFFERS, never URLs,
 * and does the encoding itself.
 *
 * Model choice is the caller's, but it must advertise image input. ENGY exposes
 * `input_modalities` on GET /v1/models; as of 2026-09-05 the multimodal ones are
 * glm-5.3-flash, kimi-k3 and qwen3.8-27b.
 */

import { resolveProvider, priceOf } from '@/backend/lib/council/llm';
import { ocrStep } from '@/backend/lib/ocr/activity';
import { toDataUri, type RasterPage } from '@/backend/lib/ocr/rasterize';
import { markFailed, modelFor } from '@/task-manager/ai/modelFor';

/** Verified multimodal on ENGY. A model outside this set is allowed but warned about. */
export const ENGY_VISION_MODELS = ['deepseek-v4.1-flash', 'kimi-k3'] as const;

/** Default: best extraction quality per rupee in testing (deepseek-v4.1-flash is multimodal; glm/qwen on Engy are text-only). */
const envVisionModel = (process.env.OCR_VISION_MODEL || '').trim();
export const DEFAULT_VISION_MODEL =
    envVisionModel && !/glm|qwen/i.test(envVisionModel)
        ? envVisionModel
        : 'deepseek-v4.1-flash';

const TIMEOUT_MS = Number(process.env.OCR_VISION_TIMEOUT_MS || 60_000);

export interface VisionExtractInput {
    /** Page images. Buffers only — a URL cannot be passed, by design. */
    pages: ReadonlyArray<Pick<RasterPage, 'buffer' | 'mime'>>;
    /** What to pull out. Say the shape you want; JSON mode enforces the envelope. */
    instruction: string;
    model?: string;
    maxTokens?: number;
    /** Engy only: skip the model's hidden reasoning. Right for plain reading; wrong for judgement. */
    thinkingOff?: boolean;
    /** When true, ask for response_format json_object. */
    json?: boolean;
}

export interface VisionExtractResult {
    ok: boolean;
    /** Parsed object when `json` was set and parsing succeeded. */
    data: Record<string, unknown> | null;
    /** Raw model text, always present on success — useful when parsing fails. */
    text: string | null;
    model: string;
    provider: string;
    usage: { prompt: number; completion: number; total: number } | null;
    error?: string;
}

/**
 * Send page images to a vision model and get text or structured JSON back.
 * Never throws: every failure comes back as { ok: false, error }, matching the
 * convention in documentBank/ocr.ts so a caller's control flow is unchanged.
 */
async function visionExtractRaw(input: VisionExtractInput): Promise<VisionExtractResult> {
    let model = input.model || DEFAULT_VISION_MODEL;
    // On Engy, glm and qwen series are text-only; automatically switch to multimodal deepseek-v4.1-flash
    if (/qwen|glm/i.test(model)) {
        model = 'deepseek-v4.1-flash';
    }

    // Prioritize Engy API key when configured in env (ENGY_API_KEY / engy / ENGY_KEY / COUNCIL_API_KEY when pointing to engy)
    const engyKey = (
        process.env.ENGY_API_KEY ||
        process.env.engy ||
        process.env.ENGY_KEY ||
        (process.env.COUNCIL_API_KEY && (process.env.COUNCIL_API_KEY.startsWith('sk-engy-') || /engy\./i.test(process.env.COUNCIL_BASE_URL || '')) ? process.env.COUNCIL_API_KEY : '')
    ).trim();
    const resolved = resolveProvider();
    const apiKey = engyKey || (resolved.apiKey?.startsWith('sk-engy-') ? resolved.apiKey : null) || resolved.apiKey;
    const baseUrl = engyKey
        ? (process.env.ENGY_BASE_URL || process.env.COUNCIL_BASE_URL || 'https://api.engy.ai/v1')
        : (apiKey?.startsWith('sk-engy-') ? 'https://api.engy.ai/v1' : resolved.spec.baseUrl);
    const provider = engyKey || apiKey?.startsWith('sk-engy-') ? 'engy' : resolved.provider;

    const base: Omit<VisionExtractResult, 'ok'> = {
        data: null, text: null, model, provider, usage: null,
    };

    if (!apiKey) {
        return { ...base, ok: false, error: 'No LLM key configured (ENGY_API_KEY / engy / COUNCIL_API_KEY / GROQ_API_KEY / OPENAI_API_KEY).' };
    }
    if (!input.pages.length) {
        return { ...base, ok: false, error: 'No page images supplied.' };
    }

    const content = [
        { type: 'text', text: input.instruction },
        // THE CORRECTION THAT MATTERS: a data: URI per page, never a signed URL.
        ...input.pages.map((p) => ({
            type: 'image_url',
            image_url: { url: toDataUri(p) },
        })),
    ];

    const body: Record<string, unknown> = {
        model,
        max_tokens: input.maxTokens ?? 1200,
        messages: [{ role: 'user', content }],
    };
    if (input.json) body.response_format = { type: 'json_object' };
    // Reading a page is not a puzzle: do not let the model spend its budget "thinking" (Engy only).
    if (input.thinkingOff && /engy\./i.test(baseUrl)) body.thinking = { type: 'disabled' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 400);
            if (/does not support image input/i.test(detail)) {
                if (model !== 'deepseek-v4.1-flash') {
                    return visionExtractRaw({ ...input, model: 'deepseek-v4.1-flash' });
                }
                return visionExtractRaw({ ...input, model: 'kimi-k3' });
            }
            return { ...base, ok: false, error: `${provider} ${res.status}: ${detail}` };
        }

        const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const text = json.choices?.[0]?.message?.content ?? null;
        const usage = json.usage
            ? {
                  prompt: json.usage.prompt_tokens ?? 0,
                  completion: json.usage.completion_tokens ?? 0,
                  total: json.usage.total_tokens ?? 0,
              }
            : null;

        if (!text) {
            return { ...base, ok: false, usage, error: 'Model returned no content.' };
        }

        let data: Record<string, unknown> | null = null;
        if (input.json) {
            // Tolerate a fenced or prose-wrapped envelope rather than failing the
            // whole extraction — same leniency as council/runner.ts parseFindings.
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try { data = JSON.parse(match[0]) as Record<string, unknown>; } catch { data = null; }
            }
        }

        return { ...base, ok: true, data, text, usage };
    } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        return {
            ...base,
            ok: false,
            error: aborted ? `vision call timed out after ${TIMEOUT_MS}ms` : (e as Error).message,
        };
    } finally {
        clearTimeout(timer);
    }
}

/** The public entry point: the read itself, plus one step in the OCR activity log (tokens and cost included). */
export async function visionExtract(input: VisionExtractInput): Promise<VisionExtractResult> {
    const t0 = Date.now();
    // Owner 2026-11-15: the model can be chosen in the Tech console (Brain → AI models). Nothing chosen = today's model, as before.
    // A caller that names its own model (task import, the proctor) is left alone. A chosen model that fails costs one
    // attempt: today's model is then tried once.
    let r: VisionExtractResult;
    if (input.model) {
        r = await visionExtractRaw(input);
    } else {
        const chosen = await modelFor('ocr_vision', DEFAULT_VISION_MODEL);
        r = await visionExtractRaw({ ...input, model: chosen });
        if (!r.ok && chosen !== DEFAULT_VISION_MODEL) {
            markFailed('ocr_vision'); // rested, so the remaining page batches of this document go straight to today's model
            r = await visionExtractRaw({ ...input, model: DEFAULT_VISION_MODEL });
        }
    }
    const rate = priceOf(r.model);
    ocrStep({
        step: 'vision_model', ms: Date.now() - t0, ok: r.ok, model: r.model, provider: r.provider,
        tokens_in: r.usage?.prompt, tokens_out: r.usage?.completion,
        cost_usd: r.usage ? (r.usage.prompt * rate.input + r.usage.completion * rate.output) / 1e6 : undefined,
        note: `${input.pages.length} page image${input.pages.length === 1 ? '' : 's'}${r.ok ? '' : `: ${r.error ?? 'failed'}`}`,
    });
    return r;
}
