/**
 * The language brain — shared types.
 *
 * A FIXED workflow (not an agent): gather context → understand (one AI call) → validate → decide (plain code)
 * → reply (facts checked). The AI only PROPOSES; code checks every name and number against real data, and a
 * change is never made without a confirmation. Nothing in this folder touches the database or WhatsApp.
 */

export const TASK_INTENTS = [
    'view_tasks',        // "what do I have today", "how is Vidya doing"
    'complete_tasks',    // "done 2", "finished the carpet one", "all done"
    'progress_update',   // "working on it", "half done with 2", "stuck waiting for the vendor"
    'create_tasks',      // "remind me to call the vendor", "assign Lohit a task about RFID …"
    'hand_over_task',    // "give task 2 to Vidya"
    'answer_pending',    // "yes", "no", "the second one", "make it tomorrow" — answers to a question the bot asked
    'help',
    'smalltalk',
    'unknown',
] as const;

export const FACILITY_INTENTS = ['facility_request'] as const;

export type TaskIntent = typeof TASK_INTENTS[number];
export type FacilityIntent = typeof FACILITY_INTENTS[number];
export type Intent = TaskIntent | FacilityIntent;

export type ProgressState = 'working' | 'partly_done' | 'blocked' | 'done_all' | 'done_some' | 'other';
export type ViewScope = 'self' | 'person' | 'department' | 'org' | 'pending_overview';

/** Which of the sender's numbered tasks a message points at. Numbers come from the list the AI was shown. */
export interface Which { all: boolean; numbers: number[]; hints: string[] }

export type Slots =
    | { intent: 'view_tasks'; scope: ViewScope; person: string | null; department: string | null }
    | { intent: 'complete_tasks'; which: Which }
    | { intent: 'progress_update'; state: ProgressState; which: Which; note: string | null }
    | { intent: 'create_tasks'; assignee: string; tasks: Array<{ title: string; details: string | null }>; date: string | null }
    | { intent: 'hand_over_task'; which: Which; to: string | null }
    | { intent: 'answer_pending'; answer: 'yes' | 'no' | 'pick' | 'edit' | 'unsure'; pick: number | null; instruction: string | null }
    | { intent: 'facility_request'; service: 'room' | 'ticket' | 'other' }
    | { intent: 'help' | 'smalltalk' | 'unknown' };

export interface Interpretation {
    intent: Intent;
    /** 0..1 — how sure the AI says it is. Code also applies its own checks; this is only one input. */
    confidence: number;
    language: string;
    slots: Slots;
    /** Things the AI itself flagged as unclear ("two people could be 'Lohit'"). Any entry on a change → ask. */
    ambiguities: string[];
    /** The AI's own wording of the question it would ask, if it thinks one is needed (never trusted blindly). */
    clarifyQuestion: string | null;
    summary: string;
    /** False when wording the AI produced (a task title, a note) is not really in the person's message. */
    grounded: boolean;
}

export type PendingState =
    | { kind: 'confirm'; summary: string }
    | { kind: 'pick'; options: string[] }
    | { kind: 'preview'; count: number }
    | { kind: 'ping_reply'; assigner: string; taskIds: string[]; taskTitles: string[]; /** Names of everyone who gave these tasks, when more than one person is waiting on the reply. */ assigners?: string[] };

export type Role = 'employee' | 'reporting_manager' | 'superuser';

export interface BrainPerson { id: string; name: string; department: string | null; role: Role }
export interface BrainTask { n: number; id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }

export interface BrainContext {
    today: string;                     // YYYY-MM-DD
    sender: BrainPerson;
    /** People the sender can name (colleagues, reports, superusers). Names only go to the AI. */
    people: BrainPerson[];
    /** Ids the sender is ALLOWED to give work to (the existing permission rule, computed by the caller). */
    assignableIds: string[];
    /** The sender's own tasks for today, numbered 1..n — the numbers people say ("done 2") refer to this list. */
    tasks: BrainTask[];
    departments: string[];
    pending: PendingState | null;
    /** The last few turns, oldest first, as plain strings. Optional. */
    recent?: string[];
}

export type Action =
    | { type: 'view_tasks'; scope: ViewScope; personId: string | null; department: string | null }
    | { type: 'complete_tasks'; taskIds: string[] }
    | { type: 'progress_update'; state: ProgressState; taskIds: string[]; note: string | null }
    | { type: 'create_tasks'; assigneeId: string; tasks: Array<{ title: string; details: string | null }>; date: string }
    | { type: 'hand_over_task'; taskId: string; toId: string }
    | { type: 'answer_pending'; answer: 'yes' | 'no' | 'pick' | 'edit'; pick: number | null; instruction: string | null }
    | { type: 'chat'; kind: 'help' | 'smalltalk' };

export type ClarifyReason =
    | 'low_confidence' | 'ai_flagged_ambiguity' | 'unknown_intent'
    | 'no_task_referenced' | 'task_number_out_of_range' | 'several_tasks_match'
    | 'person_not_found' | 'several_people_match' | 'no_recipient' | 'no_task_content'
    | 'nothing_pending' | 'unsure_answer' | 'bad_pick' | 'too_many_tasks' | 'not_grounded' | 'department_not_found';

export type RefuseReason = 'not_allowed_to_assign' | 'task_already_done' | 'not_allowed_to_view' | 'cannot_hand_over_to_self' | 'nothing_to_do';

export type Decision =
    | { outcome: 'ACT'; action: Action }
    | { outcome: 'CONFIRM'; action: Action }
    | { outcome: 'CLARIFY'; reason: ClarifyReason; options: string[]; detail: string | null }
    | { outcome: 'REFUSE'; reason: RefuseReason; detail: string | null }
    | { outcome: 'HANDOFF'; domain: string; service: string };

export type Outcome = Decision['outcome'];

/**
 * Which changes need a one-line "shall I go ahead?" first. Every change is confirmed (create, hand over, "done") EXCEPT a plain
 * status update — "working on it", "half done", "stuck" — which goes straight through (decided with the owner: it only notes a
 * status, is easy to correct, and asking every time would make a simple reply feel heavy). "done" is ALWAYS confirmed, and an
 * unclear update is always asked about, whatever this setting says.
 */
export interface ConfirmPolicy { confirmProgressUpdates: boolean }
export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = { confirmProgressUpdates: false };

/** Confidence below which a CHANGE is never proposed; the bot asks instead. Reads use the lower bar. */
export const CHANGE_CONFIDENCE_MIN = 0.8;
export const READ_CONFIDENCE_MIN = 0.55;
export const MAX_TASKS_PER_MESSAGE = 15;
export const MAX_TITLE_LENGTH = 200;
