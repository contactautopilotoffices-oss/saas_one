import type { AccessDecision } from '../TaskAccessService';
import { decideImportEligibility, extractCandidate } from '../TaskImportInbound';
import type { Employee, TestingConfig } from '../types';
import type { ExecutionResult } from './domain';
import { ExecIO, executeAction, needsExecution } from './execute';
import { BrainDeps, BrainResult, composeBrainReply, runBrain } from './index';
import { shadowDetails } from './shadow';
import { addDays, clip, isGrounded, splitLongReply } from './text';
import { FIND_MAX_ROWS, type FoundTask } from './findTasks';
import { DEFAULT_CONFIRM_POLICY, DRAFT_TTL_MIN, type Action, type BrainContext, type ClarifyReason, type PendingState } from './types';
import { AI_DOWN_HELP, ExactPlan, LastChange, UNDO_HINT, UndoIO, changeFromAction, normalizeChange, parseExactCommand, planExact, runUndo } from './frontDoor';
import { isExplicitTaskCommand } from '@/backend/lib/whatsapp/interpreter/coordinator.mjs';
import { tasksDomainWithTeam } from './tasksDomain';
import { facilityDomain } from './facilityDomain';
import { buildTeamReport, buildTeamTaskList } from './teamReport';

/**
 * The language brain — Phase 4: SMART CHAT, live.
 *
 * For people in a department with Smart chat ON (and, while the sandbox is ON, a sandbox number), the brain answers their plain-
 * language messages. Everything not covered falls back to the OLD bot untouched:
 *   • a room / ticket message, or one while a facility conversation is open  → old facility assistant
 *   • the AI being unavailable                                               → old keyword bot
 *   • an older conversation (import preview, old "confirm?") still open       → that old flow finishes first
 *
 * Quick part (during the webhook): decide. Slow part (after the webhook answered): carry out, write the reply, remember.
 * Every change is carried out by the existing task functions, which enforce permissions again.
 * What is remembered is a short-lived summary — the brain's own words and what it understood, never the person's original words.
 */

export const LIVE_STATE_TYPE = 'BRAIN_STATE';
/** How long a question the bot asked stays answerable. Part B (2026-10-13): 15 → 120 minutes — Priyanka's "yes" 15 minutes
 *  after "should I mark … as done?" found nothing waiting. A late yes is still safe: the change is re-checked when carried out. */
export const STATE_TTL_MIN = 120;

const SORRY_RETRY = 'Sorry, something went wrong on my side. Please try that again in a moment.';

export interface LiveState {
    /** Short memory of the last turns (interpretation + the bot's own replies), newest last. */
    recent: string[];
    pending: PendingState | null;
    /** The change that was proposed and is waiting for a yes (only for a pending confirmation). */
    action: Action | null;
    /** One-line summary of the original request, used to resume after a pick or a change of mind. */
    originalSummary: string | null;
    pickOptions: string[];
    /** This conversation is a reply to someone's request (a reminder sent to a superuser): tell the people who gave those tasks. */
    relay: boolean;
    /** Titles of the tasks in that request (they are not on the person's own list). */
    titles: Record<string, string>;
    /** Phase 3 "One front door": the person's last change, so "undo" can reverse it within 10 minutes. */
    lastChange?: LastChange | null;
    /** Phase 5 only: detects a second clarification in a row. */
    lastOutcome?: string | null;
}

/** Owner 2026-10-20: a reply short enough to be a plain yes ("yes", "haan kar do", "ok go ahead") — one line, at most 8 words. */
export const isShortReply = (text: string): boolean => !/\n/.test(text.trim()) && text.trim().split(/\s+/).filter(Boolean).length <= 8;

const EMPTY: LiveState = { recent: [], pending: null, action: null, originalSummary: null, pickOptions: [], relay: false, titles: {} };

/** Owner 2026-10-19: an unfinished request is kept for DRAFT_TTL_MIN minutes, then forgotten. */
function liveDraft(p: Record<string, unknown>): boolean {
    if (p.kind !== 'draft' || typeof p.request !== 'string' || !p.request.trim()) return false;
    const at = Date.parse(String(p.at || ''));
    return Number.isFinite(at) && Date.now() - at < DRAFT_TTL_MIN * 60 * 1000;
}

/**
 * Owner 2026-10-19: the questions after which the bot KEEPS the unfinished request, so the next reply ("both", "only Neeti",
 * "assign it to Srushti") finishes it instead of starting over. (A pick list and a yes/no already keep their own state.)
 */
const DRAFT_REASONS: ReadonlySet<ClarifyReason> = new Set<ClarifyReason>([
    'ai_flagged_ambiguity', 'low_confidence', 'add_or_assign', 'no_recipient', 'person_not_found', 'no_task_content', 'unknown_intent',
    'note_missing',   // owner 2026-10-21: "add note" without the text → the reply is the note
]);
const MAX_DRAFT_CHARS = 1500;

/**
 * Owner 2026-10-21 (Sanil: "Add Sailee rest FNF" → "couldn't find anyone named Sailee"): when the bot is unsure but the
 * message looks like adding a task, it SUGGESTS the task in the person's own words and asks once. A clear answer then saves
 * it straight away (undo for 10 minutes): "yes" / "add task" → their own list; "assign it to Neeti" → Neeti.
 */
// Only when the bot did not understand, or a name matched nobody. Never when the AI has a specific question of its own
// ("both Vidya and Dipti, or one?"), and never when they clearly said who it is for ("assign … to …", "give it to …").
const SUGGEST_REASONS: ReadonlySet<ClarifyReason> = new Set<ClarifyReason>(['person_not_found', 'unknown_intent', 'low_confidence', 'not_grounded']);
const ASSIGN_WORDS = /\b(?:assign|assigned|give|hand|de do|dedo|ko do|ko de)\b/i;
const ADD_WORDS = /\b(?:add|task|tasks|todo|to-do|remind me|kaam|jod|daal|likh)\b/i;
const COMMAND_WORDS = /^(?:(?:please|pls|plz|kindly)\s+)?(?:(?:i\s+)?(?:need|want|have)\s+to\s+)?(?:add|create|make|put|new)?\s*(?:a\s+|an\s+|new\s+|one\s+)?(?:tasks?|todo|to-do)?\s*(?:for\s+me|for\s+myself)?\s*[:.\-–]?\s*/i;
const QUESTION_START = /^(?:what|which|how|why|when|who|whose|where|is|are|do|does|can|show|list|tell|kya|kab|kaun|kitne|kaise)\b/i;
export const SUGGEST_QUESTION = "Did you want to add this task to your list? Reply yes, or tell me who it's for.";

/** The task in the person's own words: their lines without "add / task / need to add …". Only ONE clear line, never a question. */
export function suggestedTitle(text: string): string | null {
    const lines = text.split(/\n+/)
        .map(l => {
            // "Task. Add Sailee rest FNF" (lines can arrive joined): drop command words until none are left at the start.
            let out = l.trim();
            for (let i = 0; i < 4; i++) { const next = out.replace(COMMAND_WORDS, '').replace(/^[\s:.\-–,]+/, '').trim(); if (next === out) break; out = next; }
            return out.replace(/[\s:.\-–,!]+$/g, '').trim();
        })
        .filter(l => /[a-z]/i.test(l) && !/^(?:tasks?|add|please|pls|need|to|ok|okay|hi|hello)$/i.test(l));
    if (lines.length !== 1) return null;
    const title = lines[0];
    if (title.length > 120 || /\?/.test(title) || QUESTION_START.test(title)) return null;
    return title;
}

/** A plain "yes, add it to my list" answer to a suggestion. */
const YES_TO_SUGGESTION = /^(?:yes|y|yeah|yep|haan|ha|han|ok|okay|sure|done|add|add it|add this|add task|add tasks|add the task|need to add (?:a |the )?task|for me|mine|my list|mera|mere liye|haan add karo|ha add karo|add karo|kar do|yes add|yes add it|ok add|go ahead|theek hai|thik hai)[\s!.👍]*$/i;
export const isYesToSuggestion = (text: string): boolean => YES_TO_SUGGESTION.test(text.trim());

/** The person's words so far: the earlier unfinished request (if any) plus this message. */
export function draftRequest(previous: PendingState | null, text: string): string {
    const before = previous?.kind === 'draft' ? `${previous.request}\n` : '';
    return clip(`${before}${text}`, MAX_DRAFT_CHARS);
}

/** The question the bot asked: its reply up to the first "?" (without any list that follows), else its start. */
export function questionOf(reply: string): string {
    const q = reply.indexOf('?');
    return clip(q >= 0 && q < 400 ? reply.slice(0, q + 1) : reply, 300);
}

export function normalizeState(data: unknown): LiveState {
    if (!data || typeof data !== 'object') return { ...EMPTY };
    const value = data as Record<string, unknown>;
    const pending = value.pending as Record<string, unknown> | null;
    const action = value.action as Record<string, unknown> | null;
    return {
        recent: Array.isArray(value.recent) ? value.recent.filter((s: unknown) => typeof s === 'string').slice(-4) : [],
        pending: pending && (['confirm', 'pick', 'preview', 'ping_reply'].includes(String(pending.kind)) || liveDraft(pending)) ? pending as unknown as PendingState : null,
        action: action && typeof action.type === 'string' ? action as unknown as Action : null,
        originalSummary: typeof value.originalSummary === 'string' ? value.originalSummary : null,
        pickOptions: Array.isArray(value.pickOptions) ? value.pickOptions.filter((s: unknown) => typeof s === 'string') : [],
        relay: value.relay === true,
        titles: value.titles && typeof value.titles === 'object' && !Array.isArray(value.titles) ? Object.fromEntries(Object.entries(value.titles).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
        ...(normalizeChange(value.lastChange) ? { lastChange: normalizeChange(value.lastChange) } : {}),
        ...(typeof value.lastOutcome === 'string' ? { lastOutcome: value.lastOutcome } : {}),
    };
}

/** Keep the person's last change for "undo" when the state is rewritten (only while the front door is on). */
const carry = (state: LiveState, change: LastChange | null | undefined): Partial<LiveState> => {
    if (!change && !state.lastChange) return {};
    if (change && state.lastChange) {
        return {
            lastChange: {
                at: change.at,
                items: [...state.lastChange.items, ...change.items]
            }
        };
    }
    return { lastChange: change ?? state.lastChange };
};

const remember = (recent: string[], understood: string, said: string | null): string[] =>
    [...recent, `Person: ${clip(understood, 200)}`, ...(said ? [`Assistant: ${clip(said, 200)}`] : [])].slice(-4);

export interface LiveIO {
    getSmartChatDepartments(): Promise<ReadonlySet<string>>;
    getConfig(): Promise<TestingConfig>;
    getEmployee(phone: string): Promise<Employee | null>;
    checkAccess(employee: Employee): Promise<AccessDecision>;
    facilityActive(phone: string): Promise<boolean>;
    getState(phone: string): Promise<{ type: string; data: unknown } | null>;
    setState(phone: string, state: LiveState): Promise<void>;
    clearState(phone: string): Promise<void>;
    /** For a superuser: the reminders sent to them that are still waiting for a reply (null when none). */
    openPingPending(employee: Employee): Promise<{ pending: PendingState; titles: Record<string, string> } | null>;
    buildContext(employee: Employee, phone: string, opts: { pending: PendingState | null; recent: string[]; conversation?: string[] }): Promise<BrainContext>;
    /** Phase 2 conversation memory: the chat's last messages, oldest first ([] while the switch is OFF). */
    readConversation?(phone: string): Promise<string[]>;
    /** Phase 3: the "One front door" switch (Task Access panel). Absent / false = exactly the old behaviour. */
    frontDoorOn?(): Promise<boolean>;
    /** Phase 4: the "Team reports" switch (Task Access panel). Absent / false = the AI's instructions are exactly as before. */
    teamReportsOn?(): Promise<boolean>;
    beginLearning?(input: { messageId?: string | null; phone?: string | null; text?: string | null; context?: BrainContext | null }): Promise<void>;
    observeLearning?(input: { messageId?: string | null; phone?: string | null; text: string; context: BrainContext; intent?: string | null; outcome?: string | null; previousOutcome?: string | null; exact?: string | null; apology?: boolean; interpretation?: unknown; reply?: string | null }): Promise<void>;
    /** Phase 3: reversing a change for "undo" (the same permission-checked functions as the Tasks tab). */
    undo?: UndoIO;
    brain: BrainDeps;
    exec: ExecIO;
    /** One WhatsApp message through the safety gate (kill switches, Pretend Mode). */
    reply(phone: string, text: string): Promise<void>;
    audit(details: Record<string, unknown>, employee: Employee): Promise<void>;
    seenBefore(messageId: string): boolean;
    markSeen(messageId: string): void;
}

export interface LiveClaim { handled: boolean; background?: () => Promise<void> }
const NOT_HANDLED: LiveClaim = { handled: false };

// Owner 2026-10-20: these always go to the old bot, before any AI call or in-flight merging. Greetings / menu words get the
// menu (Create Ticket / Book Meeting Room, or 1. Tasks / 2. Facility), and ticket / room requests reach the facility assistant
// directly. Smart chat used to answer "hi" with a task greeting and quietly merge "I want to raise a ticket" into that turn,
// so people could never reach tickets or rooms. Anything that mentions a task stays with smart chat.
const MENU_WORDS = /^(?:hi+|hello+|hey+|menu|help|options|good\s*(?:morning|afternoon|evening))[\s!.]*$/i;
const FACILITY_REQUEST = /\b(?:raise|create|log|open|file|register|submit)\s+(?:(?:a|an|new|the)\s+){0,2}(?:ticket|complaint)s?\b|\b(?:book|reserve)\s+(?:(?:a|an|the)\s+)?(?:meeting\s+|conference\s+)?room\b|^(?:create ticket|book meeting room|new ticket)[\s!.]*$/i;
export function isMenuOrFacilityMessage(text: string): boolean {
    const t = text.trim();
    return MENU_WORDS.test(t) || (FACILITY_REQUEST.test(t) && !/\btasks?\b/i.test(t));
}
// A ticket / room request that arrived while another reply was still being written: never drop it silently.
const HANDOFF_IN_MERGE = 'For a ticket or meeting room, please send that as its own message (or send *menu*).';

/** Optional, for callers that feed the brain text from elsewhere (a voice note). Absent = exactly the old behaviour. */
export interface LiveOptions {
    /** Shown above every reply of this turn (e.g. 🎙️ I heard: "…"). Not remembered in the brain's short memory. */
    replyPrefix?: string;
    /** Where the text came from, recorded in the audit row (e.g. 'voice'). */
    via?: string;
}

interface InFlightTurn {
    phone: string;
    pending: Array<{ text: string; messageId: string | null | undefined }>;
    createdAt: number;
    closing?: boolean;
}
const activeInFlight = new Map<string, InFlightTurn>();

export function resetInFlightQueues(): void {
    activeInFlight.clear();
}

/**
 * Called first for every text message. Not ours → { handled:false } and the old bot answers exactly as before.
 * Ours → the decision is already made; the caller runs `background` AFTER answering the webhook.
 */
export async function claimSmartChat(body: unknown, io?: LiveIO, opts: LiveOptions = {}): Promise<LiveClaim> {
    let cand: ReturnType<typeof extractCandidate>;
    try { cand = extractCandidate(body); } catch { return NOT_HANDLED; }
    if (!cand || cand.mediaClass !== 'text' || !cand.text.trim()) return NOT_HANDLED;
    if (isMenuOrFacilityMessage(cand.text)) return NOT_HANDLED;          // menu, tickets, rooms → the old bot (see above)

    // Zero-delay in-flight merging: if this user already has an active turn running,
    // catch this follow-up message and append it to that turn instead of answering separately.
    const inFlight = activeInFlight.get(cand.phone);
    if (inFlight && !inFlight.closing && Date.now() - inFlight.createdAt < 30_000) {
        inFlight.pending.push({ text: cand.text, messageId: cand.messageId });
        const real = io ?? await defaultLiveIO();
        if (cand.messageId) real.markSeen(cand.messageId);
        return { handled: true };
    } else if (inFlight && (inFlight.closing || Date.now() - inFlight.createdAt >= 30_000)) {
        activeInFlight.delete(cand.phone);
    }

    try {
        const real = io ?? await defaultLiveIO();
        // Group 2 "faster replies" (2026-10-13): reads that do not depend on each other run side by side (they used to run one
        // after another). The same checks, in the same order of meaning: any "no" still means the old bot answers.
        const t0 = Date.now();
        const [departments, employee] = await Promise.all([real.getSmartChatDepartments(), real.getEmployee(cand.phone)]);
        if (departments.size === 0) return NOT_HANDLED;
        if (!employee?.department_id || !departments.has(employee.department_id)) return NOT_HANDLED;
        const [access, config] = await Promise.all([real.checkAccess(employee), real.getConfig()]);
        // Same people as the Task Manager itself, in a department with the switch ON, inside the sandbox while it is ON.
        if (!decideImportEligibility(config, cand.phone, employee, access, departments).ok) return NOT_HANDLED;

        // Read BEFORE this message is stored, so the transcript holds only EARLIER messages (the new one is "message").
        const conversationP = real.readConversation ? real.readConversation(cand.phone).catch(() => [] as string[]) : Promise.resolve([] as string[]);
        const switchesP = Promise.all([
            real.frontDoorOn ? real.frontDoorOn().catch(() => false) : Promise.resolve(false),
            real.teamReportsOn ? real.teamReportsOn().catch(() => false) : Promise.resolve(false),
        ]);
        conversationP.catch(() => undefined); switchesP.catch(() => undefined);
        const [row, facility] = await Promise.all([real.getState(cand.phone), real.facilityActive(cand.phone)]);
        // An older conversation still in progress (a task-list preview, an old confirmation) finishes first. The old bot's IDLE
        // markers do not count (group 3, 2026-10-13): "ACTIVE_SESSION" (set for 30 min by an old "tasks") and the old
        // "1. Tasks / 2. Facility" menu sent everything to the old bot for half an hour — Harsh's "add HR grievance module task
        // also" got the menu. Only a plain "1" / "2" still answers that menu.
        const idleOld = row?.type === 'ACTIVE_SESSION' || (row?.type === 'DISAMBIGUATION' && !/^\s*[12]\s*$/.test(cand.text));
        if (row && row.type !== LIVE_STATE_TYPE && !idleOld) return NOT_HANDLED;
        if (facility) return NOT_HANDLED;                                  // a room / ticket conversation is open
        if (cand.messageId && real.seenBefore(cand.messageId)) return { handled: true }; // repeat delivery of one we already took

        const state = normalizeState(row?.type === LIVE_STATE_TYPE ? row.data : null);   // an old idle marker → start fresh
        // A superuser with a reminder waiting for a reply: their "working on it" / "done" answers THAT request.
        let pending = state.pending; let titles: Record<string, string> = state.titles;
        if (!pending && employee.role === 'superuser') {
            const waiting = await real.openPingPending(employee);
            if (waiting) { pending = waiting.pending; titles = waiting.titles; }
        }
        const conversation = await conversationP;
        const ctx = await real.buildContext(employee, cand.phone, { pending, recent: state.recent, ...(conversation.length ? { conversation } : {}) });
        const [frontDoorSwitch, teamReportsSwitch] = await switchesP;
        const loadMs = Date.now() - t0;
        if (real.beginLearning) await real.beginLearning({ messageId: cand.messageId, phone: cand.phone, text: cand.text, context: ctx }).catch(() => undefined);
        const started = Date.now();
        const phone0 = cand.phone, messageId0 = cand.messageId;

        // Phase 3 "One front door" (switch OFF → skipped entirely): exact commands are answered by code, no AI call.
        const frontDoor = frontDoorSwitch;
        if (frontDoor && !ctx.pending) {
            const cmd = parseExactCommand(cand.text);
            const plan = cmd ? planExact(cmd, ctx) : null;
            if (plan) {
                if (messageId0) real.markSeen(messageId0);
                return {
                    handled: true,
                    background: async () => {
                        const q: InFlightTurn = { phone: phone0, pending: [], createdAt: Date.now() };
                        activeInFlight.set(phone0, q);
                        try {
                            await respondExact({ io: real, employee, phone: phone0, messageId: messageId0, text: cand!.text, ctx, state, plan, started, opts });
                        } finally {
                            activeInFlight.delete(phone0);
                        }
                    }
                };
            }
        }

        // Phase 4 "Team reports" (switch OFF → the domains, and so the AI's instructions, are exactly as before).
        const teamReports = teamReportsSwitch;
        const brainIO = teamReports ? { ...real, brain: { ...real.brain, domains: [tasksDomainWithTeam, facilityDomain] } } : real;
        // Owner 2026-10-14: with "One front door" ON (it provides undo), marking one's own tasks done needs no "Reply YES".
        const policy = { ...DEFAULT_CONFIRM_POLICY, ...(brainIO.brain.policy || {}), confirmCompletions: !frontDoor, confirmCreates: !frontDoor };
        const result = await runBrain(cand.text, ctx, { ...brainIO.brain, policy, skipReply: true });
        if (result.status !== 'ok' || !result.decision || !result.interpretation) {
            await real.audit({ phoneMasked: cand.phone.replace(/\d(?=\d{4})/g, '•'), messageId: cand.messageId ?? null, live: true, status: 'ai_unavailable', fallback: !frontDoor || isExplicitTaskCommand(cand.text), ms: Date.now() - started }, employee).catch(() => undefined);
            // AI down. Front door ON: old exact commands still go to the old bot; anything else gets one short help line (no menu).
            if (!frontDoor || isExplicitTaskCommand(cand.text)) return NOT_HANDLED;
            if (messageId0) real.markSeen(messageId0);
            return { handled: true, background: async () => { try { await real.reply(phone0, prefixedText(opts, AI_DOWN_HELP)); } catch { /* the watchdog covers silence */ } } };
        }
        if (result.decision.outcome === 'HANDOFF') return NOT_HANDLED;                                 // rooms / tickets → facility assistant

        if (cand.messageId) real.markSeen(cand.messageId);
        const phone = cand.phone, text = cand.text, messageId = cand.messageId;
        return {
            handled: true,
            background: async () => {
                const q: InFlightTurn = { phone, pending: [], createdAt: Date.now() };
                activeInFlight.set(phone, q);
                try {
                    await respond({ io: brainIO, employee, phone, text, messageId, ctx, result, state, depth: 0, started, relay: ctx.pending?.kind === 'ping_reply', titles, opts, frontDoor, loadMs });
                } finally {
                    activeInFlight.delete(phone);
                }
            }
        };
    } catch (err) {
        console.warn('[TaskBrainLive] not handled, the old bot answers instead:', err instanceof Error ? err.message : err);
        return NOT_HANDLED;
    }
}

interface Turn {
    io: LiveIO; employee: Employee; phone: string; text: string; messageId: string | null | undefined;
    ctx: BrainContext; result: BrainResult; state: LiveState; depth: number; started: number;
    /** The message is a reply to a request: tell the people who gave those tasks. */
    relay: boolean; titles: Record<string, string>;
    opts?: LiveOptions;
    /** Phase 3: remember executed changes so "undo" can reverse them (only while the front door is on). */
    frontDoor?: boolean;
    /** Group 2: how long loading the person's data took (ms), for the per-step timings in the audit row. */
    loadMs?: number;
}

const prefixedText = (opts: LiveOptions | undefined, text: string): string => (opts?.replyPrefix ? `${opts.replyPrefix}\n\n${text}` : text);
const prefixed = (t: Turn, text: string): string => prefixedText(t.opts, text);

/**
 * Merges any rapid follow-up messages sent by the same user while this turn was in-flight,
 * combining them into a single coherent response with zero extra latency on single messages.
 */
async function drainInFlight(
    queue: InFlightTurn,
    phone: string,
    employee: Employee,
    io: LiveIO,
    currentCtx: BrainContext,
    currentState: LiveState,
    initialReply: string
): Promise<{ reply: string; nextState: LiveState }> {
    let combinedReply = initialReply;
    let state = currentState;
    let ctx = currentCtx;
    let anyChange = !!currentState.lastChange;

    const hadUndoHint = combinedReply.includes(UNDO_HINT);
    if (hadUndoHint) {
        combinedReply = combinedReply.split('\n\n' + UNDO_HINT).join('').trim();
    }

    while (queue.pending.length > 0) {
        const nextMsg = queue.pending.shift()!;
        try {
            ctx = await io.buildContext(employee, phone, {
                pending: state.pending,
                recent: state.recent,
            });
        } catch { /* use existing ctx */ }

        const cmd = parseExactCommand(nextMsg.text);
        if (cmd) {
            const plan = planExact(cmd, ctx);
            if (plan?.kind === 'act') {
                const exec = await executeAction(plan.action, ctx, io.exec);
                const summary = exec?.summary || 'Marked task as done.';
                const piece = [summary, exec?.values?.details].filter(Boolean).join('\n\n');
                combinedReply = `${combinedReply}\n\n${piece}`;
                const change = changeFromAction(plan.action, ctx);
                state = { ...EMPTY, recent: remember(state.recent, `exact command: ${clip(nextMsg.text, 40)}`, summary), ...carry(state, change) };
                if (change) anyChange = true;
            } else if (plan?.kind === 'reply') {
                combinedReply = `${combinedReply}\n\n${plan.text}`;
                state = { ...state, recent: remember(state.recent, `exact command: ${clip(nextMsg.text, 40)}`, plan.text) };
            } else if (cmd.kind === 'done') {
                const note = `(Note: Task ${cmd.numbers.join(', ')} was not found on your open tasks list.)`;
                combinedReply = `${combinedReply}\n\n${note}`;
                state = { ...state, recent: remember(state.recent, `exact command: ${clip(nextMsg.text, 40)}`, note) };
            } else if (cmd.kind === 'done_all') {
                const note = `(Note: You have no open tasks left to complete.)`;
                combinedReply = `${combinedReply}\n\n${note}`;
                state = { ...state, recent: remember(state.recent, `exact command: ${clip(nextMsg.text, 40)}`, note) };
            }
        } else {
            try {
                const brainResult = await runBrain(nextMsg.text, ctx, { ...io.brain, policy: DEFAULT_CONFIRM_POLICY, skipReply: true });
                if (brainResult.status === 'ok' && brainResult.decision?.outcome === 'HANDOFF') {
                    combinedReply = `${combinedReply}\n\n${HANDOFF_IN_MERGE}`;
                } else if (brainResult.status === 'ok' && brainResult.decision && brainResult.interpretation) {
                    let execResult: ExecutionResult | null = null;
                    if (brainResult.decision.outcome === 'ACT' && needsExecution(brainResult.decision.action)) {
                        execResult = await executeAction(brainResult.decision.action, ctx, io.exec);
                        const change = changeFromAction(brainResult.decision.action, ctx);
                        state = { ...state, ...carry(state, change) };
                        if (change) anyChange = true;
                    }
                    const nextRep = await composeBrainReply({
                        text: nextMsg.text,
                        ctx,
                        interpretation: brainResult.interpretation,
                        decision: brainResult.decision,
                        deps: io.brain,
                        result: execResult ?? undefined,
                    });
                    if (nextRep?.text) {
                        combinedReply = `${combinedReply}\n\n${nextRep.text}`;
                        state = { ...state, recent: remember(state.recent, brainResult.interpretation.summary || 'a message', nextRep.text) };
                    }
                }
            } catch { /* ignore fallback */ }
        }
    }

    if ((anyChange || hadUndoHint) && !combinedReply.includes(UNDO_HINT)) {
        combinedReply = `${combinedReply}\n\n${UNDO_HINT}`;
    }

    return { reply: combinedReply, nextState: state };
}

/**
 * Phase 3: carry out an exact command ("done 2", "done all", "tasks", "undo") — no AI call. Never throws: a problem becomes
 * one honest apology. The change goes through the same permission-checked functions; "done" is remembered for "undo".
 */
async function respondExact(t: {
    io: LiveIO; employee: Employee; phone: string; messageId: string | null | undefined; text: string;
    ctx: BrainContext; state: LiveState; plan: ExactPlan; started: number; opts?: LiveOptions;
}): Promise<void> {
    const { io, employee, phone, ctx, state, plan } = t;
    try {
        let reply: string; let next: LiveState; let kind: string; let executed: string | null = null;
        if (plan.kind === 'act') {
            const change = changeFromAction(plan.action, ctx);
            const exec = await executeAction(plan.action, ctx, io.exec);
            executed = exec?.summary ?? null;
            reply = [exec?.summary, exec?.values?.details, change ? UNDO_HINT : null].filter(Boolean).join('\n\n') || 'Done.';
            next = { ...EMPTY, recent: state.recent, ...carry(state, change) };
            kind = plan.action.type;
        } else if (plan.kind === 'undo') {
            const r = io.undo ? await runUndo(state.lastChange ?? null, employee.id, io.undo) : { text: "There's nothing to undo right now.", undone: 0 };
            reply = r.text; executed = r.undone ? `Undid ${r.undone}` : null;
            next = { ...EMPTY, recent: state.recent, lastChange: null };   // an undo is used up, whatever happened
            kind = 'undo';
        } else {
            reply = plan.text;
            next = { ...state };
            kind = 'view';
        }

        const inFlight = activeInFlight.get(phone);
        if (inFlight && inFlight.pending.length > 0) {
            const drained = await drainInFlight(inFlight, phone, employee, io, ctx, next, reply);
            reply = drained.reply;
            next = drained.nextState;
        }
        if (inFlight) inFlight.closing = true;

        if (io.observeLearning) await io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, exact: kind, outcome: plan.kind === 'undo' ? 'ACT' : null, reply }).catch(() => undefined);
        await io.setState(phone, { ...next, recent: remember(next.recent, `exact command: ${clip(t.text, 40)}`, reply) });
        await io.reply(phone, prefixedText(t.opts, reply));
        await io.audit({ phoneMasked: phone.replace(/\d(?=\d{4})/g, '•'), messageId: t.messageId ?? null, live: true, exact: kind, executed, ms: Date.now() - t.started, ...(t.opts?.via ? { via: t.opts.via } : {}) }, employee);
    } catch (err) {
        console.warn('[TaskBrainLive] exact command failed:', err instanceof Error ? err.message : err);
        if (io.observeLearning) await io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, apology: true, reply: SORRY_RETRY }).catch(() => undefined);
        try { await io.reply(phone, SORRY_RETRY); } catch { /* nothing more to do */ }
    }
}

/** The slow part. Never throws: a problem becomes one honest apology. */
async function respond(t: Turn): Promise<void> {
    try {
        await handle(t);
    } catch (err) {
        console.warn('[TaskBrainLive] failed while answering:', err instanceof Error ? err.message : err);
        if (t.io.observeLearning) await t.io.observeLearning({ messageId: t.messageId, phone: t.phone, text: t.text, context: t.ctx, apology: true, reply: SORRY_RETRY }).catch(() => undefined);
        try { await t.io.reply(t.phone, SORRY_RETRY); } catch { /* nothing more to do */ }
    }
}

const GENERIC_LOST = 'Sorry, I lost track of what we were doing. What would you like to do?';

async function handle(t: Turn): Promise<void> {
    const { io, employee, phone, ctx } = t;
    const interp = t.result.interpretation!;
    let decision = t.result.decision!;

    const say = async (result: BrainResult, exec: ExecutionResult | null, next: LiveState | 'clear', extra: Record<string, unknown> = {}) => {
        const r0 = Date.now();
        const reply = await composeBrainReply({ text: t.text, ctx, interpretation: result.interpretation!, decision: result.decision!, deps: io.brain, result: exec ?? undefined });
        const s0 = Date.now();
        let finalReplyText = reply?.text ?? null;
        let finalNext: LiveState | 'clear' = next;
        const inFlight = activeInFlight.get(phone);
        if (inFlight && inFlight.pending.length > 0 && finalReplyText) {
            const baseState = finalNext === 'clear' ? EMPTY : finalNext;
            const drained = await drainInFlight(inFlight, phone, employee, io, ctx, baseState, finalReplyText);
            finalReplyText = drained.reply;
            finalNext = drained.nextState;
        }
        if (inFlight) inFlight.closing = true;

        // Owner 2026-10-19: remember the exact question asked, so the next reply is read as its answer.
        if (finalNext !== 'clear' && finalNext.pending?.kind === 'draft' && !finalNext.pending.question && finalReplyText) {
            finalNext = { ...finalNext, pending: { ...finalNext.pending, question: questionOf(finalReplyText) } };
        }
        // Group 2: the learning note and saving the conversation do not depend on each other → side by side. The state is
        // still saved BEFORE the reply is sent, so a quick "yes" always finds the question.
        await Promise.all([
            io.observeLearning ? io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, intent: result.interpretation!.intent, outcome: result.decision!.outcome, previousOutcome: t.state.lastOutcome ?? null, interpretation: { intent: result.interpretation!.intent, outcome: result.decision!.outcome, summary: result.interpretation!.summary }, reply: reply?.text ?? null }).catch(() => undefined) : undefined,
            finalNext === 'clear' ? io.clearState(phone) : io.setState(phone, { ...finalNext, lastOutcome: result.decision!.outcome, recent: remember(t.state.recent, result.interpretation!.summary || 'a message', finalReplyText) }),
        ]);
        const w0 = Date.now();
        if (finalReplyText) await io.reply(phone, prefixed(t, finalReplyText));
        // Group 2: how long each step took (ms) — times only, never content. Read on the Bot health numbers.
        const steps = { load: t.loadMs ?? null, understand: result.trace.fastPath ? 0 : result.trace.interpretMs, act: extra.actMs ?? null, reply: s0 - r0, save: w0 - s0, send: Date.now() - w0 };
        const { actMs: _actMs, ...rest } = extra; void _actMs;
        await io.audit({ ...shadowDetails({ phone, messageId: t.messageId, messageChars: t.text.length, result: { ...result, reply: (reply && finalReplyText) ? { ...reply, text: finalReplyText } : reply }, ms: Date.now() - t.started }), steps, live: true, executed: exec?.summary ?? null, ...(t.opts?.via ? { via: t.opts.via } : {}), ...rest }, employee);
    };

    // ── Owner 2026-10-21: the answer to a suggested task ("Did you want to add this task?") ────────────────
    const suggested = t.depth === 0 && t.state.pending?.kind === 'draft' ? t.state.pending.suggested : undefined;
    const saveNow = async (action: Action) => {
        const change = t.frontDoor ? changeFromAction(action, ctx) : null;     // read BEFORE it changes (for undo)
        const a0 = Date.now();
        const exec = await executeAction(action, ctx, io.exec, { relay: false, titles: {} });
        return say({ ...t.result, decision: { outcome: 'ACT', action } }, exec, { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, change) : {}) }, { suggestedSaved: true, actMs: Date.now() - a0 });
    };
    if (suggested && t.frontDoor && isYesToSuggestion(t.text)) {
        // "yes" / "add task" / "for me" → their own list, straight away (undo for 10 minutes).
        return saveNow({ type: 'create_tasks', assigneeId: ctx.sender.id, tasks: [{ title: suggested, details: null }], date: ctx.today });
    }
    if (suggested && t.frontDoor && decision.outcome === 'CONFIRM') {
        // "assign it to Neeti" → the brain read the whole request; when it is clear (every task is the suggested one, every
        // person resolved and allowed), it is saved straight away instead of asking again.
        const a = decision.action;
        const creates = a.type === 'create_tasks' ? [a] : a.type === 'batch' && !a.unclear.length && a.actions.every(x => x.type === 'create_tasks') ? a.actions as Array<Extract<Action, { type: 'create_tasks' }>> : [];
        const fromSuggestion = creates.length > 0 && creates.every(c => c.tasks.length > 0 && c.tasks.every(x => isGrounded(x.title, suggested)));
        if (fromSuggestion) return saveNow(a);
    }
    if (t.depth === 0 && decision.outcome === 'CLARIFY' && SUGGEST_REASONS.has(decision.reason)) {
        const words = draftRequest(t.state.pending, t.text);
        const title = suggested ?? (ADD_WORDS.test(words) && !ASSIGN_WORDS.test(words) ? suggestedTitle(words) : null);
        if (title) {
            decision = { outcome: 'CLARIFY', reason: 'suggest_add', options: [], detail: title };
            const next: LiveState = { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, null) : {}),
                pending: { kind: 'draft', request: `Add task: ${title}`, question: SUGGEST_QUESTION, at: new Date().toISOString(), suggested: title } };
            return say({ ...t.result, decision }, null, next);
        }
    }

    // ── an answer to a question the bot asked ───────────────────────────────
    if (decision.outcome === 'ACT' && decision.action.type === 'answer_pending') {
        let a = decision.action;
        if (a.answer === 'no') return say(t.result, null, 'clear');
        // Owner 2026-10-20 (Sanil sent his request again and it was saved as if he had said yes): only a SHORT reply can be a
        // yes. A longer message is a new version of the request → re-read with it (a new preview), or ask for a clear yes.
        if (a.answer === 'yes' && t.state.action && !isShortReply(t.text)) {
            if (t.depth === 0 && t.state.originalSummary) a = { ...a, answer: 'edit', instruction: t.text };
            else { await io.reply(phone, prefixed(t, 'Please reply *yes* to go ahead, or *no* to cancel.')); return; }
        }
        if (a.answer === 'yes' && t.state.action) {
            const change = t.frontDoor ? changeFromAction(t.state.action, ctx) : null;   // read BEFORE it changes
            const a0 = Date.now();
            const exec = await executeAction(t.state.action, ctx, io.exec, { relay: t.state.relay, titles: t.state.titles });
            return say(t.result, exec, { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, change) : {}) }, { confirmedAction: t.state.action.type, actMs: Date.now() - a0 });
        }
        if ((a.answer === 'pick' || a.answer === 'edit') && t.depth === 0 && t.state.originalSummary) {
            const label = a.answer === 'pick' ? t.state.pickOptions[(a.pick ?? 0) - 1] : null;
            if (a.answer === 'edit' || label) {
                // Resume with the original request plus the person's choice or change — the brain then proposes the new version.
                const message = a.answer === 'pick' ? `${t.state.originalSummary}. Specifically: ${label}` : `${t.state.originalSummary}. Change of mind: ${a.instruction}`;
                const waiting = t.state.relay ? await io.openPingPending(employee) : null;
                const ctx2: BrainContext = { ...ctx, pending: waiting?.pending ?? null };
                const again = await runBrain(message, ctx2, { ...io.brain, policy: { ...DEFAULT_CONFIRM_POLICY, ...(io.brain.policy || {}), confirmCompletions: !t.frontDoor, confirmCreates: !t.frontDoor }, skipReply: true });
                if (again.status === 'ok' && again.decision && again.interpretation && again.decision.outcome !== 'HANDOFF') {
                    return handle({ ...t, text: message, ctx: ctx2, result: again, state: { ...t.state, pending: null, action: null, pickOptions: [] }, depth: 1, relay: !!waiting, titles: waiting?.titles ?? {} });
                }
            }
        }
        await io.clearState(phone);
        await io.reply(phone, prefixed(t, GENERIC_LOST));
        return;
    }

    // ── everything else: carry out if it is a read / a note, then reply and remember ────
    let exec: ExecutionResult | null = null;
    let change: LastChange | null = null;
    let actMs: number | null = null;
    if (decision.outcome === 'ACT' && needsExecution(decision.action)) {
        if (t.frontDoor) change = changeFromAction(decision.action, ctx);              // read BEFORE it changes
        const a0 = Date.now();
        exec = await executeAction(decision.action, ctx, io.exec, { relay: t.relay, titles: t.titles });
        actMs = Date.now() - a0;
    }

    const next: LiveState = { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, change) : {}) };
    if (decision.outcome === 'CONFIRM') {
        next.pending = { kind: 'confirm', summary: interp.summary || 'a change to your tasks' };
        next.action = decision.action;
        // Owner 2026-10-19: for new tasks keep the person's OWN words (the whole list), so "remove 3" or "make it tomorrow"
        // re-reads every line, not just a one-line summary of them.
        // Owner 2026-10-20: a note too, so "change the note to …" re-reads their exact words.
        next.originalSummary = (decision.action.type === 'create_tasks' || decision.action.type === 'batch' || decision.action.type === 'add_note') && t.depth === 0
            ? draftRequest(t.state.pending, t.text) : (interp.summary || null);
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    } else if (decision.outcome === 'CLARIFY' && decision.options.length && (decision.reason === 'several_people_match' || decision.reason === 'several_tasks_match')) {
        next.pending = { kind: 'pick', options: decision.options };
        next.pickOptions = decision.options;
        // Owner 2026-10-20: "which Onboarding?" for a note keeps the person's own words, so the note text survives the choice.
        next.originalSummary = interp.intent === 'add_note' && t.depth === 0 ? draftRequest(t.state.pending, t.text) : (interp.summary || null);
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    } else if (decision.outcome === 'CLARIFY' && DRAFT_REASONS.has(decision.reason) && t.depth === 0
        && (decision.reason !== 'unknown_intent' || t.state.pending?.kind === 'draft' || t.text.trim().split(/\s+/).length >= 3)) {
        // Owner 2026-10-19: the bot asked a question about this request → keep the request, so the answer can finish it.
        next.pending = { kind: 'draft', request: draftRequest(t.state.pending, t.text), question: null, at: new Date().toISOString(),
            // Owner 2026-10-21: a suggested task stays suggested while the bot asks about its person ("which Neeti?").
            ...(t.state.pending?.kind === 'draft' && t.state.pending.suggested ? { suggested: t.state.pending.suggested } : {}) };
        next.relay = false; next.titles = {};
    } else if (t.state.pending && ((decision.outcome === 'CLARIFY' && (decision.reason === 'unsure_answer' || decision.reason === 'bad_pick'))
        || (decision.outcome === 'ACT' && decision.action.type === 'chat')
        // Owner 2026-10-19: a side question ("what are my tasks?") does not drop an unfinished request either.
        || (t.state.pending.kind === 'draft' && decision.outcome === 'ACT' && (decision.action.type === 'view_tasks' || decision.action.type === 'find_tasks')))) {
        // A side remark ("thanks", "what do you mean?") does not cancel a question that is still waiting.
        // Part B: an unclear answer to a question that still stands keeps that question (and its change) open, so the next
        // clear "yes" / "2" still works. Before, the question was dropped and the yes found nothing waiting.
        Object.assign(next, { pending: t.state.pending, action: t.state.action, originalSummary: t.state.originalSummary, pickOptions: t.state.pickOptions, relay: t.state.relay, titles: t.state.titles });
    }
    return say(t.result, exec, next, actMs !== null ? { actMs } : {});
}

// ── the real wiring (loaded lazily so tests never touch the database) ───────

const seen = new Map<string, number>();
const SEEN_TTL_MS = 15 * 60 * 1000;

export async function defaultLiveIO(): Promise<LiveIO> {
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { WorkspaceService, todayIST } = await import('../WorkspaceService');
    const { PermissionService } = await import('../PermissionService');
    const { SuperuserInsights } = await import('../SuperuserInsights');
    const { getConversationRoutingState } = await import('@/backend/lib/whatsapp/interpreter/context');
    const { buildBrainContext } = await import('./context');
    const { engyBrainLlm } = await import('./llm');
    const { SuperuserPingService } = await import('../SuperuserPingService');
    const { defaultRelayIO, relayToAssigners } = await import('./relay');
    const { readTranscript } = await import('../ConversationMemory');
    const { botSwitchOn } = await import('../BotSwitches');
    const { activePromptSections, beginObservation, observeTurn } = await import('../BotLearningService');
    const llm = engyBrainLlm();
    // Group 2: two independent setup reads side by side.
    const [relayIO, promptSections] = await Promise.all([defaultRelayIO(), activePromptSections()]);

    const STATUS: Record<string, string> = { pending: 'To do', in_progress: 'In progress', completed: 'Done' };

    const exec: ExecIO = {
        async setStatus(actorId, taskId, status, opts) { await WorkspaceService.setStatus(actorId, { taskId, status, notifyGiver: opts?.notifyGiver }); },
        async notifyCompleted(_actorId, taskIds) { await WorkspaceService.notifyCompleted(taskIds); },
        async assign(actorId, i) { await WorkspaceService.assign(actorId, { targetUserId: i.targetUserId, title: i.title, description: i.description, date: i.date, notify: i.notify, note: i.note }); },
        async alertAssigned(actorId, targetUserId, titles, date) { await WorkspaceService.alertAssigned(actorId, targetUserId, titles, date); },
        async handOver(actorId, taskId, toId, note) { const r = await WorkspaceService.handOver(actorId, { taskId, targetUserId: toId, note }); return { toName: r.toName }; },
        async deleteTask(actorId, taskId) { await WorkspaceService.deleteTask(actorId, { taskId, via: 'whatsapp' }); },
        async renameTask(actorId, taskId, title) { await WorkspaceService.renameTask(actorId, { taskId, title, via: 'whatsapp' }); },
        async addNote(actorId, taskId, note) { await WorkspaceService.addNote(actorId, { taskId, note, via: 'whatsapp' }); },
        remindTasks: (actorId, taskIds) => WorkspaceService.remindTasks(actorId, { taskIds, via: 'whatsapp' }),
        async setLocked(actorId, taskId, locked) { await WorkspaceService.setLocked(actorId, { taskId, locked }); },
        async readPerson(actorId, personId) {
            const [actor, target] = await Promise.all([TaskDatabaseService.getEmployeeById(actorId), TaskDatabaseService.getEmployeeById(personId)]);
            if (!actor || !target) return null;
            const allowed = actor.role === 'superuser' || target.id === actor.id || (await PermissionService.visibleAndAssignable(actor, [target])).length === 1;
            if (!allowed) return null;
            const rows = await TaskDatabaseService.getDailyAssignments({ employeeId: personId, date: todayIST() });
            return rows.length ? rows.map((r, i) => `${i + 1}. ${r.title} (${STATUS[r.status] ?? r.status})`).join('\n') : 'No tasks today.';
        },
        async readTeam(actorId, list) {
            // "My team" = the people this person may give work to — the same rule assigning uses, re-checked here.
            const actor = await TaskDatabaseService.getEmployeeById(actorId);
            if (!actor) return null;
            // Only departments where the Task Manager is switched ON (owner 2026-10-12): a superuser no longer sees all 86 people.
            const [pool, active] = await Promise.all([TaskDatabaseService.getAllEmployees(), TaskAccessService.activeDepartmentIds()]);
            const team = (await PermissionService.visibleAndAssignable(actor, pool))
                .filter(e => e.id !== actor.id && e.active !== false && !!e.department_id && active.has(e.department_id)).slice(0, 40);
            if (!team.length) return null;
            const date = todayIST();
            // Owner 2026-10-21: each person's numbered list (today + carried forward, the same list they see), not today's only.
            const members = await Promise.all(team.map(async e => ({
                name: e.name,
                tasks: (await TaskDatabaseService.getNumberedList({ employeeId: e.id, date, departmentId: e.department_id ?? null }))
                    .map(r => ({ status: r.status, isCarriedForward: !!r.isCarriedForward, title: r.title, assignedDate: r.assigned_date })),
            })));
            return list ? buildTeamTaskList(members) : buildTeamReport(members);
        },
        async findTasks(actorId, q) {
            // Flexible "look up tasks": the permission rule is applied AGAIN here, at the moment of reading — your own tasks,
            // people you may give work to (superuser: everyone), only in departments where the Task Manager is ON.
            const actor = await TaskDatabaseService.getEmployeeById(actorId);
            if (!actor) return null;
            const [pool, active] = await Promise.all([TaskDatabaseService.getAllEmployees(), TaskAccessService.activeDepartmentIds()]);
            const inActive = (e: Employee) => !!e.department_id && active.has(e.department_id);
            const seeable = actor.role === 'superuser' ? pool.filter(inActive) : (await PermissionService.visibleAndAssignable(actor, pool)).filter(inActive);
            const allowed = new Set([actor.id, ...seeable.map(e => e.id)]);
            const ids = q.employeeIds.filter(id => allowed.has(id));
            if (!ids.length) return null;
            const statuses = q.overdueOnly || q.status === 'open' ? ['pending', 'in_progress'] as const
                : q.status === 'not_started' ? ['pending'] as const : q.status === 'in_progress' ? ['in_progress'] as const : q.status === 'done' ? ['completed'] as const : null;
            return TaskDatabaseService.searchAssignments({
                employeeIds: ids, assignedBy: q.givenById, from: q.from, to: q.to, dateField: q.dateField, statuses: statuses ? [...statuses] : null,
                assignedBefore: q.overdueOnly ? q.today : null, assignedOnOrBefore: q.minDaysOld ? addDays(q.today, -q.minDaysOld) : null,
                kind: q.kind, words: q.words, newestFirst: q.sort === 'newest', limit: FIND_MAX_ROWS,
            }) as unknown as Promise<FoundTask[]>;
        },
        async readInsight(actorId, kind, subject) {
            const actor = await TaskDatabaseService.getEmployeeById(actorId);
            if (!actor || actor.role !== 'superuser') throw new Error('Company-wide questions are only available to superusers.');
            const r = await SuperuserInsights.run({ actor, decision: { kind, subject } });
            return r.kind === 'reply' ? r.text : r.prompt;
        },
        async relay(actorId, input) {
            const actor = await relayIO.getPerson(actorId);
            return actor ? relayToAssigners({ actor, ...input }, relayIO) : { told: [], couldNot: [] };
        },
    };

    return {
        getSmartChatDepartments: async () => (await TaskAccessService.getSmartChatDepartments()).departments,
        getConfig: () => TaskDatabaseService.getTestingConfig(),
        getEmployee: phone => TaskDatabaseService.getEmployeeByPhone(phone),
        checkAccess: e => TaskAccessService.check({ userId: e.id, departmentId: e.department_id }),
        facilityActive: async phone => (await getConversationRoutingState(phone)).facilityActive,
        async getState(phone) {
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            return c ? { type: c.context_type, data: c.context_data } : null;
        },
        async setState(phone, state) {
            await TaskDatabaseService.setConversationContext({ phone, system: 'TASK_MANAGER', contextType: LIVE_STATE_TYPE, contextData: state as unknown as Record<string, unknown>, ttlMinutes: STATE_TTL_MIN });
        },
        async clearState(phone) {
            // Only ever clear OUR state, never another conversation's.
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            if (c && c.context_type === LIVE_STATE_TYPE) await TaskDatabaseService.clearConversationContext(phone, 'TASK_MANAGER');
        },
        async openPingPending(e) {
            const tasks = await SuperuserPingService.openPingTasksFor(e.id);
            if (!tasks.length) return null;
            const assigners = [...new Set(tasks.map(x => x.assignerName))];
            const many = assigners.length > 1;
            const titles = Object.fromEntries(tasks.map(x => [x.id, many ? `${x.title} (from ${x.assignerName})` : x.title]));
            return { pending: { kind: 'ping_reply', assigner: assigners.join(' and '), taskIds: tasks.map(x => x.id), taskTitles: tasks.map(x => titles[x.id]), assigners: many ? assigners : undefined }, titles };
        },
        buildContext: (e, phone, opts) => buildBrainContext(e, phone, opts),
        readConversation: phone => readTranscript(phone),
        frontDoorOn: () => botSwitchOn('frontDoor'),
        teamReportsOn: () => botSwitchOn('teamReports'),
        undo: {
            currentStatus: taskId => WorkspaceService.taskStatus(taskId),
            async setStatus(actorId, taskId, status) { await WorkspaceService.setStatus(actorId, { taskId, status }); },
            findCreated: (actorId, assigneeId, title, date, since) => WorkspaceService.findRecentlyCreated(actorId, assigneeId, title, date, since),
            async deleteTask(actorId, taskId) { await WorkspaceService.deleteTask(actorId, { taskId }); },
        },
        brain: { llm, promptSections },
        beginLearning: beginObservation,
        observeLearning: observeTurn,
        exec,
        // Owner 2026-10-21: WhatsApp takes about 4,000 characters per message; a longer reply (a big team's task list) goes as
        // a few messages, split between lines, in order.
        async reply(phone, text) { for (const part of splitLongReply(text)) await TaskMessagingService.sendFreeformReply(phone, part); },
        async audit(details, employee) { await TaskDatabaseService.logAudit({ eventType: 'brain_live', actorId: employee.id, details }); },
        seenBefore: id => { const t = seen.get(id); return !!t && Date.now() - t < SEEN_TTL_MS; },
        markSeen: id => {
            const now = Date.now();
            seen.set(id, now);
            if (seen.size > 1000) seen.forEach((ts, k) => { if (now - ts > SEEN_TTL_MS) seen.delete(k); });
        },
    };
}
