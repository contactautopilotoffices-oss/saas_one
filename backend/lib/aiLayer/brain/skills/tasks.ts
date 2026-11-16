/**
 * Tasks in the brain (owner 2026-11-15: "The brain adds tasks, marks them done, hands them over and sends reminders
 * itself, so it no longer passes them to the task assistant" — "implement this safely").
 *
 * How it is kept safe:
 *   - Every action is OFF until a Tech member switches it on in the console, one action at a time, and the console
 *     refuses to go from off straight to live: off → test mode (the card is shown, "Yes" changes nothing) → live.
 *   - While all four are off, nothing about the brain changes: these skills, the two look-ups below and the task
 *     wording of the instructions are not sent to the model at all (registry.ts, loop/prompt.ts).
 *   - Nothing changes without the person's Yes to a card built by code, and the same proposal runs once (loop/turn.ts).
 *   - Each action goes through the SAME checked function the Tasks tab and the task assistant use (WorkspaceService),
 *     so who may give, finish, hand over or remind is decided again by the Task Manager at the moment of the change.
 *   - Titles and notes must be the person's own words (the same check as a ticket's description).
 *   - People are offered only from the Task Manager's own "may give work to" list, as handles (P1, P2): the model never
 *     sees or invents a user id.
 *   - Anything the brain cannot do with tasks still goes to the task assistant (team progress, delete, rename, move),
 *     and while the task assistant is waiting for this person's answer the brain does not take their message
 *     (channels/whatsapp.ts).
 *
 * ## Agent Spec — the brain's task actions
 *
 * **1. Workflow or agent?**  agent (the brain's existing tool loop; four more tools in it) [BAA p.104]
 *    Justification (must be (a) or (b)) [BAA p.115]: (a): the same person mixes tasks with tickets, rooms and files in
 *    one chat ("done 2, and the AC in cabin 4 is leaking"); a fixed pathway per message cannot route that.
 *    Head-to-head vs. the deterministic path [BAA pp.94–95, 99]: NOT RUN (see 10). The path it replaces is the task
 *    assistant (task-manager/brain), itself model-driven. The comparison is planned as test mode per action.
 *
 * **2. Context** [BAA p.112]
 *    What it knows that the task assistant doesn't: the person's tickets, rooms, open files and remembered facts in the
 *    same turn. What the task assistant knows that it doesn't: its own pending questions, superuser pings and the
 *    "undo" of a last change. That is why the brain steps aside while the task assistant is waiting.
 *
 * **3. Cost of a false positive** [BAA p.112]
 *    high for create / hand over / remind (another person gets a WhatsApp message), low for complete (own task, the
 *    giver is told). Model tier: the brain's existing chain (Opus first) because every action reaches other people;
 *    the card and the person's Yes are the second check.
 *
 * **4. Tools**
 *    | tool | when-not-to-use in its description? [BAA p.107] | errors as text? [BAA p.94] | args validated? [BAA p.93] | MCP? [BAA p.106] |
 *    | tasks_people  | yes | yes (problem text) | zod | no (in-process, like every brain skill) |
 *    | tasks_given   | yes | yes | zod | no |
 *    | task_create   | yes | yes | zod + grounding + date range | no |
 *    | task_complete | yes | yes | zod + handles | no |
 *    | task_hand_over| yes | yes | zod + handles | no |
 *    | task_remind   | yes | yes | zod + handles from tasks_given only | no |
 *
 * **5. Prompt** [BAA pp.105, 114]
 *    Numbered ordered steps: yes (loop/prompt.ts; step 8 has a task variant)   Explicit no-skip clause: yes
 *    Single-shot tone example: yes (rooms)   Terminal state written to data: ai_action_log row per proposal and result.
 *
 * **6. Memory** [BAA pp.100–103]
 *    Does this workload repeat? yes (the same people, the same daily list). No new write tool: the existing episode
 *    line is written after an action ("Marked 2 tasks done"), with the existing scope rules [BAA p.101].
 *
 * **7. Multi-agent?** [BAA p.116]
 *    Today two agents (brain and task assistant) split by context. This moves the four actions into the brain, per
 *    action and per organisation, and leaves the rest with the task assistant. Reason for keeping a split at all:
 *    race/overlap (the task assistant's pending questions), so the brain steps aside while one is open.
 *
 * **8. Evaluation — all four axes** [BAA pp.118–119]
 *    System: the brain's trace (model calls, latency, cost) per turn; errors from the Task Manager become text.
 *    Quality assurance (rubric: GLM family, mid tier, 0–3, manual audit 16 of 156 = 10%) [BAA pp.96–98]: the
 *    existing rubric; NO task cases in the 56-message set yet (see 10).
 *    Tool interaction [BAA p.95]: expected order tasks_mine / tasks_people / tasks_given → one write tool; checked in
 *    tests/ai-layer/brain-tasks.test.ts with a scripted model, not yet measured on a real one.
 *    Agent efficiency [BAA p.119]: the existing limit of read calls per turn (4) and per-day action limit apply.
 *
 * **9. Trace** [BAA pp.119–120]
 *    Run/step telemetry wired: yes, the existing turn trace and audit log. Ad-hoc single-agent testing done before
 *    scale [BAA p.116]: scripted-model tests only; a real-model check is the owner's next step, in test mode.
 *
 * **10. Laws knowingly violated, and why:**
 *    L2: no head-to-head against the task assistant on a fixed case set before switching on. Instead each action
 *        starts off, then runs in test mode on real messages (the card is shown, nothing changes) before it can go
 *        live, one action at a time.
 *    L5/L6 (in part): no real-model accuracy number for tasks is claimed; the test set has no task cases yet.
 */
import { z } from 'zod';
import { istDate } from '../../dates';
import { bt } from '../text';
import type { ReadSkill, SkillContext, TaskOutcome, WriteSkill } from '../types';
import { grounded } from '../../pipeline';
import { clip, dayLabel, nullableStr, quote, schema, str } from './common';

const staffOnly = (actor: { ownRecordsOnly: boolean; propertyIds: string[] }) => !actor.ownRecordsOnly && actor.propertyIds.length > 0;

/** The four actions. While none of them is on for a person, nothing about tasks changes for them. */
export const TASK_ACTION_IDS: ReadonlySet<string> = new Set(['task.create', 'task.complete', 'task.hand_over', 'task.remind']);
/** Look-ups that exist only for those actions: offered only when one of the actions is on. */
export const TASK_HELPER_IDS: ReadonlySet<string> = new Set(['tasks.people', 'tasks.given']);

/** A task handle issued by tasks_given starts with this, so a reminder can only be about a task the person gave. */
const GIVEN = 'gave: ';
const MAX_TITLE = 150;
const MAX_NOTE = 300;

const many = (ctx: SkillContext, n: number) => (n === 1 ? bt('task_one', ctx.lang) : bt('task_many', ctx.lang, { n }));
const lines = (titles: string[]) => titles.map(t => `• ${clip(t.replace(/\s+/g, ' '), 80)}`).join('\n');
/** A note the person gave, in their own words; anything else is dropped (never invented). */
const ownNote = (ctx: SkillContext, note: string | null | undefined) => (note && note.trim() ? grounded(note.trim().slice(0, MAX_NOTE), ctx.userWords) : null);
const failedLines = (ctx: SkillContext, failed: TaskOutcome['failed'], label: (l: string) => string) =>
    failed.map(f => bt('task_failed_line', ctx.lang, { label: clip(label(f.label), 60), why: clip(f.why, 140) })).join('');

// ── look-ups ─────────────────────────────────────────────────────────────────────────────────────────────────────

const peopleArgs = z.object({ name: z.string().trim().max(80).nullish() }).strip();

export const tasksPeopleSkill: ReadSkill<z.infer<typeof peopleArgs>> = {
    id: 'tasks.people', module: 'tasks', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The colleagues this person may give a task to (the Task Manager\'s own rule), each with a handle (P1, P2…). Use BEFORE task_create for someone else or task_hand_over, to get the person\'s handle. Pass the name they used to narrow the list. Do NOT use to look up anyone\'s tasks or details.',
    input: schema({ name: nullableStr('The colleague\'s name as the person wrote it, or null for everyone. Example: "Ravi".') }),
    args: peopleArgs,
    examples: ['give this to Ravi', 'add a task for Asha', 'who can I assign tasks to'],
    ability: { en: 'find a colleague for a task', hi: 'टास्क के लिए सहकर्मी ढूँढना', hinglish: 'task ke liye colleague dhoondna' },
    allowed: staffOnly,
    async run(ctx, a) {
        const people = await ctx.data.taskPeople(ctx.actor.userId);
        if (people === null) return { text: 'The Task Manager is not switched on for this person.' };
        const want = (a.name ?? '').toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        const hits = want.length ? people.filter(p => want.every(w => p.name.toLowerCase().includes(w))) : people;
        if (!hits.length) return { text: want.length ? `No colleague this person may give tasks to matches "${clip(a.name ?? '', 40)}". Say so; ask_user with a fuller name if needed.` : 'This person may not give tasks to anyone.' };
        const shown = hits.slice(0, 25);
        return {
            text: `${hits.length > 1 && want.length ? 'Several match: call ask_user with their names as options.\n' : ''}Colleagues:\n${shown.map(p => `${ctx.handle('person', p.id, clip(p.name, 60))} | ${quote(p.name, 60)}${p.department ? ` | ${quote(p.department, 40)}` : ''}`).join('\n')}${hits.length > shown.length ? `\n(+${hits.length - shown.length} more: ask for the name)` : ''}`,
        };
    },
};

const noArgs = z.object({}).strip();

export const tasksGivenSkill: ReadSkill<z.infer<typeof noArgs>> = {
    id: 'tasks.given', module: 'tasks', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The open tasks this person GAVE to others in the last 30 days, each with a handle (K1, K2…) and who is doing it. Use before task_remind ("remind Ravi about the report"), or when they ask what they assigned that is still open. Do NOT use for their own tasks (tasks_mine).',
    input: schema({}),
    args: noArgs,
    examples: ['remind Ravi about the report', 'what did I assign that is still open', 'jo task maine diye the unka reminder bhejo'],
    ability: { en: 'see tasks I gave', hi: 'मेरे दिए टास्क देखना', hinglish: 'mere diye tasks dekhna' },
    allowed: staffOnly,
    async run(ctx) {
        const rows = await ctx.data.tasksGiven(ctx.actor.userId);
        if (rows === null) return { text: 'The Task Manager is not switched on for this person.' };
        if (!rows.length) return { text: 'This person has no open tasks given to others.', display: ctx.lang === 'en' ? 'Nothing you gave is still open.' : 'Aapka diya koi task abhi open nahi hai.' };
        const shown = rows.slice(0, 30);
        return {
            text: `Open tasks given to others:\n${shown.map(r => `${ctx.handle('task', r.id, `${GIVEN}${clip(r.title, 60)} (${clip(r.assigneeName, 40)})`)} | ${quote(r.title)} | for ${quote(r.assigneeName, 40)} | ${r.status} | ${r.date}`).join('\n')}`,
            display: shown.map(r => `• ${clip(r.title.replace(/\s+/g, ' '), 60)} (${clip(r.assigneeName, 30)}, ${r.status})`).join('\n'),
        };
    },
};

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const createArgs = z.object({
    titles: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    assignee: z.string().trim().max(10).nullish(),
    date: z.string().trim().max(10).nullish(),
    note: z.string().trim().max(600).nullish(),
}).strip();
const createPayload = z.object({ assigneeId: z.string().uuid(), assigneeName: z.string().max(80), self: z.boolean(), titles: z.array(z.string().min(1).max(MAX_TITLE)).min(1).max(10), date: z.string().regex(DAY), note: z.string().max(MAX_NOTE).nullable() }).strict();

export const taskCreateSkill: WriteSkill<z.infer<typeof createArgs>, z.infer<typeof createPayload>> = {
    id: 'task.create', module: 'tasks', kind: 'write', risk: 2, defaultMode: 'off',
    description: 'Propose adding one or more tasks, for the person or for a colleague. Shows a confirmation card; the person must say Yes. Each title must be the person\'s OWN words for that task, copied. For a colleague, first call tasks_people to get their handle. The date is today unless they named another day. Do NOT use to mark a task done, change one or remind someone.',
    input: schema({
        titles: { type: 'array', items: { type: 'string' }, description: 'One title per task, in the person\'s own words. Example: ["Call the AC vendor", "Send the DG log"].' },
        assignee: nullableStr('A person handle from tasks_people, or null for the person themselves. Example: "P2".'),
        date: nullableStr('YYYY-MM-DD from today up to 60 days ahead, or null for today. Example: "2026-11-16".'),
        note: nullableStr('A note for the task if the person gave one, in their words, else null. Example: "before 5 pm".'),
    }),
    args: createArgs,
    payload: createPayload,
    examples: ['add a task for Ravi: call the AC vendor', 'mere liye task add karo: send the DG log', 'tomorrow, give Asha a task to check the lift'],
    ability: { en: 'add a task', hi: 'टास्क जोड़ना', hinglish: 'task add karna' },
    allowed: staffOnly,
    async prepare(ctx, a) {
        const titles: string[] = [];
        for (const raw of a.titles) {
            const t = grounded(raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE), ctx.userWords);
            if (!t) return { ok: false, problem: `"${clip(raw, 40)}" is not in the person's own words. Each title must be copied from what they wrote. If you do not know the title, call ask_user: "What should the task say?"` };
            if (!titles.some(x => x.toLowerCase() === t.toLowerCase())) titles.push(t);
        }
        let assigneeId = ctx.actor.userId, assigneeName = bt('task_you', ctx.lang), self = true;
        if (a.assignee && a.assignee.trim()) {
            const p = ctx.resolve(a.assignee, 'person');
            if (!p) return { ok: false, problem: `${clip(a.assignee, 10)} is not a person handle from this conversation. Call tasks_people with the name and use a handle from it.` };
            if (p.id !== ctx.actor.userId) { assigneeId = p.id; assigneeName = p.label; self = false; }
        }
        const today = istDate(ctx.now);
        const date = a.date && a.date.trim() ? a.date.trim() : today;
        if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { ok: false, problem: 'date must be YYYY-MM-DD, or null for today.' };
        if (date < today) return { ok: false, problem: `That date is in the past (today is ${today}). Ask which day they meant.` };
        if (date > istDate(new Date(ctx.now.getTime() + 60 * 86_400_000))) return { ok: false, problem: 'Tasks can be added up to 60 days ahead.' };
        const note = ownNote(ctx, a.note);
        return {
            ok: true,
            payload: { assigneeId, assigneeName, self, titles, date, note },
            card: `${bt('task_create_card', ctx.lang, { count: many(ctx, titles.length), who: assigneeName, date: dayLabel(date), titles: lines(titles), note: note ? bt('task_note_line', ctx.lang, { note: clip(note, 120) }) : '' })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { count: titles.length, for_someone_else: !self, date },
        };
    },
    async execute(ctx, p) {
        const r = await ctx.data.createTasks({ userId: ctx.actor.userId, assigneeId: p.assigneeId, titles: p.titles, date: p.date, note: p.note });
        const who = p.self ? bt('task_you', ctx.lang) : r.assigneeName || p.assigneeName;
        const head = r.done.length ? bt('task_added', ctx.lang, { done: `${many(ctx, r.done.length)} (${dayLabel(p.date)})`, who }) : bt('task_none_done', ctx.lang);
        return {
            ok: r.done.length > 0,
            reply: `${head}${r.done.length ? `\n${lines(r.done)}` : ''}${failedLines(ctx, r.failed, l => l)}`,
            resultRef: `${r.done.length} tasks`,
            episode: r.done.length ? `Added ${r.done.length} task(s) for ${p.self ? 'themselves' : quote(who, 40)}: ${quote(r.done.join('; '), 80)}` : null,
        };
    },
};

const completeArgs = z.object({ tasks: z.array(z.string().trim().min(1).max(10)).min(1).max(15), remark: z.string().trim().max(600).nullish() }).strip();
const completePayload = z.object({ tasks: z.array(z.object({ id: z.string().uuid(), title: z.string().max(200) }).strict()).min(1).max(15), remark: z.string().max(MAX_NOTE).nullable() }).strict();

export const taskCompleteSkill: WriteSkill<z.infer<typeof completeArgs>, z.infer<typeof completePayload>> = {
    id: 'task.complete', module: 'tasks', kind: 'write', risk: 1, defaultMode: 'off',
    description: 'Propose marking one or more of the person\'s OWN tasks as done ("done 2", "finished the painting one", "all done"). Shows a confirmation card; the person must say Yes. Needs task handles from tasks_mine (task numbers are the numbers there). Do NOT use for "working on it" or "stuck" (answer them in words), or for tasks they gave to others.',
    input: schema({
        tasks: { type: 'array', items: { type: 'string' }, description: 'Task handles from tasks_mine. Example: ["K2"].' },
        remark: nullableStr('A completion remark if the person gave one, in their words, else null. Example: "replaced the filter".'),
    }),
    args: completeArgs,
    payload: completePayload,
    examples: ['done 2', 'painting wala task ho gaya', 'finished task 1 and 3, replaced the filter'],
    ability: { en: 'mark a task done', hi: 'टास्क पूरा करना', hinglish: 'task done karna' },
    allowed: staffOnly,
    async prepare(ctx, a) {
        const tasks: Array<{ id: string; title: string }> = [];
        for (const h of a.tasks) {
            const t = ctx.resolve(h, 'task');
            if (!t || t.label.startsWith(GIVEN)) return { ok: false, problem: `${clip(h, 10)} is not one of the person's own task handles. Call tasks_mine and use handles from it.` };
            if (!tasks.some(x => x.id === t.id)) tasks.push({ id: t.id, title: t.label });
        }
        const remark = ownNote(ctx, a.remark);
        return {
            ok: true,
            payload: { tasks, remark },
            card: `${bt('task_complete_card', ctx.lang, { count: many(ctx, tasks.length), titles: lines(tasks.map(t => t.title)), note: remark ? bt('task_note_line', ctx.lang, { note: clip(remark, 120) }) : '' })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { count: tasks.length, remark: !!remark },
        };
    },
    async execute(ctx, p) {
        const title = (id: string) => p.tasks.find(t => t.id === id)?.title ?? 'a task';
        const r = await ctx.data.completeTasks({ userId: ctx.actor.userId, taskIds: p.tasks.map(t => t.id), remark: p.remark });
        const head = r.done.length ? bt('task_completed', ctx.lang, { done: many(ctx, r.done.length) }) : bt('task_none_done', ctx.lang);
        return {
            ok: r.done.length > 0,
            reply: `${head}${r.done.length ? `\n${lines(r.done.map(title))}` : ''}${failedLines(ctx, r.failed, title)}`,
            resultRef: `${r.done.length} done`,
            episode: r.done.length ? `Marked ${r.done.length} task(s) done: ${quote(r.done.map(title).join('; '), 80)}` : null,
        };
    },
};

const handArgs = z.object({ task: z.string().trim().min(1).max(10), to: z.string().trim().min(1).max(10), note: z.string().trim().max(600).nullish() }).strip();
const handPayload = z.object({ taskId: z.string().uuid(), title: z.string().max(200), toId: z.string().uuid(), toName: z.string().max(80), note: z.string().max(MAX_NOTE).nullable() }).strict();

export const taskHandOverSkill: WriteSkill<z.infer<typeof handArgs>, z.infer<typeof handPayload>> = {
    id: 'task.hand_over', module: 'tasks', kind: 'write', risk: 2, defaultMode: 'off',
    description: 'Propose giving ONE of the person\'s own tasks to a colleague ("give task 2 to Ravi"). Shows a confirmation card; the person must say Yes, and the colleague is told. Needs a task handle from tasks_mine and a person handle from tasks_people. Do NOT use to add a new task for someone (task_create) or to remind someone.',
    input: schema({
        task: str('A task handle from tasks_mine. Example: "K2".'),
        to: str('A person handle from tasks_people. Example: "P1".'),
        note: nullableStr('A note for the colleague if the person gave one, in their words, else null. Example: "keys are with security".'),
    }),
    args: handArgs,
    payload: handPayload,
    examples: ['give task 2 to Ravi', 'painting wala task Asha ko de do', 'hand over the DG check to Suresh, keys are with security'],
    ability: { en: 'hand over a task', hi: 'टास्क किसी और को देना', hinglish: 'task hand over karna' },
    allowed: staffOnly,
    async prepare(ctx, a) {
        const t = ctx.resolve(a.task, 'task');
        if (!t || t.label.startsWith(GIVEN)) return { ok: false, problem: `${clip(a.task, 10)} is not one of the person's own task handles. Call tasks_mine and use a handle from it.` };
        const p = ctx.resolve(a.to, 'person');
        if (!p) return { ok: false, problem: `${clip(a.to, 10)} is not a person handle from this conversation. Call tasks_people with the name and use a handle from it.` };
        if (p.id === ctx.actor.userId) return { ok: false, problem: 'That is the person themselves. Ask who should take the task.' };
        const note = ownNote(ctx, a.note);
        return {
            ok: true,
            payload: { taskId: t.id, title: t.label, toId: p.id, toName: p.label, note },
            card: `${bt('task_handover_card', ctx.lang, { who: p.label, titles: lines([t.label]), note: note ? bt('task_note_line', ctx.lang, { note: clip(note, 120) }) : '' })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { note: !!note },
        };
    },
    async execute(ctx, p) {
        try {
            const r = await ctx.data.handOverTask({ userId: ctx.actor.userId, taskId: p.taskId, toId: p.toId, note: p.note });
            return { ok: true, reply: `${bt('task_handed', ctx.lang, { who: r.toName || p.toName })}\n${lines([p.title])}`, resultRef: 'handed over', episode: `Handed over task ${quote(p.title, 50)} to ${quote(r.toName || p.toName, 40)}` };
        } catch (err) {
            // The Task Manager's own reason (not allowed, the colleague cannot take tasks, ...), said plainly.
            return { ok: false, reply: bt('task_handover_failed', ctx.lang, { who: p.toName, why: clip(err instanceof Error && err.message ? err.message : 'something went wrong', 160) }) };
        }
    },
};

const remindArgs = z.object({ tasks: z.array(z.string().trim().min(1).max(10)).min(1).max(20) }).strip();
const remindPayload = z.object({ tasks: z.array(z.object({ id: z.string().uuid(), title: z.string().max(200) }).strict()).min(1).max(20) }).strict();

export const taskRemindSkill: WriteSkill<z.infer<typeof remindArgs>, z.infer<typeof remindPayload>> = {
    id: 'task.remind', module: 'tasks', kind: 'write', risk: 2, defaultMode: 'off',
    description: 'Propose sending a WhatsApp reminder to the colleagues doing tasks this person GAVE them ("remind Ravi about the report"). Shows a confirmation card; the person must say Yes. Needs task handles from tasks_given. Do NOT use for the person\'s own tasks, or to give someone a new task.',
    input: schema({ tasks: { type: 'array', items: { type: 'string' }, description: 'Task handles from tasks_given. Example: ["K4", "K5"].' } }),
    args: remindArgs,
    payload: remindPayload,
    examples: ['remind Ravi about the report', 'sabko pending tasks ka reminder bhejo', 'nudge Asha on the lift check'],
    ability: { en: 'remind someone about a task', hi: 'टास्क का रिमाइंडर भेजना', hinglish: 'task ka reminder bhejna' },
    allowed: staffOnly,
    async prepare(ctx, a) {
        const tasks: Array<{ id: string; title: string }> = [];
        for (const h of a.tasks) {
            const t = ctx.resolve(h, 'task');
            if (!t || !t.label.startsWith(GIVEN)) return { ok: false, problem: `${clip(h, 10)} is not a task this person gave to someone. Call tasks_given and use handles from it.` };
            if (!tasks.some(x => x.id === t.id)) tasks.push({ id: t.id, title: t.label.slice(GIVEN.length) });
        }
        return {
            ok: true,
            payload: { tasks },
            card: `${bt('task_remind_card', ctx.lang, { count: many(ctx, tasks.length), titles: lines(tasks.map(t => t.title)) })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { count: tasks.length },
        };
    },
    async execute(ctx, p) {
        const r = await ctx.data.remindTasks({ userId: ctx.actor.userId, taskIds: p.tasks.map(t => t.id) });
        const who = r.reminded.map(x => `${x.name} (${x.count})`).join(', ');
        const skipped = r.skipped.map(s => bt('task_failed_line', ctx.lang, { label: clip(s.title, 60), why: clip(s.why, 140) })).join('');
        return {
            ok: r.reminded.length > 0,
            reply: `${who ? bt('task_reminded', ctx.lang, { who }) : bt('task_not_reminded', ctx.lang)}${skipped}`,
            resultRef: `${r.reminded.length} reminded`,
            episode: who ? `Sent a task reminder to ${quote(who, 60)}` : null,
        };
    },
};

export const TASK_SKILLS = [tasksPeopleSkill, tasksGivenSkill, taskCreateSkill, taskCompleteSkill, taskHandOverSkill, taskRemindSkill] as const;

/**
 * When a person's task actions are on, three existing descriptions must stop sending tasks away. Swapped in by
 * registry.ts only then, so with every action off the tool list is byte for byte as before.
 */
export const IN_BRAIN_DESCRIPTIONS: Readonly<Record<string, string>> = {
    'tasks.mine': 'The person\'s own open tasks for today, numbered as in their daily message, each with a handle (K1, K2…). Use for "my tasks", before task_complete or task_hand_over ("done 2" means the task numbered 2 here), and to find the task a file should be attached to. Do NOT use for tasks they gave to others (tasks_given).',
    'task.add_file': 'Propose attaching a photo or file the person sent to ONE of their own tasks. Shows a confirmation card; the person must say Yes. Use when they send a file for a task ("photo of the finished work for task 2"). Needs a task handle from tasks_mine. Do NOT use to mark a task done (task_complete) or to change it.',
    handoff: 'Pass the conversation on. Ends your turn. Use to "tasks_assistant" only for task requests none of your task tools does (team progress, deleting, renaming or moving a task to another day). Use to "human" when the person asks for a person, is upset, or you cannot help after trying. Do NOT use for requests you can answer with your tools.',
};
