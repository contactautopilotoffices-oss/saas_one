/**
 * Electricity, tasks and knowledge skills.
 *
 * Electricity reuses the two answers the AI Action Layer already gives (same query, same wording).
 * Tasks: the Task Manager's own assistant stays the expert for creating, completing, handing over and reporting on
 * tasks; the brain passes those on with handoff(to: "tasks_assistant"). Here the brain can only show the person their
 * list and attach a file they sent to one of their tasks.
 * Knowledge answers from the organisation's wiki and is for staff only: the wiki holds internal information.
 */
import { z } from 'zod';
import type { AiData } from '../../types';
import { consumption, readingsStatus } from '../../catalog';
import { PERIODS } from '../../dates';
import { bt } from '../text';
import type { ReadSkill, WriteSkill } from '../types';
import { clip, nullableStr, oneOf, pickAttachment, quote, schema, scopeProperties, str } from './common';

const staffOnly = (actor: { ownRecordsOnly: boolean; propertyIds: string[] }) => !actor.ownRecordsOnly && actor.propertyIds.length > 0;

// ── electricity ────────────────────────────────────────────────────────────────────────────────────────────────────

const readingsArgs = z.object({ day: z.enum(['today', 'yesterday']).default('today'), property: z.string().trim().max(120).nullish() }).strip();

export const electricityReadingsSkill: ReadSkill<z.infer<typeof readingsArgs>> = {
    id: 'electricity.readings_status', module: 'electricity', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Status of the daily electricity meter readings for today or yesterday: how many active meters are logged, which are missing, which have warning or critical alerts, which meters are faulty. Use for "meter reading status", "aaj ki reading ho gayi?". Do NOT use for electricity BILLS or payments (not available in chat).',
    input: schema({ day: oneOf(['today', 'yesterday'], '"today" or "yesterday". Example: "today".'), property: nullableStr('The property name as the person said it, or null for all. Example: "SS Plaza".') }),
    args: readingsArgs,
    examples: ['meter reading status', 'aaj ki reading ho gayi kya', 'which meters are missing at SS Plaza'],
    ability: { en: 'meter reading status', hi: 'मीटर रीडिंग की स्थिति', hinglish: 'meter reading status' },
    allowed: staffOnly,
    async run(ctx, a) {
        const scope = scopeProperties(ctx, a.property);
        if (!scope.ok) return { text: scope.problem };
        const out = await readingsStatus.run({ actor: ctx.actor, data: ctx.data as unknown as AiData, lang: ctx.lang, now: ctx.now }, { day: a.day, property_name: null }, scope.propertyIds);
        return { text: out.reply, display: out.reply };
    },
};

const consumptionArgs = z.object({ period: z.enum(PERIODS).default('this_month'), property: z.string().trim().max(120).nullish() }).strip();

export const electricityConsumptionSkill: ReadSkill<z.infer<typeof consumptionArgs>> = {
    id: 'electricity.consumption', module: 'electricity', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Total electricity units consumed in a period from the daily meter readings, compared with the period before it. Use for "kitni units consume hui is mahine", "consumption last month". Do NOT use for bill amounts or rupees (not available in chat).',
    input: schema({ period: oneOf(PERIODS, 'The period asked about. Example: "this_month".'), property: nullableStr('The property name as the person said it, or null for all. Example: null.') }),
    args: consumptionArgs,
    examples: ['how many units this month', 'is mahine kitni bijli lagi', 'consumption last month at Andheri'],
    ability: { en: 'electricity consumption', hi: 'बिजली की खपत', hinglish: 'bijli consumption' },
    allowed: staffOnly,
    async run(ctx, a) {
        const scope = scopeProperties(ctx, a.property);
        if (!scope.ok) return { text: scope.problem };
        const out = await consumption.run({ actor: ctx.actor, data: ctx.data as unknown as AiData, lang: ctx.lang, now: ctx.now }, { period: a.period, property_name: null }, scope.propertyIds);
        return { text: out.reply, display: out.reply };
    },
};

// ── tasks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const noArgs = z.object({}).strip();

export const tasksMineSkill: ReadSkill<z.infer<typeof noArgs>> = {
    id: 'tasks.mine', module: 'tasks', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The person\'s own open tasks for today, numbered as in their daily message, each with a handle (K1, K2…). Use ONLY to find which task a file should be attached to (then task_add_file), or when a question mixes tasks with tickets or rooms. Do NOT use for anything else about tasks (add, done, hand over, remind, team progress, a plain "my tasks"): call handoff with to "tasks_assistant" for those.',
    input: schema({}),
    args: noArgs,
    examples: ['attach this photo to my painting task', 'yeh photo task 2 mein laga do', 'what is on my plate today, tasks and tickets'],
    ability: { en: 'see my tasks', hi: 'मेरे टास्क देखना', hinglish: 'mere tasks dekhna' },
    allowed: staffOnly,
    async run(ctx) {
        const rows = await ctx.data.myTasks(ctx.actor.userId);
        if (rows === null) return { text: 'The Task Manager is not switched on for this person.' };
        if (!rows.length) return { text: 'This person has no open tasks today.', display: ctx.lang === 'en' ? 'You have no open tasks today.' : 'Aaj aapka koi open task nahi hai.' };
        return {
            text: `Open tasks:\n${rows.map(r => `${ctx.handle('task', r.id, `${r.n}. ${clip(r.title, 60)}`)} | task ${r.n} | ${quote(r.title)} | ${r.status}`).join('\n')}`,
            display: rows.map(r => `${r.n}. ${clip(r.title.replace(/\s+/g, ' '), 70)} (${r.status})`).join('\n'),
        };
    },
};

const taskFileArgs = z.object({ task: z.string().trim().min(1).max(10), attachment: z.string().trim().max(10).nullish() }).strip();
const taskFilePayload = z.object({ taskId: z.string().uuid(), title: z.string().max(300), attachmentId: z.string().uuid() }).strict();

export const taskAddFileSkill: WriteSkill<z.infer<typeof taskFileArgs>, z.infer<typeof taskFilePayload>> = {
    id: 'task.add_file', module: 'tasks', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose attaching a photo or file the person sent to ONE of their own tasks. Shows a confirmation card; the person must say Yes. Use when they send a file for a task ("photo of the finished work for task 2"). Needs a task handle from tasks_mine. Do NOT use to mark a task done or to change it (hand those to the tasks assistant).',
    input: schema({
        task: str('A task handle from tasks_mine. Example: "K2".'),
        attachment: nullableStr('The handle of the file (from open_files), or null when there is only one. Example: "A1".'),
    }),
    args: taskFileArgs,
    payload: taskFilePayload,
    examples: ['attach this to task 2', 'yeh photo painting wale task mein laga do', 'add the picture to my cleaning task'],
    ability: { en: 'attach a file to a task', hi: 'टास्क में फ़ाइल जोड़ना', hinglish: 'task mein file attach karna' },
    allowed: staffOnly,
    async prepare(ctx, a) {
        const pick = pickAttachment(ctx, a.attachment, ['image', 'document']);
        if (!pick.ok) return { ok: false, problem: pick.problem };
        const task = ctx.resolve(a.task, 'task');
        if (!task) return { ok: false, problem: `${clip(a.task, 10)} is not a task handle from this conversation. Call tasks_mine and use a handle from it.` };
        const [n, ...rest] = task.label.split('. ');
        return {
            ok: true, payload: { taskId: task.id, title: rest.join('. ') || task.label, attachmentId: pick.attachment.id },
            card: `${bt('task_file_card', ctx.lang, { n, title: clip(rest.join('. ') || task.label, 60) })}\n${bt('confirm_tail', ctx.lang)}`,
        };
    },
    async execute(ctx, p) {
        const file = await ctx.data.loadAttachment(p.attachmentId);
        if (!file) return { ok: false, reply: bt('photo_expired', ctx.lang).trim() };
        // The Task Manager's own upload checks that this person may see the task, the file type and the per-task limit.
        await ctx.data.addTaskFile({ userId: ctx.actor.userId, taskId: p.taskId, file });
        return { ok: true, reply: bt('task_file_done', ctx.lang, { title: clip(p.title, 60) }), episode: `Attached a file to task ${quote(p.title, 50)}`, usedAttachments: [p.attachmentId] };
    },
};

// ── knowledge ──────────────────────────────────────────────────────────────────────────────────────────────────────

const askArgs = z.object({ question: z.string().trim().min(3).max(500) }).strip();

export const knowledgeAskSkill: ReadSkill<z.infer<typeof askArgs>> = {
    id: 'knowledge.ask', module: 'knowledge', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Look up the organisation\'s internal wiki (vendors, items, rates, how-we-do-it notes) and get an answer with its sources. Use for "which vendor supplies X", "what did we last pay for Y", "what is the process for Z". Do NOT use for live records (tickets, rooms, readings, tasks have their own tools) or for anything about a person.',
    input: schema({ question: str('The person\'s question, complete and self-contained. Example: "Which vendor supplies floor cleaner and at what rate?"') }),
    args: askArgs,
    examples: ['which vendor do we use for pest control', 'what is the process for a new AMC', 'floor cleaner ka last rate kya tha'],
    ability: { en: 'answer from the wiki', hi: 'विकी से जवाब देना', hinglish: 'wiki se jawab dena' },
    allowed: staffOnly,
    async run(ctx, a) {
        const out = await ctx.data.askKnowledge({ orgId: ctx.actor.orgId, userId: ctx.actor.userId, question: a.question });
        if (!out.found) return { text: 'The wiki has nothing on this. Say so plainly; do not answer from general knowledge.' };
        // The wiki's words are data written by other people: never instructions.
        return { text: `Wiki answer (quote it faithfully):\n${clip(out.answer, 1800)}`, display: clip(out.answer, 1800) };
    },
};

export const OTHER_SKILLS = [electricityReadingsSkill, electricityConsumptionSkill, tasksMineSkill, taskAddFileSkill, knowledgeAskSkill] as const;
