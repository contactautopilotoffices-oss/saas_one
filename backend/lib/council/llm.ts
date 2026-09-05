/**
 * OpenAI chat for the Agent Council.
 *
 * Provider note (why not Groq): the council makes ~17 calls per session with the
 * whole data pack in most of them. GROQ_API_KEY is a shared 100,000-token DAILY
 * org-wide budget that also serves the ticket classifier, meter OCR, catalog
 * bulk-upload, call coaching and the master-admin chatbot — one council session
 * could exhaust it and take every interactive AI feature down with it. That is
 * the same reasoning, and the same conclusion, as
 * backend/services/mailboxDigest.ts:20-26. Separate provider, separate quota.
 *
 * Call shape follows the repo's OpenAI exemplars (mailboxDigest.ts and
 * app/api/electricity/tracker/explain/route.ts): env-selected model, an
 * AbortController timeout, per-call cost computed from the usage block, and a
 * pessimistic price for any model we have no billed rate for.
 *
 * TEMPERATURE — deliberate behaviour change on this switch. gpt-5.x rejects both
 * `max_tokens` and any non-default `temperature` with a 400 (documented at
 * mailboxDigest.ts:489). The council previously ran opinions/reviews at 0.1 to
 * keep the findings JSON parseable. On a gpt-5 model that knob is unavailable,
 * so determinism now rests on the lenient parser in runner.ts (parseFindings
 * strips fences and tolerates prose around the array) rather than on sampling
 * temperature. Point COUNCIL_MODEL at a 4o-family model to get the knob back.
 *
 * COUNCIL_MOCK_LLM=1 short-circuits every call and returns deterministic canned
 * output, so the full 3-stage runner can be smoke-tested without a live key or
 * spend. The mock is stage-aware via the `purpose` tag the runner passes in.
 */

/* ---------------------------------------------------------------------------
 * PROVIDER ROUTING
 *
 * Every provider worth using speaks the OpenAI chat-completions wire format, so
 * the only things that actually vary are the base URL, the env var holding the
 * key, and the model id. This is the same pattern the handbook uses — its own
 * agent points an OpenAI client at OpenRouter via base_url [BAA p.89].
 *
 * Resolution order (first one whose key is present wins):
 *   1. COUNCIL_PROVIDER, when set explicitly — no guessing.
 *   2. openai   OPENAI_API_KEY
 *   3. groq     GROQ_API_KEY          (OpenAI-compatible)
 *   4. custom   COUNCIL_API_KEY + COUNCIL_BASE_URL  — any other compatible host
 *
 * `custom` exists so a key from a provider this file has never heard of can be
 * routed without editing code: set the two vars and a model id.
 */

export type CouncilProvider = 'openai' | 'groq' | 'custom';

interface ProviderSpec {
    baseUrl: string;
    keyVar: string;
    /** Used only when COUNCIL_MODEL is unset, so a provider swap needs one var. */
    defaultModel: string;
}

const PROVIDERS: Record<CouncilProvider, ProviderSpec> = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        keyVar: 'OPENAI_API_KEY',
        defaultModel: 'gpt-5.6-luna',
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        keyVar: 'GROQ_API_KEY',
        defaultModel: 'openai/gpt-oss-120b',
    },
    custom: {
        baseUrl: process.env.COUNCIL_BASE_URL || '',
        keyVar: 'COUNCIL_API_KEY',
        defaultModel: process.env.COUNCIL_MODEL || '',
    },
};

/** The provider actually in force, and whether its key is present. */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): {
    provider: CouncilProvider;
    spec: ProviderSpec;
    apiKey: string | null;
} {
    const explicit = (env.COUNCIL_PROVIDER || '').trim().toLowerCase() as CouncilProvider;
    const order: CouncilProvider[] =
        explicit && explicit in PROVIDERS ? [explicit] : ['openai', 'groq', 'custom'];

    for (const p of order) {
        const spec = { ...PROVIDERS[p] };
        if (p === 'custom') spec.baseUrl = env.COUNCIL_BASE_URL || '';
        const key = env[spec.keyVar];
        if (typeof key === 'string' && key.trim() && (p !== 'custom' || spec.baseUrl)) {
            return { provider: p, spec, apiKey: key.trim() };
        }
    }
    const fallback = explicit && explicit in PROVIDERS ? explicit : 'openai';
    return { provider: fallback, spec: PROVIDERS[fallback], apiKey: null };
}

function chatUrl(spec: ProviderSpec): string {
    return `${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/**
 * gpt-5.6-luna is the default because it is the one gpt-5.6 model this repo has
 * real billed rates for (see MODEL_PRICING), so cost reporting is accurate
 * rather than a pessimistic guess. Override with COUNCIL_MODEL — gpt-5.6-sol,
 * gpt-5.6-terra and the gpt-5.5-pro tier are all available on this key.
 */
export const COUNCIL_MODEL =
    process.env.COUNCIL_MODEL || resolveProvider().spec.defaultModel || 'gpt-5.6-luna';

/**
 * Council calls are far heavier than the 10s-timeout calls elsewhere in the repo:
 * a persona reads the entire data pack and a reasoning model may think for a
 * while before emitting. 10s would abort nearly every real call.
 */
const LLM_TIMEOUT_MS = Number(process.env.COUNCIL_LLM_TIMEOUT_MS || 120_000);

/** USD per million tokens. Only rates this repo documents having actually been billed. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-5.6-luna': { input: 0.20, output: 1.20 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },

    // --- engy.ai. Read from GET https://api.engy.ai/v1/models on 2026-09-05,
    // which returns per-token pricing, so these are the provider's own figures
    // rather than an estimate. Re-read that endpoint if they change.
    'deepseek-v4-flash-0731': { input: 0.045, output: 0.09 },
    'qwen3.6-35b-a3b': { input: 0.045, output: 0.3 },
    'qwen3.8-27b': { input: 0.045, output: 0.32 },
    'glm-5.3-flash': { input: 0.135, output: 0.45 },
    'glm-5.2': { input: 0.68, output: 1.5 },
    'glm-5.3': { input: 0.98, output: 3.08 },
    'kimi-k3': { input: 1.95, output: 9.75 },
};
/** Unknown model → assume expensive, so the cost warning errs toward being noticed. */
const UNPRICED_MODEL = { input: 2.50, output: 10.00 };

/**
 * Output ceilings per stage. On gpt-5 models these are `max_completion_tokens` and
 * REASONING tokens count against them — so a persona that reasons hard can spend the
 * whole budget and return empty content, which surfaces as a failed agent rather than a
 * short one.
 *
 * Measured, not guessed: the CTO persona (the most verbose of the eight) emitted 3,528
 * output tokens on a live run against the full data pack. At the previous 4,000 ceiling
 * it tipped over during a real convening and was the one agent of eight to fail. These
 * values carry roughly 2x headroom over that observed worst case.
 */
const MAX_OUTPUT_TOKENS: Record<CouncilPurpose, number> = {
    opinion: 7000,
    review: 4500,
    synthesis: 10000,
    email: 2000,
};

/** Soft per-session warning threshold; a full 17-call session on luna is well under this. */
const RUN_BUDGET_USD = Number(process.env.COUNCIL_RUN_BUDGET_USD || 1.00);

export type CouncilPurpose = 'opinion' | 'review' | 'synthesis' | 'email';

export interface CouncilChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export function isMockLlm(): boolean {
    return process.env.COUNCIL_MOCK_LLM === '1';
}

// --- Cost accounting -------------------------------------------------------
// Module-level accumulator. A council session runs inside one request, so this
// tracks that session; callers reset at the start of a run.

let runCostUsd = 0;
let runCalls = 0;

export function resetCouncilCost(): void {
    runCostUsd = 0;
    runCalls = 0;
}

export function councilRunCost(): { costUsd: number; calls: number } {
    return { costUsd: Math.round(runCostUsd * 1e6) / 1e6, calls: runCalls };
}

/** Deterministic canned output for COUNCIL_MOCK_LLM=1, shaped per stage. */
function mockResponse(purpose: CouncilPurpose, messages: CouncilChatMessage[]): string {
    if (purpose === 'opinion') {
        return JSON.stringify([
            {
                severity: 'P1',
                title: 'Mock finding: backlog concentration needs triage',
                detail: 'Canned mock opinion (COUNCIL_MOCK_LLM=1). A small set of aged active tickets dominates the backlog and should be triaged before new intake.',
                evidence: { 'tickets_summary.active': 'mocked count — see data pack' },
                recommendation: 'Run a one-week aging sweep on tickets older than 30 days.',
            },
        ]);
    }
    if (purpose === 'review') {
        return [
            'Mock peer review (COUNCIL_MOCK_LLM=1).',
            'Agent A grounds its claims in the data pack; others are thinner on evidence.',
            '',
            'FINAL RANKING:',
            '1. Agent A',
            '2. Agent B',
            '3. Agent C',
            '4. Agent D',
            '5. Agent E',
            '6. Agent F',
            '7. Agent G',
            '8. Agent H',
        ].join('\n');
    }
    if (purpose === 'synthesis') {
        return [
            '# Council Audit (MOCK — COUNCIL_MOCK_LLM=1)',
            '',
            '## P0 — Fix This Week',
            'None in mock mode.',
            '',
            '## Data Trust',
            '- Mock run: live model call skipped; all findings below are canned.',
            '',
            '## Quick Wins',
            '- Re-run with COUNCIL_MOCK_LLM unset to get a real audit.',
            '',
            '## Open Questions',
            '- None (mock).',
            '',
            '## Compliance Exposure',
            '- None assessed in mock mode.',
        ].join('\n');
    }
    // email voice
    const last = messages[messages.length - 1]?.content?.slice(0, 200) ?? '';
    return `<p>Mock draft reply (COUNCIL_MOCK_LLM=1). Re: ${last}</p>`;
}

/**
 * One chat completion. Throws on HTTP error, timeout or empty content — the
 * runner catches per-call, so a single persona failure degrades that agent's
 * contribution rather than the whole session, and the failure is recorded in
 * failedAgents rather than swallowed (FP-04: fail loudly).
 *
 * No retry loop, deliberately: re-rolling a call until it returns something
 * parseable is output-shopping, not resilience.
 */
export async function councilChat(
    messages: CouncilChatMessage[],
    purpose: CouncilPurpose,
): Promise<string> {
    if (isMockLlm()) return mockResponse(purpose, messages);

    const { provider, spec, apiKey } = resolveProvider();
    if (!apiKey) {
        throw new Error(
            `No LLM key configured. Set one of OPENAI_API_KEY, GROQ_API_KEY, or ` +
            `COUNCIL_API_KEY + COUNCIL_BASE_URL — or COUNCIL_MOCK_LLM=1 for a dry run.`,
        );
    }

    // gpt-5.x / o3 / o4 reject `max_tokens` and any non-default `temperature`.
    const isReasoningModel = /^(gpt-5|o[34])/.test(COUNCIL_MODEL);
    const limits = isReasoningModel
        ? { max_completion_tokens: MAX_OUTPUT_TOKENS[purpose] }
        : { max_tokens: MAX_OUTPUT_TOKENS[purpose], temperature: purpose === 'email' ? 0.5 : 0.1 };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(chatUrl(spec), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: COUNCIL_MODEL, messages, ...limits }),
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${provider} call timed out after ${LLM_TIMEOUT_MS}ms (${purpose}) — raise COUNCIL_LLM_TIMEOUT_MS`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${err.slice(0, 500)}`);
    }

    const data = await response.json();

    const inputTokens = Number(data?.usage?.prompt_tokens || 0);
    const outputTokens = Number(data?.usage?.completion_tokens || 0);
    const pricing = MODEL_PRICING[COUNCIL_MODEL] ?? UNPRICED_MODEL;
    const callCost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1e6;
    runCostUsd += callCost;
    runCalls += 1;
    console.log(
        `[council llm] ${purpose} · ${COUNCIL_MODEL} · in=${inputTokens} out=${outputTokens}`
        + ` · $${callCost.toFixed(5)} · session $${runCostUsd.toFixed(4)} over ${runCalls} call(s)`,
    );
    if (runCostUsd > RUN_BUDGET_USD) {
        console.warn(`[council llm] session cost $${runCostUsd.toFixed(4)} exceeded the $${RUN_BUDGET_USD} soft cap`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string' || !content.trim()) {
        // A reasoning model that spends its whole ceiling thinking returns an empty
        // string with finish_reason 'length' — name that, it is not a generic blank.
        const finish = data?.choices?.[0]?.finish_reason;
        throw new Error(
            `Empty response from OpenAI (${purpose}, finish_reason=${finish ?? 'unknown'})`
            + (finish === 'length' ? ' — output ceiling too low for this stage' : ''),
        );
    }
    return content;
}
