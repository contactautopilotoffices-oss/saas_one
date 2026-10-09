import { parseConfirmAnswer, parsePick } from '../TaskGateway';
import type { DomainHandler, ExecutionResult } from './domain';
import { facilityDomain } from './facilityDomain';
import { interpretMessage } from './interpret';
import { BRAIN_INTERPRET_MODELS, BRAIN_REPLY_MODELS, BrainLlm } from './llm';
import { composeReply, ComposedReply, knownWordsFrom } from './respond';
import { tasksDomain } from './tasksDomain';
import { BrainContext, ConfirmPolicy, DEFAULT_CONFIRM_POLICY, Decision, Interpretation } from './types';

/**
 * The language brain — the six fixed steps, in one call:
 *   gather context (the caller) → UNDERSTAND (1 AI call) → VALIDATE → DECIDE (plain code) → REPLY (facts checked).
 * It never executes anything and never touches the database or WhatsApp: it returns a decision and a reply, and the
 * caller (Phase 4) carries the decision out with the existing, permission-checked task functions.
 *
 * Domains plug in through `deps.domains`. Today: tasks + a facility hand-off. A single combined assistant later
 * means adding a real facility domain, not changing this file.
 */

export interface BrainDeps {
    llm: BrainLlm;
    domains?: DomainHandler[];
    interpretModels?: readonly string[];
    replyModels?: readonly string[];
    policy?: ConfirmPolicy;
    /** Data fetched after an ACT (e.g. another person's task list) so the reply can introduce it. */
    result?: ExecutionResult;
    /** Decide only: do not write the reply yet (the caller does it later with composeBrainReply). */
    skipReply?: boolean;
}

export interface BrainTrace {
    fastPath: boolean;
    interpretModel: string | null;
    replyModel: string | null;
    interpretMs: number;
    replyMs: number;
    tokensIn: number;
    tokensOut: number;
    failures: string[];
}

export interface BrainResult {
    /** 'ai_unavailable' = every model failed; the caller should fall back to the old keyword flow. */
    status: 'ok' | 'ai_unavailable';
    interpretation: Interpretation | null;
    decision: Decision | null;
    reply: ComposedReply | null;
    trace: BrainTrace;
}

export const DEFAULT_DOMAINS: DomainHandler[] = [tasksDomain, facilityDomain];
const MAX_MESSAGE_CHARS = 1500;

/** A plain "yes", "no" or "2" to a question we just asked needs no AI at all. */
function fastAnswer(message: string, ctx: BrainContext): Interpretation | null {
    const p = ctx.pending;
    if (!p) return null;
    const base = { confidence: 1, language: 'en', ambiguities: [] as string[], clarifyQuestion: null, grounded: true };
    if (p.kind === 'pick') {
        const n = parsePick(message, p.options.length);
        if (n) return { ...base, intent: 'answer_pending', slots: { intent: 'answer_pending', answer: 'pick', pick: n, instruction: null }, summary: `Picked option ${n}.` };
    }
    if (p.kind === 'confirm' || p.kind === 'preview') {
        const a = parseConfirmAnswer(message);
        if (a) return { ...base, intent: 'answer_pending', slots: { intent: 'answer_pending', answer: a, pick: null, instruction: null }, summary: `Answered ${a}.` };
    }
    return null;
}

export async function runBrain(message: string, ctx: BrainContext, deps: BrainDeps): Promise<BrainResult> {
    const domains = deps.domains ?? DEFAULT_DOMAINS;
    const policy = deps.policy ?? DEFAULT_CONFIRM_POLICY;
    const text = String(message ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
    const trace: BrainTrace = { fastPath: false, interpretModel: null, replyModel: null, interpretMs: 0, replyMs: 0, tokensIn: 0, tokensOut: 0, failures: [] };
    const unavailable = (): BrainResult => ({ status: 'ai_unavailable', interpretation: null, decision: null, reply: null, trace });

    // 2–3. understand + validate
    let interpretation = fastAnswer(text, ctx);
    if (interpretation) {
        trace.fastPath = true;
    } else {
        try {
            const r = await interpretMessage({ llm: deps.llm, models: deps.interpretModels ?? BRAIN_INTERPRET_MODELS, message: text, ctx, domains });
            interpretation = r.interpretation;
            trace.interpretModel = r.trace.model; trace.interpretMs = r.ms; trace.tokensIn += r.tokensIn; trace.tokensOut += r.tokensOut;
            trace.failures.push(...r.trace.failures.map(f => `understand ${f.model}: ${f.error}`));
        } catch (err) {
            trace.failures.push(err instanceof Error ? err.message : String(err));
            return unavailable();
        }
    }

    // 4. decide — plain code, owned by whichever domain the intent belongs to
    const owner = domains.find(d => d.intents.some(i => i.name === interpretation!.intent));
    if (!owner) return unavailable();
    const decision = owner.decide(interpretation, ctx, policy);

    // 5. reply (the caller may ask to do this later: e.g. only after a confirmed change has really been made)
    if (deps.skipReply) return { status: 'ok', interpretation, decision, reply: null, trace };
    const reply = await composeBrainReply({ text, ctx, interpretation, decision, deps });
    if (reply) { trace.replyModel = reply.model; trace.replyMs = reply.ms; trace.tokensIn += reply.tokensIn; trace.tokensOut += reply.tokensOut; }
    return { status: 'ok', interpretation, decision, reply, trace };
}

/**
 * Step 5 on its own: write the reply for a decision. `result` is what really happened (so the reply can say it was done);
 * without it the reply may only ask or explain. Returns null when the decision has no reply (a hand-off).
 */
export async function composeBrainReply(p: {
    text: string; ctx: BrainContext; interpretation: Interpretation; decision: Decision; deps: BrainDeps; result?: ExecutionResult;
}): Promise<ComposedReply | null> {
    const domains = p.deps.domains ?? DEFAULT_DOMAINS;
    const owner = domains.find(d => d.intents.some(i => i.name === p.interpretation.intent));
    if (!owner) return null;
    const facts = owner.replyFacts(p.decision, p.ctx, p.result ?? p.deps.result);
    if (!facts) return null;
    const ctx = p.ctx;
    const known = knownWordsFrom([p.text, ctx.sender.name, ...ctx.people.map(x => x.name), ...ctx.tasks.map(t => t.title), ...ctx.departments,
        ...(ctx.pending?.kind === 'ping_reply' ? [ctx.pending.assigner, ...ctx.pending.taskTitles] : []), ...(ctx.pending?.kind === 'pick' ? ctx.pending.options : [])]);
    return composeReply({ llm: p.deps.llm, models: p.deps.replyModels ?? BRAIN_REPLY_MODELS, facts, userMessage: p.text, known });
}
