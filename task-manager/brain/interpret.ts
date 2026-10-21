import type { DomainHandler } from './domain';
import { BrainLlm, FallbackTrace, HEDGE_UNDERSTAND_MS, extractJson, withModelFallback } from './llm';
import { interpretSystemPromptWithSections, interpretUserPrompt, type PromptSections, BUILTIN_PROMPT_SECTIONS } from './prompt';
import { BrainContext, ExtraRequest, Intent, Interpretation, MAX_EXTRA_REQUESTS } from './types';
import { clip } from './text';
import { foldUnmarkedNotes } from './tasksDomain';

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
    const validSlots = owner.validateSlots(intent, rawSlots, ctx);
    if (!validSlots) throw new Error(`invalid details for "${intent}"`);

    const ambiguities = (Array.isArray(r.ambiguities) ? r.ambiguities : [])
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map(a => clip(a, 160)).slice(0, 5);

    // Part B: wording may come from the message OR the person's OWN earlier messages ("yes add this task" agrees to a task they
    // named a minute ago). Never from the assistant's lines. Every change is still shown and confirmed before it happens.
    // Owner 2026-10-19: an unfinished request ("draft") is the person's own words too, so "both" can finish it.
    const groundText = [message, ...(ctx.pending?.kind === 'draft' ? [ctx.pending.request] : []), ...(ctx.conversation ?? []).filter(l => l.startsWith('Person: ')).map(l => l.slice(8))].join('\n');
    // Owner 2026-10-20: a note on a new task only when the person marked one ("note:"); otherwise it stays in the title.
    const ownWords = [message, ...(ctx.pending?.kind === 'draft' ? [ctx.pending.request] : [])].join('\n');
    const slots = foldUnmarkedNotes(validSlots, ownWords);

    // Part B: the other requests in the same message. A bad one never fails the whole reading: it is reported as unclear.
    const also: ExtraRequest[] = []; const unclear: string[] = [];
    for (const item of (Array.isArray(r.also) ? r.also : []).slice(0, MAX_EXTRA_REQUESTS)) {
        const it = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
        const label = it && typeof it.summary === 'string' && it.summary.trim() ? clip(it.summary, 120) : 'one part of your message';
        const o = it ? domains.find(d => d.intents.some(i => i.name === it.intent)) : undefined;
        const s = it && o ? o.validateSlots(it.intent as Intent, it.slots && typeof it.slots === 'object' && !Array.isArray(it.slots) ? it.slots as Record<string, unknown> : {}, ctx) : null;
        if (!it || !o || !s) { unclear.push(label); continue; }
        const folded = foldUnmarkedNotes(s, ownWords);
        also.push({ intent: it.intent as Intent, slots: folded, summary: label, grounded: o.checkGrounding(folded, groundText) });
    }

    return {
        intent,
        confidence,
        language: typeof r.language === 'string' && r.language.trim() ? clip(r.language, 12) : 'en',
        slots,
        ambiguities,
        clarifyQuestion: typeof r.clarify_question === 'string' && r.clarify_question.trim() ? clip(r.clarify_question, 200) : null,
        summary: typeof r.summary === 'string' ? clip(r.summary, 200) : '',
        grounded: owner.checkGrounding(slots, groundText),
        ...(also.length ? { also } : {}),
        ...(unclear.length ? { unclear } : {}),
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
    llm: BrainLlm; models: readonly string[]; message: string; ctx: BrainContext; domains: DomainHandler[]; promptSections?: PromptSections;
    /** Group 2: start the backup model after this long (0 = strictly one after another). */
    hedgeMs?: number;
}): Promise<InterpretResult> {
    const system = interpretSystemPromptWithSections(p.domains, p.promptSections ?? BUILTIN_PROMPT_SECTIONS);
    const user = interpretUserPrompt(p.message, p.ctx);
    const started = Date.now();
    let tokensIn = 0, tokensOut = 0;

    const { value, trace } = await withModelFallback(p.models, async model => {
        const res = await p.llm.complete({ model, system, user, json: true, maxTokens: 1500 });
        tokensIn += res.tokensIn; tokensOut += res.tokensOut;
        return validateInterpretation(extractJson(res.text), p.domains, p.ctx, p.message);
    }, 'understand', { hedgeMs: p.hedgeMs ?? HEDGE_UNDERSTAND_MS });

    return { interpretation: value, trace, tokensIn, tokensOut, ms: Date.now() - started };
}
