/**
 * What a save will change, in plain words, and which changes need an explicit "yes" first. The wording follows the
 * server's own change log (diffSettings in backend/lib/aiLayer/brain/console/view.ts, which is server-only), so the
 * list shown before saving reads like the history line written after it. The server checks everything again.
 */
import type { BrainSettings } from '@/backend/lib/aiLayer/brain/config';
import type { SkillMode } from '@/backend/lib/aiLayer/brain/types';
import type { SkillView } from '@/backend/lib/aiLayer/brain/console/types';
import { MODE_LABEL, SKILL_MODE_LABEL } from './labels';

type SkillMeta = Pick<SkillView, 'id' | 'kind' | 'defaultMode'>;

export const skillModeOf = (s: BrainSettings, skill: SkillMeta): SkillMode => s.skillModes[skill.id] ?? skill.defaultMode;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const onOff = (b: boolean) => (b ? 'on' : 'off');

export function describeChanges(before: BrainSettings, after: BrainSettings, skills: SkillMeta[]): string[] {
    const out: string[] = [];
    const say = (label: string, a: unknown, b: unknown) => { if (!same(a, b)) out.push(`${label}: ${String(a)} → ${String(b)}`); };
    if (before.mode !== after.mode) out.push(`Mode: ${MODE_LABEL[before.mode]} → ${MODE_LABEL[after.mode]}`);
    say('Who gets it', before.audience === 'pilot' ? 'pilot people' : 'everyone', after.audience === 'pilot' ? 'pilot people' : 'everyone');
    const people = (label: string, a: string[], b: string[]) => {
        const added = b.filter(x => !a.includes(x)).length, removed = a.filter(x => !b.includes(x)).length;
        if (added || removed) out.push(`${label}: ${[added ? `${added} added` : '', removed ? `${removed} removed` : ''].filter(Boolean).join(', ')} (now ${b.length})`);
    };
    people('Pilot people', before.pilotUserIds, after.pilotUserIds);
    people('Blocked people', before.blockedUserIds, after.blockedUserIds);
    say('WhatsApp', onOff(before.channels.whatsapp), onOff(after.channels.whatsapp));
    say('In-app chat', onOff(before.channels.app_chat), onOff(after.channels.app_chat));
    say('Tasks through the task assistant', onOff(before.taskEngine), onOff(after.taskEngine));
    const learnWord = { off: 'off', shadow: 'watch only', live: 'on' } as const;
    say('Ticket sorting learns', learnWord[before.ticketLearning.mode], learnWord[after.ticketLearning.mode]);
    say('Find similar tickets by meaning', onOff(before.ticketLearning.meaning), onOff(after.ticketLearning.meaning));
    say('Draft new sorting rules every day', onOff(before.ticketLearning.rulesDaily), onOff(after.ticketLearning.rulesDaily));
    say('Read ticket photos', learnWord[before.ticketPhotos.mode], learnWord[after.ticketPhotos.mode]);
    for (const s of skills) {
        const was = skillModeOf(before, s), now = skillModeOf(after, s);
        if (was !== now) out.push(`Skill ${s.id}: ${SKILL_MODE_LABEL[was].toLowerCase()} → ${SKILL_MODE_LABEL[now].toLowerCase()}`);
    }
    say('Messages per person per hour', before.limits.perUserPerHour, after.limits.perUserPerHour);
    say('Actions per person per day', before.limits.actionsPerUserPerDay, after.limits.actionsPerUserPerDay);
    say('Look-ups per message', before.limits.maxToolCalls, after.limits.maxToolCalls);
    say('Questions in a row before a person takes over', before.limits.maxQuestionsInRow, after.limits.maxQuestionsInRow);
    say('Model effort', before.model.effort, after.model.effort);
    say('Longest reply (tokens)', before.model.maxTokens, after.model.maxTokens);
    say('Model sees photos', before.model.vision ? 'yes' : 'no', after.model.vision ? 'yes' : 'no');
    say('Memory', onOff(before.memory.enabled), onOff(after.memory.enabled));
    say('Remembered facts kept (days)', before.memory.profileDays, after.memory.profileDays);
    say('Past actions kept (days)', before.memory.episodeDays, after.memory.episodeDays);
    say('Claude key order', before.keys.order.map(k => `Key ${k}`).join(', '), after.keys.order.map(k => `Key ${k}`).join(', '));
    say('Key 1 cycle ends', before.keys.cycleEnd.k1 ?? 'not set', after.keys.cycleEnd.k1 ?? 'not set');
    say('Key 2 cycle ends', before.keys.cycleEnd.k2 ?? 'not set', after.keys.cycleEnd.k2 ?? 'not set');
    say('Key 1 monthly credit (USD)', before.keys.monthlyCreditUsd.k1, after.keys.monthlyCreditUsd.k1);
    say('Key 2 monthly credit (USD)', before.keys.monthlyCreditUsd.k2, after.keys.monthlyCreditUsd.k2);
    say('Message words kept (days)', before.textRetentionDays, after.textRetentionDays);
    // Same wording as the server's change log (diffSettings in console/view.ts).
    say('Lessons from judged messages', before.learning.lessons ? 'on' : 'off', after.learning.lessons ? 'on' : 'off');
    say('Lessons shown per message', before.learning.maxLessons, after.learning.maxLessons);
    if (!same(before.grid, after.grid)) out.push('Role access grid changed');
    return out;
}

/** What each write skill does for real, for the one-sentence consequence. */
const SKILL_CONSEQUENCE: Record<string, string> = {
    'ticket.create': 'it will raise real tickets that reach the maintenance team',
    'ticket.add_photo': 'it will attach photos to real tickets',
    'room.book': 'it will book real meeting rooms',
    'task.add_file': 'it will attach files to people’s real tasks',
    'task.create': 'it will add real tasks, also for colleagues, who get a WhatsApp alert',
    'task.complete': 'it will mark people’s real tasks as done and tell the people who gave them',
    'task.hand_over': 'it will give people’s real tasks to colleagues, who are told',
    'task.remind': 'it will send real WhatsApp reminders to colleagues',
    'memory.remember': 'it will save facts about the person for later conversations',
    'memory.forget': 'it will delete what it remembers about the person',
};

/**
 * The changes that need an explicit confirmation, each stated as its consequence in one sentence:
 * mode → live, audience → everyone, any write skill → live, lessons → on.
 */
export function riskyChanges(before: BrainSettings, after: BrainSettings, skills: SkillMeta[]): string[] {
    const out: string[] = [];
    const channels = [after.channels.whatsapp && 'WhatsApp', after.channels.app_chat && 'in-app chat'].filter(Boolean).join(' and ') || 'no channel yet';
    if (before.mode !== 'live' && after.mode === 'live') {
        out.push(after.audience === 'everyone'
            ? `The brain will start answering everyone in the organisation for real, on ${channels}.`
            : `The brain will start answering the ${after.pilotUserIds.length} pilot ${after.pilotUserIds.length === 1 ? 'person' : 'people'} for real, on ${channels}.`);
    }
    if (before.audience !== 'everyone' && after.audience === 'everyone') {
        out.push(after.mode === 'off'
            ? 'Once the brain is switched on, everyone in the organisation will get it, not only the pilot people.'
            : `Everyone in the organisation who writes on ${channels} will get the brain, not only the pilot people.`);
    }
    for (const s of skills) {
        if (s.kind !== 'write') continue;
        if (skillModeOf(before, s) !== 'live' && skillModeOf(after, s) === 'live') {
            out.push(`“${s.id}” goes live: after the person says Yes, ${SKILL_CONSEQUENCE[s.id] ?? 'it will make real changes in the app'}.`);
        }
    }
    if (!before.learning.lessons && after.learning.lessons) {
        out.push('Messages the Tech team judged will start steering the brain’s answers for everyone who gets the brain.');
    }
    return out;
}

/**
 * The server refuses an action skill going from off straight to live; say so before the person tries. Skills that are
 * live by design (the memory skills) are not held back. The server also refuses the same jump made through the
 * organisation's mode (a skill saved as live while the brain is off); its message is shown when the save is tried.
 */
export const offToLiveRefused = (savedMode: SkillMode, kind: 'read' | 'write', defaultMode: SkillMode) => kind === 'write' && defaultMode !== 'live' && savedMode === 'off';

/** Fewer people than this from outside the Tech team, and their messages could be traced back to them (the server enforces it). */
export const MIN_OUTSIDE_PILOT = 5;
