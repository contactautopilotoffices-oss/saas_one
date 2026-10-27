/**
 * The language brain — the AI transport. The only place that talks to a model.
 *
 * Reuses the repo's existing provider routing (COUNCIL_PROVIDER / COUNCIL_BASE_URL / COUNCIL_API_KEY → Engy),
 * so no new key and no new library. Injectable, so every test runs with a fake and never touches the network.
 * A model is only skipped to the next one on an ERROR, timeout, empty or unparseable reply.
 */

export interface LlmRequest {
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    json?: boolean;
}

export interface LlmResponse { text: string; tokensIn: number; tokensOut: number; finishReason?: string }

export interface BrainLlm { complete(req: LlmRequest): Promise<LlmResponse> }

/**
 * The cheaper backup models (Engy: COUNCIL_API_KEY in .env). Owner 2026-10-22: GLM first, then Qwen.
 * Chosen originally by the Phase 2 measurement (140 labelled cases, see docs/TASK_BRAIN_SPEC.md).
 */
export const BACKUP_MODELS: readonly string[] = ['glm-5.3-flash', 'qwen3.8-27b'];

/**
 * Owner 2026-10-22: the WhatsApp chatbot runs on Claude Haiku for EVERY step (understanding, the rewrite, the reply), with
 * the backup models after it, so a Claude outage, rate limit, missing key or empty credit never stops the bot.
 * The bot's own settings live HERE in code, not in .env (owner: "no separate configs"). '' = Claude off (backups only).
 *   TWO_STEP_READING  step 3 (kind first, then details). Flip to true only after run_eval.ts --two-step wins.
 * Measured 2026-10-21 (real set, 8 cases): Claude Haiku 7/8 vs glm-5.3-flash 3/8 and Groq gpt-oss-120b 0/8.
 */
export const CHATBOT_MODEL = 'anthropic:claude-haiku-5-5';
/** Kept under its old name: the model tried FIRST for understanding. */
export const STRONGER_UNDERSTAND_MODEL = CHATBOT_MODEL;
export const TWO_STEP_READING = false;

export function interpretModelsWith(first: string): readonly string[] {
    return first ? [first, ...BACKUP_MODELS.filter(m => m !== first)] : BACKUP_MODELS;
}
export const BRAIN_INTERPRET_MODELS: readonly string[] = interpretModelsWith(CHATBOT_MODEL);
export const BRAIN_REPLY_MODELS: readonly string[] = interpretModelsWith(CHATBOT_MODEL);
export const BRAIN_REWRITE_MODELS: readonly string[] = interpretModelsWith(CHATBOT_MODEL);
/** Voice-note clean-up is NOT the chatbot: it keeps the cheap models it was measured with (docs/VOICE_NOTE_INTAKE_PLAN.md). */
export const CHEAP_CLEANUP_MODELS: readonly string[] = ['qwen3.8-27b', 'glm-5.3-flash'];

// Measured: the slower model answers in about 4 s (p90 6 s) but the provider occasionally stalls. 30 s made a stall feel like
// a dead bot; 15 s lets the other model take over quickly (each model gets one try, then the next).
const TIMEOUT_MS = 15_000;

/**
 * `thinking: 'off'` (the default) tells Engy's models not to "think" silently before answering. Measured: a one-sentence
 * reply drops from ~80 tokens / 2 s to ~17 tokens / 0.6 s, and with thinking ON a small token budget can be used up before
 * any answer is written. Only sent to the Engy-style provider (COUNCIL_PROVIDER=custom), never to others.
 */
export function engyBrainLlm(options: { thinking?: 'off' | 'default'; timeoutMs?: number } = {}): BrainLlm {
    const thinking = options.thinking ?? 'off';
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    return {
        async complete(req) {
            if (req.model.startsWith(GROQ_PREFIX)) return groqComplete(req, timeoutMs);
            if (req.model.startsWith(ANTHROPIC_PREFIX)) return anthropicComplete(req, timeoutMs);
            const { resolveProvider } = await import('@/backend/lib/council/llm');
            const { provider, spec, apiKey } = resolveProvider();
            if (!apiKey) throw new Error('no AI key is configured');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(`${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: req.model,
                        max_tokens: req.maxTokens ?? 1200,
                        temperature: 0,
                        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
                        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
                        ...(thinking === 'off' && provider === 'custom' ? { reasoning_effort: 'none' } : {}),
                    }),
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const j: any = await res.json();
                const text = j?.choices?.[0]?.message?.content;
                const finishReason: string | undefined = j?.choices?.[0]?.finish_reason;
                // A model that spends its whole budget thinking returns an empty string with finish_reason "length" — say so.
                if (typeof text !== 'string' || !text.trim()) throw new Error(`the model returned nothing (finish_reason=${finishReason ?? 'unknown'}, used ${j?.usage?.completion_tokens ?? '?'} tokens)`);
                return { text, tokensIn: j?.usage?.prompt_tokens ?? 0, tokensOut: j?.usage?.completion_tokens ?? 0, finishReason };
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

export const GROQ_PREFIX = 'groq:';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * The WhatsApp task bot's OWN Groq keys (owner 2026-10-21): never the shared GROQ_API_KEY, which other features use.
 * Put one or more in .env (several Groq accounts = backups):
 *   WHATSAPP_BOT_GROQ_API_KEY, WHATSAPP_BOT_GROQ_API_KEY_2, WHATSAPP_BOT_GROQ_API_KEY_3, … up to _5
 * Keys are tried in that order: a rate limit (429), a bad or disabled key (401/403), a Groq server error (5xx) or a
 * timeout moves on to the next key. Keys are never logged or printed.
 */
export const BOT_GROQ_KEY_NAMES = ['WHATSAPP_BOT_GROQ_API_KEY', ...[2, 3, 4, 5].map(n => `WHATSAPP_BOT_GROQ_API_KEY_${n}`)];
export function botGroqKeys(env: Record<string, string | undefined> = process.env): string[] {
    return BOT_GROQ_KEY_NAMES.map(n => String(env[n] ?? '').trim()).filter(Boolean);
}

/** Step 5: one call to Groq (OpenAI-compatible) with the bot's own keys. gpt-oss models get reasoning_effort "low". */
export async function groqComplete(req: LlmRequest, timeoutMs = TIMEOUT_MS): Promise<LlmResponse> {
    const keys = botGroqKeys();
    if (!keys.length) throw new Error('no WhatsApp bot Groq key is configured');
    const model = req.model.slice(GROQ_PREFIX.length);
    const body = JSON.stringify({
        model,
        max_completion_tokens: (req.maxTokens ?? 1200) + 600, // room for the low thinking before the answer
        temperature: 0,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}),
    });
    const problems: string[] = [];
    for (let k = 0; k < keys.length; k++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${keys[k]}`, 'Content-Type': 'application/json' }, body, signal: controller.signal });
        } catch (err) {
            clearTimeout(timer);
            problems.push(`key ${k + 1}: ${err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error'}`);
            continue; // try the next account
        }
        clearTimeout(timer);
        if (res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500) { problems.push(`key ${k + 1}: HTTP ${res.status}`); continue; }
        if (!res.ok) throw new Error(`Groq HTTP ${res.status}`); // a bad request: another key would not help
        const j = await res.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = j?.choices?.[0]?.message?.content;
        const finishReason: string | undefined = j?.choices?.[0]?.finish_reason;
        if (typeof text !== 'string' || !text.trim()) throw new Error(`Groq returned nothing (finish_reason=${finishReason ?? 'unknown'})`);
        return { text, tokensIn: j?.usage?.prompt_tokens ?? 0, tokensOut: j?.usage?.completion_tokens ?? 0, finishReason };
    }
    throw new Error(`every WhatsApp bot Groq key failed (${problems.join('; ')})`);
}

export const ANTHROPIC_PREFIX = 'anthropic:';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * The WhatsApp chatbot's Claude key (owner 2026-10-22): ONE key, named CLAUDE_API_KEY in .env / .env.local / Vercel.
 * When it is missing, rate-limited, out of credit or Claude is down, the backup models answer instead.
 * The key is never logged or printed.
 */
export const BOT_ANTHROPIC_KEY_NAMES = ['CLAUDE_API_KEY'];
export function botAnthropicKeys(env: Record<string, string | undefined> = process.env): string[] {
    return BOT_ANTHROPIC_KEY_NAMES.map(n => String(env[n] ?? '').trim()).filter(Boolean);
}

export const CLAUDE_THINKING_ROOM = 1000;

/** One call to Claude (Messages API). The prompts already ask for JSON only; extractJson tolerates a little text around it. */
export async function anthropicComplete(req: LlmRequest, timeoutMs = TIMEOUT_MS): Promise<LlmResponse> {
    const keys = botAnthropicKeys();
    if (!keys.length) throw new Error('CLAUDE_API_KEY is not set');
    const body = JSON.stringify({
        model: req.model.slice(ANTHROPIC_PREFIX.length),
        // Room for Haiku's short built-in thinking before the answer: it counts against max_tokens, and without the extra room
        // a small budget (the rewrite asks for 200) could be used up before any answer was written. Only what is used is paid.
        max_tokens: (req.maxTokens ?? 1200) + CLAUDE_THINKING_ROOM,
        // No `temperature`: Claude 5.x models reject it with HTTP 400 ("deprecated for this model").
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
    });
    const problems: string[] = [];
    for (let k = 0; k < keys.length; k++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(ANTHROPIC_URL, { method: 'POST', headers: { 'x-api-key': keys[k], 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body, signal: controller.signal });
        } catch (err) {
            clearTimeout(timer);
            problems.push(`key ${k + 1}: ${err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error'}`);
            continue;
        }
        clearTimeout(timer);
        if (res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500) { problems.push(`key ${k + 1}: HTTP ${res.status}`); continue; }
        if (!res.ok) throw new Error(`Claude HTTP ${res.status}`); // a bad request: another key would not help
        const j = await res.json() as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        const text = (j?.content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '').join('');
        if (!text.trim()) throw new Error(`Claude returned nothing (stop_reason=${j?.stop_reason ?? 'unknown'})`);
        return { text, tokensIn: j?.usage?.input_tokens ?? 0, tokensOut: j?.usage?.output_tokens ?? 0, finishReason: j?.stop_reason };
    }
    throw new Error(`Claude failed (${problems.join('; ')})`);
}

/** Image types Claude accepts, and its per-image size limit (base64 is ~4/3 of this). */
const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CLAUDE_IMAGE_MAX_BYTES = 3_750_000;

/**
 * Owner 2026-10-27: read an image with Claude (task import from a photo / screenshot). Same key handling as
 * anthropicComplete: tried in order, never logged. Throws on any problem (wrong type, too big, error, empty), so the caller
 * moves on to its backup model.
 */
export async function anthropicVision(input: { model: string; image: Buffer; mimeType: string; instruction: string; maxTokens: number; timeoutMs: number }): Promise<string> {
    const keys = botAnthropicKeys();
    if (!keys.length) throw new Error('CLAUDE_API_KEY is not set');
    const mime = input.mimeType.toLowerCase().split(';')[0].trim();
    if (!CLAUDE_IMAGE_TYPES.has(mime)) throw new Error(`Claude cannot read ${mime || 'this file type'}`);
    if (input.image.length > CLAUDE_IMAGE_MAX_BYTES) throw new Error('the image is too large for Claude');
    const body = JSON.stringify({
        model: input.model.startsWith(ANTHROPIC_PREFIX) ? input.model.slice(ANTHROPIC_PREFIX.length) : input.model,
        max_tokens: input.maxTokens + CLAUDE_THINKING_ROOM,
        messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: input.image.toString('base64') } },
            { type: 'text', text: input.instruction },
        ] }],
    });
    const problems: string[] = [];
    for (let k = 0; k < keys.length; k++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), input.timeoutMs);
        let res: Response;
        try {
            res = await fetch(ANTHROPIC_URL, { method: 'POST', headers: { 'x-api-key': keys[k], 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body, signal: controller.signal });
        } catch (err) {
            clearTimeout(timer);
            problems.push(`key ${k + 1}: ${err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error'}`);
            continue;
        }
        clearTimeout(timer);
        if (res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500) { problems.push(`key ${k + 1}: HTTP ${res.status}`); continue; }
        if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
        const j = await res.json() as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
        const text = (j?.content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '').join('');
        if (!text.trim()) throw new Error(`Claude returned nothing (stop_reason=${j?.stop_reason ?? 'unknown'})`);
        return text;
    }
    throw new Error(`Claude failed (${problems.join('; ')})`);
}

/** Pull one JSON object out of a model reply (tolerates code fences and a little prose around it). */
export function extractJson(text: string): unknown {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
}

export interface FallbackTrace { model: string; failures: Array<{ model: string; error: string }> }

/**
 * Group 2 "faster replies" (2026-10-13): how long the first model may take before the next one is ALSO started. The first
 * usable answer wins; the slower call is simply ignored. Measured: the understand model usually answers in ~1–4 s but
 * sometimes stalls for 15+ s — the whole bot then waited. Now a stall costs ~5 s at most. Extra calls happen only when a
 * model is slow, so the extra cost is small.
 */
export const HEDGE_UNDERSTAND_MS = 5_000;
export const HEDGE_REPLY_MS = 4_000;

/**
 * Try each model in order; the first that returns a usable value wins. Throws the last error if all fail.
 * With `hedgeMs`: if a model has not answered by then, the next one starts too (an ERROR starts the next one at once);
 * whichever gives a usable value first wins. Without it: strictly one after another, exactly as before.
 */
export async function withModelFallback<T>(
    models: readonly string[],
    run: (model: string) => Promise<T>,
    label = 'brain',
    opts: { hedgeMs?: number } = {}
): Promise<{ value: T; trace: FallbackTrace }> {
    const failures: Array<{ model: string; error: string }> = [];
    if (opts.hedgeMs && models.length > 1) {
        return new Promise((resolve, reject) => {
            let next = 0; let running = 0; let settled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const stopTimer = () => { if (timer) clearTimeout(timer); timer = null; };
            const start = () => {
                if (settled || next >= models.length) return;
                const model = models[next++]; running++;
                stopTimer();
                if (next < models.length) timer = setTimeout(start, opts.hedgeMs);
                run(model).then(value => {
                    if (settled) return;
                    settled = true; stopTimer();
                    resolve({ value, trace: { model, failures } });
                }, err => {
                    running--;
                    const error = err instanceof Error ? err.message : String(err);
                    if (settled) return;
                    failures.push({ model, error });
                    console.warn(`[TaskBrain] ${label} failed on ${model}: ${error}`);
                    if (next < models.length) start();
                    else if (running === 0) {
                        settled = true; stopTimer();
                        reject(new Error(`${label}: every model failed (${failures.map(f => `${f.model}: ${f.error}`).join('; ')})`));
                    }
                });
            };
            start();
        });
    }
    for (const model of models) {
        try {
            return { value: await run(model), trace: { model, failures } };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            failures.push({ model, error });
            console.warn(`[TaskBrain] ${label} failed on ${model}: ${error}`);
        }
    }
    throw new Error(`${label}: every model failed (${failures.map(f => `${f.model}: ${f.error}`).join('; ')})`);
}
