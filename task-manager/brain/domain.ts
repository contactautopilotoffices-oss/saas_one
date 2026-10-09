import type { BrainContext, ConfirmPolicy, Decision, Intent, Interpretation, Slots } from './types';

/**
 * The language brain — the "domain" plug-in point.
 *
 * The core (understand → validate → decide → reply) knows nothing about tasks or rooms. A DOMAIN says which
 * intents it owns, how to validate their details, how to decide, and what facts a reply may use. Today there is
 * a tasks domain and a tiny facility domain that only hands off; joining the facility assistant into one later
 * means giving it a real domain here, not rewriting the core.
 */

export interface IntentSpec {
    name: Intent;
    /** One line for the AI: when does a message mean this? */
    description: string;
    /** The shape of `slots` for this intent, written for the AI. */
    slots: string;
}

/** Everything the reply writer may say. Code fills `values`; the AI only wraps words around the placeholders. */
export interface ReplyFacts {
    kind: string;
    /** Plain English: what happened / what must be said. Written for the AI. */
    describe: string;
    /** placeholder name → exact text code will insert (may be multi-line, e.g. a numbered list). */
    values: Record<string, string>;
    /** placeholders that MUST appear in the reply. */
    required: string[];
    /** the reply must end with a question. */
    asksQuestion: boolean;
    /** nothing has happened yet, so the reply must not say it has. */
    claimsNothingDone: boolean;
    /** names the reply may mention in plain words (everything else must come through a placeholder). */
    names: string[];
    /** plain deterministic text used when the AI is down or its answer fails the checks. */
    fallback: string;
}

export interface ExecutionResult { values: Record<string, string>; summary: string }

export interface DomainHandler {
    id: string;
    intents: IntentSpec[];
    /** Strictly validate the AI's raw slots for one of this domain's intents. null = invalid. */
    validateSlots(intent: Intent, raw: Record<string, unknown>, ctx: BrainContext): Slots | null;
    /** Is the wording the AI produced really drawn from the message? */
    checkGrounding(slots: Slots, message: string): boolean;
    /** Plain-code decision. Never calls the AI, never touches data. */
    decide(interp: Interpretation, ctx: BrainContext, policy: ConfirmPolicy): Decision;
    /** Facts for the reply to this decision (null = no reply, e.g. a hand-off). `result` carries data fetched after an ACT. */
    replyFacts(decision: Decision, ctx: BrainContext, result?: ExecutionResult): ReplyFacts | null;
}
