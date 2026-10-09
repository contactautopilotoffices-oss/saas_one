import { matchByName } from '../TaskGateway';
import type { DomainHandler, ExecutionResult, IntentSpec, ReplyFacts } from './domain';
import {
    Action, BrainContext, BrainPerson, BrainTask, CHANGE_CONFIDENCE_MIN, ClarifyReason, ConfirmPolicy, Decision, Intent,
    Interpretation, MAX_TASKS_PER_MESSAGE, MAX_TITLE_LENGTH, ProgressState, READ_CONFIDENCE_MIN, Slots, TASK_INTENTS, ViewScope, Which,
} from './types';
import { addDays, clip, contentWords, dayLabel, isGrounded, isIsoDate, norm, similarity } from './text';

/**
 * The language brain — the TASKS domain.
 *
 * Everything here is plain code. The AI's output arrives as untrusted JSON; this file validates its shape, checks
 * every person and task number against real data, applies the permission and confirmation rules, and decides:
 *   ACT (a read or a chat reply) · CONFIRM (a change, asked about first) · CLARIFY (unclear → ask) · REFUSE · HANDOFF.
 */

const INTENT_SPECS: IntentSpec[] = [
    { name: 'view_tasks', description: 'wants to SEE tasks or progress: their own ("what do I have today", "anything pending?") or another person\'s / a department\'s / the whole company\'s.',
        slots: '{"scope":"self"|"person"|"department"|"org"|"pending_overview","person":string|null,"department":string|null}' },
    { name: 'complete_tasks', description: 'says they FINISHED one or more of THEIR OWN tasks ("done 2", "finished the carpet one", "all done"). If the message is about another person\'s tasks, or asks to delete / remove / change a task, it is NOT this intent: use "unknown" and say why in ambiguities.',
        slots: '{"which":{"all":boolean,"numbers":[int],"hints":[string]}}  — numbers refer to the numbered task list you were given; put a task number there whenever the person names a task you can match to the list.' },
    { name: 'progress_update', description: 'reports PROGRESS short of finishing, or a status on tasks they were sent: "working on it", "half done", "stuck waiting for the vendor", or "done"/"done all" in reply to someone\'s request.',
        slots: '{"state":"working"|"partly_done"|"blocked"|"done_all"|"done_some"|"other","which":{"all":boolean,"numbers":[int],"hints":[string]},"note":string|null}' },
    { name: 'create_tasks', description: 'wants to ADD one or more tasks, for themself ("remind me to…") or for someone else ("assign Lohit a task about…"). Split distinct jobs into separate tasks.',
        slots: '{"assignee":"me"|<person name>,"tasks":[{"title":string,"details":string|null}],"date":"YYYY-MM-DD"|null}  — titles are short (max 12 words) and use the person\'s own words; never invent work; date only if the message gives one.' },
    { name: 'hand_over_task', description: 'wants to GIVE one of their own existing tasks to a teammate ("give task 2 to Vidya", "pass the carpet one to Harsh").',
        slots: '{"which":{"all":false,"numbers":[int],"hints":[string]},"to":<person name>|null}' },
    { name: 'answer_pending', description: 'is ANSWERING a question the bot just asked (only possible when a question is pending): "yes", "no", "the second one", "make it tomorrow instead".',
        slots: '{"answer":"yes"|"no"|"pick"|"edit"|"unsure","pick":int|null,"instruction":string|null}' },
    { name: 'help', description: 'asks what the bot can do or how to use it.', slots: '{}' },
    { name: 'smalltalk', description: 'greets, thanks, or chats with no task request.', slots: '{}' },
    { name: 'unknown', description: 'anything else, or you cannot tell what is wanted.', slots: '{}' },
];

const CHANGE_INTENTS: ReadonlySet<Intent> = new Set(['complete_tasks', 'progress_update', 'create_tasks', 'hand_over_task']);
const SCOPES: readonly ViewScope[] = ['self', 'person', 'department', 'org', 'pending_overview'];
const STATES: readonly ProgressState[] = ['working', 'partly_done', 'blocked', 'done_all', 'done_some', 'other'];
const SELF_WORDS = new Set(['me', 'myself', 'self', 'i', 'my self', 'my own']);
const EVERYONE_WORDS = new Set(['everyone', 'everybody', 'all', 'all of them', 'the team', 'team', 'someone', 'somebody', 'anyone', 'anybody', 'whoever']);

// ── strict shape checks ─────────────────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = clip(v, max);
    return s || null;
};

function parseWhich(raw: unknown): Which {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const numbers = (Array.isArray(o.numbers) ? o.numbers : [])
        .map(n => (typeof n === 'number' ? n : typeof n === 'string' && /^\d{1,3}$/.test(n.trim()) ? Number(n) : NaN))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 999);
    const hints = (Array.isArray(o.hints) ? o.hints : []).map(h => str(h, 80)).filter((h): h is string => !!h).slice(0, 6);
    return { all: o.all === true, numbers: [...new Set(numbers)].slice(0, 30), hints };
}

function validateSlots(intent: Intent, raw: Record<string, unknown>, ctx: BrainContext): Slots | null {
    switch (intent) {
        case 'view_tasks': {
            const scope = raw.scope as ViewScope;
            if (!SCOPES.includes(scope)) return null;
            return { intent, scope, person: str(raw.person, 60), department: str(raw.department, 60) };
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
                .map(t => (t && typeof t === 'object' ? { title: str((t as any).title, MAX_TITLE_LENGTH), details: str((t as any).details, 400) } : null))
                .filter((t): t is { title: string; details: string | null } => !!t && !!t.title)
                .slice(0, MAX_TASKS_PER_MESSAGE + 1);
            const date = isIsoDate(raw.date) && raw.date >= addDays(ctx.today, -366) && raw.date <= addDays(ctx.today, 366) ? raw.date : null;
            return { intent, assignee: str(raw.assignee, 60) || 'me', tasks, date };
        }
        case 'hand_over_task':
            return { intent, which: parseWhich(raw.which), to: str(raw.to, 60) };
        case 'answer_pending': {
            const answer = raw.answer as string;
            if (!['yes', 'no', 'pick', 'edit', 'unsure'].includes(answer)) return null;
            const pick = typeof raw.pick === 'number' && Number.isInteger(raw.pick) && raw.pick >= 1 && raw.pick <= 99 ? raw.pick : null;
            return { intent, answer: answer as 'yes' | 'no' | 'pick' | 'edit' | 'unsure', pick, instruction: str(raw.instruction, 200) };
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
        return slots.tasks.every(t => isGrounded(t.title, message) && (!t.details || isGrounded(t.details, message)));
    }
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

const labelOf = (p: BrainPerson) => (p.department ? `${p.name} (${p.department})` : p.name);
const taskLine = (t: BrainTask) => `${t.n}. ${t.title}`;

type TaskResolution =
    | { ok: true; tasks: BrainTask[] }
    | { ok: false; decision: Decision };

const clarify = (reason: ClarifyReason, options: string[] = [], detail: string | null = null): Decision => ({ outcome: 'CLARIFY', reason, options, detail });

function hintCandidates(hint: string, tasks: BrainTask[]): BrainTask[] {
    const words = contentWords(hint);
    if (!words.length) return [];
    const score = (t: BrainTask) => {
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

function decide(interp: Interpretation, ctx: BrainContext, policy: ConfirmPolicy): Decision {
    // While the person is replying to someone's request, "done 5" must mean that request's 5th task, never their own task 5.
    // So a plain "complete" is routed through the request's own numbering.
    if (ctx.pending?.kind === 'ping_reply' && interp.slots.intent === 'complete_tasks') {
        const which = interp.slots.which;
        return decide({ ...interp, intent: 'progress_update', slots: { intent: 'progress_update', state: which.all ? 'done_all' : 'done_some', which, note: null } }, ctx, policy);
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
            if (slots.scope === 'self') return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'self', personId: null, department: null } };
            if (slots.scope === 'person') {
                const r = resolveRecipient(slots.person, ctx);
                if (!r.ok) return r.decision;
                if (r.person.id !== ctx.sender.id && !mayGiveWorkTo(ctx, r.person)) return { outcome: 'REFUSE', reason: 'not_allowed_to_view', detail: r.person.name };
                return { outcome: 'ACT', action: { type: 'view_tasks', scope: 'person', personId: r.person.id, department: null } };
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
            return { outcome: 'CONFIRM', action: { type: 'complete_tasks', taskIds: r.tasks.map(t => t.id) } };
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
            const mustConfirm = policy.confirmProgressUpdates || slots.state === 'done_all' || slots.state === 'done_some';
            return mustConfirm ? { outcome: 'CONFIRM', action } : { outcome: 'ACT', action };
        }

        case 'create_tasks': {
            if (!slots.tasks.length) return clarify('no_task_content');
            if (slots.tasks.length > MAX_TASKS_PER_MESSAGE) return clarify('too_many_tasks', [], String(MAX_TASKS_PER_MESSAGE));
            const target = norm(slots.assignee);
            let assignee: BrainPerson;
            if (SELF_WORDS.has(target)) {
                assignee = ctx.sender;
            } else {
                const r = resolveRecipient(slots.assignee, ctx);
                if (!r.ok) return r.decision;
                assignee = r.person;
            }
            if (!mayGiveWorkTo(ctx, assignee)) return { outcome: 'REFUSE', reason: 'not_allowed_to_assign', detail: assignee.name };
            return { outcome: 'CONFIRM', action: { type: 'create_tasks', assigneeId: assignee.id, tasks: slots.tasks, date: slots.date || ctx.today } };
        }

        case 'hand_over_task': {
            const t = resolveTasks(slots.which, ctx, { allowAll: false, exactlyOne: true });
            if (!t.ok) return t.decision;
            const r = resolveRecipient(slots.to, ctx);
            if (!r.ok) return r.decision;
            if (r.person.id === ctx.sender.id) return { outcome: 'REFUSE', reason: 'cannot_hand_over_to_self', detail: null };
            if (!mayGiveWorkTo(ctx, r.person)) return { outcome: 'REFUSE', reason: 'not_allowed_to_assign', detail: r.person.name };
            return { outcome: 'CONFIRM', action: { type: 'hand_over_task', taskId: t.tasks[0].id, toId: r.person.id } };
        }

        case 'answer_pending': {
            const p = ctx.pending;
            if (!p || p.kind === 'ping_reply') return clarify(p ? 'unsure_answer' : 'nothing_pending');
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

// ── what a reply may say ────────────────────────────────────────────────────────────────────────

const STATUS_WORD: Record<BrainTask['status'], string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Done' };
const bullets = (titles: string[]) => titles.map(t => `• ${t}`).join('\n');
const first = (name: string) => name.split(' ')[0];
const CAPABILITIES = [
    '• See your tasks ("what\'s pending today?")',
    '• Mark things done ("finished the carpet one")',
    '• Add tasks for yourself or a teammate ("assign Vidya a task to chase the vendor")',
    '• Hand one of your tasks to a teammate',
].join('\n');

const STATE_PHRASE: Record<ProgressState, string> = {
    working: 'you are working on', partly_done: 'you are part-way through', blocked: 'you are blocked on',
    done_all: 'you have finished', done_some: 'you have finished', other: 'you have an update on',
};

function clarifyFacts(d: Extract<Decision, { outcome: 'CLARIFY' }>, ctx: BrainContext): ReplyFacts {
    const opts = d.options.join('\n');
    const base = { kind: `clarify_${d.reason}`, asksQuestion: true, claimsNothingDone: true, names: [ctx.sender.name] };
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
        case 'no_task_content': return { ...base, describe: 'The person wants to add a task but did not say what it is. Ask what the task should be.', values: {}, required: [], fallback: 'What should the task be?' };
        case 'too_many_tasks': return { ...base, describe: `Too many tasks in one message (the limit is ${d.detail}). Ask them to send fewer at a time.`, values: {}, required: [], fallback: `That is a lot of tasks at once. Could you send them in smaller groups (up to ${d.detail})?` };
        case 'nothing_pending': return { ...base, describe: 'Nothing is waiting for an answer from the person. Say so lightly and ask what they would like to do.', values: {}, required: [], fallback: 'I don\'t have anything waiting for your answer. What would you like to do?' };
        case 'unsure_answer': return { ...base, describe: 'The person\'s answer was not clear. Ask them to confirm what they want, in a simple yes-or-no way.', values: { pending: d.detail || '' }, required: [], fallback: 'Sorry, I wasn\'t sure what you meant. Could you say yes or no, or tell me what to change?' };
        case 'not_grounded': return { ...base, describe: 'You are not sure you captured the task wording correctly. Ask them to say the task again in one short sentence.', values: {}, required: [], fallback: 'I want to get that exactly right. Could you say the task again in one short sentence?' };
        case 'ai_flagged_ambiguity': return { ...base, describe: `Something in the message was unclear (${d.detail}). Ask ONE short question that clears it up.`, values: {}, required: [], fallback: 'I want to be sure I understood. Could you tell me a little more?' };
        case 'low_confidence': return { ...base, describe: 'You are not sure what the person wants. Ask ONE short question, offering the likely options (see tasks, add a task, mark one done).', values: {}, required: [], fallback: 'I\'m not sure I understood. Do you want to see your tasks, add a task, or mark one done?' };
        default: return { ...base, describe: 'You did not understand the message. Ask what they want to do, briefly.', values: {}, required: [], fallback: 'I\'m not sure what you\'d like to do. You can ask to see your tasks, add one, or mark one done.' };
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
        };
        const [describe, fallback] = texts[decision.reason];
        return { kind: `refuse_${decision.reason}`, describe, values: {}, required: [], asksQuestion: decision.reason === 'cannot_hand_over_to_self', claimsNothingDone: true, names: [sender.name, ...(d ? [d] : [])], fallback };
    }

    const a = decision.action;
    const confirming = decision.outcome === 'CONFIRM';

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
        const lines = a.tasks.map(t => t.details ? `${t.title} — ${t.details}` : t.title);
        const dateNote = a.date !== ctx.today ? ` for ${dayLabel(a.date)}` : '';
        return { kind: 'confirm_create', describe: `Ask the person to confirm adding ${a.tasks.length === 1 ? 'this task' : `these ${a.tasks.length} tasks`} to ${self ? 'their own list' : `${who}'s list`}${dateNote}. Nothing has been added yet.`,
            values: { assignee: who, tasks: bullets(lines), count: String(a.tasks.length), ...(dateNote ? { date: dayLabel(a.date) } : {}) },
            required: ['tasks'], asksQuestion: true, claimsNothingDone: true, names: [sender.name, who],
            fallback: `Add ${a.tasks.length === 1 ? 'this task' : `these ${a.tasks.length} tasks`} ${self ? 'to your list' : `for ${who}`}${dateNote}?\n${bullets(lines)}` };
    }
    if (confirming && a.type === 'hand_over_task') {
        const title = titleOf(a.taskId); const to = personName(a.toId);
        return { kind: 'confirm_handover', describe: `Ask the person to confirm giving the task to ${to}. It would leave their list and ${to} would be told. Nothing has moved yet.`,
            values: { task: title, assignee: to }, required: ['task'], asksQuestion: true, claimsNothingDone: true, names: [sender.name, to],
            fallback: `Give "${title}" to ${to}? It will leave your list and ${to} will be told.` };
    }

    if (a.type === 'chat' && a.kind === 'help') {
        return { kind: 'help', describe: 'Briefly tell the person what you can help with, then show the list.', values: { capabilities: CAPABILITIES }, required: ['capabilities'], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: `Here's what I can do:\n${CAPABILITIES}` };
    }
    if (a.type === 'chat') {
        return { kind: 'smalltalk', describe: 'Reply in one or two warm, short sentences. If it fits, mention you can help with their tasks.', values: {}, required: [], asksQuestion: false, claimsNothingDone: false, names: [sender.name], fallback: 'Happy to help. Ask me about your tasks any time.' };
    }
    if (a.type === 'view_tasks' && a.scope === 'self') {
        const open = ctx.tasks.filter(t => t.status !== 'completed').length;
        const total = ctx.tasks.length;
        const list = ctx.tasks.map(t => `${taskLine(t)} (${STATUS_WORD[t.status]})`).join('\n');
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
    const resultFacts = (kind: string, r: ExecutionResult): ReplyFacts => {
        const details = r.values.details || '';
        return { kind, describe: `Tell the person what happened, in one or two short, warm sentences. Outcome: ${r.summary}${details ? ' (Do not repeat the numbers or titles: the system inserts the details.)' : ''}`,
            values: details ? { details } : {}, required: details ? ['details'] : [], asksQuestion: false, claimsNothingDone: false, names: [sender.name],
            fallback: details ? `${r.summary}\n${details}` : r.summary };
    };

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

export const TASK_INTENT_NAMES: readonly string[] = TASK_INTENTS;
