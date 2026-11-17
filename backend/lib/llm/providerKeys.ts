/**
 * Owner 2026-11-15: ONE shared set of keys per AI provider, nothing dedicated to any job.
 *   "i want to remove the WHATSAPP_BOT_GROQ_API_KEY and replace it with the GROQ_API_KEY(s). i dont want anything
 *    dedicated to any job." … "if one of the keys is exhausted, others can be used until i replace the api key".
 *
 * Every Groq call in the application reads GROQ_API_KEY → GROQ_API_KEY_2 → GROQ_API_KEY_3, and every Gemini call
 * GEMINI_API_KEY → GEMINI_API_KEY_2 → GEMINI_API_KEY_3 (then GOOGLE_AI_API_KEY, the older name of the same key, so a
 * server that only has that one keeps working). The per-job keys that existed before (WHATSAPP_BOT_GROQ_API_KEY…,
 * GROQ_VOICE_API_KEY, GROQ_TASK_CHAT_API_KEY, GROQ_LAYOUT_API_KEY, GEMINI_AUTOTUNE_API_KEY) are no longer read.
 *
 * A key that is used up, over its rate limit, rejected or disabled (HTTP 429 / 401 / 403) is skipped for REST_MS on
 * this server, and the next key is used; once the rest is over it is tried again, so a key replaced on the server is
 * picked up by itself. Any other failure (a bad request, a server error, a timeout) is not the key's fault: it is
 * returned as it is, and the other keys are not spent on it.
 *
 * Keys are only ever read here and passed to the caller. A value is never logged, returned to a browser or stored.
 */

export type KeyProvider = 'groq' | 'gemini';
type Env = Record<string, string | undefined>;

export const PROVIDER_KEY_NAMES: Readonly<Record<KeyProvider, readonly string[]>> = {
    groq: ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3'],
    gemini: ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GOOGLE_AI_API_KEY'],
};

/** How long a used-up or rejected key is skipped before it is tried again. */
export const KEY_REST_MS = 15 * 60_000;

/** key name → resting until (ms). Per server instance; nothing is stored anywhere. */
const restingUntil = new Map<string, number>();

/** For tests. */
export function _resetKeyRests(): void { restingUntil.clear(); }

const isResting = (name: string, now: number) => (restingUntil.get(name) ?? 0) > now;

/**
 * The keys to try, in order: every key that is set, the same value only once, resting keys moved to the end (so a
 * request still goes out when every key is resting: the provider then says whether it is still used up).
 */
export function providerKeys(provider: KeyProvider, env: Env = process.env, now = Date.now()): Array<{ name: string; value: string }> {
    const seen = new Set<string>();
    const set = PROVIDER_KEY_NAMES[provider]
        .map(name => ({ name, value: String(env[name] ?? '').trim() }))
        .filter(k => k.value && !seen.has(k.value) && seen.add(k.value));
    return [...set.filter(k => !isResting(k.name, now)), ...set.filter(k => isResting(k.name, now))];
}

/** The key values in the order to try them. Empty = no key is set. */
export const groqKeys = (env: Env = process.env): string[] => providerKeys('groq', env).map(k => k.value);
export const geminiKeys = (env: Env = process.env): string[] => providerKeys('gemini', env).map(k => k.value);

/** Is at least one key of this provider set? */
export const hasProviderKey = (provider: KeyProvider, env: Env = process.env): boolean => providerKeys(provider, env).length > 0;

/** An HTTP status that says "this key cannot be used right now" (used up, rate limited, rejected, disabled). */
export const isKeyProblem = (status: number | null | undefined): boolean => status === 429 || status === 401 || status === 403;

/** Rest the key(s) holding this value. */
export function restKey(provider: KeyProvider, value: string, env: Env = process.env, now = Date.now()): void {
    for (const name of PROVIDER_KEY_NAMES[provider]) if (String(env[name] ?? '').trim() === value) restingUntil.set(name, now + KEY_REST_MS);
}

/** The HTTP status carried by an SDK error (Groq / Google clients), if any. */
export function statusOf(err: unknown): number | null {
    const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
    const s = Number(e?.status ?? e?.statusCode ?? e?.response?.status);
    if (Number.isFinite(s) && s > 0) return s;
    const m = /\b(429|401|403)\b/.exec(err instanceof Error ? err.message : '');
    return m ? Number(m[1]) : null;
}

export class NoProviderKeyError extends Error {
    constructor(provider: KeyProvider) {
        super(`No ${provider === 'groq' ? 'Groq' : 'Gemini'} key is set (${PROVIDER_KEY_NAMES[provider].join(', ')})`);
        this.name = 'NoProviderKeyError';
    }
}

/**
 * A fetch with the provider's keys: each key in turn while the answer is 429 / 401 / 403. Returns the first other
 * answer, or the last key's answer when every key had a problem. `init` builds the request for one key (called once
 * per attempt, so a body is never reused). A network error or a timeout is thrown as it is: another key would not help.
 */
export async function fetchWithKeys(provider: KeyProvider, url: string, init: (key: string) => RequestInit, env: Env = process.env, doFetch: typeof fetch = fetch): Promise<Response> {
    const keys = providerKeys(provider, env);
    if (!keys.length) throw new NoProviderKeyError(provider);
    let last: Response | null = null;
    for (let i = 0; i < keys.length; i++) {
        const res = await doFetch(url, init(keys[i].value));
        if (!isKeyProblem(res.status)) return res;
        restKey(provider, keys[i].value, env);
        last = res;
        if (i < keys.length - 1) console.warn(`[ProviderKeys] ${provider} key ${keys[i].name} answered HTTP ${res.status}; trying the next key for the next ${KEY_REST_MS / 60_000} minutes`);
    }
    return last!;
}

/**
 * The same for an SDK call: `run` with each key in turn while it fails with 429 / 401 / 403. The last key's error is
 * thrown when every key had a problem; any other error is thrown at once.
 */
export async function withProviderKeys<T>(provider: KeyProvider, run: (key: string) => Promise<T>, env: Env = process.env): Promise<T> {
    const keys = providerKeys(provider, env);
    if (!keys.length) throw new NoProviderKeyError(provider);
    let lastErr: unknown = null;
    for (let i = 0; i < keys.length; i++) {
        try {
            return await run(keys[i].value);
        } catch (err) {
            if (!isKeyProblem(statusOf(err))) throw err;
            restKey(provider, keys[i].value, env);
            lastErr = err;
            if (i < keys.length - 1) console.warn(`[ProviderKeys] ${provider} key ${keys[i].name} answered HTTP ${statusOf(err)}; trying the next key for the next ${KEY_REST_MS / 60_000} minutes`);
        }
    }
    throw lastErr;
}
