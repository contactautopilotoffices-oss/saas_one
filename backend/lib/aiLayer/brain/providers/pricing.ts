/**
 * List prices in US dollars per million tokens (Anthropic first-party API, as of 2026-11-03). Used only to estimate
 * spend for the console; the provider's own billing page is the source of truth. A model missing here has no
 * estimate (null = not measured), which is different from zero.
 */
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

const PRICES: Record<string, Price> = {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    // Haiku 5.5: prompts up to 100K tokens. Cache prices are taken as the usual 0.1x read / 1.25x write of input.
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

export const priceOf = (model: string): Price | null => PRICES[model.replace(/^anthropic:/, '')] ?? null;

/** `uncachedIn` = input tokens billed at the full rate (the provider reports cached tokens separately). */
export function costUsd(model: string, usage: { uncachedIn: number; out: number; cacheRead: number; cacheWrite: number }): number | null {
    const p = priceOf(model);
    if (!p) return null;
    return (usage.uncachedIn * p.input + usage.out * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) / 1_000_000;
}
