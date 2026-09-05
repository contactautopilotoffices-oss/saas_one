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

import { resolveProvider } from '@/backend/lib/council/llm';
import { toDataUri, type RasterPage } from '@/backend/lib/ocr/rasterize';

/** Verified multimodal on ENGY. A model outside this set is allowed but warned about. */
export const ENGY_VISION_MODELS = ['glm-5.3-flash', 'kimi-k3', 'qwen3.8-27b'] as const;

/** Default: best extraction quality per rupee in testing. */
export const DEFAULT_VISION_MODEL =
    process.env.OCR_VISION_MODEL || 'glm-5.3-flash';

const TIMEOUT_MS = Number(process.env.OCR_VISION_TIMEOUT_MS || 60_000);

export interface VisionExtractInput {
    /** Page images. Buffers only — a URL cannot be passed, by design. */
    pages: ReadonlyArray<Pick<RasterPage, 'buffer' | 'mime'>>;
    /** What to pull out. Say the shape you want; JSON mode enforces the envelope. */
    instruction: string;
    model?: string;
    maxTokens?: number;
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
export async function visionExtract(input: VisionExtractInput): Promise<VisionExtractResult> {
    const model = input.model || DEFAULT_VISION_MODEL;
    const { provider, spec, apiKey } = resolveProvider();

    const base: Omit<VisionExtractResult, 'ok'> = {
        data: null, text: null, model, provider, usage: null,
    };

    if (!apiKey) {
        return { ...base, ok: false, error: 'No LLM key configured (COUNCIL_API_KEY / GROQ_API_KEY / OPENAI_API_KEY).' };
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 400);
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
