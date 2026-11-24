/**
 * ONE BRAIN TURN. Pure orchestration over injected dependencies, so every path is tested without a database, a model
 * key or a WhatsApp number.
 *
 *   rate limit → HR filter → a Yes / No / number for something pending (code, no model)
 *   → skills this person may use → model with those skills as tools (bounded loop)
 *        read skill  → runs now, result goes back to the model as text
 *        write skill → validated by code; a confirmation card is shown; NOTHING runs
 *        ask_user / handoff / plain answer → the turn ends
 *   → the answer is checked against what code returned (nothing invented) → reply
 *   Yes on a later turn → access re-checked → the existing service runs it once → result from code
 *
 * ## Agent Spec — Unified Brain  (docs/AGENT_DOCTRINE.md §3; full reasoning in docs/WHATSAPP_UNIFIED_BRAIN_PLAN.md §12)
 *
 * **1. Workflow or agent?** Hybrid: a fixed workflow around one bounded agent step [BAA p.121]. Only the model step
 *    decides, and it may decide not to call a tool [BAA p.90]. Justification (a) [BAA p.115]: resolving "my complaint",
 *    "the room I had yesterday" needs a lookup before a decision, which the one-shot classifiers could not do.
 *    Head-to-head vs. the deterministic path [BAA pp.94–95, 99]: not yet run; the eval harness and shadow mode exist
 *    for it and promotion to live waits on that comparison.
 * **2. Context** [BAA p.112]: the person's role class and properties, open files, the pending question or proposal,
 *    remembered facts, handles issued in this thread, the last turns, and this turn's tool results. Never ids,
 *    phone numbers, file paths, other people's data outside scope, or which channel it is on.
 * **3. Cost of a false positive** [BAA p.112]: writes medium (every write needs the person's Yes on a card code
 *    built); answers with numbers high (so numbers must trace to tool results, checked in grounding.ts). Model tier
 *    is a setting (Control Center → AI models → "Unified brain"), chosen by measurement.
 * **4. Tools**: every skill in skills/registry.ts. Description states when NOT to use it [BAA p.107]; run/prepare
 *    never throw past this loop, errors go back as text [BAA p.94]; arguments are strict-schema and re-parsed with
 *    zod, handles only [BAA p.93]; MCP: not yet [BAA p.106], see item 10.
 * **5. Prompt** [BAA pp.105, 114]: ten numbered steps with a no-skip clause and one tone example (loop/prompt.ts).
 *    Terminal state in data: ai_action_log.decision and the proposal's op_id.
 * **6. Memory** [BAA pp.100–103]: the workload repeats (same people, buildings, rooms). Write tool memory_remember
 *    with a closed key list, unknown keys refused before writing [BAA p.101]; past actions read only through
 *    memory_recall [BAA p.103]. Organisation memory (stage 4): lessons the Tech team judged and one tested guidance
 *    note (learning/lessons.ts). The model has no tool to write either; a lesson is used only for the same kind of
 *    login and a skill the person already has [BAA p.101], and never as a source of facts.
 * **7. Multi-agent?** [BAA p.116]: one brain, skills as data; code owns the step order, one thread per person. Tasks
 *    are handed to the Task Manager's own assistant (a different context and a tuned prompt) [BAA p.112].
 * **8. Evaluation** [BAA pp.118–119], measured 2026-11-14 on the 56-case test set (eval/cases.ts, fake data, run by
 *    scripts/brain/eval.ts; saved in eval/lastRun.json and shown on the console's Scorecard):
 *    System: provider errors, latency and model hops are in every trace; median turn 2.0 to 2.4 s on the three tiers.
 *    Quality assurance (rubric: family GLM (5.3 Flash) against a Claude brain, tier mid, scale 0–3 with reasoning
 *      first, manual audit 10% = 16 of 156 grades, 14 agreed, checked by the coding assistant and NOT yet by a person)
 *      [BAA pp.96–98]: mean 2.88 Haiku 5.5, 2.81 Sonnet 5.5, 2.87 Opus 5.5; plus fixed checks in eval/grade.ts.
 *    Tool interaction (expected skill, tools and arguments per case; measured call count) [BAA p.95]: 56/56 on each
 *      tier, 0 unsafe; 0.82 to 0.86 tool calls per turn.
 *    Agent efficiency [BAA p.119]: US$0.0003 / 0.0042 / 0.0069 per turn (Haiku / Sonnet / Opus) with the cached
 *      prompt; the 4-call cap and effort "low" are the two sides of the token-vs-tool trade.
 *    Not measured: real conversations (the set is written, not sampled from traffic) and the live shadow comparison.
 * **9. Trace** [BAA pp.119–120]: every model call and tool call of a turn is returned in TurnTrace and stored by the
 *    channel; each skill is tested alone before scale [BAA p.116].
 * **10. Laws knowingly violated:** L9 (skills run in-process, not behind MCP: they share the app's code and permission
 *    checks; the registry is the single definition an MCP catalog can expose later). L13 (no agent framework: the
 *    project forbids new frameworks without approval; the loop is ~150 lines). L2 timing (the head-to-head runs in
 *    shadow after deploy, not before the build).
 *
 * ### Amendment 2026-11-18: what is open, quick bursts, safe saves (owner's failing chats)
 * **1.** Still hybrid [BAA p.121]: more of each turn is decided by code, not less. Cancel phrases, a number outside the
 *    list and a bare Yes after a side answer are now fixed rules (loop/intent.ts), because guessing them is a false
 *    positive with a real cost [BAA p.112]. Head-to-head [BAA pp.94–95, 99]: not run; replayed failures only (item 8).
 * **2. Context** [BAA p.112]: adds the card waiting behind a question (`waiting_card`) and the topics the person
 *    closed (`closed_by_person`, labels built by code from the card's payload, never by the model).
 * **3. False positive** [BAA p.112]: unchanged tiers. A bare Yes no longer runs a card that was not the last thing said;
 *    the card is shown again instead (one extra step instead of a wrong action).
 * **4. Tools**: new control tool close_topic, with when-not-to-use in its description [BAA p.107]; it never throws and
 *    reports back as text [BAA p.94]; its arguments are read defensively and only handles from open_files are used
 *    [BAA p.93]; not MCP, as item 10 [BAA p.106].
 * **5. Prompt** [BAA pp.105, 114]: steps 11 (offer at most once, never re-offer a closed topic) and 12 (several lines =
 *    one reply) added to the numbered list; the no-skip clause and the tone example are unchanged.
 * **6. Memory** [BAA pp.100–103]: no new write tool. The thread gains `parked`, `closed`, `cardLast` and a `rev`
 *    counter; closed topics are kept one day. Two turns saving together merge instead of overwriting (channels/whatsapp.ts).
 * **7. Multi-agent?** [BAA p.116]: still one brain; a burst is one turn, so two turns of one person no longer overlap.
 * **8. Evaluation** [BAA pp.118–119]: tests/ai-layer/brain-open-items.test.ts and the batching tests in
 *    brain-channels.test.ts replay the owner's two chats step by step (fake model). Not yet done: the 56-case set and
 *    the rubric [BAA pp.96–98] were NOT re-run with real models for this change; tool interaction [BAA p.95] is checked
 *    only for close_topic by the replayed cases.
 * **9. Trace** [BAA pp.119–120]: close_topic is in TurnTrace.toolCalls; new trace reasons: cancelled, closed_topic,
 *    card_shown_again, pick_out_of_range.
 * **10. Laws knowingly violated:** as above, plus L2 for this change [BAA pp.94–95, 99] (no head-to-head before
 *    shipping; the fixes target concrete failures and keep every older test green).
 *
 * ### Amendment 2026-11-18 (b): the property list, one repair, swipe-replies
 * **1.** Still hybrid [BAA p.121]. A swiped Yes / Cancel on a card is decided by code; a swipe on an old card runs
 *    nothing [BAA p.112].
 * **2. Context** [BAA p.112]: adds `replying_to` (the quoted message, from the thread only; never fetched elsewhere).
 * **3. False positive** [BAA p.112]: unchanged. A failed fact check now gets one repair call on the same model before
 *    code's own answer is used; the check itself is unchanged and still decides.
 * **4. Tools**: new read skill properties.mine (the person's own property list, from the access already loaded; no
 *    query), description with when-not-to-use [BAA p.107], returns text and never throws [BAA p.94], args re-parsed
 *    with zod [BAA p.93]; not MCP [BAA p.106].
 * **5. Prompt** [BAA pp.105, 114]: unchanged steps; the repair note is a fixed text (repairNote) sent only after a
 *    failed check, never in the cached prefix.
 * **6. Memory** [BAA pp.100–103]: history entries keep the WhatsApp ids of the message, so a swipe can be matched;
 *    kept as long as the history (24 hours, 16 entries).
 * **8. Evaluation** [BAA pp.118–119]: eval case p-my-properties added (every skill has a case); tests in
 *    brain-answers.test.ts and brain-swipe.test.ts. Not re-run with real models or the rubric [BAA pp.96–98].
 *    Efficiency [BAA p.119]: the repair adds at most one model call, only on turns that failed the check
 *    (TurnTrace.repaired marks them, so their share and cost can be read on the console).
 * **9. Trace** [BAA pp.119–120]: TurnTrace.repaired; a failed repair is in hops as "repair: …"; new reason
 *    quoted_old_card.
 * **10. Laws knowingly violated:** L2 as above [BAA pp.94–95, 99].
 *
 * ### Amendment 2026-11-18 (c): the full meeting room cycle
 * **1.** Still hybrid [BAA p.121]: which property to use for rooms (only those with rooms; the only one, without
 *    asking) is decided by code in skills/rooms.ts, not by the model.
 * **3. False positive** [BAA p.112]: two new writes, room.cancel and room.move, both behind the person's Yes on a card
 *    code built, both starting in shadow like every write. A move books the new time BEFORE cancelling the old, so a
 *    failure leaves the old booking in place; a cancel that fails after the new booking is said plainly.
 * **4. Tools**: rooms.list, rooms.free_slots (read), room.cancel, room.move (write). Descriptions say when not to use
 *    them [BAA p.107]; expected refusals come back as text [BAA p.94]; arguments re-parsed with zod and bookings
 *    reached only through B handles re-read from the person's own bookings [BAA p.93]; not MCP [BAA p.106].
 *    Cancelling uses the app's own cancel (moved unchanged to backend/lib/meetingRooms/cancelBooking.ts).
 * **8. Evaluation** [BAA pp.118–119]: eval cases r-list, r-free-slots, r-cancel, r-move; tests in
 *    brain-rooms.test.ts. Not re-run with real models or the rubric [BAA pp.96–98].
 * **10. Laws knowingly violated:** L2 as above [BAA pp.94–95, 99].
 *
 * ### Amendment 2026-11-18 (d): the task assistant as the brain's task engine (config taskEngine, default off)
 * **1. Workflow or agent?** [BAA p.104] Still one agent in front; tasks are delegated whole to the task assistant, an
 *    existing specialist with its own rules [BAA p.116]. Not a second agent in this loop: the brain only marks the words.
 *    Justification [BAA p.115] (a): people mix tasks with tickets and rooms in one message; one front door routes that.
 * **2. Context** [BAA p.112]: unchanged for the model; the task assistant's replies are added to the thread so later
 *    turns know them. The task assistant's own context is NOT changed (owner: "exactly as it is now").
 * **3. False positive** [BAA p.112]: no new write in the brain. task_part takes only the person's own words (checked in
 *    code, ownWords), so the task assistant never acts on the model's rewording. The brain's own Yes-card task actions
 *    are not offered while this is on.
 * **4. Tools**: control tool task_part, with when-not-to-use [BAA p.107], reported back as text [BAA p.94], arguments
 *    checked in code [BAA p.93]; not MCP [BAA p.106].
 * **5. Prompt** [BAA pp.105, 114]: step 8 has a third frozen variant (SYSTEM_PROMPT_TASK_ENGINE), used only with the
 *    switch on; off, the brain gets SYSTEM_PROMPT byte for byte.
 * **8. Evaluation** [BAA pp.118–119]: brain-task-engine.test.ts runs the REAL task assistant code side by side (direct /
 *    brain listening / brain borrowing the reply) and requires the same words and the same task changes. The task
 *    assistant's own test files give the same results before and after. Not measured: how often the real model marks
 *    the task words correctly [BAA pp.96–98]; read it in Review before widening.
 * **10. Laws knowingly violated:** L2 as above [BAA pp.94–95, 99]. A message only about tasks takes today's path
 *    unchanged, so the risk sits only in mixed messages.
 *
 * ### Amendment 2026-11-20: rooms at the same properties as the app (owner: "keep the whatsapp bot consistent with the
 * fms"; "if the app doesnt allow, dont change the app")
 * **1.** Still hybrid [BAA p.121]: which properties a person may book rooms at is decided by code from the database
 *    (scope.ts roomPropertyIds), never by the model. HR, CRM/BD, IT, Design and Tech logins get every property of the
 *    organisation, the same list the app's Book Meeting Room page offers; everyone else is unchanged.
 * **2. Context** [BAA p.112]: unchanged, except the room skills see the wider list (skills/rooms.ts roomScope); every
 *    other skill keeps the narrower propertyIds.
 * **3. False positive** [BAA p.112]: a booking still needs the person's Yes on a card code built, and the database
 *    booking function checks access again (migration 20261120000002, same roles) [BAA p.93]. No new write.
 * **8. Evaluation** [BAA pp.118–119]: brain-room-scope.test.ts; all earlier room tests unchanged. Not re-run with real
 *    models [BAA pp.96–98].
 * **10. Laws knowingly violated:** L2 as above [BAA pp.94–95, 99].
 * Later the same day ("fix both"): such a login with NO property login (the HR team) is served on WhatsApp for rooms
 *    only (scope.ts roomsOnly; skillsFor offers the room skills alone) [BAA p.112], and only while "Tasks through the
 *    task assistant" is on, so their task messages still reach the task assistant unchanged [BAA p.116]; with it off
 *    they are left to the existing bots as before. The context line meeting_rooms_at tells the model where rooms can be
 *    booked [BAA p.112]; tests in brain-channels.test.ts and brain-room-scope.test.ts [BAA pp.118–119].
 */
import { createHash, randomUUID } from 'node:crypto';
import { buildAuditRow, type AuditInput, type AuditStore } from '../../audit';
import { istDate, istStart } from '../../dates';
import { isHrMatter } from '../../interpret';
import { NO, YES, detectLang, t } from '../../language';
import type { ActorContext, Lang } from '../../types';
import { effectiveBrainLimits, roleClass, scopeFingerprint, type BrainSettings } from '../config';
import { NO_LEARNING, cleanGuidance, echoesLesson, guidanceBlock, lessonsBlock, selectLessons, type Learned } from '../learning/lessons';
import { findQuoted, handleBook, openThread, waitingCard, HISTORY_TURNS, type PendingConfirm, type ThreadState } from '../memory/thread';
import { ASK_USER, CLOSE_TOPIC, HANDOFF, TASK_PART, skillByTool, taskEngineFor, skillsFor, tasksInBrain, toolDefs, toolName, type AvailableSkill } from '../skills/registry';
import { bt } from '../text';
import type { AttachmentRef, Block, BrainChannel, BrainData, BrainModel, BrainReply, MemoryFact, Msg, Outcome, SkillContext, TurnTrace, WriteSkill } from '../types';
import { ungroundedParts } from './grounding';
import { isCancelPhrase, sameQuestion } from './intent';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_TASKS, SYSTEM_PROMPT_TASK_ENGINE, buildContext } from './prompt';

export interface TurnDeps {
    data: BrainData;
    model: BrainModel;
    /** The models to try, in order: the main one first, then the backups (Control Center → AI models). */
    chain(): Promise<string[]>;
    audit: AuditStore;
    now(): Date;
    /** true = allowed. Per person per hour. */
    allowMessage(key: string, perHour: number): boolean;
    /**
     * What the organisation's Tech team has taught the brain (lessons) and told it (guidance). Optional, and a failure
     * here means "nothing learned this turn": learning must never stop a reply (doctrine L7, memory failure isolation).
     */
    learning?(): Promise<Learned>;
}

export interface TurnImage { handle: string; mime: string; base64: string }

export interface TurnInput {
    /** Loaded from the database for THIS turn. Never cached across a confirmation. */
    actor: ActorContext;
    settings: BrainSettings;
    /** Property nicknames (AI Access settings). */
    aliases?: Record<string, string[]>;
    channel: BrainChannel;
    text: string;
    /** Photos that arrived with this message, for the model to look at this once. */
    images?: TurnImage[];
    /** Every file of this person that is not attached to anything yet (including this turn's). */
    attachments?: AttachmentRef[];
    /** The stored thread, untrusted. */
    state: unknown;
    /** Shadow: think and record, never run a write, never write the audit log. */
    dryRun?: boolean;
    /** 2026-11-18: the WhatsApp ids of the message(s) this turn answers, kept on the person's history entry. */
    messageIds?: string[];
    /** 2026-11-18: the person swiped to reply to a message: the WhatsApp ids of the message they quoted. */
    quotedIds?: string[];
}

export interface TurnOutput {
    /** null = the brain has nothing to say (the message belongs to another assistant). */
    reply: BrainReply | null;
    state: ThreadState;
    outcome: Outcome;
    handoffTo: 'tasks_assistant' | 'human' | null;
    /**
     * 2026-11-18 (task engine): the person's own words about tasks in a message that ALSO asked something else. The
     * channel has the task assistant answer them and joins its reply with this one. Absent when there is none, and for
     * a message only about tasks (that is a plain hand-off to the task assistant, exactly as before).
     */
    taskWords?: string;
    lang: Lang;
    trace: TurnTrace;
}

const MAX_MODELS = 3;
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const clipArg = (v: unknown): unknown => (typeof v === 'string' ? v.slice(0, 200) : Array.isArray(v) ? v.slice(0, 10).map(clipArg) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clipArg(x)])) : v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const plainWords = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Every line of `words` is in the person's message (2026-11-18, task_part): never the model's own wording. */
export function ownWords(words: string, message: string): boolean {
    const m = plainWords(message);
    const lines = words.split('\n').map(plainWords).filter(Boolean);
    return lines.length > 0 && lines.every(l => m.includes(l));
}

/** The task words are (nearly) the whole message: it is only about tasks. */
export function coversMessage(words: string, message: string): boolean {
    const m = plainWords(message).length;
    return m > 0 && plainWords(words.split('\n').join(' ')).length >= 0.85 * m;
}

/** What the model is told when its answer failed the fact check (2026-11-18). Frozen wording; only the parts vary. */
export function repairNote(bad: string[]): string {
    const parts = bad.slice(0, 6).map(b => `"${b.slice(0, 40)}"`).join(', ');
    return [
        `<system_check>Your answer was NOT sent. It contains ${parts}, which is not in any tool result, the context or the person's words.`,
        'Do not guess. Either call a read tool that returns it, or write the answer again without it.',
        'If the answer is a list, show the list a tool returned instead of counting, shortening or adding to it yourself.',
        'Reply to the person directly; do not mention this check.</system_check>',
    ].join('\n');
}

type LoopEnd =
    | { kind: 'text'; text: string }
    | { kind: 'ask'; question: string; options: string[] }
    | { kind: 'handoff'; to: 'tasks_assistant' | 'human' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { kind: 'propose'; skill: WriteSkill<any, any>; payload: unknown; card: string; auditFields: Record<string, unknown> | undefined };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutput> {
    const started = Date.now();
    const now = deps.now();
    const { actor, settings, channel } = input;
    const dryRun = input.dryRun === true;
    const aliases = input.aliases ?? {};
    const attachments = input.attachments ?? [];
    const images = settings.model.vision ? (input.images ?? []) : [];
    const raw = input.text.trim().slice(0, 1500);
    const state = openThread(input.state, now);
    const limits = effectiveBrainLimits(settings);
    const book = handleBook(state.handles);
    /** The confirmation card waiting for Yes or Cancel (in front, or parked behind a question). 2026-11-18. */
    const card = waitingCard(state);
    /**
     * The message a swipe-reply quotes (2026-11-18): found = still in the thread; 'gone' = older than what is kept.
     * `quotesCard` = it quotes the card that is waiting now; `quotesOldCard` = it quotes a card that is no longer open.
     */
    const quotedIds = (input.quotedIds ?? []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 512).slice(0, 5);
    const quoted = quotedIds.length ? findQuoted(state, quotedIds) ?? 'gone' as const : null;
    const quotedText = quoted && quoted !== 'gone' && quoted.role === 'assistant' ? quoted.text : '';
    const looksLikeCard = (t: string) => (['en', 'hi', 'hinglish'] as const).some(l => t.includes(bt('confirm_tail', l)));
    const quotesCard = !!card && !!quotedText && quotedText.includes(card.card);
    const quotesOldCard = !!quotedText && !quotesCard && looksLikeCard(quotedText);
    // Declared before any fast path: finish() reads taskWordsOut.
    /** task_part words of this model run (2026-11-18), each checked to be the person's own words. */
    let taskBits: string[] = [];
    /** Set when the message mixed tasks with something else: the words the task assistant answers. */
    let taskWordsOut: string | undefined;
    /** Topics the person closed in THIS turn, and whether the waiting card was cancelled by it. */
    const closedNow: Array<{ label: string; at: string }> = [];
    let cardClosed = false;
    const trace: TurnTrace = { outcome: 'error', reason: null, skillId: null, modelCalls: [], toolCalls: [], hops: [], grounded: null, latencyMs: 0, costUsd: null, tokensIn: 0, tokensOut: 0, lessons: [], guidance: null };

    // Memory never blocks a turn: any failure reads as "nothing remembered".
    const memory: MemoryFact[] = settings.memory.enabled ? await deps.data.listMemory(actor.orgId, actor.userId).catch(() => []) : [];
    const shortReply = raw.length <= 12 && (YES.test(raw) || NO.test(raw) || /^\d+$/.test(raw));
    const preferred = memory.find(m => m.key === 'preferred_language')?.value;
    const detected = detectLang(raw);
    const lang: Lang = preferred === 'en' || preferred === 'hi' || preferred === 'hinglish' ? preferred
        : state.lang && (shortReply || !raw || (state.pending && detected === 'en')) ? state.lang : detected;

    const audit = (a: Omit<AuditInput, 'orgId' | 'userId' | 'channel' | 'lang'>) =>
        deps.audit.write(buildAuditRow({ ...a, orgId: actor.orgId, userId: actor.userId, channel, lang, latencyMs: Date.now() - started }));
    const safeAudit = (a: Parameters<typeof audit>[0]) => (dryRun ? Promise.resolve() : audit(a).catch(err => { console.error('[Brain] audit write failed', errText(err)); }));

    /** What is kept of the person's words. HR matters and empty photo-only turns are never stored as text. */
    let storedUserText = raw || (images.length || attachments.length ? '[sent a file]' : '');
    type Next = {
        pending?: ThreadState['pending']; askStreak?: number; keepThread?: boolean; handoffTo?: TurnOutput['handoffTo']; reason?: string | null; skillId?: string | null;
        /** The waiting card is finished with (confirmed, cancelled, refused): it is not carried forward. */
        dropCard?: boolean;
        /** This reply ends with the waiting card or its Yes/Cancel reminder (a bare Yes then confirms it). */
        cardLast?: boolean;
        /** The Yes/Cancel reminder was added to this reply: it is never added again for this card. */
        reminded?: boolean;
    };
    const finish = (outcome: Outcome, reply: BrainReply | null, next: Next = {}): TurnOutput => {
        const at = now.toISOString();
        const history = next.keepThread ? state.history : [
            ...state.history,
            ...(storedUserText ? [{ role: 'user' as const, text: storedUserText.slice(0, 2000), at, ...(input.messageIds?.length ? { ids: input.messageIds.slice(0, 10) } : {}) }] : []),
            ...(reply ? [{ role: 'assistant' as const, text: reply.text.slice(0, 2000), at }] : []),
        ].slice(-HISTORY_TURNS);
        trace.outcome = outcome;
        trace.reason = next.reason ?? trace.reason;
        trace.skillId = next.skillId ?? trace.skillId;
        trace.latencyMs = Date.now() - started;
        trace.tokensIn = trace.modelCalls.reduce((n, c) => n + c.tokensIn, 0);
        trace.tokensOut = trace.modelCalls.reduce((n, c) => n + c.tokensOut, 0);
        const priced = trace.modelCalls.filter(c => c.costUsd !== null);
        trace.costUsd = priced.length ? priced.reduce((n, c) => n + (c.costUsd as number), 0) : null;
        return {
            reply, outcome, lang, trace, handoffTo: next.handoffTo ?? null, ...(taskWordsOut && next.handoffTo !== 'tasks_assistant' ? { taskWords: taskWordsOut } : {}),
            state: next.keepThread ? { ...state, lastActiveAt: state.lastActiveAt } : {
                lang, handles: book.snapshot(), history, lastActiveAt: at,
                ...carry(next),
                askStreak: next.askStreak ?? 0,
                closed: [...state.closed, ...closedNow].slice(-10),
                ...(state.rev !== undefined ? { rev: state.rev } : {}),
            },
        };
    };
    /**
     * What stays open after this turn (2026-11-18). A card is no longer thrown away because the person asked something
     * else: it stays until Yes, Cancel or its expiry. While the brain asks a question, the card waits behind it.
     */
    function carry(next: Next): Pick<ThreadState, 'pending' | 'parked' | 'cardLast'> {
        let kept = next.dropCard || cardClosed ? null : card;
        if (kept && next.reminded) kept = { ...kept, reminded: true };
        if (next.pending === undefined) return { pending: kept, parked: null, cardLast: !!kept && next.cardLast === true };
        if (next.pending?.kind === 'ask') return { pending: next.pending, parked: kept, cardLast: false };
        if (next.pending?.kind === 'confirm') return { pending: next.pending, parked: null, cardLast: next.cardLast ?? true };
        return { pending: null, parked: null, cardLast: false };
    }

    // ── 1. Limits ──
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    const recentTurns = dryRun ? 0 : await deps.audit.countTurnsSince(actor.orgId, actor.userId, hourAgo).catch(() => 0);
    if (!deps.allowMessage(`ai-brain:${actor.orgId}:${actor.userId}`, limits.perUserPerHour) || recentTurns >= limits.perUserPerHour) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'rate_limited' });
        return finish('refuse', { text: bt('rate_limited', lang) }, { pending: state.pending, askStreak: state.askStreak, cardLast: state.cardLast, reason: 'rate_limited' });
    }

    // ── 2. HR matters never reach the model, a ticket, the memory or the stored thread ──
    if (raw && isHrMatter(raw)) {
        storedUserText = '[an HR matter: not stored]';
        await safeAudit({ entryId: 'hr.redirect', decision: 'refused', refusalReason: 'hr_matter' });
        return finish('refuse', { text: t('hr_redirect', lang) }, { reason: 'hr_matter' });
    }

    const available = skillsFor(actor, settings);
    const scope = sha(scopeFingerprint(actor, available.map(a => a.skill.id)));
    const userWords = [...state.history.filter(h => h.role === 'user').slice(-5).map(h => h.text), raw].join('\n');
    const ctx: SkillContext = { actor, lang, now, channel, data: deps.data, aliases, userWords, attachments, handle: book.issue, resolve: book.resolve, memory };

    // ── 3. Fast path: an answer to something pending needs no model ──
    // A swipe-reply on the waiting card is an answer to THAT card, even behind a question (2026-11-18).
    if (quotesCard && card && raw) {
        if (YES.test(raw)) return confirm(card);
        if (NO.test(raw) || isCancelPhrase(raw, card.skillId)) return cancelCard(card);
    }
    // A swipe-reply "Yes" on a card that is no longer open (done, cancelled, expired): nothing runs on it.
    if (quotesOldCard && raw && (YES.test(raw) || NO.test(raw))) {
        return finish('not_executed', { text: bt('expired', lang) }, { pending: state.pending, askStreak: state.askStreak, cardLast: state.cardLast, reason: 'quoted_old_card' });
    }
    // A short cancel phrase ("cancel it", "cancel the lan ticket", "rehne do") cancels the waiting card, wherever it is
    // (2026-11-18: only the bare word "cancel" used to count). A phrase naming something else goes to the model.
    // Only for a card in FRONT: behind a question, "leave it" may be the answer to that question, so the model decides.
    if (state.pending?.kind === 'confirm' && raw && isCancelPhrase(raw, state.pending.skillId)) return cancelCard(state.pending);
    if (state.pending?.kind === 'confirm' && raw) {
        // A bare Yes / No confirms or cancels the card only when the card was the last thing the brain said. After a
        // side answer, "yes" may answer that answer, so the card is shown again first and nothing runs on a guess.
        const cardWasLast = state.cardLast !== false;
        if ((YES.test(raw) || NO.test(raw)) && !cardWasLast) {
            return finish('propose', { text: `${bt('card_again', lang)}\n${state.pending.card}`, options: lang === 'hi' ? ['हाँ', 'रद्द करें'] : ['Yes', 'Cancel'], awaitingConfirm: true }, { cardLast: true, skillId: state.pending.skillId, reason: 'card_shown_again' });
        }
        if (YES.test(raw)) return confirm(state.pending);
        if (NO.test(raw)) return cancelCard(state.pending);
    }
    // A number outside the list just shown ("0", "5" for two choices) is answered here, never guessed (2026-11-18).
    if (state.pending?.kind === 'ask' && state.pending.options.length && /^\d{1,2}$/.test(raw) && !state.pending.options[Number(raw) - 1]) {
        const n = state.pending.options.length;
        return finish('ask', { text: n === 1 ? bt('pick_one', lang) : bt('pick_range', lang, { n }), options: state.pending.options }, { pending: state.pending, askStreak: state.askStreak, reason: 'pick_out_of_range' });
    }
    if (!state.pending && !images.length && !quotedText && (!raw || shortReply)) {
        // "yes", "2", "ok" with nothing of ours waiting: it answers another assistant's question, or nothing at all.
        if (raw || !attachments.length) return finish('unsupported', null, { keepThread: true, reason: 'not_ours' });
    }
    let text = raw;
    if (state.pending?.kind === 'ask' && /^\d{1,2}$/.test(raw)) {
        const pick = state.pending.options[Number(raw) - 1];
        if (pick) text = pick;
    }

    if (!available.length) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'nothing_enabled' });
        return finish('unsupported', { text: bt('nothing_enabled', lang) }, { reason: 'nothing_enabled' });
    }

    // ── 4. The model step ──
    // The task assistant as the brain's task engine (2026-11-18): only on WhatsApp, where the task assistant lives.
    const engine = input.channel === 'whatsapp' && taskEngineFor(actor, settings);
    const tools = toolDefs(available, { taskPart: engine });
    // Tasks in the brain (owner 2026-11-15): only when one of the person's task actions is on; otherwise the same prompt as before.
    const system = engine ? SYSTEM_PROMPT_TASK_ENGINE : tasksInBrain(available) ? SYSTEM_PROMPT_TASKS : SYSTEM_PROMPT;
    const visible = images.filter(i => attachments.some(a => a.handle === i.handle));
    const context = buildContext({ actor, lang, now, aliases, attachments, pending: state.pending, parked: state.parked, closed: state.closed, quoted, memory, handles: book.all(), visibleImages: visible.map(i => i.handle) });
    // What the Tech team taught (lessons) and wrote (guidance). It sits AFTER the frozen prompt and the context, so the
    // cached prefix is untouched, and it is kept apart from `context`: a lesson is another person's message and must
    // never count as a source of facts for the grounding check.
    let learned: Learned = NO_LEARNING;
    if (deps.learning) { try { learned = await deps.learning(); } catch (err) { console.warn('[Brain] learning skipped this turn:', errText(err)); } }
    const lessons = settings.learning.lessons
        ? selectLessons(text, learned.lessons, { role: roleClass(actor), skillIds: available.map(a => a.skill.id), max: settings.learning.maxLessons })
        : [];
    const guidance = learned.guidance && cleanGuidance(learned.guidance.text) ? learned.guidance : null;
    trace.lessons = lessons.map(l => l.id);
    trace.guidance = guidance?.version ?? null;
    const taught = [guidance ? guidanceBlock(guidance.text) : '', lessonsBlock(lessons)].filter(Boolean).join('\n');
    const userBlocks: Block[] = [
        ...visible.map(i => ({ type: 'image' as const, mime: i.mime, base64: i.base64 })),
        { type: 'text', text: `${context}\n${taught ? `${taught}\n` : ''}<message>\n${text || '(the person sent a file with no words)'}\n</message>` },
    ];
    const history: Msg[] = [];
    for (const h of state.history) {
        if (!history.length && h.role === 'assistant') continue; // the first message must be the person's
        history.push({ role: h.role, blocks: [{ type: 'text', text: h.text }] });
    }

    let sources: string[] = [];
    let displays: string[] = [];
    let lastRead: string | null = null;

    /** What close_topic asked for in this model run (2026-11-18). Applied by code after the loop, once. */
    const closing: { ask: { what: string; handles: string[]; card: boolean } | null } = { ask: null };


    /** The conversation of the model run that answered, so a repair can carry on from it with its tool results. */
    let convo: Msg[] = [];

    const runLoop = async (model: string, resume = false): Promise<LoopEnd> => {
        if (!resume) { sources = []; displays = []; lastRead = null; closing.ask = null; taskBits = []; convo = [...history, { role: 'user', blocks: userBlocks }]; }
        const messages: Msg[] = convo;
        let reads = 0; let problems = 0;
        for (let round = 0; round < limits.maxToolCalls + 4; round++) {
            const t0 = Date.now();
            const reply = await deps.model.call({ model, system, tools, messages, maxTokens: settings.model.maxTokens, effort: settings.model.effort });
            trace.modelCalls.push({ seq: trace.modelCalls.length + 1, model: reply.model, keySlot: reply.keySlot ?? null, tokensIn: reply.usage.tokensIn, tokensOut: reply.usage.tokensOut, cacheRead: reply.usage.cacheRead, cacheWrite: reply.usage.cacheWrite, costUsd: reply.usage.costUsd, ms: Date.now() - t0, stopReason: reply.stopReason });
            if (reply.stopReason === 'refusal') throw new Error('the model declined to answer');
            const uses = reply.blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
            const said = reply.blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
            if (!uses.length) {
                if (reply.stopReason === 'max_tokens' && !said) throw new Error('the model ran out of room before answering');
                return { kind: 'text', text: said };
            }
            messages.push({ role: 'assistant', blocks: reply.blocks, raw: reply.raw });

            const results: Block[] = [];
            const note = (use: { id: string }, textOut: string, isError = false) => { results.push({ type: 'tool_result', toolUseId: use.id, text: textOut, ...(isError ? { isError: true } : {}) }); };
            const record = (skillId: string, kind: 'read' | 'write' | 'control', args: unknown, ok: boolean, chars: number, ms: number, error?: string) => {
                trace.toolCalls.push({ seq: trace.toolCalls.length + 1, skillId, kind, args: clipArg(args), ok, resultChars: chars, ms, error: error ?? null });
            };

            // Reads the model asked for together run side by side; their results keep the order they were asked in.
            const readJobs = new Map<string, Promise<void>>();
            for (const use of uses) {
                const entry = available.find(a => toolName(a.skill.id) === use.name);
                if (!entry || entry.skill.kind !== 'read') continue;
                const skill = entry.skill;
                const parsed = skill.args.safeParse(use.input ?? {});
                if (!parsed.success) { record(skill.id, 'read', use.input, false, 0, 0, 'bad arguments'); note(use, `Those arguments are not valid for ${use.name}: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`, true); continue; }
                if (reads >= limits.maxToolCalls) { record(skill.id, 'read', parsed.data, false, 0, 0, 'tool budget used up'); note(use, 'You have used all your lookups for this turn. Answer now with what you have, or call ask_user.', true); continue; }
                reads++;
                const t1 = Date.now();
                readJobs.set(use.id, (async () => {
                    try {
                        const out = await skill.run(ctx, parsed.data);
                        // The same finished answer from two look-ups is shown once (test set 2026-11-14: "no tickets" appeared twice).
                        sources.push(out.text); if (out.display) { sources.push(out.display); if (!displays.includes(out.display)) displays.push(out.display); }
                        lastRead = skill.id;
                        record(skill.id, 'read', parsed.data, true, out.text.length, Date.now() - t1);
                        note(use, out.text);
                    } catch (err) {
                        // Doctrine L3: a tool failure goes back to the model as text; it never breaks the turn.
                        console.error('[Brain] read skill failed', skill.id, errText(err));
                        record(skill.id, 'read', parsed.data, false, 0, Date.now() - t1, errText(err));
                        note(use, 'That lookup failed just now (a system problem, not the person\'s fault). Tell them you could not check it and to try again shortly.', true);
                    }
                })());
            }
            await Promise.all(readJobs.values());

            for (const use of uses) {
                if (readJobs.has(use.id) || results.some(r => r.type === 'tool_result' && r.toolUseId === use.id)) continue;
                if (use.name === ASK_USER) {
                    const a = use.input as { question?: unknown; options?: unknown } | null;
                    const question = typeof a?.question === 'string' ? a.question.trim().slice(0, 500) : '';
                    const options = Array.isArray(a?.options) ? a.options.filter((o): o is string => typeof o === 'string' && !!o.trim()).map(o => o.trim().slice(0, 160)).slice(0, 8) : [];
                    record(ASK_USER, 'control', { options: options.length }, !!question, 0, 0);
                    if (question) return { kind: 'ask', question, options };
                    note(use, 'ask_user needs a question.', true); continue;
                }
                if (use.name === TASK_PART && engine) {
                    const words = String((use.input as { words?: unknown } | null)?.words ?? '').trim().slice(0, 1500);
                    const own = ownWords(words, raw);
                    record(TASK_PART, 'control', { chars: words.length, own }, own, 0, 0);
                    if (own) taskBits.push(words);
                    note(use, own
                        ? 'Noted: the task assistant answers this part itself, in its own words. Now answer only anything ELSE in the message, briefly; never mention the task part. If there is nothing else, reply with nothing.'
                        : 'Not taken: those words are not in the message. Copy the person\'s words about tasks exactly, or answer without task_part.');
                    continue;
                }
                if (use.name === CLOSE_TOPIC) {
                    const a = use.input as { what?: unknown; files?: unknown; cancel_card?: unknown } | null;
                    const what = typeof a?.what === 'string' ? a.what.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
                    const handles = Array.isArray(a?.files) ? a.files.filter((f): f is string => typeof f === 'string').map(f => f.trim().toUpperCase()).slice(0, 5) : [];
                    // The waiting card is cancelled only when the model says it is what they dropped (or names no file).
                    const cancelsCard = !!card && (a?.cancel_card === true || (a?.cancel_card === undefined && !handles.length));
                    const prev = closing.ask as { what: string; handles: string[]; card: boolean } | null; // set by an earlier call in this run
                    closing.ask = { what: what || prev?.what || '', handles: [...new Set([...(prev?.handles ?? []), ...handles])], card: cancelsCard || !!prev?.card };
                    record(CLOSE_TOPIC, 'control', { files: handles.length, card: cancelsCard }, true, 0, 0);
                    note(use, `Done: ${cancelsCard ? 'the waiting card is cancelled and nothing was raised' : 'noted that the person does not want this'}. The system tells the person this, so do not repeat it, and never offer it again. Now answer only anything ELSE in the message, briefly. If there is nothing else, reply with nothing.`);
                    continue;
                }
                if (use.name === HANDOFF) {
                    const to = (use.input as { to?: unknown } | null)?.to === 'tasks_assistant' ? 'tasks_assistant' as const : 'human' as const;
                    record(HANDOFF, 'control', { to }, true, 0, 0);
                    return { kind: 'handoff', to };
                }
                const entry = available.find(a => toolName(a.skill.id) === use.name);
                if (!entry) {
                    // A tool that exists but is not this person's is answered exactly like one that does not exist.
                    record(skillByTool(use.name)?.id ?? use.name.slice(0, 60), 'control', null, false, 0, 0, 'not available');
                    note(use, `${use.name} is not available. Use only the tools you were given, or tell the person this is done in the app.`, true); continue;
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const skill = entry.skill as WriteSkill<any, any>;
                const parsed = skill.args.safeParse(use.input ?? {});
                if (!parsed.success) { record(skill.id, 'write', use.input, false, 0, 0, 'bad arguments'); note(use, `Those arguments are not valid for ${use.name}: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`, true); continue; }
                const t1 = Date.now();
                try {
                    const prepared = await skill.prepare(ctx, parsed.data);
                    if (prepared.ok) {
                        record(skill.id, 'write', parsed.data, true, prepared.card.length, Date.now() - t1);
                        return { kind: 'propose', skill, payload: prepared.payload, card: prepared.card, auditFields: prepared.auditFields };
                    }
                    problems++;
                    sources.push(prepared.problem);
                    record(skill.id, 'write', parsed.data, false, prepared.problem.length, Date.now() - t1, 'needs more');
                    note(use, prepared.problem, true);
                } catch (err) {
                    problems++;
                    console.error('[Brain] write skill could not be prepared', skill.id, errText(err));
                    record(skill.id, 'write', parsed.data, false, 0, Date.now() - t1, errText(err));
                    note(use, 'That could not be checked just now (a system problem). Tell the person to try again shortly.', true);
                }
            }
            // Results go back in the order the calls were made, all in one message.
            results.sort((x, y) => uses.findIndex(u => x.type === 'tool_result' && u.id === x.toolUseId) - uses.findIndex(u => y.type === 'tool_result' && u.id === y.toolUseId));
            messages.push({ role: 'user', blocks: results });
            if (problems > 3) break;
        }
        return { kind: 'text', text: '' }; // the loop cap was reached: answer from what code already has
    };

    let end: LoopEnd | null = null;
    let usedModel: string | null = null;
    let models: string[] = [];
    try { models = (await deps.chain()).slice(0, MAX_MODELS); } catch (err) { trace.hops.push({ model: 'chain', error: errText(err) }); }
    for (const model of models) {
        try { end = await runLoop(model); usedModel = model; break; }
        catch (err) {
            trace.hops.push({ model, error: errText(err) });
            console.warn(`[Brain] ${model} failed, trying the next model: ${errText(err)}`);
        }
    }
    if (!end) {
        await safeAudit({ entryId: null, decision: 'error', refusalReason: 'ai_unavailable' });
        // Nothing is lost: an open question or proposal stays exactly as it was.
        return finish('error', { text: bt('down', lang) }, { keepThread: true, reason: 'ai_unavailable' });
    }
    // Guidance is written and tested by the Tech team, so a fact in it (a helpdesk name, a number) may be said. Lessons are not here.
    const sourcesNow = () => [context, guidance ? cleanGuidance(guidance.text) : '', userWords, text, ...sources, ...state.history.map(h => h.text)].join('\n');
    // Repair (2026-11-18): an answer that fails the fact check gets ONE more try, on the same model and with its tool
    // results, told exactly what could not be traced. Before, the person got "I couldn't put that answer together
    // reliably" at once, and asking again failed the same way ("Show those 22 properties", twice).
    if (end.kind === 'text' && end.text.trim() && usedModel) {
        const bad = ungroundedParts(end.text, sourcesNow(), istDate(now));
        if (bad.length) {
            convo.push({ role: 'assistant', blocks: [{ type: 'text', text: end.text }] });
            convo.push({ role: 'user', blocks: [{ type: 'text', text: repairNote(bad) }] });
            trace.repaired = true;
            try { end = await runLoop(usedModel, true); }
            catch (err) { trace.hops.push({ model: usedModel, error: `repair: ${errText(err)}` }); }
        }
    }
    const usage = { model: trace.modelCalls.at(-1)?.model ?? null, tokensIn: trace.modelCalls.reduce((n, c) => n + c.tokensIn, 0), tokensOut: trace.modelCalls.reduce((n, c) => n + c.tokensOut, 0) };
    // close_topic (2026-11-18): code does what it means, once, after the model run that asked for it succeeded.
    const closeLine = closing.ask ? await applyClose(closing.ask) : null;
    /** The reply with the close line in front of it, when something was closed this turn. */
    const withClose = (text: string) => (closeLine ? (text.trim() ? `${closeLine}\n\n${text}` : closeLine) : text);
    // Tasks for the task assistant (2026-11-18). Only about tasks (the words are the whole message, or the brain has
    // nothing else to say): the plain hand-off, so the message goes to the task assistant exactly as it does today.
    // Mixed with something else: the brain answers the rest and the channel adds the task assistant's own reply.
    if (engine && taskBits.length) {
        const taskText = taskBits.join('\n');
        const nothingElse = end.kind === 'text' && !end.text.trim() && !closeLine;
        if (coversMessage(taskText, raw) || nothingElse) {
            await safeAudit({ entryId: null, decision: 'handed_off', refusalReason: 'to_task_manager', ...usage });
            return finish('handoff', { text: bt('tasks_elsewhere', lang) }, { handoffTo: 'tasks_assistant', reason: 'tasks' });
        }
        taskWordsOut = taskText;
    }
    const allSources = sourcesNow();
    /** The reply repeats another person's judged message: treated like an invented fact. */
    const echoes = (reply: string) => echoesLesson(reply, lessons, allSources);

    if (end.kind === 'handoff') {
        await safeAudit({ entryId: null, decision: 'handed_off', refusalReason: end.to === 'tasks_assistant' ? 'to_task_manager' : 'to_human', ...usage });
        return end.to === 'tasks_assistant'
            ? finish('handoff', { text: withClose(bt('tasks_elsewhere', lang)) }, { handoffTo: 'tasks_assistant', reason: 'tasks' })
            : finish('handoff', { text: withClose(bt('handoff_asked', lang)) }, { handoffTo: 'human', reason: 'human' });
    }

    if (end.kind === 'propose') {
        const pending: PendingConfirm = { kind: 'confirm', opId: randomUUID(), skillId: end.skill.id, payload: end.payload, card: end.card, scope, at: now.toISOString() };
        await safeAudit({ entryId: end.skill.id, decision: 'confirm_shown', opId: pending.opId, fields: end.auditFields ?? null, ...usage });
        const yes = lang === 'hi' ? ['हाँ', 'रद्द करें'] : ['Yes', 'Cancel'];
        // The same card again with a different photo: say plainly the new photo replaces the earlier one (2026-11-18).
        const photoOf = (x: unknown) => (x && typeof x === 'object' && typeof (x as { attachmentId?: unknown }).attachmentId === 'string' ? (x as { attachmentId: string }).attachmentId : null);
        const before = card && !cardClosed && card.skillId === end.skill.id ? photoOf(card.payload) : null;
        const after = photoOf(end.payload);
        const shown = before && after && before !== after ? `${bt('photo_replaced', lang)}\n${end.card}` : end.card;
        return finish('propose', { text: withClose(shown), options: yes, awaitingConfirm: true }, { pending, skillId: end.skill.id });
    }

    if (end.kind === 'ask') {
        // Only asking the SAME thing again counts as not moving forward (2026-11-18: a streak left over from an earlier
        // conversation made "Can i book a meeting room?" end at once with "I'm not getting this right").
        const askStreak = state.pending?.kind === 'ask' && sameQuestion(state.pending.question, end.question) ? state.askStreak + 1 : 1;
        if (askStreak > limits.maxQuestionsInRow) {
            await safeAudit({ entryId: lastRead, decision: 'handed_off', refusalReason: 'too_many_questions', ...usage });
            return finish('handoff', { text: withClose(bt('handoff_human', lang)) }, { handoffTo: 'human', reason: 'too_many_questions' });
        }
        let options = end.options;
        let missing = ungroundedParts([end.question, ...options].join('\n'), allSources, istDate(now));
        if (echoes([end.question, ...options].join('\n'))) missing.push('(a lesson)');
        // Choices the model made up ("10:00 to 11:00?" when no room was looked up) are dropped, not the whole question:
        // a sound question with invented choices is asked without them (found by the test set 2026-11-14).
        const dropped = missing.length > 0 && options.length > 0 && ungroundedParts(end.question, allSources, istDate(now)).length === 0 && !echoes(end.question);
        if (dropped) { options = []; missing = []; }
        // Still recorded as not grounded: the model did make something up, and the console flags the turn for a look.
        trace.grounded = !dropped && missing.length === 0;
        if (missing.length) {
            await safeAudit({ entryId: lastRead, decision: 'error', refusalReason: 'ungrounded_question', ...usage });
            return finish('answer', { text: withClose(displays.length ? displays.join('\n\n') : closeLine ? '' : bt('ungrounded', lang)) }, { reason: 'ungrounded_question' });
        }
        const body = options.length ? `${end.question}\n${options.map((o, i) => `${i + 1}) ${o}`).join('\n')}\n${bt('pick', lang)}` : end.question;
        await safeAudit({ entryId: lastRead, decision: 'asked', fields: { options: options.length }, ...usage });
        return finish('ask', { text: withClose(body), ...(options.length ? { options } : {}) }, { pending: { kind: 'ask', question: end.question, options, at: now.toISOString() }, askStreak, skillId: lastRead, reason: dropped ? 'choices_dropped' : null });
    }

    // A plain answer: the model's wording is used only if every number and reference in it traces to a source.
    // After close_topic, an empty answer is right: there was nothing else in the message (2026-11-18).
    if (closeLine && !end.text.trim()) {
        trace.grounded = true;
        await safeAudit({ entryId: lastRead, decision: 'answered', ...usage });
        return finish(cardClosed ? 'cancelled' : 'answer', { text: closeLine }, { skillId: lastRead, reason: 'closed_topic' });
    }
    const missing = end.text ? ungroundedParts(end.text, allSources, istDate(now)) : ['(empty)'];
    if (end.text && echoes(end.text)) missing.push('(a lesson)');
    trace.grounded = missing.length === 0;
    let answer = missing.length === 0 ? end.text : displays.length ? displays.join('\n\n') : closeLine ? '' : bt(end.text ? 'ungrounded' : 'down', lang);
    // A card still waiting after a side answer: say so ONCE, in code, so what the person is told matches what is open.
    const remind = !!card && !cardClosed && !card.reminded;
    if (remind) answer = `${answer}\n\n${bt('card_waiting', lang)}`;
    await safeAudit({ entryId: lastRead, decision: lastRead || missing.length === 0 ? 'answered' : 'error', refusalReason: missing.length ? 'ungrounded_answer' : null, ...usage });
    return finish('answer', { text: withClose(answer) }, { skillId: lastRead, reason: missing.length ? 'ungrounded_answer' : null, ...(remind ? { reminded: true, cardLast: true } : {}) });

    // ── A confirmed proposal (closure over deps, actor, lang) ──

    async function confirm(p: PendingConfirm): Promise<TurnOutput> {
        // Whatever happens below, this card is finished with.
        const finishCard = (o: Outcome, r: BrainReply | null, n: Next = {}) => finish(o, r, { ...n, dropCard: true });
        const entry: AvailableSkill | undefined = available.find(a => a.skill.id === p.skillId);
        // Guardrail G3: everything is checked again NOW, against the person's access as it is at this moment.
        if (!entry || entry.skill.kind !== 'write' || p.scope !== scope) {
            await safeAudit({ entryId: p.skillId, decision: 'refused', opId: p.opId, refusalReason: 'access_changed' });
            return finishCard('not_executed', { text: bt('access_changed', lang) }, { skillId: p.skillId, reason: 'access_changed' });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skill = entry.skill as WriteSkill<any, any>;
        const payload = skill.payload.safeParse(p.payload);
        if (!payload.success) {
            await safeAudit({ entryId: p.skillId, decision: 'error', opId: p.opId, refusalReason: 'bad_proposal' });
            return finishCard('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'bad_proposal' });
        }
        if (dryRun || entry.mode === 'shadow') {
            await safeAudit({ entryId: p.skillId, decision: 'shadow', opId: p.opId });
            return finishCard('not_executed', { text: bt('shadow_write', lang) }, { skillId: p.skillId, reason: 'test_mode' });
        }
        // Idempotency: the same proposal confirmed twice (double tap, a retried delivery) runs once. The unique index
        // on ai_action_log (op_id) WHERE decision = 'accepted' makes this race-safe in the database too.
        const status = await deps.audit.opStatus(actor.orgId, actor.userId, p.opId).catch(() => 'accepted' as const);
        if (status === 'accepted') return finishCard('not_executed', { text: bt('already_done', lang) }, { skillId: p.skillId, reason: 'already_done' });
        if (status === 'failed') return finishCard('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'failed_before' });
        // The audit row is written FIRST. If it cannot be written, nothing runs (no unlogged writes).
        try { await audit({ entryId: p.skillId, decision: 'accepted', opId: p.opId }); }
        catch { return finishCard('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'audit_failed' }); }
        // The daily cap is counted AFTER our own row exists, so parallel confirmations cannot all slip under it.
        const since = istStart(istDate(now)).toISOString();
        const actions = await deps.audit.countActionsSince(actor.orgId, actor.userId, since).catch(() => Infinity);
        if (actions > limits.actionsPerUserPerDay) {
            await safeAudit({ entryId: p.skillId, decision: 'refused', opId: p.opId, refusalReason: 'daily_limit' });
            return finishCard('not_executed', { text: bt('daily_limit', lang) }, { skillId: p.skillId, reason: 'daily_limit' });
        }
        try {
            const out = await skill.execute(ctx, payload.data, p.opId);
            await safeAudit({ entryId: p.skillId, decision: out.ok ? 'acted' : 'error', opId: p.opId, resultRef: out.resultRef ?? null, refusalReason: out.ok ? null : 'not_done' });
            if (out.ok) {
                // Memory and bookkeeping never fail an action that already happened.
                for (const id of out.usedAttachments ?? []) await deps.data.markAttachmentUsed(id, `${p.skillId}:${out.resultRef ?? p.opId}`).catch(() => undefined);
                if (out.episode && settings.memory.enabled) await deps.data.addEpisode({ orgId: actor.orgId, userId: actor.userId, summary: out.episode, skillId: p.skillId }).catch(() => undefined);
            }
            return finishCard(out.ok ? 'executed' : 'not_executed', { text: out.reply }, { skillId: p.skillId, reason: out.ok ? null : 'not_done' });
        } catch (err) {
            console.error('[Brain] write skill failed', p.skillId, errText(err));
            await safeAudit({ entryId: p.skillId, decision: 'error', opId: p.opId, refusalReason: 'write_failed' });
            return finishCard('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'write_failed' });
        }
    }

    // ── Closing things the person does not want (2026-11-18) ──

    /** A short label of what a card was about, for the closed list the model sees. Built from code's payload, never the model. */
    function cardLabel(c: PendingConfirm): string {
        const p = (c.payload ?? {}) as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : '');
        if (c.skillId === 'ticket.create') return `ticket: ${s(p.description)}`;
        if (c.skillId === 'ticket.add_photo') return `photo for ticket ${s(p.ticketNumber)}`;
        if (c.skillId === 'room.book') return `room booking: ${s(p.roomName)} ${s(p.date)} ${s(p.startTime)}`;
        if (c.skillId === 'task.add_file') return `file for task: ${s(p.title)}`;
        if (Array.isArray(p.titles) && typeof p.titles[0] === 'string') return `task: ${s(p.titles[0])}`;
        return c.skillId.replace(/[._]/g, ' ');
    }

    /** The photo a card would have used is set aside, so it is not offered for the same thing again. Never in shadow. */
    async function setAside(ids: string[], why: string): Promise<void> {
        if (dryRun) return;
        for (const id of [...new Set(ids)]) await deps.data.markAttachmentUsed(id, `declined:${why}`.slice(0, 120)).catch(() => undefined);
    }
    function cardPhoto(c: PendingConfirm): string[] {
        const id = (c.payload as { attachmentId?: unknown } | null)?.attachmentId;
        return typeof id === 'string' ? [id] : [];
    }

    /** "cancel it", a No to the card: cancelled in code, its photo set aside, the topic closed. */
    async function cancelCard(c: PendingConfirm): Promise<TurnOutput> {
        await safeAudit({ entryId: c.skillId, decision: 'cancelled', opId: c.opId });
        await setAside(cardPhoto(c), c.opId);
        closedNow.push({ label: cardLabel(c), at: now.toISOString() });
        cardClosed = true;
        // The question in front of a parked card was about that card: both go.
        return finish('cancelled', { text: bt('cancelled', lang) }, { skillId: c.skillId, dropCard: true, pending: null, reason: 'cancelled' });
    }

    /** close_topic from the model. Returns the line code puts in front of the reply. */
    async function applyClose(ask: { what: string; handles: string[]; card: boolean }): Promise<string> {
        const ids = ask.handles.map(h => attachments.find(a => a.handle === h)?.id).filter((x): x is string => !!x);
        const cancels = !!card && ask.card;
        if (card && cancels) {
            await safeAudit({ entryId: card.skillId, decision: 'cancelled', opId: card.opId });
            ids.push(...cardPhoto(card));
            cardClosed = true;
        }
        await setAside(ids, cancels ? card!.opId : 'closed_topic');
        const label = ask.what || (cancels ? cardLabel(card!) : '');
        if (label) closedNow.push({ label, at: now.toISOString() });
        return bt(cancels ? 'cancelled' : 'closed_done', lang);
    }
}

/** For channels: does this outcome mean the brain took the message? (false → another assistant should answer it). */
export function brainHandled(out: Pick<TurnOutput, 'outcome' | 'handoffTo' | 'reply'>): boolean {
    if (out.outcome === 'unsupported' && !out.reply) return false;
    if (out.outcome === 'handoff' && out.handoffTo === 'tasks_assistant') return false;
    if (out.outcome === 'error') return false;
    return true;
}

export type { ActorContext, BrainChannel };
