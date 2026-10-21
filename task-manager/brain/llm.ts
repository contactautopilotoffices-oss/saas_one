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
 * Chosen by the Phase 2 measurement (140 labelled cases, see docs/TASK_BRAIN_SPEC.md), following doctrine L10:
 * the model at the step where a wrong guess is costly (understanding what the person means) is the most careful one;
 * the step the checker already protects (writing the reply) uses the faster, cheaper one. Each falls back to the other.
 */
const DEFAULT_INTERPRET_MODELS: readonly string[] = ['glm-5.3-flash', 'qwen3.8-27b'];

/**
 * Step 5 (owner 2026-10-21): the bot's own settings live HERE in code, not in .env (owner: "no separate configs").
 *   STRONGER_UNDERSTAND_MODEL  the model tried FIRST for understanding (Groq, low thinking). The usual models stay after it
 *                              as backups, so a Groq outage, rate limit or missing key never stops the bot. '' = off.
 *   TWO_STEP_READING           step 3 (kind first, then details). Flip to true only after run_eval.ts --two-step wins.
 * Replies are NOT affected: they stay on the cheap models.
 */
export const STRONGER_UNDERSTAND_MODEL = 'groq:openai/gpt-oss-120b';
export const TWO_STEP_READING = false;

export function interpretModelsWith(first: string): readonly string[] {
    return first ? [first, ...DEFAULT_INTERPRET_MODELS.filter(m => m !== first)] : DEFAULT_INTERPRET_MODELS;
}
export const BRAIN_INTERPRET_MODELS: readonly string[] = interpretModelsWith(STRONGER_UNDERSTAND_MODEL);
export const BRAIN_REPLY_MODELS: readonly string[] = ['qwen3.8-27b', 'glm-5.3-flash'];

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
