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
    'delete_tasks',      // "delete task 2", "remove the carpet one" — always previewed, then YES (owner request 2026-10-13)
    'rename_task',       // "rename task 2 to Vendor follow-up" — always previewed, then YES (owner request 2026-10-13)
    'add_note',          // "add note to onboarding: documents pending" — own task or one they gave; previewed, then YES (owner 2026-10-20)
    'remind_tasks',      // "remind srushti about onboarding" — tasks they GAVE that are still open; previewed, then YES (owner 2026-10-20)
    'lock_task',         // "lock task 2" / "unlock task 3" / "which tasks are locked?" — own tasks only; previewed, then YES (owner 2026-10-20)
    'find_tasks',        // any other QUESTION about tasks: "what did I finish yesterday", "anything about AMC", "how many did Lohit finish this week" (read-only)
    'help',
    'smalltalk',
    'unknown',
] as const;

export const FACILITY_INTENTS = ['facility_request'] as const;

export type TaskIntent = typeof TASK_INTENTS[number];
export type FacilityIntent = typeof FACILITY_INTENTS[number];
export type Intent = TaskIntent | FacilityIntent;

export type ProgressState = 'working' | 'partly_done' | 'blocked' | 'done_all' | 'done_some' | 'other';
export type ViewScope = 'self' | 'person' | 'team' | 'department' | 'org' | 'pending_overview';   // 'team' only while "Team reports" is ON

/** Which of the sender's numbered tasks a message points at. Numbers come from the list the AI was shown. */
export interface Which {
    all: boolean; numbers: number[]; hints: string[];
    /** Owner 2026-10-15: a GROUP of the sender's tasks instead of naming each one — "carried" (overdue / left from earlier
     *  days), "today", or one day "YYYY-MM-DD" ("yesterday's", "13 Oct's"). Only tasks on their list (today + carry-forward). */
    group?: 'carried' | 'today' | string;
}

export type Slots =
    | { intent: 'view_tasks'; scope: ViewScope; person: string | null; department: string | null; /** only tasks carried over from earlier days (own list) */ carriedOnly?: boolean; /** team: every task of each person, not only counts */ teamList?: boolean }
    | { intent: 'complete_tasks'; which: Which }
    | { intent: 'progress_update'; state: ProgressState; which: Which; note: string | null }
    | { intent: 'create_tasks'; assignee: string; tasks: Array<{ title: string; details: string | null;
            /** Owner 2026-10-19: who THIS task is for, when it differs per line ("1. meeting with vendors - neeti"). */
            assignees?: string[] }>; date: string | null;
        /** Owner 2026-10-19: several people for the whole message ("assign Parab and Neeti to conduct induction"). */
        assignees?: string[];
        /** A GROUP the AI read from the message ("everyone", "my team", "all of Tech except Harsh"). Code turns it into people. */
        group?: { whose: 'team' | 'department' | 'everyone'; department: string | null; except: string[] } | null;
        /** Owner 2026-10-21: they asked to add a note ("add note") but gave no text → the bot asks for it. */
        wantsNote?: boolean }
    /** Owner 2026-10-21: `note` goes with the task to the new holder; `wantsNote` = "add note" said without the text. */
    | { intent: 'hand_over_task'; which: Which; to: string | null; note?: string | null; wantsNote?: boolean }
    | { intent: 'answer_pending'; answer: 'yes' | 'no' | 'pick' | 'edit' | 'unsure'; pick: number | null; instruction: string | null }
    | { intent: 'facility_request'; service: 'room' | 'ticket' | 'other' }
    | { intent: 'find_tasks'; query: import('./findTasks').TaskQuery }
    | { intent: 'delete_tasks'; which: Which }
    | { intent: 'rename_task'; which: Which; newTitle: string | null }
    /** Owner 2026-10-20: a note on an EXISTING task. `person` only says whose task it is (a filter, never a new task). */
    | { intent: 'add_note'; which: Which; person: string | null; note: string | null }
    /** Owner 2026-10-20: remind the people doing tasks the sender GAVE. `person` narrows whose; `overdueOnly` = only overdue ones. */
    | { intent: 'remind_tasks'; which: Which; person: string | null; overdueOnly: boolean }
    /** Owner 2026-10-20: make own tasks repeat every working day (lock), stop that (unlock), or list the repeating ones. */
    | { intent: 'lock_task'; which: Which; action: 'lock' | 'unlock' | 'list' }
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
    /** Part B (2026-10-13): the OTHER requests in the same message ("done 1 and add …"), each validated like the first. */
    also?: ExtraRequest[];
    /** Parts of the message the AI tried to read as a request but that did not validate (told to the person, never acted on). */
    unclear?: string[];
}

/** One more request from the same message. Only changes are ever combined (see tasksDomain.decide). */
export interface ExtraRequest { intent: Intent; slots: Slots; summary: string; grounded: boolean }

export type PendingState =
    | { kind: 'confirm'; summary: string }
    | { kind: 'pick'; options: string[] }
    | { kind: 'preview'; count: number }
    | { kind: 'ping_reply'; assigner: string; taskIds: string[]; taskTitles: string[]; /** Names of everyone who gave these tasks, when more than one person is waiting on the reply. */ assigners?: string[] }
    /** Owner 2026-10-19: an UNFINISHED request. The bot asked a question about it; the next message fills the gap ("both",
     *  "only Neeti", "assign it to Srushti") instead of starting over. `request` = the person's own words so far. */
    | { kind: 'draft'; request: string; question: string | null; at: string;
        /** Owner 2026-10-21: the task the bot SUGGESTED when unsure ("Did you want to add this task?"). A clear reply saves it
         *  straight away (with undo): "yes" / "add task" → their own list, "assign it to Neeti" → Neeti. */
        suggested?: string };

export type Role = 'employee' | 'reporting_manager' | 'superuser';

export interface BrainPerson { id: string; name: string; department: string | null; role: Role }
/** `n` is the number from the person's numbered list (same as in their messages); `from` = the day an older open task was given. */
export interface BrainTask { n: number; id: string; title: string; status: 'pending' | 'in_progress' | 'completed'; from?: string;
    /** Owner 2026-10-20: repeats every working day (the person's own lock) / a team fixed task (only an admin changes it). */
    locked?: boolean; teamFixed?: boolean }

/** Owner 2026-10-20: an open task the sender GAVE someone else (they may add a note to it). Not numbered: found by its name. */
export interface NoteTarget { id: string; title: string; ownerId: string; ownerName: string; date: string }

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
    /** Conversation memory (Phase 2): the real last messages of the chat, oldest first ("Person: …" / "Assistant: …").
     *  Only present while WHATSAPP_MEMORY_ENABLED is on; absent → the prompt is exactly as before. */
    conversation?: string[];
    /** Owner 2026-10-20: open tasks the sender gave other people (for "add note to …"). Absent → only their own tasks. */
    noteTargets?: NoteTarget[];
    /** Owner 2026-10-21: the person's own message, so code can check a word in it (e.g. "assign" with nobody named). */
    message?: string;
}

export type Action =
    | { type: 'view_tasks'; scope: ViewScope; personId: string | null; department: string | null; /** own list: only tasks carried over from earlier days */ carriedOnly?: boolean; /** Owner 2026-10-21: team = every task of each person (not the progress counts) */ list?: boolean }
    | { type: 'complete_tasks'; taskIds: string[] }
    | { type: 'progress_update'; state: ProgressState; taskIds: string[]; note: string | null }
    | { type: 'create_tasks'; assigneeId: string; tasks: Array<{ title: string; details: string | null }>; date: string }
    | { type: 'hand_over_task'; taskId: string; toId: string; /** Owner 2026-10-21: optional note for the new holder. */ note?: string | null }
    | { type: 'answer_pending'; answer: 'yes' | 'no' | 'pick' | 'edit'; pick: number | null; instruction: string | null }
    | { type: 'chat'; kind: 'help' | 'smalltalk' }
    /** Flexible "look up tasks" (read-only): the form, already resolved to allowed people and exact dates by code. */
    | { type: 'find_tasks'; query: import('./findTasks').ResolvedQuery }
    /** Delete tasks from the person's own list (checked again by the same function the Tasks tab uses). */
    | { type: 'delete_tasks'; taskIds: string[] }
    /** Rename one task on the person's own list. */
    | { type: 'rename_task'; taskId: string; title: string }
    /** Add a note line ("Remark: …") to one task: their own, or one they gave (`ownerName` = whose task, null = their own). */
    | { type: 'add_note'; taskId: string; note: string; title: string; ownerName: string | null }
    /** Remind the people doing these tasks (tasks the sender gave). `lines` = "Onboarding (Srushti, 19 Oct)" for the preview. */
    | { type: 'remind_tasks'; taskIds: string[]; lines: string[] }
    /** Lock (repeat every working day) or unlock the person's own tasks, through the same checked function as the Tasks tab. */
    | { type: 'lock_tasks'; taskIds: string[]; lock: boolean }
    /** Read only: list the person's tasks that repeat every working day. */
    | { type: 'locked_list' }
    /** Several changes from ONE message, shown in one preview and carried out after one YES. `unclear` = parts not understood. */
    | { type: 'batch'; actions: Action[]; unclear: string[] };

export type ClarifyReason =
    | 'low_confidence' | 'ai_flagged_ambiguity' | 'unknown_intent'
    | 'no_task_referenced' | 'task_number_out_of_range' | 'several_tasks_match'
    | 'person_not_found' | 'several_people_match' | 'no_recipient' | 'no_task_content'
    | 'nothing_pending' | 'unsure_answer' | 'bad_pick' | 'too_many_tasks' | 'not_grounded' | 'department_not_found'
    /** Owner 2026-10-19: they named a piece of work but not who it is for: add to their own list, or assign it? */
    | 'add_or_assign'
    /** Owner 2026-10-21: unsure, but it looks like they want to add a task → suggest it ("Did you want to add this task?"). */
    | 'suggest_add'
    /** Owner 2026-10-21: "add note" without the note's text → ask what it should say. */
    | 'note_missing';

export type RefuseReason = 'not_allowed_to_assign' | 'task_already_done' | 'not_allowed_to_view' | 'cannot_hand_over_to_self' | 'nothing_to_do' | 'nothing_in_group' | 'nothing_to_remind' | 'already_locked' | 'not_locked' | 'team_fixed';

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
export interface ConfirmPolicy {
    confirmProgressUpdates: boolean;
    /** Owner 2026-10-14: false = marking one's OWN tasks done goes straight through, with "Reply undo within 10 minutes".
     *  The live bot sets it false only while "One front door" (which provides undo) is ON. Absent / true = asked first. */
    confirmCompletions?: boolean;
    /** Owner 2026-10-21: false = a clear "add task …" / "assign Neeti …" is saved straight away with "Reply undo within
     *  10 minutes" (no yes/no). Set false only while "One front door" (which provides undo) is ON. Absent / true = asked first. */
    confirmCreates?: boolean;
}
export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = { confirmProgressUpdates: false, confirmCompletions: true };

/** Confidence below which a CHANGE is never proposed; the bot asks instead. Reads use the lower bar. */
export const CHANGE_CONFIDENCE_MIN = 0.8;
export const READ_CONFIDENCE_MIN = 0.55;
/** Owner 2026-10-19: 15 → 30 (HR send longer lists). */
export const MAX_TASKS_PER_MESSAGE = 30;
/** Owner 2026-10-19: how long an unfinished request (a "draft") waits for the answer to the bot's question. */
export const DRAFT_TTL_MIN = 30;
/** Extra requests read from one message on top of the first ("done 1 and add …"): at most this many. */
export const MAX_EXTRA_REQUESTS = 4;
export const MAX_TITLE_LENGTH = 200;
/** Owner 2026-10-20: longest note ("Remark: …") the bot adds to a task. */
export const MAX_NOTE_LENGTH = 300;
