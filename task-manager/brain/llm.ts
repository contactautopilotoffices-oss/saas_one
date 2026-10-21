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
export const BRAIN_INTERPRET_MODELS: readonly string[] = ['glm-5.3-flash', 'qwen3.8-27b'];
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
