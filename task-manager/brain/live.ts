import type { AccessDecision } from '../TaskAccessService';
import { decideImportEligibility, extractCandidate } from '../TaskImportInbound';
import type { Employee, TestingConfig } from '../types';
import type { ExecutionResult } from './domain';
import { ExecIO, executeAction, needsExecution } from './execute';
import { BrainDeps, BrainResult, composeBrainReply, runBrain } from './index';
import { shadowDetails } from './shadow';
import { addDays, clip } from './text';
import { FIND_MAX_ROWS, type FoundTask } from './findTasks';
import type { Action, BrainContext, PendingState } from './types';
import { AI_DOWN_HELP, ExactPlan, LastChange, UNDO_HINT, UndoIO, changeFromAction, normalizeChange, parseExactCommand, planExact, runUndo } from './frontDoor';
import { isExplicitTaskCommand } from '@/backend/lib/whatsapp/interpreter/coordinator.mjs';
import { tasksDomainWithTeam } from './tasksDomain';
import { facilityDomain } from './facilityDomain';
import { buildTeamReport } from './teamReport';

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

const EMPTY: LiveState = { recent: [], pending: null, action: null, originalSummary: null, pickOptions: [], relay: false, titles: {} };

export function normalizeState(data: unknown): LiveState {
    if (!data || typeof data !== 'object') return { ...EMPTY };
    const value = data as Record<string, unknown>;
    const pending = value.pending as Record<string, unknown> | null;
    const action = value.action as Record<string, unknown> | null;
    return {
        recent: Array.isArray(value.recent) ? value.recent.filter((s: unknown) => typeof s === 'string').slice(-4) : [],
        pending: pending && ['confirm', 'pick', 'preview', 'ping_reply'].includes(String(pending.kind)) ? pending as unknown as PendingState : null,
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
const carry = (state: LiveState, change: LastChange | null | undefined): Partial<LiveState> =>
    (change ?? state.lastChange) ? { lastChange: change ?? state.lastChange } : {};

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
    observeLearning?(input: { messageId?: string | null; phone?: string | null; text: string; context: BrainContext; intent?: string | null; outcome?: string | null; previousOutcome?: string | null; exact?: string | null; apology?: boolean; interpretation?: unknown }): Promise<void>;
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

/** Optional, for callers that feed the brain text from elsewhere (a voice note). Absent = exactly the old behaviour. */
export interface LiveOptions {
    /** Shown above every reply of this turn (e.g. 🎙️ I heard: "…"). Not remembered in the brain's short memory. */
    replyPrefix?: string;
    /** Where the text came from, recorded in the audit row (e.g. 'voice'). */
    via?: string;
}

/**
 * Called first for every text message. Not ours → { handled:false } and the old bot answers exactly as before.
 * Ours → the decision is already made; the caller runs `background` AFTER answering the webhook.
 */
export async function claimSmartChat(body: unknown, io?: LiveIO, opts: LiveOptions = {}): Promise<LiveClaim> {
    let cand: ReturnType<typeof extractCandidate>;
    try { cand = extractCandidate(body); } catch { return NOT_HANDLED; }
    if (!cand || cand.mediaClass !== 'text' || !cand.text.trim()) return NOT_HANDLED;

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
                return { handled: true, background: () => respondExact({ io: real, employee, phone: phone0, messageId: messageId0, text: cand!.text, ctx, state, plan, started, opts }) };
            }
        }

        // Phase 4 "Team reports" (switch OFF → the domains, and so the AI's instructions, are exactly as before).
        const teamReports = teamReportsSwitch;
        const brainIO = teamReports ? { ...real, brain: { ...real.brain, domains: [tasksDomainWithTeam, facilityDomain] } } : real;
        const result = await runBrain(cand.text, ctx, { ...brainIO.brain, skipReply: true });
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
        return { handled: true, background: () => respond({ io: brainIO, employee, phone, text, messageId, ctx, result, state, depth: 0, started, relay: ctx.pending?.kind === 'ping_reply', titles, opts, frontDoor, loadMs }) };
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
        if (io.observeLearning) await io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, exact: kind, outcome: plan.kind === 'undo' ? 'ACT' : null }).catch(() => undefined);
        await io.setState(phone, { ...next, recent: remember(next.recent, `exact command: ${clip(t.text, 40)}`, reply) });
        await io.reply(phone, prefixedText(t.opts, reply));
        await io.audit({ phoneMasked: phone.replace(/\d(?=\d{4})/g, '•'), messageId: t.messageId ?? null, live: true, exact: kind, executed, ms: Date.now() - t.started, ...(t.opts?.via ? { via: t.opts.via } : {}) }, employee);
    } catch (err) {
        console.warn('[TaskBrainLive] exact command failed:', err instanceof Error ? err.message : err);
        if (io.observeLearning) await io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, apology: true }).catch(() => undefined);
        try { await io.reply(phone, 'Sorry, something went wrong on my side. Please try that again in a moment.'); } catch { /* nothing more to do */ }
    }
}

/** The slow part. Never throws: a problem becomes one honest apology. */
async function respond(t: Turn): Promise<void> {
    try {
        await handle(t);
    } catch (err) {
        console.warn('[TaskBrainLive] failed while answering:', err instanceof Error ? err.message : err);
        if (t.io.observeLearning) await t.io.observeLearning({ messageId: t.messageId, phone: t.phone, text: t.text, context: t.ctx, apology: true }).catch(() => undefined);
        try { await t.io.reply(t.phone, 'Sorry, something went wrong on my side. Please try that again in a moment.'); } catch { /* nothing more to do */ }
    }
}

const GENERIC_LOST = 'Sorry, I lost track of what we were doing. What would you like to do?';

async function handle(t: Turn): Promise<void> {
    const { io, employee, phone, ctx } = t;
    const interp = t.result.interpretation!;
    const decision = t.result.decision!;

    const say = async (result: BrainResult, exec: ExecutionResult | null, next: LiveState | 'clear', extra: Record<string, unknown> = {}) => {
        const r0 = Date.now();
        const reply = await composeBrainReply({ text: t.text, ctx, interpretation: result.interpretation!, decision: result.decision!, deps: io.brain, result: exec ?? undefined });
        const s0 = Date.now();
        // Group 2: the learning note and saving the conversation do not depend on each other → side by side. The state is
        // still saved BEFORE the reply is sent, so a quick "yes" always finds the question.
        await Promise.all([
            io.observeLearning ? io.observeLearning({ messageId: t.messageId, phone, text: t.text, context: ctx, intent: result.interpretation!.intent, outcome: result.decision!.outcome, previousOutcome: t.state.lastOutcome ?? null, interpretation: { intent: result.interpretation!.intent, outcome: result.decision!.outcome, summary: result.interpretation!.summary } }).catch(() => undefined) : undefined,
            next === 'clear' ? io.clearState(phone) : io.setState(phone, { ...next, lastOutcome: result.decision!.outcome, recent: remember(t.state.recent, result.interpretation!.summary || 'a message', reply?.text ?? null) }),
        ]);
        const w0 = Date.now();
        if (reply) await io.reply(phone, prefixed(t, reply.text));
        // Group 2: how long each step took (ms) — times only, never content. Read on the Bot health numbers.
        const steps = { load: t.loadMs ?? null, understand: result.trace.fastPath ? 0 : result.trace.interpretMs, act: extra.actMs ?? null, reply: s0 - r0, save: w0 - s0, send: Date.now() - w0 };
        const { actMs: _actMs, ...rest } = extra; void _actMs;
        await io.audit({ ...shadowDetails({ phone, messageId: t.messageId, messageChars: t.text.length, result: { ...result, reply }, ms: Date.now() - t.started }), steps, live: true, executed: exec?.summary ?? null, ...(t.opts?.via ? { via: t.opts.via } : {}), ...rest }, employee);
    };

    // ── an answer to a question the bot asked ───────────────────────────────
    if (decision.outcome === 'ACT' && decision.action.type === 'answer_pending') {
        const a = decision.action;
        if (a.answer === 'no') return say(t.result, null, 'clear');
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
                const again = await runBrain(message, ctx2, { ...io.brain, skipReply: true });
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
        next.originalSummary = interp.summary || null;
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    } else if (decision.outcome === 'CLARIFY' && decision.options.length && (decision.reason === 'several_people_match' || decision.reason === 'several_tasks_match')) {
        next.pending = { kind: 'pick', options: decision.options };
        next.pickOptions = decision.options;
        next.originalSummary = interp.summary || null;
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    } else if (t.state.pending && ((decision.outcome === 'CLARIFY' && (decision.reason === 'unsure_answer' || decision.reason === 'bad_pick'))
        || (decision.outcome === 'ACT' && decision.action.type === 'chat'))) {
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
        async assign(actorId, i) { await WorkspaceService.assign(actorId, { targetUserId: i.targetUserId, title: i.title, description: i.description, date: i.date, notify: i.notify }); },
        async alertAssigned(actorId, targetUserId, titles, date) { await WorkspaceService.alertAssigned(actorId, targetUserId, titles, date); },
        async handOver(actorId, taskId, toId) { const r = await WorkspaceService.handOver(actorId, { taskId, targetUserId: toId }); return { toName: r.toName }; },
        async deleteTask(actorId, taskId) { await WorkspaceService.deleteTask(actorId, { taskId, via: 'whatsapp' }); },
        async renameTask(actorId, taskId, title) { await WorkspaceService.renameTask(actorId, { taskId, title, via: 'whatsapp' }); },
        async readPerson(actorId, personId) {
            const [actor, target] = await Promise.all([TaskDatabaseService.getEmployeeById(actorId), TaskDatabaseService.getEmployeeById(personId)]);
            if (!actor || !target) return null;
            const allowed = actor.role === 'superuser' || target.id === actor.id || (await PermissionService.visibleAndAssignable(actor, [target])).length === 1;
            if (!allowed) return null;
            const rows = await TaskDatabaseService.getDailyAssignments({ employeeId: personId, date: todayIST() });
            return rows.length ? rows.map((r, i) => `${i + 1}. ${r.title} (${STATUS[r.status] ?? r.status})`).join('\n') : 'No tasks today.';
        },
        async readTeam(actorId) {
            // "My team" = the people this person may give work to — the same rule assigning uses, re-checked here.
            const actor = await TaskDatabaseService.getEmployeeById(actorId);
            if (!actor) return null;
            // Only departments where the Task Manager is switched ON (owner 2026-10-12): a superuser no longer sees all 86 people.
            const [pool, active] = await Promise.all([TaskDatabaseService.getAllEmployees(), TaskAccessService.activeDepartmentIds()]);
            const team = (await PermissionService.visibleAndAssignable(actor, pool))
                .filter(e => e.id !== actor.id && e.active !== false && !!e.department_id && active.has(e.department_id)).slice(0, 40);
            if (!team.length) return null;
            const date = todayIST();
            const members = await Promise.all(team.map(async e => ({ name: e.name, tasks: await TaskDatabaseService.getDailyAssignments({ employeeId: e.id, date }) })));
            return buildTeamReport(members);
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
        async reply(phone, text) { await TaskMessagingService.sendFreeformReply(phone, text); },
        async audit(details, employee) { await TaskDatabaseService.logAudit({ eventType: 'brain_live', actorId: employee.id, details }); },
        seenBefore: id => { const t = seen.get(id); return !!t && Date.now() - t < SEEN_TTL_MS; },
        markSeen: id => {
            const now = Date.now();
            seen.set(id, now);
            if (seen.size > 1000) seen.forEach((ts, k) => { if (now - ts > SEEN_TTL_MS) seen.delete(k); });
        },
    };
}
