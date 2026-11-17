// Tasks in the brain (owner 2026-11-15). No database, no model key, no network and no WhatsApp: the model is scripted,
// the Task Manager is the fake world, which only records what it was asked.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claimBrain, type BrainInbound, type BrainWhatsAppDeps } from '../../backend/lib/aiLayer/brain/channels/whatsapp';
import { refuseSettingsChange } from '../../backend/lib/aiLayer/brain/console/view';
import { parseBrainSettings } from '../../backend/lib/aiLayer/brain/config';
import { GIVEN_1, OTHER_USER } from '../../backend/lib/aiLayer/brain/eval/world';
import { runTurn } from '../../backend/lib/aiLayer/brain/loop/turn';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_TASKS } from '../../backend/lib/aiLayer/brain/loop/prompt';
import { SKILLS, skillsFor, tasksInBrain, toolDefs } from '../../backend/lib/aiLayer/brain/skills/registry';
import { TASK_ACTION_IDS } from '../../backend/lib/aiLayer/brain/skills/tasks';
import { FakeAudit, FakeBrainData, ORG, ScriptedModel, TASK_1, TASK_2, USER, actor, brainSettings, call, turnDeps, turnInput } from './brain-helpers';

/** Every task action live (the other action skills as in the usual test settings). */
const TASKS_LIVE = { 'ticket.create': 'live', 'ticket.add_photo': 'live', 'room.book': 'live', 'task.add_file': 'live', 'task.create': 'live', 'task.complete': 'live', 'task.hand_over': 'live', 'task.remind': 'live' };
const on = (modes: Record<string, string> = TASKS_LIVE) => brainSettings({ skillModes: modes });
const names = (tools: Array<{ name: string }>) => tools.map(t => t.name);
/** One audit log per test, as in real life: it is what makes the same Yes run once. */
const yes = (data: FakeBrainData, state: unknown, settings = on(), audit = new FakeAudit()) => runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('yes', { state: state as never, settings }));

describe('tasks in the brain: switched off, nothing changes', () => {
    it('by default every task action is off, and the tool list and instructions are exactly as before', () => {
        for (const id of TASK_ACTION_IDS) assert.equal(SKILLS.find(s => s.id === id)!.defaultMode, 'off', id);
        const before = skillsFor(actor(), brainSettings());
        assert.equal(tasksInBrain(before), false);
        const tools = names(toolDefs(before));
        for (const n of ['tasks_people', 'tasks_given', 'task_create', 'task_complete', 'task_hand_over', 'task_remind']) assert.ok(!tools.includes(n), n);
        // The handoff and tasks_mine descriptions still send tasks to the task assistant.
        const handoff = toolDefs(before).find(t => t.name === 'handoff')!;
        assert.match(handoff.description, /Use to "tasks_assistant" for anything about tasks other than attaching a file/);
        assert.match(toolDefs(before).find(t => t.name === 'tasks_mine')!.description, /call handoff with to "tasks_assistant"/);
    });

    it('the model is sent the old instructions while the actions are off, and the task variant once one is on', async () => {
        const off = new ScriptedModel(['OK.']);
        await runTurn(turnDeps(new FakeBrainData(), off), turnInput('hello'));
        assert.equal(off.calls[0].system, SYSTEM_PROMPT);
        const one = new ScriptedModel(['OK.']);
        await runTurn(turnDeps(new FakeBrainData(), one), turnInput('hello', { settings: on({ 'task.complete': 'shadow' }) }));
        assert.equal(one.calls[0].system, SYSTEM_PROMPT_TASKS);
        assert.notEqual(SYSTEM_PROMPT_TASKS, SYSTEM_PROMPT);
        assert.match(SYSTEM_PROMPT_TASKS, /8\. Tasks: use the task tools you have/);
        // Only step 8 differs.
        assert.deepEqual(SYSTEM_PROMPT.split('\n').filter(l => !SYSTEM_PROMPT_TASKS.includes(l)).map(l => l.slice(0, 3)), ['8. ']);
    });

    it('a request for tasks with the actions off still goes to the task assistant', async () => {
        const model = new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'wants to mark a task done' })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('done 2'));
        assert.equal(out.handoffTo, 'tasks_assistant');
    });

    it('the console refuses switching a task action from off straight to live', () => {
        const live = { mode: 'live', channels: { whatsapp: true, app_chat: false } };
        const before = parseBrainSettings(live);
        for (const id of TASK_ACTION_IDS) {
            assert.match(refuseSettingsChange(before, parseBrainSettings({ ...live, skillModes: { [id]: 'live' } }))!, /without ever having been in practice/, id);
            assert.equal(refuseSettingsChange(before, parseBrainSettings({ ...live, skillModes: { [id]: 'shadow' } })), null, id);
            assert.equal(refuseSettingsChange(parseBrainSettings({ ...live, skillModes: { [id]: 'shadow' } }), parseBrainSettings({ ...live, skillModes: { [id]: 'live' } })), null, id);
        }
    });
});

describe('tasks in the brain: switched on', () => {
    it('one action on brings its look-ups; the descriptions no longer send tasks away; clients and vendors get none', () => {
        const avail = skillsFor(actor(), on({ 'task.remind': 'shadow' }));
        assert.ok(tasksInBrain(avail));
        const tools = toolDefs(avail);
        for (const n of ['tasks_people', 'tasks_given', 'task_remind']) assert.ok(names(tools).includes(n), n);
        for (const n of ['task_create', 'task_complete', 'task_hand_over']) assert.ok(!names(tools).includes(n), n);
        assert.match(tools.find(t => t.name === 'handoff')!.description, /only for task requests none of your task tools does/);
        assert.match(tools.find(t => t.name === 'tasks_mine')!.description, /before task_complete or task_hand_over/);
        const client = skillsFor(actor({ ownRecordsOnly: true, recordRule: 'raised_by_me', roles: ['tenant'] }), on());
        const vendor = skillsFor(actor({ ownRecordsOnly: true, recordRule: 'assigned_to_me', roles: ['vendor'] }), on());
        for (const a of [client, vendor]) assert.ok(!a.some(s => s.skill.module === 'tasks'), 'no task skill for a client or vendor');
    });

    it('"done 2": the task numbered 2 is shown on a card, and only Yes marks it done, once', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('tasks_mine', {}), call('task_complete', { tasks: ['K2'], remark: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('done 2', { settings: on() }));
        assert.equal(first.outcome, 'propose');
        assert.match(first.reply!.text, /Mark 1 task as done\?\n• 2\. Check the DG set/);
        assert.equal(data.taskCalls.length, 0, 'nothing changed before Yes');
        const audit = new FakeAudit();
        const second = await yes(data, first.state, on(), audit);
        assert.equal(second.outcome, 'executed');
        assert.deepEqual(data.taskCalls, [{ op: 'complete', input: { userId: USER, taskIds: [TASK_2], remark: null } }]);
        assert.match(second.reply!.text, /Marked 1 task as done/);
        const again = await yes(data, first.state, on(), audit);   // a double tap or a repeated delivery
        assert.notEqual(again.outcome, 'executed');
        assert.equal(data.taskCalls.length, 1, 'the same Yes runs once');
    });

    it('in test mode the card is shown and Yes changes nothing', async () => {
        const data = new FakeBrainData();
        const settings = on({ 'task.complete': 'shadow' });
        const model = new ScriptedModel([call('tasks_mine', {}), call('task_complete', { tasks: ['K1'], remark: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('painting task is done', { settings }));
        assert.equal(first.outcome, 'propose');
        const second = await yes(data, first.state, settings);
        assert.equal(second.outcome, 'not_executed');
        assert.match(second.reply!.text, /Test mode/);
        assert.equal(data.taskCalls.length, 0);
    });

    it('add a task for a colleague: the title must be the person\'s words, the colleague a handle from tasks_people', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('tasks_people', { name: 'Ravi' }),
            call('task_create', { titles: ['Call the lift company about the noise'], assignee: 'P1', date: null, note: null }),   // invented words
            call('task_create', { titles: ['call the AC vendor'], assignee: 'P1', date: '2026-11-05', note: 'before 5 pm' }),
        ]);
        const first = await runTurn(turnDeps(data, model), turnInput('add a task for Ravi to call the AC vendor tomorrow, before 5 pm', { settings: on() }));
        assert.equal(first.outcome, 'propose');
        assert.match(model.toolResults().join('\n'), /not in the person's own words/);
        assert.match(first.reply!.text, /👤 For: Ravi Kumar\n🗓️ Thu 5 Nov\n• call the AC vendor\n📝 Note: before 5 pm/);
        const second = await yes(data, first.state);
        assert.equal(second.outcome, 'executed');
        assert.deepEqual(data.taskCalls, [{ op: 'create', input: { userId: USER, assigneeId: OTHER_USER, titles: ['call the AC vendor'], date: '2026-11-05', note: 'before 5 pm' } }]);
        assert.match(second.reply!.text, /Added 1 task \(Thu 5 Nov\) for Ravi Kumar/);
    });

    it('a made-up person handle, a user id, a past date or too far ahead is refused before any card', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('task_create', { titles: ['fix the tap'], assignee: 'P7', date: null, note: null }),
            call('task_create', { titles: ['fix the tap'], assignee: OTHER_USER, date: null, note: null }),
            call('task_create', { titles: ['fix the tap'], assignee: null, date: '2026-11-01', note: null }),
            call('task_create', { titles: ['fix the tap'], assignee: null, date: '2027-03-01', note: null }),
            'I could not add it.',
        ]);
        const out = await runTurn(turnDeps(data, model), turnInput('add a task to fix the tap', { settings: on(), }));
        const results = model.toolResults().join('\n');
        assert.match(results, /P7 is not a person handle/);
        assert.match(results, /is not a person handle/);
        assert.match(results, /in the past/);
        assert.match(results, /up to 60 days ahead/);
        assert.notEqual(out.outcome, 'propose');
        assert.equal(data.taskCalls.length, 0);
    });

    it('hand over: own task to a colleague, who the Task Manager may still refuse (its reason is said plainly)', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('tasks_mine', {}), call('tasks_people', { name: 'Asha' }), call('task_hand_over', { task: 'K1', to: 'P1', note: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('give task 1 to Asha', { settings: on() }));
        assert.match(first.reply!.text, /Give this task to Asha Rao\?\n• 1\. Paint the lobby wall/);
        data.refuseTask.set(TASK_1, 'Asha is on leave today');
        const second = await yes(data, first.state);
        assert.equal(second.outcome, 'not_executed');
        assert.match(second.reply!.text, /not given to Asha Rao: Asha is on leave today/);
    });

    it('remind: only about tasks the person gave (tasks_given), never their own', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('tasks_mine', {}), call('task_remind', { tasks: ['K1'] }),           // their own task: refused
            call('tasks_given', {}), call('task_remind', { tasks: ['K3'] }),
        ]);
        const first = await runTurn(turnDeps(data, model), turnInput('remind Ravi about the DG report', { settings: on() }));
        assert.match(model.toolResults().join('\n'), /K1 is not a task this person gave to someone/);
        assert.match(first.reply!.text, /Send a reminder about 1 task\?\n• Send the monthly DG report/);
        const second = await yes(data, first.state);
        assert.deepEqual(data.taskCalls, [{ op: 'remind', input: { userId: USER, taskIds: [GIVEN_1] } }]);
        assert.match(second.reply!.text, /Reminder sent to Ravi Kumar \(1\)/);
    });

    it('complete refuses a task the person gave to someone else; several tasks report each failure', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('tasks_given', {}), call('task_complete', { tasks: ['K1'], remark: null }), call('tasks_mine', {}), call('task_complete', { tasks: ['K2', 'K3'], remark: 'replaced the filter' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('done 1 and 2, replaced the filter', { settings: on() }));
        assert.match(model.toolResults().join('\n'), /not one of the person's own task handles/);
        assert.match(first.reply!.text, /Mark 2 tasks as done\?[\s\S]*📝 Note: replaced the filter/);
        data.refuseTask.set(TASK_2, 'A completion remark is required');
        const second = await yes(data, first.state);
        assert.equal(second.outcome, 'executed');
        assert.match(second.reply!.text, /Marked 1 task as done\.\n• 1\. Paint the lobby wall\n⚠️ Not done: 2\. Check the DG set \(A completion remark is required\)/);
    });

    it('things the brain still cannot do with tasks go to the task assistant', async () => {
        const model = new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'team progress' })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('how is my team doing', { settings: on() }));
        assert.equal(out.handoffTo, 'tasks_assistant');
    });
});

describe('tasks in the brain: on WhatsApp, the task assistant\'s open question stays with it', () => {
    const PHONE = '919876543210';
    const msg = (text: string): BrainInbound => ({ phone: PHONE, text, messageId: `wamid.${Math.random()}` });
    function world(settings = on(), waiting = false) {
        const asked: string[] = [];
        const deps: BrainWhatsAppDeps = {
            env: {}, anyOrgOn: async () => true, findUser: async () => ({ id: USER }), orgsForUser: async () => [ORG],
            loadActor: async () => actor(), loadSettings: async () => ({ settings, aliases: {} }), importBusy: async () => false,
            captionMentionsTasks: () => false, loadThread: async () => null, saveThread: async () => undefined, listOpenFiles: async () => [],
            stage: async () => ({ ok: false, reason: 'download_failed' }),
            turnDeps: () => turnDeps(new FakeBrainData(), new ScriptedModel(['You have 2 tasks today.']), new FakeAudit()),
            record: async () => undefined, sendReply: async () => true,
            taskBotWaiting: async phone => { asked.push(phone); return waiting; },
        };
        return { deps, asked };
    }

    it('while it waits for this person\'s answer, the brain does not take the message', async () => {
        const { deps } = world(on(), true);
        assert.deepEqual(await claimBrain(deps, msg('the painting one')), { handled: false, why: 'task_bot_waiting' });
    });

    it('when it is not waiting, the brain answers', async () => {
        const { deps } = world(on(), false);
        assert.equal((await claimBrain(deps, msg('what are my tasks'))).handled, true);
    });

    it('with every task action off, the check is not even made (exactly as before)', async () => {
        const { deps, asked } = world(brainSettings(), true);
        assert.equal((await claimBrain(deps, msg('what are my tickets'))).handled, true);
        assert.deepEqual(asked, []);
    });

    it('if the check fails, the task assistant answers', async () => {
        const { deps } = world(on(), false);
        deps.taskBotWaiting = async () => { throw new Error('db down'); };
        assert.deepEqual(await claimBrain(deps, msg('done 2')), { handled: false, why: 'task_bot_waiting' });
    });
});
