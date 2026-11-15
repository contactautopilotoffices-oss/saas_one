/**
 * Brain Console: the shapes the console API returns. Types only, so the screens can import this file.
 *
 * Privacy (owner 2026-11-14): the console shows messages, never the person. Nothing in these shapes carries a name, a
 * phone number, a user id or a WhatsApp message id of someone who talked to the brain. `person` is a short tag that
 * is the same for one person within one day and cannot be turned back into who they are. The only names in the
 * console are in the pilot picker (PersonOption), where a Tech member chooses who may use the brain.
 */
import type { BrainSettings, RoleClass } from '../config';
import type { BrainChannel, BrainModule, Outcome, SkillMode } from '../types';

/** Reasons a turn is worth a human look. Worked out from the trace and from what the person did next. */
export type Flag =
    | 'gave_up'            // every model failed, or the turn ended in an error
    | 'not_done'           // the person said Yes but the action could not run
    | 'ungrounded'         // the reply contained a number, ticket or link that no tool result supported
    | 'correction'         // the person's next message was "no / wrong / I meant ..."
    | 'asked_again'        // the person repeated the same request within two minutes
    | 'question_loop'      // the brain asked two questions in a row
    | 'handed_to_person';  // the brain passed the conversation to a human

/** Facts about a turn that are not mistakes. */
export type Note = 'backup_model' | 'slow' | 'photo' | 'hr_hidden' | 'text_cleared';

export interface ConsoleStatus {
    /** The brain's tables do not exist yet (migrations not applied): every screen shows the set-up notice. */
    tableMissing: boolean;
    /** The review tables of migration 20261114000003 do not exist yet: labelling is unavailable. */
    reviewMissing: boolean;
    /** The guidance table of migration 20261114000004 does not exist yet: guidance is unavailable. */
    learningMissing: boolean;
    /** env AI_BRAIN_DISABLED=true: the brain is stopped for every organisation, whatever the switches say. */
    killSwitch: boolean;
    mode: SkillMode;
}

export interface TurnLabel { verdict: 'right' | 'wrong'; expectedOutcome: Outcome; expectedSkill: string | null; note: string | null }

export interface ToolCallView { seq: number; skillId: string; kind: 'read' | 'write' | 'control'; args: string; ok: boolean; ms: number; error: string | null }
export interface ModelCallView { seq: number; model: string; keySlot: number | null; tokensIn: number; tokensOut: number; cacheRead: number; costUsd: number | null; ms: number; stopReason: string }

export interface TurnView {
    id: string;
    at: string;
    /** Same person, same day → same tag. Example: "K7Q2". Not an id. */
    person: string;
    /** YYYY-MM-DD in India time: with `person`, the key of a conversation. */
    day: string;
    role: RoleClass | null;
    channel: BrainChannel;
    shadow: boolean;
    /** Phone numbers, email addresses and ids are masked. null when hidden or cleared (see notes). */
    userText: string | null;
    replyText: string | null;
    outcome: Outcome;
    reason: string | null;
    skillId: string | null;
    handoffTo: string | null;
    lang: string | null;
    model: string | null;
    keySlot: number | null;
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    costUsd: number | null;
    latencyMs: number;
    grounded: boolean | null;
    toolCount: number;
    /** How many taught lessons the brain was shown for this message (0 when lessons are off or none matched). */
    lessons: number;
    /** The guidance version in force for this message, or null. */
    guidance: number | null;
    flags: Flag[];
    notes: Note[];
    label: TurnLabel | null;
    /** Shadow turns only: which of today's bots answered this message, when that was recorded. */
    answeredBy: string | null;
    /** Present on detail views (one conversation, the review queue). */
    toolCalls?: ToolCallView[];
    modelCalls?: ModelCallView[];
    hops?: Array<{ model: string; error: string }>;
}

export interface SeriesPoint { t: string; turns: number; flagged: number; costUsd: number }

export interface Overview {
    days: number;
    /** More turns exist in the period than were read; the numbers are for the newest ones. */
    truncated: boolean;
    totals: {
        turns: number; live: number; shadow: number; people: number; flagged: number;
        costUsd: number; turnsWithoutCost: number;
        medianLatencyMs: number; p95LatencyMs: number;
        /** Share of prompt tokens read from the cache, 0..1. null when nothing was sent. */
        cacheHitRate: number | null;
        toolCallsPerTurn: number;
        /** Share of turns that ended in an answer, a question, a card or a finished action, 0..1. */
        handledRate: number | null;
    };
    bucket: 'hour' | 'day';
    series: SeriesPoint[];
    outcomes: Array<{ outcome: Outcome; count: number }>;
    skills: Array<{ skillId: string; calls: number; failed: number }>;
    models: Array<{ model: string; turns: number; costUsd: number; medianLatencyMs: number }>;
    channels: Array<{ channel: BrainChannel; turns: number }>;
    roles: Array<{ role: RoleClass | 'unknown'; turns: number }>;
    flags: Array<{ flag: Flag; count: number }>;
    latestFlagged: TurnView[];
}

export interface ConversationSummary {
    person: string;
    day: string;
    role: RoleClass | null;
    channels: BrainChannel[];
    shadow: boolean;
    turns: number;
    firstAt: string;
    lastAt: string;
    /** The first message, masked and cut short. */
    preview: string | null;
    lastOutcome: Outcome;
    flagged: number;
    costUsd: number;
}

export interface SkillView {
    id: string;
    module: BrainModule;
    kind: 'read' | 'write';
    risk: number;
    description: string;
    examples: string[];
    defaultMode: SkillMode;
    /** What is in force for this organisation. */
    mode: SkillMode;
    /** Whether each kind of login gets this skill by default (the app's own access rule still applies on top). */
    roles: Record<RoleClass, boolean>;
    usage: { calls: number; failed: number; lastUsedAt: string | null };
}

/** The pilot picker only. The one place a name appears; it never appears next to a message. */
export interface PersonOption { id: string; name: string; role: string; isTech: boolean }

export interface KeyView {
    slot: number;
    /** The name of the environment variable. The value is never sent. */
    name: string;
    set: boolean;
    resting: { why: string; minutesLeft: number } | null;
}

export interface HistoryEntry { at: string; by: string; changes: string[] }

export interface SettingsView {
    settings: BrainSettings;
    /** Sent back on save, so two people editing at once cannot overwrite each other silently. */
    updatedAt: string | null;
    keys: KeyView[];
    /** The models tried in order (Control Centre → AI models → Unified brain). */
    chain: string[];
    history: HistoryEntry[];
    people: PersonOption[];
    /** Hard ceilings the organisation's own limits are clamped to. */
    ceilings: { perUserPerHour: number; actionsPerUserPerDay: number };
}

export interface KeyCost {
    slot: number;
    name: string;
    set: boolean;
    resting: { why: string; minutesLeft: number } | null;
    cycleStart: string;
    cycleEnd: string;
    /** false = no cycle date is saved, so the calendar month is used. */
    cycleKnown: boolean;
    creditUsd: number;
    spentUsd: number;
    /** Spend at the current daily rate by the end of the cycle. */
    projectedUsd: number;
    turns: number;
}

export interface CostView {
    keys: KeyCost[];
    /** Spend recorded here is what the brain measured from token counts; the Claude Console is the bill of record. */
    last30: { costUsd: number; turns: number; turnsWithoutCost: number; perTurnUsd: number | null };
    byDay: Array<{ day: string; costUsd: number; turns: number }>;
    byModel: Array<{ model: string; costUsd: number; turns: number }>;
    bySkill: Array<{ skillId: string; costUsd: number; turns: number }>;
}

export interface MemoryView {
    enabled: boolean;
    profileDays: number;
    episodeDays: number;
    /** How many people have at least one remembered fact. Counts only: nobody's memory is shown. */
    people: number;
    facts: Array<{ key: string; label: string; count: number }>;
    episodes: { total: number; last7Days: number; bySkill: Array<{ skillId: string; count: number }> };
}

export interface ShadowView {
    days: number;
    totals: { turns: number; wouldAnswer: number; wouldAct: number; wouldHandOff: number; right: number; wrong: number; unlabelled: number };
    turns: TurnView[];
}

export interface EvalCaseView {
    id: string;
    text: string;
    role: RoleClass;
    channel: BrainChannel;
    verdict: 'right' | 'wrong';
    gotOutcome: string | null;
    gotSkill: string | null;
    expectedOutcome: Outcome;
    expectedSkill: string | null;
    note: string | null;
    active: boolean;
    at: string;
}

/**
 * A flagged message of the older AI assistant, judged here since 2026-11-15 (`ai_judge`): teach it the right answer,
 * or ignore it. No name, phone or user id. The task assistant's flagged messages are not in this list: its own review
 * panel is shown in the Review screen instead (it moved here from the Control Centre).
 */
export interface OtherBotItem {
    id: string;
    bot: 'task_assistant' | 'ai_assistant';
    at: string;
    /** What the AI assistant chose to do with the message, in plain words. null when it chose nothing. */
    chose: string | null;
    /** Masked like every other message in the console. */
    text: string;
    reply: string | null;
    followUp: string | null;
    /** Why it was flagged, already in plain words. */
    reasons: string[];
    state: 'waiting' | 'judged' | 'ignored' | 'with_developer';
}

export interface ReviewView {
    /** Flagged messages of the older AI assistant, newest first. One that is still 'waiting' can be judged. */
    others: OtherBotItem[];
    /** What a reviewer may teach the AI assistant as the right answer: its questions and actions, "about tasks", "nothing". */
    aiAnswers: Array<{ id: string; kind: string; label: string }>;
    /** Whether taught cases are shown to the brain as lessons (Switches → Learning). */
    lessonsOn: boolean;
    /** Turns that look wrong and that nobody has judged yet, newest first, with their full detail. */
    queue: TurnView[];
    judged: { right: number; wrong: number };
    cases: EvalCaseView[];
    /** What a reviewer may pick as the right ending and the right skill. */
    outcomes: Outcome[];
    skills: Array<{ id: string; kind: 'read' | 'write' }>;
}

export interface ScoreModel {
    model: string;
    cases: number;
    passed: number;
    /** Right tool, right arguments, 0..1 (doctrine L4, L5). */
    toolChoice: number;
    /** Mean rubric score 0..3 from the grading model (doctrine L6). null when the grader did not run. */
    quality: number | null;
    /** Cases where something was done or shown that must never be. Must be 0. */
    unsafe: number;
    avgCostUsd: number | null;
    medianLatencyMs: number;
    avgToolCalls: number;
    groups: Array<{ group: string; passed: number; total: number }>;
    failed: Array<{ id: string; why: string }>;
}

export interface ScorecardView {
    /** null = the test set has never been run against a real model. */
    ranAt: string | null;
    grader: { model: string; audited: number; auditedAgree: number } | null;
    models: ScoreModel[];
    golden: Array<{ id: string; group: string; role: RoleClass; text: string; expect: string }>;
}

// ── Guidance: a short note from the Tech team that every reply is written with ────────────────────────────────────

export interface GuidanceScore { passed: number; unsafe: number; done: number }

export interface GuidanceTest {
    /** The model it was tested on (the first model of the chain at the time). */
    model: string;
    /**
     * running = call `test_step` again; passed = may go live; failed = may not;
     * stale = the test set, the model order or the words changed since, so it must be tested again.
     */
    state: 'running' | 'passed' | 'failed' | 'stale';
    /** Steps finished and steps in all (each test message is played with and without this guidance). */
    done: number;
    total: number;
    /** Without this guidance (what is live today). */
    baseline: GuidanceScore;
    /** With this guidance. */
    candidate: GuidanceScore;
    /** Test messages that pass today and fail with this guidance. */
    newlyFailing: Array<{ id: string; why: string }>;
    /** In plain words, why it passed or failed. null while running. */
    verdict: string | null;
    spentUsd: number;
    startedAt: string;
    finishedAt: string | null;
}

export interface GuidanceVersion {
    id: string;
    version: number;
    text: string;
    status: 'draft' | 'live' | 'retired';
    /** The Tech member who wrote it. */
    createdBy: string;
    createdAt: string;
    activatedAt: string | null;
    test: GuidanceTest | null;
}

/** Whether the brain can be asked to propose the words of a note from the answers judged wrong, and how often. */
export interface SuggestView {
    /** false until the migrations it needs are applied. */
    available: boolean;
    /** Answers judged wrong (and still in use) that a suggestion would be based on. */
    mistakes: number;
    /** How many of them are needed before a suggestion can be asked for. */
    needed: number;
    leftToday: number;
    perDay: number;
}

export interface GuidanceView {
    suggest: SuggestView;
    live: GuidanceVersion | null;
    /** Newest first, at most 20. */
    versions: GuidanceVersion[];
    /** The model a test would run on now. */
    model: string | null;
    /** How many test messages a test plays. */
    cases: number;
    /** Rough cost of one test on that model, from the last scored run. null when unknown. */
    estimateUsd: number | null;
    testsLeftToday: number;
    maxChars: number;
}

export type ConsoleReply<T> = { success: true; status: ConsoleStatus; data: T } | { success: false; error: string };
