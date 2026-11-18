/**
 * The Unified Brain: shared types. Plan: docs/WHATSAPP_UNIFIED_BRAIN_PLAN.md.
 *
 * One brain turn per message, on any channel. Code identifies the person and loads the skills they may use; the model
 * may call READ skills to understand the request and may PROPOSE write skills; code validates, confirms and runs them.
 * Nothing in this folder knows which channel it is on, except channels/*.
 */
import type { z } from 'zod';
import type { ActorContext, ConsumptionRow, Lang, ReadingsStatusRow, TicketCountRow, TicketListRow, TicketQuery } from '../types';

export type BrainChannel = 'whatsapp' | 'app_chat';
export type BrainModule = 'tickets' | 'rooms' | 'tasks' | 'electricity' | 'knowledge' | 'memory';
export const BRAIN_MODULES: readonly BrainModule[] = ['tickets', 'rooms', 'tasks', 'electricity', 'knowledge', 'memory'];
export type SkillMode = 'off' | 'shadow' | 'live';
export type GridLevel = 'off' | 'questions' | 'questions_actions';
/** 0 = read · 1 = affects only the person · 2 = affects others · 3 = app only (never offered as a tool). */
export type Risk = 0 | 1 | 2 | 3;

// ── Handles: the model never sees or invents database ids ─────────────────────────────────────────────────────────

export type HandleKind = 'ticket' | 'room' | 'task' | 'booking' | 'attachment' | 'person';
export interface HandleRef { kind: HandleKind; id: string; label: string; propertyId?: string | null }

export interface AttachmentRef {
    handle: string;
    id: string;
    kind: 'image' | 'video' | 'document';
    mime: string;
    caption: string | null;
    receivedAt: string;
}

// ── Data access (injected, so tests never touch a database or the network) ────────────────────────────────────────

export interface TicketDetail {
    id: string; ticketNumber: string; title: string; status: string; priority: string | null;
    propertyId: string; createdAt: string; assigneeName: string | null; hasPhoto: boolean;
}
export interface RoomRow { id: string; name: string; propertyId: string }
export interface BookingRow { id: string; roomName: string; propertyId: string; date: string; startTime: string; endTime: string; status: string }
export interface TaskRow { id: string; n: number; title: string; status: string }
/** Someone this person may give a task to (the Task Manager's own rule). */
export interface TaskPerson { id: string; name: string; department: string | null }
/** An open task this person gave to someone else. */
export interface GivenTask { id: string; title: string; assigneeName: string; status: string; date: string }
/** Per-item result of a task action: what was done, and what could not be, with the Task Manager's own reason. */
export interface TaskOutcome { done: string[]; failed: Array<{ label: string; why: string }> }
export interface MemoryFact { key: string; value: string; label: string; source: string | null; confirmedAt: string | null; lastUsedAt: string | null }
export interface EpisodeRow { at: string; summary: string }
export interface StagedFile { bytes: Uint8Array; mime: string; fileName: string }

export interface BrainData {
    countTickets(q: TicketQuery): Promise<TicketCountRow[]>;
    listTickets(q: TicketQuery, limit: number): Promise<TicketListRow[]>;
    /** One ticket by number, limited to the person's scope and record rule. null = not found or not theirs. */
    ticketDetail(q: { orgId: string; propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string; ticketNumber: string }): Promise<TicketDetail | null>;
    /** The person's recent tickets (any period), newest first, under the same scope rules. */
    recentTickets(q: { orgId: string; propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string; openOnly: boolean }, limit: number): Promise<TicketDetail[]>;
    /** photoAttached = the photo passed in is really on the ticket now (false when there was none or it could not be stored). */
    createTicket(input: { opId: string; propertyId: string; description: string; title?: string; priority?: string; photo?: StagedFile | null }): Promise<{ ticketNumber: string; status: string; assigneeName: string | null; photoAttached: boolean }>;
    addTicketPhoto(input: { ticketId: string; photo: StagedFile }): Promise<void>;

    readingsStatus(propertyIds: string[], date: string): Promise<ReadingsStatusRow[]>;
    consumption(propertyIds: string[], from: string, to: string): Promise<ConsumptionRow[]>;

    listRooms(propertyId: string): Promise<RoomRow[]>;
    availableRooms(propertyId: string, date: string, startTime: string, endTime: string): Promise<RoomRow[]>;
    myBookings(userId: string, propertyIds: string[], fromDate: string): Promise<BookingRow[]>;
    bookRoom(input: { opId: string; userId: string; propertyId: string; roomId: string; date: string; startTime: string; endTime: string; purpose: string | null }): Promise<{ bookingId: string }>;

    /** The person's open tasks for today (numbered as in their digest). null = no Task Manager access. */
    myTasks(userId: string): Promise<TaskRow[] | null>;
    addTaskFile(input: { userId: string; taskId: string; file: StagedFile }): Promise<void>;
    /**
     * Tasks in the brain (owner 2026-11-15). Every one goes through the SAME checked functions the Tasks tab and the
     * task assistant use, so the Task Manager re-checks access, permission and its own rules at the moment of the change.
     * null from a read = no Task Manager access.
     */
    taskPeople(userId: string): Promise<TaskPerson[] | null>;
    tasksGiven(userId: string): Promise<GivenTask[] | null>;
    /** `labels` of the result are the titles. One grouped "new task" alert to the person, as the task assistant sends. */
    createTasks(input: { userId: string; assigneeId: string; titles: string[]; date: string; note: string | null }): Promise<TaskOutcome & { assigneeName: string }>;
    /** `labels` of the result are task ids. Givers get ONE grouped "task completed" notice, as with the task assistant. */
    completeTasks(input: { userId: string; taskIds: string[]; remark: string | null }): Promise<TaskOutcome>;
    handOverTask(input: { userId: string; taskId: string; toId: string; note: string | null }): Promise<{ toName: string }>;
    remindTasks(input: { userId: string; taskIds: string[] }): Promise<{ reminded: Array<{ name: string; count: number }>; skipped: Array<{ title: string; why: string }> }>;

    askKnowledge(input: { orgId: string; userId: string; question: string }): Promise<{ found: boolean; answer: string }>;

    listMemory(orgId: string, userId: string): Promise<MemoryFact[]>;
    saveMemory(input: { orgId: string; userId: string; key: string; value: string; label: string; source: string }): Promise<void>;
    forgetMemory(orgId: string, userId: string, key: string | null): Promise<number>;
    recallEpisodes(orgId: string, userId: string, query: string, limit: number): Promise<EpisodeRow[]>;
    addEpisode(input: { orgId: string; userId: string; summary: string; skillId: string }): Promise<void>;

    /** The bytes of a staged attachment (by its row id), or null when it expired or was removed. */
    loadAttachment(id: string): Promise<StagedFile | null>;
    markAttachmentUsed(id: string, usedBy: string): Promise<void>;
}

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>;

export interface SkillContext {
    actor: ActorContext;
    lang: Lang;
    now: Date;
    channel: BrainChannel;
    data: BrainData;
    /** Property nicknames from the org's AI Access settings: property id → other names. */
    aliases: Record<string, string[]>;
    /** Everything the person typed recently (this message and the few before it). Free text must be grounded in it. */
    userWords: string;
    /** Files the person sent that are not attached to anything yet. */
    attachments: AttachmentRef[];
    /** Give a record a short handle the model may refer to (T1, R2, K3, B1). The same record keeps its handle. */
    handle(kind: HandleKind, id: string, label: string, propertyId?: string | null): string;
    /** Turn a handle back into the record it was issued for in THIS thread. null = never issued (the model made it up). */
    resolve(handle: string | null | undefined, kind: HandleKind): HandleRef | null;
    /** The person's remembered facts, already loaded for this turn. */
    memory: MemoryFact[];
}

export interface ReadResult {
    /** What the model reads. Facts only; other people's words are quoted and clipped. */
    text: string;
    /** A finished answer in the person's language, used when the model's own wording fails the grounding check. */
    display?: string;
}

export type Prepared<P> =
    | { ok: false; problem: string }
    | { ok: true; payload: P; card: string; auditFields?: Record<string, unknown> };

export interface WriteResult {
    ok: boolean;
    reply: string;
    /** For the audit row (a ticket number, a booking id). Never personal data. */
    resultRef?: string | null;
    /** One line for long-term memory ("Raised ticket TKT-12 'AC leaking' at Andheri"). */
    episode?: string | null;
    /** Attachment row ids that are now attached to a record and no longer open. */
    usedAttachments?: string[];
}

interface SkillBase<A> {
    /** 'tickets.list', 'ticket.create'. The tool name shown to the model is the id with '.' replaced by '_'. */
    id: string;
    module: BrainModule;
    /** Shown to the model: what it does, when to use it, when NOT to (doctrine L8). */
    description: string;
    /** JSON Schema of the arguments (strict: every property required, optional ones nullable, no extra properties). */
    input: JsonSchema;
    /** The same shape for code: re-parsed on every call (doctrine L3 corollary). */
    args: z.ZodType<A>;
    /** Three ways people ask for it. Used in the console, the eval set and the tool description. */
    examples: readonly string[];
    /** The app's own access rule for this capability. Settings can only narrow it. */
    allowed(actor: ActorContext): boolean;
    defaultMode: SkillMode;
    /** One short label in each language, for "I can: …" replies. */
    ability: Record<Lang, string>;
}

export interface ReadSkill<A = unknown> extends SkillBase<A> {
    kind: 'read';
    risk: 0;
    run(ctx: SkillContext, args: A): Promise<ReadResult>;
}

export interface WriteSkill<A = unknown, P = unknown> extends SkillBase<A> {
    kind: 'write';
    risk: 1 | 2;
    /** The stored proposal: re-parsed before it runs, because the thread state is never trusted. */
    payload: z.ZodType<P>;
    /** Validate, resolve handles, check scope and grounding. Returns the confirmation card (built by code) or a problem. */
    prepare(ctx: SkillContext, args: A): Promise<Prepared<P>>;
    /** Runs once, after the person said Yes, through the service the app already uses. */
    execute(ctx: SkillContext, payload: P, opId: string): Promise<WriteResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Skill = ReadSkill<any> | WriteSkill<any, any>;

// ── The model, provider-neutral ───────────────────────────────────────────────────────────────────────────────────

export type Block =
    | { type: 'text'; text: string }
    | { type: 'image'; mime: string; base64: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; toolUseId: string; text: string; isError?: boolean };

export interface Msg {
    role: 'user' | 'assistant';
    blocks: Block[];
    /** The provider's own assistant content, sent back unchanged on the next call (keeps thinking blocks valid). */
    raw?: unknown;
}

export interface ToolDef { name: string; description: string; input: JsonSchema }

export type Effort = 'low' | 'medium' | 'high';

export interface ModelCall {
    model: string;
    system: string;
    tools: ToolDef[];
    messages: Msg[];
    maxTokens: number;
    effort: Effort;
}

export interface ModelUsage { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUsd: number | null }

export interface ModelReply {
    /** Text and tool_use blocks only. */
    blocks: Block[];
    raw: unknown;
    stopReason: string;
    usage: ModelUsage;
    model: string;
    /** Which key of a provider's pool answered (1-based), when the provider has a pool. */
    keySlot?: number | null;
}

export interface BrainModel {
    call(req: ModelCall): Promise<ModelReply>;
}

// ── A turn ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** executed = a confirmed action ran; not_executed = it was confirmed but could not run (slot taken, access changed, test mode). */
export type Outcome = 'answer' | 'ask' | 'propose' | 'executed' | 'not_executed' | 'cancelled' | 'handoff' | 'refuse' | 'unsupported' | 'error';

export interface BrainReply {
    text: string;
    /** Choices a channel may show as buttons (at most 3) or a numbered list. */
    options?: string[];
    awaitingConfirm?: boolean;
}

export interface ToolCallTrace { seq: number; skillId: string; kind: 'read' | 'write' | 'control'; args: unknown; ok: boolean; resultChars: number; ms: number; error?: string | null }

export interface ModelCallTrace { seq: number; model: string; keySlot: number | null; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUsd: number | null; ms: number; stopReason: string }

export interface TurnTrace {
    outcome: Outcome;
    reason: string | null;
    skillId: string | null;
    modelCalls: ModelCallTrace[];
    toolCalls: ToolCallTrace[];
    /** Models that failed before one answered: { model, error }. */
    hops: Array<{ model: string; error: string }>;
    grounded: boolean | null;
    latencyMs: number;
    costUsd: number | null;
    tokensIn: number;
    tokensOut: number;
    /** Ids of the taught lessons shown to the model for this message (empty when lessons are off or none matched). */
    lessons: string[];
    /** The guidance version in force for this message, or null. */
    guidance: number | null;
    /** 2026-11-18: the first answer failed the fact check and the model was asked once to fix it. */
    repaired?: boolean;
}
