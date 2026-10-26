/**
 * Engy, through the one LLM client FMS already has (backend/lib/council/llm.ts,
 * COUNCIL_PROVIDER=custom → Engy's OpenAI-compatible endpoint). Meera adds no
 * second LLM client, key or retry policy of its own.
 *
 * No retry on unparseable output, matching councilChat's stance: re-rolling a
 * call until something parses is output-shopping. A stage that gets no JSON
 * throws, and the pipeline decides what that means for that stage.
 */

import { councilChat, councilRunCost } from '@/backend/lib/council/llm';
import { satejConfig } from '../config';
import { parseJsonLoose } from '../util';
import { mockLlm } from './mocks';

export type SatejTask = 'structure' | 'discover' | 'analyze' | 'inbox';

export async function chatJSON<T>(opts: {
    task: SatejTask;
    system: string;
    user: string;
    /** 'fast' for the wide end of the funnel (reading search pages), 'smart' where a wrong read reaches a person. */
    model?: 'smart' | 'fast';
}): Promise<T> {
    if (satejConfig.mockMode) return mockLlm(opts.task, opts.user) as T;

    const model = opts.model === 'fast' ? satejConfig.modelFast : satejConfig.modelSmart;
    const text = await councilChat(
        [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
        ],
        'procure',
        { model: model || null },
    );
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Engy did not return a JSON object for the ${opts.task} step`);
    }
    return parsed as T;
}

/**
 * Spend so far in this process, in USD. councilChat keeps a module-level
 * running total and does not hand usage back per call, so a stage's cost is
 * the difference across it — approximate if another council call runs in the
 * same process at the same moment.
 */
export function llmSpendUsd(): number {
    return councilRunCost().costUsd;
}
