/**
 * The skill registry: the ONE list of what the brain can do. It drives the tool list the model sees, the confirmation
 * rule, the settings grid, the audit label and (later) the MCP catalog.
 *
 * Never a skill, so no wording can trigger them: deleting anything, changing roles, permissions or users, approving or
 * paying, bulk changes, free-form database queries, org settings. Those are risk 3 and live in the app only.
 */
import type { ActorContext } from '../../types';
import { brainLevelFor, skillModeFor, type BrainSettings } from '../config';
import type { Skill, SkillMode, ToolDef } from '../types';
import { MEMORY_SKILLS } from './memory';
import { OTHER_SKILLS } from './other';
import { ROOM_SKILLS } from './rooms';
import { IN_BRAIN_DESCRIPTIONS, TASK_ACTION_IDS, TASK_HELPER_IDS, TASK_SKILLS } from './tasks';
import { TICKET_SKILLS } from './tickets';
import { schema, str } from './common';

/**
 * Fixed order (never sorted by anything that changes), so the tool list is byte-identical between calls and caches.
 * The task skills (owner 2026-11-15) come last: while they are off the list is exactly what it was before them.
 */
export const SKILLS: readonly Skill[] = [...TICKET_SKILLS, ...ROOM_SKILLS, ...OTHER_SKILLS, ...MEMORY_SKILLS, ...TASK_SKILLS];

/** Tool names may not contain dots: 'tickets.list' is shown to the model as 'tickets_list'. */
export const toolName = (skillId: string): string => skillId.replace(/\./g, '_');
const BY_TOOL = new Map(SKILLS.map(s => [toolName(s.id), s]));
export const skillByTool = (name: string): Skill | undefined => BY_TOOL.get(name);
export const skillById = (id: string): Skill | undefined => SKILLS.find(s => s.id === id);

export interface AvailableSkill { skill: Skill; mode: Exclude<SkillMode, 'off'> }

/**
 * The skills this person may use right now: the skill's own rule (the app's access rule) AND the org's grid for their
 * roles AND the skill's mode. Called when the tool list is built and AGAIN when a confirmed action is about to run.
 */
export function skillsFor(actor: ActorContext, settings: BrainSettings): AvailableSkill[] {
    const out: AvailableSkill[] = [];
    for (const skill of SKILLS) {
        if (!skill.allowed(actor)) continue;
        const level = brainLevelFor(actor, settings, skill.module);
        if (level === 'off') continue;
        if (skill.kind === 'write' && level !== 'questions_actions') continue;
        if (skill.module === 'memory' && !settings.memory.enabled) continue;
        const mode = skillModeFor(settings, skill.id, skill.defaultMode);
        if (mode === 'off') continue;
        out.push({ skill, mode });
    }
    // The task look-ups exist only for the task actions: without one of those on, they are not offered at all.
    return tasksInBrain(out) ? out : out.filter(a => !TASK_HELPER_IDS.has(a.skill.id));
}

/** Has this person got at least one of the brain's own task actions (add, done, hand over, remind)? */
export const tasksInBrain = (available: readonly AvailableSkill[]): boolean => available.some(a => TASK_ACTION_IDS.has(a.skill.id));

// ── Control tools: how a turn ends other than with a plain answer ─────────────────────────────────────────────────

export const ASK_USER = 'ask_user';
export const HANDOFF = 'handoff';

export const CONTROL_TOOLS: readonly ToolDef[] = [
    {
        name: ASK_USER,
        description: 'Ask the person ONE question when a required detail is still missing after you have read what you can. Ends your turn. Give options whenever the answer is one of a few known choices (properties, rooms, tickets). Do NOT use it to confirm an action (the confirmation card does that) or to ask something a read tool could tell you.',
        input: schema({
            question: str('The question, short, in the person\'s language. Example: "Which property?"'),
            options: { type: 'array', items: { type: 'string' }, description: 'Up to 8 choices, or an empty list for an open question. Example: ["Work Square Andheri", "VFS Lower Parel"].' },
        }),
    },
    {
        name: HANDOFF,
        description: 'Pass the conversation on. Ends your turn. Use to "tasks_assistant" for anything about tasks other than attaching a file (my tasks, add, done, hand over, remind, team progress). Use to "human" when the person asks for a person, is upset, or you cannot help after trying. Do NOT use for requests you can answer with your tools.',
        input: schema({
            to: { type: 'string', enum: ['tasks_assistant', 'human'], description: 'Who takes over. Example: "tasks_assistant".' },
            reason: str('Why, in a few words. Example: "wants to mark a task done".'),
        }),
    },
];

export function toolDefs(available: AvailableSkill[]): ToolDef[] {
    // With a task action on, the descriptions that send tasks to the task assistant say what the brain now does itself.
    const inBrain = tasksInBrain(available);
    const describe = (id: string, text: string) => (inBrain && IN_BRAIN_DESCRIPTIONS[id]) || text;
    return [
        ...available.map(a => ({ name: toolName(a.skill.id), description: describe(a.skill.id, a.skill.description), input: a.skill.input })),
        ...CONTROL_TOOLS.map(t => (t.name === HANDOFF ? { ...t, description: describe('handoff', t.description) } : t)),
    ];
}

/** For the console and the docs: every skill with what it needs. */
export function describeSkills() {
    return SKILLS.map(s => ({ id: s.id, module: s.module, kind: s.kind, risk: s.risk, defaultMode: s.defaultMode, description: s.description, examples: [...s.examples] }));
}
