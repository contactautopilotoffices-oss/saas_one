import type { DomainHandler } from './domain';
import { BrainLlm, FallbackTrace, extractJson, withModelFallback } from './llm';
import { interpretSystemPrompt, interpretUserPrompt } from './prompt';
import { BrainContext, Intent, Interpretation } from './types';
import { clip } from './text';

/**
 * The language brain — step 2 and 3: UNDERSTAND (one AI call) and VALIDATE.
 *
 * The AI returns untrusted JSON. Anything off — unknown intent, wrong slot shape, missing confidence — throws, which
 * makes the next model try; only if every model fails does the caller learn the AI is unavailable.
 */

export function validateInterpretation(raw: unknown, domains: DomainHandler[], ctx: BrainContext, message: string): Interpretation {
    if (!raw || typeof raw !== 'object') throw new Error('the reply was not an object');
    const r = raw as Record<string, unknown>;

    const owner = domains.find(d => d.intents.some(i => i.name === r.intent));
    if (!owner || typeof r.intent !== 'string') throw new Error(`unknown intent "${String(r.intent)}"`);
    const intent = r.intent as Intent;

    if (typeof r.confidence !== 'number' || Number.isNaN(r.confidence)) throw new Error('missing confidence');
    const confidence = Math.min(1, Math.max(0, r.confidence));

    const rawSlots = r.slots && typeof r.slots === 'object' && !Array.isArray(r.slots) ? (r.slots as Record<string, unknown>) : {};
    const slots = owner.validateSlots(intent, rawSlots, ctx);
    if (!slots) throw new Error(`invalid details for "${intent}"`);

    const ambiguities = (Array.isArray(r.ambiguities) ? r.ambiguities : [])
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map(a => clip(a, 160)).slice(0, 5);

    return {
        intent,
        confidence,
        language: typeof r.language === 'string' && r.language.trim() ? clip(r.language, 12) : 'en',
        slots,
        ambiguities,
        clarifyQuestion: typeof r.clarify_question === 'string' && r.clarify_question.trim() ? clip(r.clarify_question, 200) : null,
        summary: typeof r.summary === 'string' ? clip(r.summary, 200) : '',
        grounded: owner.checkGrounding(slots, message),
    };
}

export interface InterpretResult {
    interpretation: Interpretation;
    trace: FallbackTrace;
    tokensIn: number;
    tokensOut: number;
    ms: number;
}

export async function interpretMessage(p: {
    llm: BrainLlm; models: readonly string[]; message: string; ctx: BrainContext; domains: DomainHandler[];
}): Promise<InterpretResult> {
    const system = interpretSystemPrompt(p.domains);
    const user = interpretUserPrompt(p.message, p.ctx);
    const started = Date.now();
    let tokensIn = 0, tokensOut = 0;

    const { value, trace } = await withModelFallback(p.models, async model => {
        const res = await p.llm.complete({ model, system, user, json: true, maxTokens: 1500 });
        tokensIn += res.tokensIn; tokensOut += res.tokensOut;
        return validateInterpretation(extractJson(res.text), p.domains, p.ctx, p.message);
    }, 'understand');

    return { interpretation: value, trace, tokensIn, tokensOut, ms: Date.now() - started };
}
