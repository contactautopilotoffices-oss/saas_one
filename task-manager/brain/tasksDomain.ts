import { matchByName } from '../TaskGateway';
import type { DomainHandler, ExecutionResult, IntentSpec, ReplyFacts } from './domain';
import {
    Action, BrainContext, BrainPerson, BrainTask, CHANGE_CONFIDENCE_MIN, ClarifyReason, ConfirmPolicy, Decision, Intent,
    Interpretation, MAX_NOTE_LENGTH, MAX_TASKS_PER_MESSAGE, MAX_TITLE_LENGTH, NoteTarget, ProgressState, READ_CONFIDENCE_MIN, Slots, TASK_INTENTS, ViewScope, Which,
} from './types';
import { addDays, clip, contentWords, dayLabel, headedList, isGrounded, isIsoDate, norm, sectionedList, similarity } from './text';
import { TaskQuery, findQuerySchema, periodRange, validateQuery, wordsGrounded } from './findTasks';
import { UNDO_HINT } from './frontDoor';

/**
 * The language brain — the TASKS domain.
 *
 * Everything here is plain code. The AI's output arrives as untrusted JSON; this file validates its shape, checks
 * every person and task number against real data, applies the permission and confirmation rules, and decides:
 *   ACT (a read or a chat reply) · CONFIRM (a change, asked about first) · CLARIFY (unclear → ask) · REFUSE · HANDOFF.
 */

// Owner 2026-10-15: a whole group of tasks in one message (complete or delete). Dates use "today" from the context.
const GROUP_HELP = 'For a whole GROUP, set "group" and leave numbers and hints empty: "overdue", "carry forward", "old" or "pending from earlier days" → "carried"; "today\'s" → "today"; one day ("yesterday\'s", "13 Oct\'s", "Monday\'s") → that date as YYYY-MM-DD. Otherwise "group" is null.';

const INTENT_SPECS: IntentSpec[] = [
    { name: 'view_tasks', description: 'wants to SEE tasks or progress: their own ("what do I have today", "anything pending?", "what are my carry forward tasks?") or another person\'s / a department\'s / the whole company\'s — for TODAY only. Any other day or range ("tomorrow", "yesterday", "this week", "last month") is "find_tasks".',
        slots: '{"scope":"self"|"person"|"department"|"org"|"pending_overview","person":string|null,"department":string|null,"carried_forward_only":boolean}  — carried_forward_only = true only when they ask for their OWN tasks carried over / left from earlier days.' },
    { name: 'complete_tasks', description: 'says they FINISHED one or more of THEIR OWN tasks ("done 2", "finished the carpet one", "all done"). If the message is about another person\'s tasks it is NOT this intent: use "unknown" and say why in ambiguities. To delete / remove a task use "delete_tasks"; to rename one use "rename_task".',
        slots: `{"which":{"all":boolean,"numbers":[int],"hints":[string],"group":"carried"|"today"|"YYYY-MM-DD"|null}}  — numbers refer to the numbered task list you were given; put a task number there whenever the person names a task you can match to the list. ${GROUP_HELP}` },
    { name: 'progress_update', description: 'reports PROGRESS short of finishing, or a status on tasks they were sent: "working on it", "half done", "stuck waiting for the vendor", or "done"/"done all" in reply to someone\'s request.',
        slots: '{"state":"working"|"partly_done"|"blocked"|"done_all"|"done_some"|"other","which":{"all":boolean,"numbers":[int],"hints":[string]},"note":string|null}' },
    { name: 'create_tasks', description: 'wants to ADD one or more tasks, for themself ("remind me to…") or for someone else ("assign Lohit a task about…"). Split distinct jobs into separate tasks.',
        slots: '{"assignee":"me"|<person name>|"?","assignees":[<person name>],"tasks":[{"title":string,"details":string|null,"assignees":[<person name>]}],"date":"YYYY-MM-DD"|null,"group":{"whose":"team"|"department"|"everyone","department":string|null,"except":[<person name>]}|null}  — titles are short (max 12 words) and use the person\'s own words; never invent work; date only if the message gives one. When the work is for a GROUP ("everyone", "my team", "all of Tech", "sabko", "everyone except Harsh"), fill "group" and set "assignee" to "group"; NEVER list the names yourself. SEVERAL NAMED PEOPLE for the same work ("assign Parab and Neeti to conduct induction", "Sanil aur Neeti dono ko"): put every name in "assignees" (each gets the task); this is clear, never an ambiguity. A LIST where each line names its own person ("1. meeting with vendors - neeti" then "2. review quotation - sanil"): one task per line, with that line\'s person in the task\'s own "assignees". A message that asks to add a task or only NAMES a piece of work, without naming anyone, and is not a question ("add task follow up regarding checklist", "event feedback for navratri event"): intent create_tasks with "assignee":"me" (it goes on their own list). Use "assignee":"?" ONLY when they say to assign it to someone but do not say who ("assign a task about the audit"). "details" ONLY when the message marks a note with the word "note" or "remark", with or without ":" ("vendor meeting, note: call before 3pm" or "onboarding note Satish" → details "call before 3pm" / "Satish"), OR in a NUMBERED list a detail is written on its own line under a task ("2. Diwali poll" then "Pending · from Team" → title "Diwali poll", details "from Team"; leave out status words like "Pending"); otherwise details is null and every word stays in the task title(s). A LIST of tasks (several lines, or items separated by commas) is ONE TASK PER LINE OR ITEM: "Add tasks / New lineups Ops, / Bangalore Drive. / Technical exe, Ops manager, AFM" → five tasks "New lineups Ops", "Bangalore Drive", "Technical exe", "Ops manager", "AFM". One sentence with a comma inside it ("call the vendor, ask for the quote") stays one task. "wants_note": true when they ask to add a note ("add note", "with a note") but give no note text ("assign Sanil the vendor follow-up, add note").' },
    { name: 'hand_over_task', description: 'wants to GIVE one of their own existing tasks to a teammate ("give task 2 to Vidya", "pass the carpet one to Harsh", "give task 2 to Vidya, note: call the vendor first").',
        slots: '{"which":{"all":false,"numbers":[int],"hints":[string]},"to":<person name>|null,"note":string|null,"wants_note":boolean}  — "note" is a note to send with it, in their words, without the person\'s name; "wants_note" is true when they ask to add a note ("add note", "with a note") but give no note text.' },
    { name: 'answer_pending', description: 'is ANSWERING a question the bot just asked (only possible when a question is pending): "yes", "no", "the second one", "make it tomorrow instead".',
        slots: '{"answer":"yes"|"no"|"pick"|"edit"|"unsure","pick":int|null,"instruction":string|null}' },
    { name: 'delete_tasks', description: 'wants to DELETE / REMOVE one or more of THEIR OWN tasks from their list ("delete task 2", "remove the carpet one", "task 3 hata do", "delete all overdue tasks", "delete yesterday\'s tasks"). Not for marking done.',
        slots: `{"which":{"all":boolean,"numbers":[int],"hints":[string],"group":"carried"|"today"|"YYYY-MM-DD"|null}}  — "all": true only when they say ALL their tasks. ${GROUP_HELP}` },
    { name: 'rename_task', description: 'wants to RENAME / change the name of ONE of their own tasks ("rename task 2 to Vendor follow-up", "change the carpet task name to Carpet PO").',
        slots: '{"which":{"all":false,"numbers":[int],"hints":[string]},"new_title":string|null}  — new_title is the new name in their own words (max 12 words); null if they did not give one.' },
    { name: 'add_note', description: 'wants to ADD A NOTE / remark to a task that ALREADY EXISTS: their own, or one they gave someone ("add note to onboarding: documents pending", "onboarding wale task mein note daal do ki documents pending hain", "add a note to Srushti\'s onboarding task: call Satish first"). A person named here only says WHOSE task it is: put that name in "person". It is NEVER a new task and NEVER a hand-over. Adding a NEW task with a note is "create_tasks" with "details".',
        slots: '{"which":{"all":false,"numbers":[int],"hints":[string]},"person":<person name>|null,"note":string}  — numbers only for a number from their own numbered list; otherwise put words of the task name in "hints". "note" is the note in their own words (max 40 words), without the task name and without the person\'s name.' },
    { name: 'remind_tasks', description: 'wants to REMIND someone about tasks they ALREADY GAVE them that are still pending ("remind srushti about onboarding", "srushti ko onboarding ka reminder bhejo", "remind sanil about all his pending tasks", "remind everyone about overdue tasks"). Never for new work: "remind me to call the vendor" or "remind Srushti to call the vendor" when it is a new job is "create_tasks".',
        slots: '{"which":{"all":boolean,"numbers":[],"hints":[string]},"person":<person name>|null,"overdue_only":boolean}  — hints are words of the task name (empty when they mean all of that person\'s pending tasks); person is whose tasks; overdue_only = true only when they say overdue / late / pending from earlier days.' },
    { name: 'lock_task', description: 'wants one of THEIR OWN tasks to REPEAT every working day ("lock task 2", "make onboarding a daily task", "isko roz ka task bana do"), to STOP repeating ("unlock task 3", "stop repeating diwali poll"), or asks WHICH of their tasks repeat ("which tasks are locked?", "my daily fixed tasks").',
        slots: '{"which":{"all":false,"numbers":[int],"hints":[string]},"action":"lock"|"unlock"|"list"}  — "list" when they only ask which tasks repeat (leave which empty).' },
    { name: 'find_tasks', description: 'asks any OTHER question about tasks (read-only), using filters: past or future days ("yesterday", "last week", "this month"), finished tasks ("what did I finish yesterday?"), who gave them ("what did Saniel give me?", "what have I assigned to Lohit?"), words in them ("anything about AMC?"), overdue / open for N days, fixed daily tasks, counts ("how many did Vidya finish this week?") or grouped ("by person", "by department"). For the person\'s own list for today, their team today, a department or the company today, use "view_tasks". NEVER for a change.',
        slots: `${findQuerySchema(false)}  — fill only what the person said; leave the rest at the defaults (whose "me", period "any", status "any"). "finished/completed yesterday" → status "done", date_field "finished", period "yesterday". "words" are words from their message only.` },
    { name: 'help', description: 'asks what the bot can do or how to use it.', slots: '{}' },
    { name: 'smalltalk', description: 'greets, thanks, chats with no task request, or asks about this conversation itself ("what did I just ask?", "why did you say that?"). If the assistant is WAITING for an answer, "what do you mean?" / "I don\'t understand" is "answer_pending" with answer "unsure".', slots: '{}' },
    { name: 'unknown', description: 'anything else, or you cannot tell what is wanted.', slots: '{}' },
];

const CHANGE_INTENTS: ReadonlySet<Intent> = new Set(['complete_tasks', 'progress_update', 'create_tasks', 'hand_over_task', 'delete_tasks', 'rename_task', 'add_note', 'remind_tasks', 'lock_task']);
const SCOPES: readonly ViewScope[] = ['self', 'person', 'department', 'org', 'pending_overview'];
const STATES: readonly ProgressState[] = ['working', 'partly_done', 'blocked', 'done_all', 'done_some', 'other'];
const SELF_WORDS = new Set(['me', 'myself', 'self', 'i', 'my self', 'my own']);
/** Owner 2026-10-21: words that mean "give this to someone else" (then a missing name is asked for, never guessed as "me"). */
const ASKS_TO_ASSIGN = /\b(?:assign|assigned|delegate|for someone|someone else|ko de|ko do|de do|dedo)\b/i;
const EVERYONE_WORDS = new Set(['everyone', 'everybody', 'all', 'all of them', 'the team', 'team', 'someone', 'somebody', 'anyone', 'anybody', 'whoever']);

// ── strict shape checks ─────────────────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = clip(v, max);
    return s || null;
};

/** Owner 2026-10-19: a list of people's names ("Parab", "Neeti"), or one name given as a string. At most 10, no repeats. */
const nameList = (v: unknown): string[] => {
    const raw = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    const out: string[] = [];
    for (const x of raw) { const n = str(x, 60); if (n && !out.some(o => norm(o) === norm(n))) out.push(n); }
    return out.slice(0, 10);
};

function parseWhich(raw: unknown): Which {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const numbers = (Array.isArray(o.numbers) ? o.numbers : [])
        .map(n => (typeof n === 'number' ? n : typeof n === 'string' && /^\d{1,3}$/.test(n.trim()) ? Number(n) : NaN))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 999);
    const hints = (Array.isArray(o.hints) ? o.hints : []).map(h => str(h, 80)).filter((h): h is string => !!h).slice(0, 6);
    const g = typeof o.group === 'string' ? o.group.trim().toLowerCase() : '';
    const group = g === 'carried' || g === 'overdue' || g === 'carry_forward' ? 'carried' : g === 'today' ? 'today' : isIsoDate(g) ? g : undefined;
    return { all: o.all === true, numbers: [...new Set(numbers)].slice(0, 30), hints, ...(group ? { group } : {}) };
}

/** Is this task in the group the person named? (carried = from an earlier day; today; or one exact day) */
function inGroup(t: BrainTask, group: string, today: string): boolean {
    if (group === 'carried') return !!t.from;
    if (group === 'today' || group === today) return !t.from;
    return t.from === group;
}
const groupLabel = (group: string, today: string) => group === 'carried' ? 'earlier days' : group === 'today' || group === today ? 'today' : dayLabel(group);

/** A group with nothing named inside it ("delete all overdue", "complete yesterday's") → every task of that group. */
const groupOnly = (w: Which) => !!w.group && !w.numbers.length && !w.hints.length;

function validateSlots(intent: Intent, raw: Record<string, unknown>, ctx: BrainContext): Slots | null {
    switch (intent) {
        case 'view_tasks': {
            const scope = raw.scope as ViewScope;
            if (!SCOPES.includes(scope)) return null;
            return { intent, scope, person: str(raw.person, 60), department: str(raw.department, 60), ...(scope === 'self' && raw.carried_forward_only === true ? { carriedOnly: true } : {}) };
        }
        case 'complete_tasks':
            return { intent, which: parseWhich(raw.which) };
        case 'progress_update': {
            const state = raw.state as ProgressState;
            if (!STATES.includes(state)) return null;
            return { intent, state, which: parseWhich(raw.which), note: str(raw.note, 200) };
        }
        case 'create_tasks': {
            const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
                .map(t => {
                    if (!t || typeof t !== 'object') return null;
                    const names = nameList((t as Record<string, unknown>).assignees);
                    const o = t as Record<string, unknown>;
                    return { title: str(o.title, MAX_TITLE_LENGTH), details: str(o.details, 400), ...(names.length ? { assignees: names } : {}) };
                })
                .filter((t): t is { title: string; details: string | null; assignees?: string[] } => !!t && !!t.title)
                .slice(0, MAX_TASKS_PER_MESSAGE + 1);
            // Owner 2026-10-19: several people for the whole message, as "assignees" or as a list in "assignee".
            const many = nameList(Array.isArray(raw.assignee) ? raw.assignee : raw.assignees);
            const date = isIsoDate(raw.date) && raw.date >= addDays(ctx.today, -366) && raw.date <= addDays(ctx.today, 366) ? raw.date : null;
            // The sender's own name is "me" (so "remind me to…" never fails the "named in the message" check).
            const a = (Array.isArray(raw.assignee) ? (many.length === 1 ? many[0] : '') : str(raw.assignee, 60)) || (many.length ? '' : 'me');
            const self = norm(a) === norm(ctx.sender.name) || norm(a) === norm(ctx.sender.name).split(' ')[0];
            const g = raw.group && typeof raw.group === 'object' && !Array.isArray(raw.group) ? raw.group as Record<string, unknown> : null;
            const group = g && ['team', 'department', 'everyone'].includes(String(g.whose))
                ? { whose: g.whose as 'team' | 'department' | 'everyone', department: str(g.department, 60), except: (Array.isArray(g.except) ? g.except : []).map(x => str(x, 60)).filter((x): x is string => !!x).slice(0, 10) }
                : null;
            return { intent, assignee: self ? 'me' : a, tasks, date, ...(many.length > 1 ? { assignees: many } : {}), ...(group ? { group } : {}), ...(raw.wants_note === true ? { wantsNote: true } : {}) };
        }
        case 'hand_over_task':
            return { intent, which: parseWhich(raw.which), to: str(raw.to, 60), note: str(raw.note, MAX_NOTE_LENGTH), ...(raw.wants_note === true ? { wantsNote: true } : {}) };
        case 'answer_pending': {
            const answer = raw.answer as string;
            if (!['yes', 'no', 'pick', 'edit', 'unsure'].includes(answer)) return null;
            const pick = typeof raw.pick === 'number' && Number.isInteger(raw.pick) && raw.pick >= 1 && raw.pick <= 99 ? raw.pick : null;
            return { intent, answer: answer as 'yes' | 'no' | 'pick' | 'edit' | 'unsure', pick, instruction: str(raw.instruction, 200) };
        }
        case 'delete_tasks':
            return { intent, which: parseWhich(raw.which) };   // a whole group / "all" is allowed (always previewed, then YES)
        case 'rename_task':
            return { intent, which: { ...parseWhich(raw.which), all: false }, newTitle: str(raw.new_title, MAX_TITLE_LENGTH) };
        case 'add_note':
            return { intent, which: { ...parseWhich(raw.which), all: false }, person: str(raw.person, 60), note: str(raw.note, MAX_NOTE_LENGTH) };
        case 'remind_tasks':
            return { intent, which: { ...parseWhich(raw.which), numbers: [] }, person: str(raw.person, 60), overdueOnly: raw.overdue_only === true };
        case 'lock_task': {
            const action = raw.action === 'lock' || raw.action === 'unlock' || raw.action === 'list' ? raw.action : null;
            return action ? { intent, which: { ...parseWhich(raw.which), all: false }, action } : null;
        }
        case 'find_tasks': {
            const query = validateQuery(raw);
            // "my team" only while the "Team reports" switch is ON (tasksDomainWithTeam allows it).
            return query && query.whose !== 'team' ? { intent, query } : null;
        }
        case 'help': case 'smalltalk': case 'unknown':
            return { intent };
        default:
            return null;
    }
}

/**
 * New TASKS are the one place the AI could invent work that then gets saved, so a task title/detail must really come from the
 * message. Notes and edit instructions are only paraphrases of what was said (they are confirmed before use), and grounding them
 * rejected honest short replies like "done all" in the measurement — so they are not checked.
 */
function checkGrounding(slots: Slots, message: string): boolean {
    if (slots.intent === 'create_tasks') {
        // The person who gets the work must be NAMED by the sender (here or in their own recent messages): the AI may not
        // turn "everyone" / "the team" into a list of names itself (2026-10-13, found by the real-AI test).
        const nameOk = (n: string) => { const w = norm(n); return SELF_WORDS.has(w) || EVERYONE_WORDS.has(w) || w === 'group' || w === '?' || w === '' || isGrounded(w.split(' ')[0], message); };
        // Owner 2026-10-19: several people / a person per line — each one must be named in the message too.
        const named = !!slots.group || (nameOk(slots.assignee) && (slots.assignees ?? []).every(nameOk) && slots.tasks.every(t => (t.assignees ?? []).every(nameOk)));
        return named && slots.tasks.every(t => isGrounded(t.title, message) && (!t.details || isGrounded(t.details, message)));
    }
    if (slots.intent === 'find_tasks') return wordsGrounded(slots.query, message);
    // Owner 2026-10-20: a note is saved on a task, so it must be the person's own words; a named person must be named by them.
    if (slots.intent === 'add_note') return (!slots.note || isGrounded(slots.note, message)) && (!slots.person || SELF_WORDS.has(norm(slots.person)) || isGrounded(norm(slots.person).split(' ')[0], message));
    if (slots.intent === 'hand_over_task' && slots.note && !isGrounded(slots.note, message)) return false;   // a note must be their words
    if (slots.intent === 'remind_tasks') return !slots.person || EVERYONE_WORDS.has(norm(slots.person)) || isGrounded(norm(slots.person).split(' ')[0], message);
    if (slots.intent === 'rename_task' && slots.newTitle) return isGrounded(slots.newTitle, message);   // the new name is theirs, never invented   // a search word must be in the message
    return true;
}

// ── resolving names and tasks against real data ─────────────────────────────────────────────────

export function resolvePerson(query: string, people: BrainPerson[], excludeId?: string): BrainPerson[] {
    const q = norm(query);
    if (q.length < 2) return [];
    const pool = people.filter(p => p.id !== excludeId);
    const exactTiers = pool.filter(p => norm(p.name) === q);
    if (exactTiers.length) return exactTiers;
    const firstName = pool.filter(p => norm(p.name).split(' ')[0] === q);
    if (firstName.length) return firstName;
    if (q.length >= 3) {
        const partial = matchByName(query, pool);
        if (partial.length) return partial;
    }
    // typo tolerance: "Vidhya" → Vidya, "Lohet" → Lohit
    const fuzzy = pool.filter(p => {
        const first = norm(p.name).split(' ')[0];
        return similarity(q, first) >= 0.8 || similarity(q, p.name) >= 0.8;
    });
    if (fuzzy.length <= 1) return fuzzy;
    const best = Math.max(...fuzzy.map(p => Math.max(similarity(q, norm(p.name).split(' ')[0]), similarity(q, p.name))));
    return fuzzy.filter(p => Math.max(similarity(q, norm(p.name).split(' ')[0]), similarity(q, p.name)) === best);
}

/** "12 Oct" — the day an older open task was given (same wording as the "tasks" list). */
const fromLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const labelOf = (p: BrainPerson) => (p.department ? `${p.name} (${p.department})` : p.name);
const taskLine = (t: BrainTask) => `${t.n}. ${t.title}`;

type TaskResolution =
    | { ok: true; tasks: BrainTask[] }
    | { ok: false; decision: Decision };

const clarify = (reason: ClarifyReason, options: string[] = [], detail: string | null = null): Decision => ({ outcome: 'CLARIFY', reason, options, detail });

function hintCandidates<T extends { title: string }>(hint: string, tasks: T[]): T[] {
    const words = contentWords(hint);
    if (!words.length) return [];
    const score = (t: T) => {
        const tw = contentWords(t.title);
        return words.filter(w => tw.some(x => x === w || (w.length > 3 && x.length > 3 && similarity(w, x) >= 0.8))).length;
    };
    const scored = tasks.map(t => ({ t, s: score(t) }));
    const best = Math.max(0, ...scored.map(x => x.s));
    return best === 0 ? [] : scored.filter(x => x.s === best).map(x => x.t);
}

/** Which of the sender's own tasks does the message point at? Never guesses between several. */
function resolveTasks(which: Which, ctx: BrainContext, opts: { allowAll: boolean; exactlyOne: boolean }): TaskResolution {
    const open = ctx.tasks.filter(t => t.status !== 'completed');
    let targets: BrainTask[] = [];

    if (groupOnly(which)) {
        // "Complete all overdue / yesterday's / today's": every OPEN task of that group on the person's list.
        if (!opts.allowAll || opts.exactlyOne) return { ok: false, decision: clarify('no_task_referenced', open.map(taskLine)) };
        const members = ctx.tasks.filter(t => inGroup(t, which.group!, ctx.today));
        targets = members.filter(t => t.status !== 'completed');
        if (!members.length) return { ok: false, decision: { outcome: 'REFUSE', reason: 'nothing_in_group', detail: groupLabel(which.group!, ctx.today) } };
        if (!targets.length) return { ok: false, decision: { outcome: 'REFUSE', reason: 'task_already_done', detail: members.map(t => t.title).join('; ') } };
        return { ok: true, tasks: targets };
    }
    if (which.all) {
        if (!opts.allowAll || opts.exactlyOne) return { ok: false, decision: clarify('no_task_referenced', open.map(taskLine)) };
        targets = open;
        if (!targets.length) return { ok: false, decision: { outcome: 'REFUSE', reason: 'nothing_to_do', detail: null } };
    } else if (which.numbers.length) {
        const bad = which.numbers.filter(n => n < 1 || n > ctx.tasks.length);
        if (bad.length) return { ok: false, decision: clarify('task_number_out_of_range', open.map(taskLine), `You have ${ctx.tasks.length} task${ctx.tasks.length === 1 ? '' : 's'}; task ${bad.join(', ')} does not exist.`) };
        const named = which.numbers.map(n => ctx.tasks[n - 1]);
        targets = named.filter(t => t.status !== 'completed');
        if (!targets.length) return { ok: false, decision: { outcome: 'REFUSE', reason: 'task_already_done', detail: named.map(t => t.title).join('; ') } };
    } else if (which.hints.length) {
        for (const hint of which.hints) {
            const cands = hintCandidates(hint, open);
            if (cands.length === 1) { targets.push(cands[0]); continue; }
            if (cands.length === 0) {
                const doneMatch = hintCandidates(hint, ctx.tasks.filter(t => t.status === 'completed'));
                if (doneMatch.length) return { ok: false, decision: { outcome: 'REFUSE', reason: 'task_already_done', detail: doneMatch.map(t => t.title).join('; ') } };
                return { ok: false, decision: clarify('no_task_referenced', open.map(taskLine), hint) };
            }
            return { ok: false, decision: clarify('several_tasks_match', cands.map(taskLine), hint) };
        }
        targets = [...new Map(targets.map(t => [t.id, t])).values()];
    } else if (open.length === 1) {
        targets = open;
    } else {
        return { ok: false, decision: clarify('no_task_referenced', open.map(taskLine)) };
    }

    if (opts.exactlyOne && targets.length !== 1) {
        return { ok: false, decision: clarify(targets.length ? 'several_tasks_match' : 'no_task_referenced', (targets.length ? targets : open).map(taskLine)) };
    }
    return { ok: true, tasks: targets };
}

type PersonResolution = { ok: true; person: BrainPerson } | { ok: false; decision: Decision };

function resolveRecipient(name: string | null, ctx: BrainContext): PersonResolution {
    if (!name) return { ok: false, decision: clarify('no_recipient') };
    const n = norm(name);
    if (EVERYONE_WORDS.has(n)) return { ok: false, decision: clarify('no_recipient', [], 'a group') };
    const found = resolvePerson(name, ctx.people);
    if (found.length === 0) return { ok: false, decision: clarify('person_not_found', [], name) };
    if (found.length > 1) return { ok: false, decision: clarify('several_people_match', found.map(labelOf), name) };
    return { ok: true, person: found[0] };
}

const mayGiveWorkTo = (ctx: BrainContext, p: BrainPerson) =>
    p.id === ctx.sender.id || ctx.sender.role === 'superuser' || ctx.assignableIds.includes(p.id);

// ── the decision ────────────────────────────────────────────────────────────────────────────────

/**
 * Part B (2026-10-13): one message, several requests ("done 1 and add HR grievance training video"). Each request is decided
 * on its own by the SAME rules; the ones that are clear become ONE preview ("should I do all of these?") and happen only after
 * ONE yes. A part that is unclear or not allowed is never acted on — the preview says it was not understood. Only changes are
 * combined, and never while replying to someone's request (its numbering is different).
 */
function decide(interp: Interpretation, ctx: BrainContext, policy: ConfirmPolicy): Decision {
    const main = decideOne(interp, ctx, policy);
    const extra = interp.also ?? [];
    if (!extra.length || ctx.pending?.kind === 'ping_reply' || !CHANGE_INTENTS.has(interp.intent)) return main;
    const parts = [
        { label: interp.summary || 'the first part', d: main },
        ...extra.map(x => ({ label: x.summary, d: CHANGE_INTENTS.has(x.intent)
            ? decideOne({ ...interp, intent: x.intent, slots: x.slots, summary: x.summary, grounded: x.grounded, ambiguities: [], also: [], unclear: [] }, ctx, policy)
            : clarify('unknown_intent') })),
    ];
    const isChange = (d: Decision): d is Extract<Decision, { outcome: 'CONFIRM' | 'ACT' }> =>
        (d.outcome === 'CONFIRM' || d.outcome === 'ACT') && d.action.type !== 'chat' && d.action.type !== 'view_tasks' && d.action.type !== 'answer_pending' && d.action.type !== 'find_tasks' && d.action.type !== 'locked_list';
    const clear = parts.filter(p => isChange(p.d));
    if (!clear.length) return main;
    const unclear = [...(interp.unclear ?? []), ...parts.filter(p => !isChange(p.d)).map(p => p.label)];
    // New tasks for the SAME person on the SAME day become one "add these tasks" (one list, one alert), not several steps.
    const actions: Action[] = [];
    for (const a of clear.map(p => (p.d as Extract<Decision, { outcome: 'CONFIRM' | 'ACT' }>).action)) {
        const same = a.type === 'create_tasks' ? actions.find((x): x is Extract<Action, { type: 'create_tasks' }> => x.type === 'create_tasks' && x.assigneeId === a.assigneeId && x.date === a.date) : undefined;
        if (same && a.type === 'create_tasks') same.tasks = [...same.tasks, ...a.tasks].slice(0, MAX_TASKS_PER_MESSAGE);
        else actions.push(a.type === 'create_tasks' ? { ...a, tasks: [...a.tasks] } : a);
    }
    if (actions.length === 1 && !unclear.length) return { outcome: 'CONFIRM', action: actions[0] };
    return { outcome: 'CONFIRM', action: { type: 'batch', actions, unclear } };
}

function decideOne(interp: Interpretation, ctx: BrainContext, policy: ConfirmPolicy): Decision {
    // While the person is replying to someone's request, "done 5" must mean that request's 5th task, never their own task 5.
    // So a plain "complete" is routed through the request's own numbering.
    if (ctx.pending?.kind === 'ping_reply' && interp.slots.intent === 'complete_tasks') {
        const which = interp.slots.which;
        return decideOne({ ...interp, intent: 'progress_update', slots: { intent: 'progress_update', state: which.all ? 'done_all' : 'done_some', which, note: null } }, ctx, policy);
    }
    const { slots } = interp;
    const intent = interp.intent;
    const isChange = CHANGE_INTENTS.has(intent);

    if (intent === 'unknown') return clarify('unknown_intent');
    if (!interp.grounded) return clarify('not_grounded');
    if (isChange && interp.ambiguities.length) return clarify('ai_flagged_ambiguity', [], interp.ambiguities.join('; '));
    if (isChange && interp.confidence < CHANGE_CONFIDENCE_MIN) return clarify('low_confidence');
    if (!isChange && intent !== 'help' && intent !== 'smalltalk' && interp.confidence < READ_CONFIDENCE_MIN) return clarify('low_confidence');

    switch (slots.intent) {
        case 'help': return { outcome: 'ACT', action: { type: 'chat', kind: 'help' } };
        case 'smalltalk': return { outcome: 'ACT', action: { type: 'chat', kind: 'smalltalk' } };

        case 'view_tasks': {
            if (slots.scope === 'self') return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'self', personId: null, department: null, ...(slots.carriedOnly ? { carriedOnly: true } : {}) } };
            if (slots.scope === 'person') {
                const r = resolveRecipient(slots.person, ctx);
                if (!r.ok) return r.decision;
                if (r.person.id !== ctx.sender.id && !mayGiveWorkTo(ctx, r.person)) return { outcome: 'REFUSE', reason: 'not_allowed_to_view', detail: r.person.name };
                return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'person', personId: r.person.id, department: null } };
            }
            // Not a superuser: a company-wide / "who has pending" reading of their question is most likely about their OWN work
            // ("any tasks left?", "how is my progress looking" were sometimes read that way) → show their own list, never
            // "you can't see that". A named department is still refused.
            if (ctx.sender.role !== 'superuser' && (slots.scope === 'org' || slots.scope === 'pending_overview')) {
                return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'self', personId: null, department: null } };
            }
            if (ctx.sender.role !== 'superuser') return { outcome: 'REFUSE', reason: 'not_allowed_to_view', detail: null };
            if (slots.scope === 'department') {
                const dep = slots.department && ctx.departments.find(d => norm(d) === norm(slots.department) || similarity(d, slots.department!) >= 0.8);
                if (!dep) return clarify('department_not_found', ctx.departments.slice(0, 12), slots.department);
                return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'department', personId: null, department: dep } };
            }
            return { outcome: 'ACT', action: { type: 'view_tasks', scope: slots.scope, personId: null, department: null } };
        }

        case 'complete_tasks': {
            const r = resolveTasks(slots.which, ctx, { allowAll: true, exactlyOne: false });
            if (!r.ok) return r.decision;
            // With undo available (policy), the person's own tasks are marked done straight away; otherwise asked first.
            return { outcome: policy.confirmCompletions === false ? 'ACT' : 'CONFIRM', action: { type: 'complete_tasks', taskIds: r.tasks.map(t => t.id) } };
        }

        case 'progress_update': {
            if (slots.state === 'other') return clarify('unsure_answer');
            // A reply to someone's request ("working on it") refers to the tasks in that request.
            let ids: string[];
            if (ctx.pending?.kind === 'ping_reply') {
                // Numbers and words in a reply to someone's request point at the tasks IN THAT REQUEST (1..n), not at the sender's own list.
                const ping = ctx.pending;
                const noRefs = !slots.which.numbers.length && !slots.which.hints.length;
                const everything = slots.state === 'done_all' || slots.which.all;
                // Several people are waiting and the reply names no task ("working on it"): ask who it is for, never guess.
                if (noRefs && !everything && ping.assigners && ping.assigners.length > 1) {
                    return clarify('several_tasks_match', [...ping.assigners.map(a => `${a}'s tasks`), 'All of them'], 'several people are waiting');
                }
                if (slots.state === 'done_some' && noRefs && !everything) {
                    return clarify('no_task_referenced', ping.taskTitles.map((t, i) => `${i + 1}. ${t}`));
                }
                if (noRefs || everything) {
                    ids = ping.taskIds;
                } else {
                    const pseudo = ping.taskIds.map((id, i) => ({ n: i + 1, id, title: ping.taskTitles[i] ?? 'task', status: 'pending' as const }));
                    const r = resolveTasks(slots.which, { ...ctx, tasks: pseudo }, { allowAll: true, exactlyOne: false });
                    if (!r.ok) return r.decision;
                    ids = r.tasks.map(t => t.id);
                }
            } else {
                const needsRefs = slots.state === 'done_some';
                const wholeList = slots.state === 'done_all' || slots.which.all;
                const r = resolveTasks(wholeList ? { ...slots.which, all: true } : slots.which, ctx, { allowAll: true, exactlyOne: false });
                if (!r.ok) return r.decision;
                if (needsRefs && !slots.which.numbers.length && !slots.which.hints.length) return clarify('no_task_referenced', ctx.tasks.filter(t => t.status !== 'completed').map(taskLine));
                ids = r.tasks.map(t => t.id);
            }
            const action: Action = { type: 'progress_update', state: slots.state, taskIds: ids, note: slots.note };
            // "Done" is asked first, unless undo is available (policy) AND these are the person's OWN tasks — a reply to someone's
            // reminder (ping) is relayed to other people and is not undoable, so it is always asked first.
            const finished = slots.state === 'done_all' || slots.state === 'done_some';
            const mustConfirm = policy.confirmProgressUpdates || (finished && (policy.confirmCompletions !== false || ctx.pending?.kind === 'ping_reply'));
            return mustConfirm ? { outcome: 'CONFIRM', action } : { outcome: 'ACT', action };
        }

        case 'create_tasks': {
            if (!slots.tasks.length) return clarify('no_task_content');
            // Owner 2026-10-21: "assign Sanil X, add note" (no text) → ask what the note should say.
            if (slots.wantsNote && slots.tasks.every(t => !t.details)) {
                const who = slots.assignees?.length === 1 ? slots.assignees[0] : !SELF_WORDS.has(norm(slots.assignee)) && slots.assignee !== '?' && slots.assignee !== 'group' ? slots.assignee : null;
                return clarify('note_missing', [], who || null);
            }
            if (slots.tasks.length > MAX_TASKS_PER_MESSAGE) return clarify('too_many_tasks', [], String(MAX_TASKS_PER_MESSAGE));
            if (slots.group) {
                // The AI said WHICH group; code decides WHO is in it — only people this person may give work to.
                const g = resolveGroup(slots.group, ctx);
                if (!g.ok) return g.decision;
                const date = slots.date || ctx.today;
                const actions: Action[] = g.people.map(p => ({ type: 'create_tasks', assigneeId: p.id, tasks: slots.tasks, date }));
                const outcome = policy.confirmCreates === false ? 'ACT' : 'CONFIRM';    // owner 2026-10-21: direct, with undo
                return actions.length === 1 ? { outcome, action: actions[0] } : { outcome, action: { type: 'batch', actions, unclear: [] } };
            }
            return decideCreate(slots, ctx, policy);
        }

        case 'hand_over_task': {
            const t = resolveTasks(slots.which, ctx, { allowAll: false, exactlyOne: true });
            if (!t.ok) return t.decision;
            const r = resolveRecipient(slots.to, ctx);
            if (!r.ok) return r.decision;
            if (r.person.id === ctx.sender.id) return { outcome: 'REFUSE', reason: 'cannot_hand_over_to_self', detail: null };
            if (!mayGiveWorkTo(ctx, r.person)) return { outcome: 'REFUSE', reason: 'not_allowed_to_assign', detail: r.person.name };
            // Owner 2026-10-21: "give task 2 to Neeti, add note" (no text) → ask what the note should say.
            if (slots.wantsNote && !slots.note) return clarify('note_missing', [], r.person.name);
            return { outcome: 'CONFIRM', action: { type: 'hand_over_task', taskId: t.tasks[0].id, toId: r.person.id, ...(slots.note ? { note: slots.note } : {}) } };
        }

        case 'find_tasks': return resolveFind(slots.query, ctx);

        case 'delete_tasks': {
            // Any of their OWN tasks, open or done; named, numbered, or a whole group / "all". Always previewed, then YES.
            const r = resolveOwnAny(slots.which, ctx, false);
            if (!r.ok) return r.decision;
            return { outcome: 'CONFIRM', action: { type: 'delete_tasks', taskIds: r.tasks.map(t => t.id) } };
        }

        case 'rename_task': {
            const r = resolveOwnAny(slots.which, ctx, true);
            if (!r.ok) return r.decision;
            if (!slots.newTitle) return clarify('no_task_content', [], 'new name');
            if (norm(slots.newTitle) === norm(r.tasks[0].title)) return clarify('no_task_content', [], 'same name');
            return { outcome: 'CONFIRM', action: { type: 'rename_task', taskId: r.tasks[0].id, title: slots.newTitle } };
        }

        case 'add_note': return decideNote(slots, ctx);
        case 'remind_tasks': return decideRemind(slots, ctx);
        case 'lock_task': return decideLock(slots, ctx);

        case 'answer_pending': {
            const p = ctx.pending;
            if (!p || p.kind === 'ping_reply') return clarify(p ? 'unsure_answer' : 'nothing_pending');
            // Owner 2026-10-19: an unfinished request can only be dropped this way ("leave it"); anything else keeps it open.
            if (p.kind === 'draft') return slots.answer === 'no' ? { outcome: 'ACT', action: { type: 'answer_pending', answer: 'no', pick: null, instruction: null } } : clarify('unsure_answer', [], p.question);
            if (slots.answer === 'unsure') return clarify('unsure_answer', [], p.kind === 'confirm' ? p.summary : null);
            if (slots.answer === 'pick') {
                if (p.kind !== 'pick' || !slots.pick || slots.pick > p.options.length) return clarify('bad_pick', p.kind === 'pick' ? p.options.map((o, i) => `${i + 1}. ${o}`) : []);
                return { outcome: 'ACT', action: { type: 'answer_pending', answer: 'pick', pick: slots.pick, instruction: null } };
            }
            if (p.kind === 'pick') return clarify('bad_pick', p.options.map((o, i) => `${i + 1}. ${o}`));
            if (slots.answer === 'edit' && !slots.instruction) return clarify('unsure_answer', [], p.kind === 'confirm' ? p.summary : null);
            return { outcome: 'ACT', action: { type: 'answer_pending', answer: slots.answer, pick: null, instruction: slots.instruction } };
        }

        default:
            return clarify('unknown_intent');
    }
}

/**
 * Owner 2026-10-19: adding tasks, for one person, several people ("Parab and Neeti"), or a different person per line.
 * Every name is checked like any name; a person the sender may not give work to is left out and said so in the preview
 * (never silently). Same person + same day → one "add these tasks" (one list, one alert).
 */
function decideCreate(slots: Extract<Slots, { intent: 'create_tasks' }>, ctx: BrainContext, policy: ConfirmPolicy): Decision {
    const date = slots.date || ctx.today;
    let top = slots.assignees?.length ? slots.assignees : [slots.assignee];
    // Owner 2026-10-21 (Sher: "add task follow up regarding Checklist" got two questions): nobody named → their OWN list.
    // Only when they say to assign it to someone without saying who ("assign a task about the audit") → ask who.
    const unknownWho = (names: string[]) => !names.length || names.every(n => { const w = norm(n); return w === '?' || w === '' || w === 'unknown'; });
    if (slots.tasks.some(t => !(t.assignees?.length) && unknownWho(top))) {
        if (ASKS_TO_ASSIGN.test(ctx.message ?? '')) return clarify('no_recipient');
        if (unknownWho(top)) top = ['me'];
    }

    const people = new Map<string, BrainPerson>();      // resolved once per name
    const refused: string[] = [];
    const actions: Array<Extract<Action, { type: 'create_tasks' }>> = [];
    for (const task of slots.tasks) {
        const names = task.assignees?.length ? task.assignees : top;
        for (const name of names) {
            const key = norm(name);
            let person = people.get(key);
            if (!person) {
                if (SELF_WORDS.has(key)) person = ctx.sender;
                else {
                    const r = resolveRecipient(name, ctx);
                    if (!r.ok) return r.decision;                    // not found / two people fit → ask, keep nothing
                    person = r.person;
                }
                people.set(key, person);
            }
            if (!mayGiveWorkTo(ctx, person)) { if (!refused.includes(person.name)) refused.push(person.name); continue; }
            const same = actions.find(x => x.assigneeId === person!.id);
            const item = { title: task.title, details: task.details };
            if (same) { if (!same.tasks.some(t => norm(t.title) === norm(item.title))) same.tasks.push(item); }
            else actions.push({ type: 'create_tasks', assigneeId: person.id, tasks: [item], date });
        }
    }
    if (!actions.length) return { outcome: 'REFUSE', reason: 'not_allowed_to_assign', detail: refused.join(', ') };
    const unclear = refused.map(n => `you can't assign tasks to ${n}`);
    // Owner 2026-10-21: a clear request is saved straight away with undo (only while "One front door" is ON). When someone
    // named could not be given the work, the preview still asks first, so nobody is silently left out.
    const outcome = policy.confirmCreates === false && !unclear.length ? 'ACT' : 'CONFIRM';
    if (actions.length === 1 && !unclear.length) return { outcome, action: actions[0] };
    return { outcome, action: { type: 'batch', actions, unclear } };
}

/**
 * Owner 2026-10-20: a note on a task that already exists. Only the sender's OWN tasks and open tasks they GAVE someone
 * (ctx.noteTargets) can be picked. A person's name only narrows WHOSE task it is: "add note to Srushti's onboarding" looks
 * at Onboarding tasks given to Srushti; without a name, all of them. Never guesses between several (asks, showing whose).
 * The server checks the permission again when the note is saved (WorkspaceService.addNote).
 */
interface NoteCandidate { id: string; title: string; ownerId: string; ownerName: string | null; date: string | null; open: boolean }
const MAX_NOTE_OPTIONS = 10;
const noteLabel = (c: NoteCandidate) => (c.ownerName ? `${c.title} (${c.ownerName}${c.date ? `, ${fromLabel(c.date)}` : ''})` : `${c.title} (yours)`);

function decideNote(slots: Extract<Slots, { intent: 'add_note' }>, ctx: BrainContext): Decision {
    if (!slots.note) return clarify('no_task_content', [], 'note');
    const toAction = (c: NoteCandidate): Decision => ({ outcome: 'CONFIRM', action: { type: 'add_note', taskId: c.id, note: slots.note!, title: c.title, ownerName: c.ownerName } });
    const own: NoteCandidate[] = ctx.tasks.map(t => ({ id: t.id, title: t.title, ownerId: ctx.sender.id, ownerName: null, date: t.from ?? null, open: t.status !== 'completed' }));
    const given: NoteCandidate[] = (ctx.noteTargets ?? []).filter((t: NoteTarget) => t.ownerId !== ctx.sender.id)
        .map(t => ({ id: t.id, title: t.title, ownerId: t.ownerId, ownerName: t.ownerName, date: t.date, open: true }));

    // A number always means their own numbered list ("add note to task 2: …").
    if (slots.which.numbers.length) {
        const r = resolveOwnAny(slots.which, ctx, true);
        if (!r.ok) return r.decision;
        return toAction(own.find(c => c.id === r.tasks[0].id)!);
    }

    let pool = [...own, ...given];
    if (slots.person) {
        const key = norm(slots.person);
        if (SELF_WORDS.has(key) || resolvePerson(slots.person, [ctx.sender]).length) pool = own;
        else {
            const owners = new Map<string, BrainPerson>(ctx.people.map(p => [p.id, p]));
            for (const g of given) if (!owners.has(g.ownerId)) owners.set(g.ownerId, { id: g.ownerId, name: g.ownerName!, department: null, role: 'employee' });
            const found = resolvePerson(slots.person, [...owners.values()].filter(p => p.id !== ctx.sender.id));
            if (found.length > 1) return clarify('several_people_match', found.map(labelOf), slots.person);
            if (!found.length) return clarify('person_not_found', [], slots.person);
            pool = given.filter(c => c.ownerId === found[0].id);
            if (!pool.length) return clarify('no_task_referenced', [...own, ...given].slice(0, MAX_NOTE_OPTIONS).map(noteLabel), `no open task you gave ${found[0].name}`);
        }
    }
    if (!pool.length) return clarify('no_task_referenced');

    const hint = slots.which.hints.join(' ');
    if (!hint) {
        const open = pool.filter(c => c.open);
        if (open.length === 1) return toAction(open[0]);
        return clarify('no_task_referenced', (open.length ? open : pool).slice(0, MAX_NOTE_OPTIONS).map(noteLabel));
    }
    const cands = hintCandidates(hint, pool);
    const openCands = cands.filter(c => c.open);
    const best = openCands.length ? openCands : cands;
    if (best.length === 1) return toAction(best[0]);
    if (!best.length) return clarify('no_task_referenced', pool.slice(0, MAX_NOTE_OPTIONS).map(noteLabel), hint);
    return clarify('several_tasks_match', best.slice(0, MAX_NOTE_OPTIONS).map(noteLabel), hint);
}

/**
 * Owner 2026-10-20: remind the people doing tasks the sender GAVE (ctx.noteTargets: open, last 30 days). A name narrows
 * whose tasks; no task words = all of that person's open tasks; "overdue" = only tasks given before today. Several people's
 * tasks fit one task name → ask which. The server checks everything again (WorkspaceService.remindTasks).
 */
const MAX_REMIND = 50;
function decideRemind(slots: Extract<Slots, { intent: 'remind_tasks' }>, ctx: BrainContext): Decision {
    const label = (t: NoteTarget) => `${t.title} (${t.ownerName}, ${fromLabel(t.date)})`;
    let pool = (ctx.noteTargets ?? []).filter(t => t.ownerId !== ctx.sender.id);
    if (slots.overdueOnly) pool = pool.filter(t => t.date < ctx.today);
    const everyone = !slots.person || EVERYONE_WORDS.has(norm(slots.person));
    if (!everyone) {
        const owners = new Map<string, BrainPerson>(ctx.people.map(p => [p.id, p]));
        for (const g of ctx.noteTargets ?? []) if (!owners.has(g.ownerId)) owners.set(g.ownerId, { id: g.ownerId, name: g.ownerName, department: null, role: 'employee' });
        const found = resolvePerson(slots.person!, [...owners.values()].filter(p => p.id !== ctx.sender.id));
        if (found.length > 1) return clarify('several_people_match', found.map(labelOf), slots.person);
        if (!found.length) return clarify('person_not_found', [], slots.person);
        pool = pool.filter(t => t.ownerId === found[0].id);
        if (!pool.length) return { outcome: 'REFUSE', reason: 'nothing_to_remind', detail: found[0].name };
    }
    if (!pool.length) return { outcome: 'REFUSE', reason: 'nothing_to_remind', detail: null };
    const hint = slots.which.hints.join(' ');
    let picked = pool;
    if (hint) {
        picked = hintCandidates(hint, pool);
        if (!picked.length) return clarify('no_task_referenced', pool.slice(0, MAX_NOTE_OPTIONS).map(label), hint);
        if (new Set(picked.map(t => t.ownerId)).size > 1) return clarify('several_tasks_match', picked.slice(0, MAX_NOTE_OPTIONS).map(label), hint);
    } else if (everyone && !slots.overdueOnly && !slots.which.all) {
        // "remind them" with no name, no task and no "overdue": ask which, never remind everyone by guesswork.
        return clarify('no_task_referenced', pool.slice(0, MAX_NOTE_OPTIONS).map(label));
    }
    picked = picked.slice(0, MAX_REMIND);
    return { outcome: 'CONFIRM', action: { type: 'remind_tasks', taskIds: picked.map(t => t.id), lines: picked.map(label) } };
}

/**
 * Owner 2026-10-20: lock / unlock the person's OWN tasks (repeat every working day), or list the repeating ones. Team fixed
 * tasks are set by an admin and are never changed here. The server checks again (WorkspaceService.setLocked).
 */
function decideLock(slots: Extract<Slots, { intent: 'lock_task' }>, ctx: BrainContext): Decision {
    if (slots.action === 'list') return { outcome: 'ACT', action: { type: 'locked_list' } };
    const r = resolveOwnAny(slots.which, ctx, false);
    if (!r.ok) return r.decision;
    const lock = slots.action === 'lock';
    const fixed = r.tasks.filter(t => t.teamFixed);
    const ok = r.tasks.filter(t => !t.teamFixed && (lock ? !t.locked : !!t.locked));
    if (!ok.length) {
        if (fixed.length) return { outcome: 'REFUSE', reason: 'team_fixed', detail: fixed.map(t => t.title).join('; ') };
        return { outcome: 'REFUSE', reason: lock ? 'already_locked' : 'not_locked', detail: r.tasks.map(t => t.title).join('; ') };
    }
    return { outcome: 'CONFIRM', action: { type: 'lock_tasks', taskIds: ok.map(t => t.id), lock } };
}

/** Most people one group message may give work to (more → ask to narrow it down). */
const MAX_GROUP = 40;

/**
 * "Assign everyone …" / "my team" / "everyone in Tech except Harsh": the AI only DESCRIBES the group; code turns it into people,
 * using ONLY the people this person may give work to (superuser: everyone). Names in "except" are resolved like any name.
 */
function resolveGroup(g: { whose: 'team' | 'department' | 'everyone'; department: string | null; except: string[] }, ctx: BrainContext): { ok: true; people: BrainPerson[] } | { ok: false; decision: Decision } {
    const allowed = ctx.people.filter(p => p.id !== ctx.sender.id && mayGiveWorkTo(ctx, p));
    let pool = allowed;
    if (g.whose === 'department') {
        const dep = g.department && ctx.departments.find(d => norm(d) === norm(g.department) || similarity(d, g.department!) >= 0.8);
        if (!dep) return { ok: false, decision: clarify('department_not_found', ctx.departments.slice(0, 12), g.department) };
        pool = allowed.filter(p => p.department === dep);
    } else if (g.whose === 'team' && ctx.sender.role === 'superuser') {
        pool = allowed.filter(p => p.department === ctx.sender.department);      // a superuser's "team" = their own department
    }
    for (const name of g.except) {
        const found = resolvePerson(name, pool);
        if (found.length > 1) return { ok: false, decision: clarify('several_people_match', found.map(labelOf), name) };
        pool = pool.filter(p => !found.some(f => f.id === p.id));
    }
    if (!pool.length) return { ok: false, decision: clarify('no_recipient', [], 'a group') };
    if (pool.length > MAX_GROUP) return { ok: false, decision: clarify('too_many_tasks', [], String(MAX_GROUP)) };
    return { ok: true, people: pool };
}

/** Delete / rename: which of their OWN tasks (open OR done) — by number or by words; never guesses between several. */
function resolveOwnAny(which: Which, ctx: BrainContext, exactlyOne: boolean): TaskResolution {
    const all = ctx.tasks;
    let targets: BrainTask[] = [];
    if (!exactlyOne && (groupOnly(which) || (which.all && !which.numbers.length && !which.hints.length))) {
        // Owner 2026-10-15: "delete all overdue / today's / 13 Oct's / all my tasks" — open or done, always previewed, then YES.
        targets = which.group ? all.filter(t => inGroup(t, which.group!, ctx.today)) : all;
        if (!targets.length) return { ok: false, decision: { outcome: 'REFUSE', reason: which.group ? 'nothing_in_group' : 'nothing_to_do', detail: which.group ? groupLabel(which.group, ctx.today) : null } };
        return { ok: true, tasks: targets };
    }
    if (which.numbers.length) {
        const bad = which.numbers.filter(n => !all.some(t => t.n === n));
        if (bad.length) return { ok: false, decision: clarify('task_number_out_of_range', all.map(taskLine), `You have no task ${bad.join(', ')} on your list.`) };
        targets = which.numbers.map(n => all.find(t => t.n === n)!);
    } else if (which.hints.length) {
        for (const hint of which.hints) {
            const cands = hintCandidates(hint, all);
            if (cands.length === 1) { targets.push(cands[0]); continue; }
            return { ok: false, decision: clarify(cands.length ? 'several_tasks_match' : 'no_task_referenced', (cands.length ? cands : all).map(taskLine), hint) };
        }
        targets = [...new Map(targets.map(t => [t.id, t])).values()];
    } else {
        return { ok: false, decision: clarify('no_task_referenced', all.map(taskLine)) };
    }
    if (exactlyOne && targets.length !== 1) return { ok: false, decision: clarify('several_tasks_match', targets.map(taskLine)) };
    return { ok: true, tasks: targets };
}

/**
 * Flexible "look up tasks": turn the AI's form into allowed people and exact dates. The permission rule is the same as
 * everywhere: your own tasks; people you may give work to; a department / everyone only for a superuser. A name that is
 * unclear is asked about, never guessed. The lookup is checked AGAIN when it runs (ExecIO.findTasks).
 */
function resolveFind(q: TaskQuery, ctx: BrainContext): Decision {
    const me = ctx.sender;
    const isSuper = me.role === 'superuser';
    const visible = new Set([me.id, ...ctx.assignableIds]);
    const refuse = (detail: string | null): Decision => ({ outcome: 'REFUSE', reason: 'not_allowed_to_view', detail });
    let ids: string[] = []; let who = '';
    // "What have I given out / assigned?" = work I gave to ANYONE (myself included), never only my own list.
    const whose = q.whose === 'me' && q.givenBy === 'me' ? 'anyone' : q.whose;
    switch (whose) {
        case 'me': ids = [me.id]; who = 'your tasks'; break;
        case 'people': {
            const names: string[] = [];
            for (const n of q.people) {
                if (SELF_WORDS.has(norm(n))) { ids.push(me.id); names.push('you'); continue; }
                const r = resolveRecipient(n, ctx);
                if (!r.ok) return r.decision;
                if (!visible.has(r.person.id)) return refuse(r.person.name);
                ids.push(r.person.id); names.push(r.person.name);
            }
            who = names.join(', ');
            break;
        }
        case 'team':
            if (!ctx.assignableIds.length) return refuse(null);
            ids = [...ctx.assignableIds]; who = 'your team'; break;
        case 'department': {
            if (!isSuper) return refuse(null);
            const dep = q.department && ctx.departments.find(d => norm(d) === norm(q.department) || similarity(d, q.department!) >= 0.8);
            if (!dep) return clarify('department_not_found', ctx.departments.slice(0, 12), q.department);
            ids = ctx.people.filter(p => p.department === dep).map(p => p.id); who = dep; break;
        }
        case 'everyone':
            if (!isSuper) return refuse(null);
            ids = [...visible]; who = 'everyone'; break;
        default:
            ids = [...visible]; who = ''; break;   // "anyone": everyone this person may see
    }
    let givenById: string | null = null; let givenByLabel: string | null = null;
    if (q.givenBy === 'me') { givenById = me.id; givenByLabel = 'you'; }
    else if (q.givenBy === 'person') {
        if (!q.givenByName) return clarify('no_recipient');
        const found = resolvePerson(q.givenByName, [me, ...ctx.people.filter(p => p.id !== me.id)]);
        if (!found.length) return clarify('person_not_found', [], q.givenByName);
        if (found.length > 1) return clarify('several_people_match', found.map(labelOf), q.givenByName);
        givenById = found[0].id; givenByLabel = found[0].id === me.id ? 'you' : found[0].name;
    }
    const range = periodRange(q, ctx.today);
    return { outcome: 'ACT', action: { type: 'find_tasks', query: {
        employeeIds: [...new Set(ids)], whoLabel: who, givenById, givenByLabel, from: range.from, to: range.to, periodLabel: range.label,
        dateField: q.dateField, status: q.status, overdueOnly: q.overdueOnly, minDaysOld: q.minDaysOld, kind: q.kind, words: q.words,
        showAs: q.showAs, sort: q.sort, limit: q.limit, today: ctx.today,
    } } };
}

// ── what a reply may say ────────────────────────────────────────────────────────────────────────

const STATUS_WORD: Record<BrainTask['status'], string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Done' };
const bullets = (titles: string[]) => titles.map(t => `• ${t}`).join('\n');
const first = (name: string) => name.split(' ')[0];
const CAPABILITIES = [
    '• See your tasks ("what\'s pending today?")',
    '• Mark things done ("finished the carpet one")',
    '• Add tasks for yourself or a teammate ("assign Vidya a task to chase the vendor")',
    '• Hand one of your tasks to a teammate',
    '• Add a note to a task ("add note to onboarding: documents pending")',
    '• Remind someone about a task you gave them ("remind Srushti about onboarding")',
    '• Make a task repeat every working day ("lock task 2", "unlock task 3")',
].join('\n');

const STATE_PHRASE: Record<ProgressState, string> = {
    working: 'you are working on', partly_done: 'you are part-way through', blocked: 'you are blocked on',
    done_all: 'you have finished', done_some: 'you have finished', other: 'you have an update on',
};

/**
 * Part B4: when the bot is unsure, it never sends a bare "I'm not sure, could you clarify?" (2026-10-12, Lohit got three in a
 * row). It shows the person's REAL open tasks and how to act on them, so the next message can be a plain "done 2".
 */
const MAX_SHOWN_OPEN = 8;
function openTasksBlock(ctx: BrainContext): { list: string; hint: string } | null {
    const open = ctx.tasks.filter(t => t.status !== 'completed');
    if (!open.length) return null;
    const shown = headedList(open.slice(0, MAX_SHOWN_OPEN).map(t => ({ carried: !!t.from, line: taskLine(t) })));
    const more = open.length > MAX_SHOWN_OPEN ? `\n…and ${open.length - MAX_SHOWN_OPEN} more (reply *tasks* to see all)` : '';
    return { list: shown + more, hint: `Reply *done ${open[0].n}* when you finish task ${open[0].n}, or tell me what you'd like in your own words.` };
}

function clarifyFacts(d: Extract<Decision, { outcome: 'CLARIFY' }>, ctx: BrainContext): ReplyFacts {
    const opts = d.options.join('\n');
    // Nothing is waiting for a yes after a clarifying question (except "unsure_answer", where the question still stands).
    const base = { kind: `clarify_${d.reason}`, asksQuestion: true, claimsNothingDone: true, names: [ctx.sender.name], noYesNoQuestion: d.reason !== 'unsure_answer' && d.reason !== 'suggest_add' };
    const block = openTasksBlock(ctx);
    // The generic "not sure" cases: say what is possible AND show the open tasks (code inserts them; never a vague question alone).
    const withOpenTasks = (describe: string, fallbackQ: string): ReplyFacts => block
        ? { ...base, describe: `${describe} Then show their open tasks (inserted by the system) and the hint.`, values: { tasks: block.list, hint: block.hint }, required: ['tasks', 'hint'], fallback: `${fallbackQ}\n\nYour open tasks:\n${block.list}\n\n${block.hint}` }
        : { ...base, describe: `${describe} They have no open tasks; mention they can add one.`, values: {}, required: [], fallback: `${fallbackQ} You have no open tasks right now; you can add one by telling me what it is.` };
    const withOptions = (describe: string, fallbackQ: string): ReplyFacts => ({
        ...base, describe, values: { options: opts }, required: d.options.length ? ['options'] : [], fallback: d.options.length ? `${fallbackQ}\n${opts}` : fallbackQ,
    });
    switch (d.reason) {
        case 'no_task_referenced': return withOptions('The person wants to act on a task but did not say which. Ask which one they mean and show the open tasks.', 'Which task do you mean?');
        case 'several_tasks_match': return withOptions('More than one task fits what the person said. Ask which one they mean, showing the matching tasks.', 'Which of these do you mean?');
        case 'task_number_out_of_range': return withOptions(`The task number does not exist (${d.detail}). Say so briefly and ask which task they meant, showing the open tasks.`, `${d.detail} Which task did you mean?`);
        case 'several_people_match': return withOptions(`More than one person could be "${d.detail}". Ask which one, showing the people.`, `Which ${first(d.detail || 'person')} do you mean?`);
        case 'bad_pick': return withOptions('The person needs to choose one of the options. Ask them to reply with the number of the one they mean, showing the options.', 'Please reply with the number of the one you mean.');
        case 'department_not_found': return withOptions('No such department was found. Ask which department they mean, showing the known ones.', 'Which department do you mean?');
        case 'person_not_found': return { ...base, describe: `No one called "${d.detail}" could be found among the people the person can work with. Say so and ask who they meant.`, values: { person: d.detail || '' }, required: [], fallback: `I couldn't find anyone called ${d.detail}. Who did you mean?` };
        case 'no_recipient': return { ...base, describe: d.detail ? 'The person named a group, but work can only be given to one named person at a time. Ask who exactly it is for.' : 'The person did not say who it is for. Ask who it is for.', values: {}, required: [], fallback: 'Who is this for?' };
        case 'no_task_content': if (d.detail === 'note') return { ...base, describe: 'The person wants to add a note to a task but did not say what the note is. Ask what the note should say.', values: {}, required: [], fallback: 'What should the note say?' };
            return d.detail === 'new name' || d.detail === 'same name'
            ? { ...base, describe: d.detail === 'same name' ? 'The task already has that name. Say so and ask what the new name should be.' : 'The person wants to rename a task but did not give the new name. Ask what it should be.', values: {}, required: [], fallback: d.detail === 'same name' ? 'That task already has that name. What should the new name be?' : 'What should the new name be?' }
            : { ...base, describe: 'The person wants to add a task but did not say what it is. Ask what the task should be.', values: {}, required: [], fallback: 'What should the task be?' };
        case 'note_missing': return { ...base, describe: `The person asked to add a note${d.detail ? ` for ${d.detail}` : ''} but did not say what it is. Ask ONE short question: what should the note say?`,
            values: {}, required: [], fallback: `What note should I add${d.detail ? ` for ${first(d.detail)}` : ''}?` };
        case 'suggest_add': return { ...base, describe: 'You are not sure what the person wants, but it looks like they want to add a task. Ask ONE short question: did they want to add this task (inserted by the system) to their own list? They can reply yes, or say who it is for.',
            values: { task: `• ${d.detail || ''}` }, required: ['task'], fallback: `Did you want to add this task to your list?\n• ${d.detail || ''}\nReply *yes*, or tell me who it's for.` };
        case 'add_or_assign': return { ...base, describe: `The person named a piece of work ([[work]]) but did not say who it is for. Ask ONE short question: should it go on their own list, or be assigned to someone (and who)?`,
            values: { work: d.detail || 'this' }, required: [], fallback: `Should I add "${d.detail || 'this'}" to your own list, or assign it to someone? If someone, who?` };
        case 'too_many_tasks': return { ...base, describe: `Too many tasks in one message (the limit is ${d.detail}). Ask them to send fewer at a time.`, values: {}, required: [], fallback: `That is a lot of tasks at once. Could you send them in smaller groups (up to ${d.detail})?` };
        case 'nothing_pending': return withOpenTasks('Nothing is waiting for a yes or no from the person right now. Say so lightly and ask what they would like to do.', 'Nothing is waiting for a yes right now. What would you like to do?');
        case 'unsure_answer': return { ...base, describe: 'The person\'s answer was not clear. Ask them to confirm what they want, in a simple yes-or-no way.', values: { pending: d.detail || '' }, required: [], fallback: 'Sorry, I wasn\'t sure what you meant. Could you say yes or no, or tell me what to change?' };
        case 'not_grounded': return { ...base, describe: 'You are not sure you captured the task wording correctly. Ask them to say the task again in one short sentence.', values: {}, required: [], fallback: 'I want to get that exactly right. Could you say the task again in one short sentence?' };
        case 'ai_flagged_ambiguity': return withOpenTasks(`Something in the message was unclear (${d.detail}). Say briefly what was unclear and ask ONE short question that clears it up.`, 'I want to be sure I understood. Which task do you mean, or what would you like to do?');
        case 'low_confidence': return withOpenTasks('You are not sure what the person wants. Ask ONE short question: do they want to see tasks, add a task, or mark one done?', 'I\'m not sure I understood. Would you like to see your tasks, add a task, or mark one done?');
        default: return withOpenTasks('You did not understand the message. Say so briefly and ask what they would like to do.', 'I didn\'t quite get that. What would you like to do?');
    }
}

/**
 * Owner 2026-10-20: a new task gets a note ONLY when the person marked one ("note:" / "remark:"). Anything the AI put in
 * "details" without that mark goes back into the title, so no word is lost and nothing becomes a note by guesswork
 * (Sanil's "Add task … Technical exe, Ops manager, AFM" was turned into a note).
 */
// Owner 2026-10-20: the word itself is enough ("onboarding note Satish"); a ":" is not needed.
export const NOTE_MARK = /(?:\b(?:note|notes|remark|remarks|nb)\b|नोट)/i;
const NUMBERED_LINE = /^\s*\d{1,3}\s*[.)]\s+\S/;
export function foldUnmarkedNotes<S extends Slots>(slots: S, ownWords: string): S {
    if (slots.intent !== 'create_tasks' || NOTE_MARK.test(ownWords)) return slots;
    // Owner 2026-10-20 (Roohi): a NUMBERED list with a detail on its own line under a task ("1. Diwali poll" then
    // "Pending · from Team") keeps that detail as the task's note. Sanil's unnumbered lines are tasks, never notes.
    const lines = ownWords.split('\n');
    const numbered = lines.filter(l => NUMBERED_LINE.test(l)).length >= 2;
    const detailLines = numbered ? lines.filter(l => l.trim() && !NUMBERED_LINE.test(l)).join('\n') : '';
    const keep = (d: string) => numbered && isGrounded(d, detailLines);
    return { ...slots, tasks: slots.tasks.map(t => (t.details && !keep(t.details) ? { ...t, title: clip(`${t.title} - ${t.details}`, MAX_TITLE_LENGTH), details: null } : t)) };
}

/** Owner 2026-10-20: a new task with a note reads "Onboarding (note: Satish)" in every preview. */
const withNote = (t: { title: string; details: string | null }) => (t.details ? `${t.title} (note: ${t.details})` : t.title);

/** One line of a combined preview, written by code from verified data. */
function batchLine(a: Action, ctx: BrainContext): string {
    const titleOf = (id: string) => ctx.tasks.find(t => t.id === id)?.title ?? 'that task';
    const who = (id: string) => (id === ctx.sender.id ? 'you' : ctx.people.find(p => p.id === id)?.name ?? 'them');
    switch (a.type) {
        case 'complete_tasks': return `Mark done: ${a.taskIds.map(titleOf).join(', ')}`;
        case 'progress_update': return a.state === 'done_all' || a.state === 'done_some' ? `Mark done: ${a.taskIds.map(titleOf).join(', ')}` : `Note ${STATE_PHRASE[a.state].replace(/^you are |^you have /, '')}: ${a.taskIds.map(titleOf).join(', ')}`;
        case 'create_tasks': return `Add for ${who(a.assigneeId)}${a.date !== ctx.today ? ` (${dayLabel(a.date)})` : ''}: ${a.tasks.map(withNote).join(', ')}`;
        case 'hand_over_task': return `Give "${titleOf(a.taskId)}" to ${who(a.toId)}${a.note ? ` (note: ${a.note})` : ''}`;
        case 'delete_tasks': return `Delete: ${a.taskIds.map(titleOf).join(', ')}`;
        case 'rename_task': return `Rename "${titleOf(a.taskId)}" to "${a.title}"`;
        case 'add_note': return `Add note to "${a.title}"${a.ownerName ? ` (${a.ownerName})` : ''}: ${a.note}`;
        case 'remind_tasks': return `Send a reminder about: ${a.lines.join(', ')}`;
        case 'lock_tasks': return `${a.lock ? 'Repeat every working day' : 'Stop repeating'}: ${a.taskIds.map(titleOf).join(', ')}`;
        default: return 'One more change';
    }
}

function replyFacts(decision: Decision, ctx: BrainContext, result?: ExecutionResult): ReplyFacts | null {
    const sender = ctx.sender;
    const titleOf = (id: string) => ctx.tasks.find(t => t.id === id)?.title ?? 'that task';
    const personName = (id: string) => (id === sender.id ? 'you' : ctx.people.find(p => p.id === id)?.name ?? 'them');

    if (decision.outcome === 'HANDOFF') return null;
    if (decision.outcome === 'CLARIFY') return clarifyFacts(decision, ctx);

    if (decision.outcome === 'REFUSE') {
        const d = decision.detail || '';
        const texts: Record<string, [string, string]> = {
            not_allowed_to_assign: [`The person asked to give work to ${d}, but they are not allowed to assign tasks to that person. Say so kindly, in one sentence.`, `Sorry, you can't assign tasks to ${d}.`],
            task_already_done: [`The task(s) they mean are already finished (${d}). Say so briefly.`, `That one is already marked done: ${d}.`],
            not_allowed_to_view: [d ? `They asked to see ${d}'s tasks, but they are not allowed to. Say so kindly.` : 'They asked for information they are not allowed to see. Say so kindly.', 'Sorry, that isn\'t something you can see.'],
            cannot_hand_over_to_self: ['They tried to give a task to themself. Say it is already theirs and ask who it should go to.', 'That task is already yours. Who should it go to?'],
            nothing_to_do: ['They have no open tasks left to act on. Say so cheerfully.', 'You have no open tasks right now.'],
            already_locked: [`The task(s) already repeat every working day (${d}). Say so briefly.`, `That already repeats every working day: ${d}.`],
            not_locked: [`The task(s) are not locked, so there is nothing to unlock (${d}). Say so briefly.`, `That task doesn't repeat, so there's nothing to unlock: ${d}.`],
            team_fixed: [`That is a team fixed task set by an admin (${d}); it cannot be locked or unlocked here. Say so kindly.`, `That's a team fixed task set by your admin, so it can't be changed here: ${d}.`],
            nothing_to_remind: [d ? `There are no open tasks they gave ${d} to remind about. Say so briefly.` : 'There are no open tasks they gave anyone to remind about. Say so briefly.', d ? `You have no open tasks given to ${d} to remind about.` : 'You have no open tasks given to anyone to remind about.'],
            nothing_in_group: [`There are no tasks from ${d || 'that day'} on their list. Say so briefly.`, `There are no tasks from ${d || 'that day'} on your list.`],
        };
        const [describe, fallback] = texts[decision.reason];
        // Part B4: "already done" also shows what is still open, so the next step is obvious (Lohit, 2026-10-12).
        const block = decision.reason === 'task_already_done' ? openTasksBlock(ctx) : null;
        if (block) {
            return { kind: `refuse_${decision.reason}`, describe: `${describe} Then show the tasks that are still open (inserted by the system) and the hint.`, values: { tasks: block.list, hint: block.hint },
                required: ['tasks', 'hint'], asksQuestion: false, claimsNothingDone: true, noYesNoQuestion: true, names: [sender.name, ...(d ? [d] : [])], fallback: `${fallback}\n\nStill open:\n${block.list}\n\n${block.hint}` };
        }
        return { kind: `refuse_${decision.reason}`, describe, values: {}, required: [], asksQuestion: decision.reason === 'cannot_hand_over_to_self', claimsNothingDone: true, noYesNoQuestion: true, names: [sender.name, ...(d ? [d] : [])], fallback };
    }

    const a = decision.action;
    const confirming = decision.outcome === 'CONFIRM';

    if (confirming && a.type === 'batch') {
        // Owner 2026-10-19: a list given to several people reads best one line per task: "1. Review quotation → Sanil".
        const onlyCreates = a.actions.every(x => x.type === 'create_tasks');
        const who = (id: string) => (id === sender.id ? 'You' : ctx.people.find(p => p.id === id)?.name ?? 'them');
        const items = onlyCreates
            ? a.actions.flatMap(x => x.type === 'create_tasks' ? x.tasks.map(t => `${withNote(t)} → ${who(x.assigneeId)}${x.date !== ctx.today ? ` (${dayLabel(x.date)})` : ''}`) : [])
                .map((line, i) => `${i + 1}. ${line}`).join('\n')
            : bullets(a.actions.map(x => batchLine(x, ctx)));
        const unclear = a.unclear.length ? a.unclear.join('; ') : '';
        return { kind: 'confirm_batch', describe: `Ask the person to confirm doing ALL of these together (one yes for everything). Nothing has happened yet.${unclear ? ' Also say, in a short separate sentence, that you could not work out one part ([[unclear]]) and they can send it again on its own.' : ''}`,
            values: { items, ...(unclear ? { unclear } : {}) }, required: ['items', ...(unclear ? ['unclear'] : [])], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `Should I do all of these?\n${items}${unclear ? `\n\n(I couldn't work out: ${unclear}. Please send it again on its own.)` : ''}` };
    }

    if (confirming && a.type === 'complete_tasks') {
        const titles = a.taskIds.map(titleOf);
        return { kind: 'confirm_complete', describe: `Ask the person to confirm marking ${titles.length === 1 ? 'this task' : `these ${titles.length} tasks`} as done. Nothing has been marked yet.`,
            values: { tasks: bullets(titles), count: String(titles.length) }, required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `Mark ${titles.length === 1 ? 'this' : `these ${titles.length}`} as done?\n${bullets(titles)}` };
    }
    if (confirming && a.type === 'progress_update') {
        const titles = a.taskIds.map(t => ctx.tasks.find(x => x.id === t)?.title ?? (ctx.pending?.kind === 'ping_reply' ? ctx.pending.taskTitles[ctx.pending.taskIds.indexOf(t)] : null) ?? 'that task');
        const finished = a.state === 'done_all' || a.state === 'done_some';
        return { kind: 'confirm_progress', describe: finished
                ? `Ask the person to confirm they have finished ${titles.length === 1 ? 'this task' : 'these tasks'}. Nothing has been marked yet.`
                : `Ask the person to confirm that ${STATE_PHRASE[a.state]} ${titles.length === 1 ? 'this task' : 'these tasks'}, so it can be noted. Nothing has been recorded yet.`,
            values: { tasks: bullets(titles), count: String(titles.length) }, required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `${finished ? 'Mark as done' : `Note that ${STATE_PHRASE[a.state]} this`}?\n${bullets(titles)}` };
    }
    if (confirming && a.type === 'create_tasks') {
        const who = personName(a.assigneeId);
        const self = a.assigneeId === sender.id;
        const lines = a.tasks.map(withNote);
        const dateNote = a.date !== ctx.today ? ` for ${dayLabel(a.date)}` : '';
        return { kind: 'confirm_create', describe: `Ask the person to confirm adding ${a.tasks.length === 1 ? 'this task' : `these ${a.tasks.length} tasks`} to ${self ? 'their own list' : `${who}'s list`}${dateNote}. Nothing has been added yet.`,
            values: { assignee: who, tasks: bullets(lines), count: String(a.tasks.length), ...(dateNote ? { date: dayLabel(a.date) } : {}) },
            required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name, who],
            fallback: `Add ${a.tasks.length === 1 ? 'this task' : `these ${a.tasks.length} tasks`} ${self ? 'to your list' : `for ${who}`}${dateNote}?\n${bullets(lines)}` };
    }
    if (confirming && a.type === 'delete_tasks') {
        const titles = a.taskIds.map(titleOf);
        return { kind: 'confirm_delete', describe: `Ask the person to confirm DELETING ${titles.length === 1 ? 'this task' : `these ${titles.length} tasks`} from their list. Say it is permanent. Nothing has been deleted yet.`,
            values: { tasks: bullets(titles), count: String(titles.length) }, required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `Delete ${titles.length === 1 ? 'this task' : `these ${titles.length} tasks`}? This is permanent.\n${bullets(titles)}` };
    }
    if (confirming && a.type === 'rename_task') {
        const from = titleOf(a.taskId);
        return { kind: 'confirm_rename', describe: 'Ask the person to confirm renaming the task. Nothing has changed yet.',
            values: { from, to: a.title }, required: ['from', 'to'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `Rename "${from}" to "${a.title}"?` };
    }
    if (confirming && a.type === 'add_note') {
        const whose = a.ownerName ? ` (${a.ownerName}'s task)` : '';
        return { kind: 'confirm_note', describe: `Ask the person to confirm adding the note to the task${a.ownerName ? ` of ${a.ownerName}` : ''}. Nothing has changed yet.`,
            values: { task: a.title, note: a.note }, required: ['task', 'note'], asksQuestion: true, claimsNothingDone: true, names: [sender.name, ...(a.ownerName ? [a.ownerName] : [])],
            fallback: `Add this note to "${a.title}"${whose}?\nNote: ${a.note}` };
    }
    if (confirming && a.type === 'lock_tasks') {
        const titles = a.taskIds.map(titleOf);
        return { kind: a.lock ? 'confirm_lock' : 'confirm_unlock', describe: a.lock
                ? `Ask the person to confirm LOCKING ${titles.length === 1 ? 'this task' : 'these tasks'}: it will come back on their list every working day. Nothing has changed yet.`
                : `Ask the person to confirm UNLOCKING ${titles.length === 1 ? 'this task' : 'these tasks'}: it will stop coming back every day (today's copy stays). Nothing has changed yet.`,
            values: { tasks: bullets(titles) }, required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: a.lock ? `Lock ${titles.length === 1 ? 'this task' : 'these tasks'}? ${titles.length === 1 ? 'It' : 'They'} will come back every working day.\n${bullets(titles)}`
                : `Stop repeating ${titles.length === 1 ? 'this task' : 'these tasks'}? Today's copy stays.\n${bullets(titles)}` };
    }
    if (a.type === 'locked_list') {
        const mine = ctx.tasks.filter(t => t.locked).map(t => `🔒 ${taskLine(t)}`);
        const team = ctx.tasks.filter(t => t.teamFixed).map(t => `📌 ${taskLine(t)} (team fixed)`);
        const list = [...mine, ...team].join('\n');
        if (!list) return { kind: 'locked_none', describe: 'The person has no repeating (locked) tasks. Say so and that they can say "lock task 2" to make one repeat.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'You have no repeating tasks. Say *lock task 2* to make a task come back every working day.' };
        return { kind: 'locked_list', describe: 'Introduce the person\'s tasks that repeat every working day. The list is inserted by the system.', values: { list }, required: ['list'], asksQuestion: false, claimsNothingDone: false, names: [sender.name],
            fallback: `Your repeating tasks:\n${list}\n\nSay *unlock* and the number to stop one repeating.` };
    }
    if (confirming && a.type === 'remind_tasks') {
        return { kind: 'confirm_remind', describe: `Ask the person to confirm sending a reminder (WhatsApp and in-app) to the people doing ${a.lines.length === 1 ? 'this task' : `these ${a.lines.length} tasks`}. Nothing has been sent yet.`,
            values: { tasks: bullets(a.lines), count: String(a.lines.length) }, required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name],
            fallback: `Send a reminder about ${a.lines.length === 1 ? 'this task' : `these ${a.lines.length} tasks`}?\n${bullets(a.lines)}` };
    }
    if (confirming && a.type === 'hand_over_task') {
        const title = titleOf(a.taskId); const to = personName(a.toId);
        // Owner 2026-10-21: the note is part of the preview (inserted by the system, never reworded).
        const noteLine = a.note ? `Note: ${a.note}` : '';
        return { kind: 'confirm_handover', describe: `Ask the person to confirm giving the task to ${to}${noteLine ? ', with the note (inserted by the system)' : ''}. It would leave their list and ${to} would be told. Nothing has moved yet.`,
            values: { task: title, assignee: to, ...(noteLine ? { note: noteLine } : {}) }, required: ['task', ...(noteLine ? ['note'] : [])], asksQuestion: true, claimsNothingDone: true, names: [sender.name, to],
            fallback: `Give "${title}" to ${to}?${noteLine ? `\n${noteLine}` : ''}\nIt will leave your list and ${to} will be told.` };
    }

    if (a.type === 'chat' && a.kind === 'help') {
        return { kind: 'help', describe: 'Briefly tell the person what you can help with, then show the list.', values: { capabilities: CAPABILITIES }, required: ['capabilities'], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: `Here's what I can do:\n${CAPABILITIES}` };
    }
    if (a.type === 'chat') {
        return { kind: 'smalltalk', describe: 'Reply in one or two warm, short sentences. If they ask about this conversation ("what did I just ask?"), answer briefly from the recent conversation, without numbers. If it fits, mention you can help with their tasks.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'Happy to help. Ask me about your tasks any time.' };
    }
    if (a.type === 'find_tasks') {
        // Flexible "look up tasks": the answer (with the filters it used) is written by code from the real rows.
        const data = result?.values.data;
        if (!data) return { kind: 'view_lookup', describe: 'Say you are looking that up.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'Let me check that for you.' };
        return { kind: 'find_result', describe: `Introduce the answer to their question in ONE short sentence (${result?.summary || 'what was found'}). The answer itself is inserted by the system: do not repeat numbers, names or titles.`,
            values: { data }, required: ['data'], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: data };
    }
    if (a.type === 'view_tasks' && a.scope === 'self' && a.carriedOnly) {
        // "What are my carry forward tasks?" → ONLY the open tasks carried over from earlier days, with their real numbers.
        const carried = ctx.tasks.filter(t => t.from && t.status !== 'completed');
        if (!carried.length) return { kind: 'view_carried_none', describe: 'The person has no tasks carried over from earlier days. Say so in a friendly way.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'You have no tasks carried over from earlier days. 👍' };
        const list = carried.map(t => `${taskLine(t)} (from ${fromLabel(t.from!)}, ${STATUS_WORD[t.status]})`).join('\n');
        const hint = `Reply *done ${carried[0].n}* when you finish task ${carried[0].n}.`;
        return { kind: 'view_carried', describe: `Introduce the person's tasks carried over from earlier days (${carried.length}). The list and the hint are inserted by the system.`,
            values: { list, hint, count: String(carried.length) }, required: ['list', 'hint'], asksQuestion: false, claimsNothingDone: false, names: [sender.name],
            fallback: `Your carried-forward tasks:\n${list}\n\n${hint}` };
    }
    if (a.type === 'view_tasks' && a.scope === 'self') {
        const open = ctx.tasks.filter(t => t.status !== 'completed').length;
        const total = ctx.tasks.length;
        // An older open task is marked with the day it was given (same as the "tasks" list).
        // Three sections (owner 2026-10-16), the same as the "tasks" reply: carry forward → pending today → completed.
        const list = sectionedList(ctx.tasks.map(t => ({ carried: !!t.from, done: t.status === 'completed', line: `${taskLine(t)} (${t.from ? `from ${fromLabel(t.from)}, ` : ''}${STATUS_WORD[t.status]})` })));
        if (!total) return { kind: 'view_none', describe: 'The person has no tasks for today. Say so in a friendly way.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'You don\'t have any tasks for today.' };
        return { kind: 'view_self', describe: `Introduce the person's task list for today (${total} task${total === 1 ? '' : 's'}, ${open} still open). The list itself is inserted by the system.`,
            values: { list, count: String(total), open: String(open), done: String(total - open) }, required: ['list'], asksQuestion: false, claimsNothingDone: false, names: [sender.name],
            fallback: `Here are your tasks for today:\n${list}` };
    }
    if (a.type === 'view_tasks') {
        const data = result?.values.data;
        if (!data) return { kind: 'view_lookup', describe: 'Say you are looking that up.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'Let me check that for you.' };
        return { kind: 'view_result', describe: `Introduce what was found (${result?.summary || 'the requested overview'}). The details are inserted by the system.`, values: { data }, required: ['data'], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: data };
    }
    // What REALLY happened (a change was carried out, or data was looked up): the reply may now say so, and the details are
    // inserted by code. Without a result a reply may only ask or explain.
    const resultFacts = (kind: string, r: ExecutionResult, hint?: string): ReplyFacts => {
        const details = r.values.details || '';
        return { kind, describe: `Tell the person what happened, in one or two short, warm sentences. Outcome: ${r.summary}${details ? ' (Do not repeat the numbers or titles: the system inserts the details.)' : ''}${hint ? ' End with the undo hint (inserted by the system).' : ''}`,
            values: { ...(details ? { details } : {}), ...(hint ? { hint } : {}) }, required: [...(details ? ['details'] : []), ...(hint ? ['hint'] : [])], asksQuestion: false, claimsNothingDone: false, names: [sender.name],
            fallback: [details ? `${r.summary}\n${details}` : r.summary, ...(hint ? [hint] : [])].join('\n\n') };
    };

    // Owner 2026-10-21: a suggested task saved straight away after a clear answer → say what was added, then the undo hint.
    if (!confirming && (a.type === 'create_tasks' || a.type === 'batch') && result && /^Added\b/.test(result.summary)) return resultFacts('create_result', result, UNDO_HINT);
    // Owner 2026-10-14: marked done straight away (no "Reply YES") → say what was done, then "Reply undo within 10 minutes".
    const finishedNow = a.type === 'complete_tasks' || (a.type === 'progress_update' && (a.state === 'done_all' || a.state === 'done_some'));
    if (!confirming && finishedNow && result && /^Marked\b/.test(result.summary)) return resultFacts('complete_result', result, UNDO_HINT);
    if (a.type === 'answer_pending' && a.answer === 'yes' && result) return resultFacts('answer_yes_result', result);
    if (a.type === 'progress_update' && result) return resultFacts('progress_result', result);
    if (a.type === 'answer_pending') {
        const text = a.answer === 'no' ? 'Okay, cancelled. Nothing was changed.' : result?.summary || 'Okay, on it.';
        return { kind: `answer_${a.answer}`, describe: a.answer === 'no' ? 'Tell the person you have cancelled it and nothing was changed.' : `Acknowledge briefly. ${result?.summary ? `Outcome: ${result.summary}` : 'The confirmed action is being carried out.'}`,
            values: {}, required: [], asksQuestion: false, claimsNothingDone: a.answer === 'no' ? false : !result, names: [sender.name], fallback: text };
    }
    // ACT progress_update (only when the policy skips confirmation)
    if (a.type === 'progress_update') {
        return { kind: 'progress_ack', describe: 'Acknowledge their update briefly.', values: {}, required: [], asksQuestion: false, claimsNothingDone: !result, names: [sender.name], fallback: 'Got it, thanks for the update.' };
    }
    return { kind: 'generic', describe: 'Acknowledge briefly.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'Okay.' };
}

export const tasksDomain: DomainHandler = {
    id: 'tasks',
    intents: INTENT_SPECS,
    validateSlots,
    checkGrounding,
    decide,
    replyFacts,
};

/**
 * Phase 4 "Team reports" (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md) — the SAME domain plus one read-only scope, "team":
 * "how is my team doing?", "anything overdue in my team?". Used ONLY while the "Team reports" switch is ON, so with the
 * switch OFF the AI's instructions are exactly as before. Who counts as "my team" is decided by code from
 * ctx.assignableIds (the existing permission rule) and is checked again when the report is read.
 */
const TEAM_VIEW_SPEC: IntentSpec = {
    name: 'view_tasks',
    description: 'wants to SEE tasks or progress: their own ("what do I have today", "anything pending?", "what are my carry forward tasks?"), another person\'s, their TEAM\'s ("how is my team doing", "what\'s pending in my team", "anything overdue in my team?", "what is my team doing?", "show my team\'s tasks"), a department\'s or the whole company\'s — for TODAY only. Any other day or range ("tomorrow", "yesterday", "this week", "last month") is "find_tasks".',
    slots: '{"scope":"self"|"person"|"team"|"department"|"org"|"pending_overview","person":string|null,"department":string|null,"carried_forward_only":boolean,"team_list":boolean}  — carried_forward_only = true only when they ask for their OWN tasks carried over / left from earlier days. team_list (scope "team" only) = true when they want to SEE THE TASKS themselves ("what is my team doing", "what are my team working on", "show my team\'s tasks", "list everyone\'s tasks"); false when they ask about PROGRESS or numbers ("how is my team doing", "team progress", "how many are pending in my team").',
};

export const tasksDomainWithTeam: DomainHandler = {
    ...tasksDomain,
    intents: INTENT_SPECS.map(s => (s.name === 'view_tasks' ? TEAM_VIEW_SPEC : s.name === 'find_tasks' ? { ...s, slots: s.slots.replace(findQuerySchema(false), findQuerySchema(true)) } : s)),
    validateSlots(intent, raw, ctx) {
        if (intent === 'view_tasks' && raw.scope === 'team') return { intent, scope: 'team', person: null, department: null, ...(raw.team_list === true ? { teamList: true } : {}) };
        if (intent === 'find_tasks') { const query = validateQuery(raw); return query ? { intent, query } : null; }
        return validateSlots(intent, raw, ctx);
    },
    decide(interp, ctx, policy) {
        const s = interp.slots;
        if (s.intent === 'view_tasks' && s.scope === 'team') {
            if (!ctx.assignableIds.length) return { outcome: 'REFUSE', reason: 'not_allowed_to_view', detail: null };
            return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'team', personId: null, department: null, ...(s.teamList ? { list: true } : {}) } };
        }
        return decide(interp, ctx, policy);
    },
};

export const TASK_INTENT_NAMES: readonly string[] = TASK_INTENTS;
