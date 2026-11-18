import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brainHandled, runTurn } from '../../backend/lib/aiLayer/brain/loop/turn';
import type { Block } from '../../backend/lib/aiLayer/brain/types';
import {
    ANDHERI, FILE_1, FakeAudit, FakeBrainData, NOW, OTHER_USER, PAREL, ROOM_A, ScriptedModel, USER, actor, brainSettings, photo, ticket, turnDeps, turnInput, call,
} from './brain-helpers';

const decisions = (audit: FakeAudit) => audit.rows.map(r => r.decision);

describe('reading before answering', () => {
    it('"my AC complaint" is looked up first, then answered from what was found', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'all', priority: null, property: null, raised_by_me: true }), 'Your ticket TKT-101 (AC not cooling in cabin 4) is still open, priority high.']);
        const out = await runTurn(turnDeps(data, model), turnInput('what happened to my AC complaint?'));
        assert.equal(out.outcome, 'answer');
        assert.match(out.reply!.text, /TKT-101/);
        assert.equal(out.trace.grounded, true);
        assert.deepEqual(out.trace.toolCalls.map(c => [c.skillId, c.kind, c.ok]), [['tickets.list', 'read', true]]);
        assert.equal(data.queries[0].recordRule, 'raised_by_me'); // staff asking about THEIR ticket narrows to their own
        assert.equal(out.state.handles.T1.id, 'TKT-101');
        assert.equal(model.calls.length, 2);
        assert.ok(brainHandled(out));
    });

    it('a number the tools never returned is not sent: the answer code built is sent instead', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: false }), 'You have 57 open tickets, including TKT-999.']);
        const out = await runTurn(turnDeps(data, model), turnInput('show open tickets'));
        assert.equal(out.trace.grounded, false);
        assert.doesNotMatch(out.reply!.text, /57|TKT-999/);
        assert.match(out.reply!.text, /TKT-101/);
    });

    it('a failing lookup comes back to the model as text; the turn still ends with a reply', async () => {
        const data = new FakeBrainData(); data.failReads = true;
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: false }), "I couldn't check your tickets just now. Please try again shortly."]);
        const out = await runTurn(turnDeps(data, model), turnInput('show open tickets'));
        assert.equal(out.outcome, 'answer');
        assert.match(model.toolResults()[0], /lookup failed/);
        assert.equal(out.trace.toolCalls[0].ok, false);
    });

    it('lookups are capped: past the cap the model is told to answer', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const read = call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: false });
        const model = new ScriptedModel([read, read, read, 'Here is TKT-101.']);
        const out = await runTurn(turnDeps(data, model), turnInput('show open tickets', { settings: brainSettings({ limits: { perUserPerHour: 30, actionsPerUserPerDay: 50, maxToolCalls: 2, maxQuestionsInRow: 2 } }) }));
        assert.equal(out.trace.toolCalls.filter(c => c.ok).length, 2);
        assert.match(model.toolResults().at(-1)!, /used all your lookups/);
        assert.equal(out.outcome, 'answer');
    });

    it('a made-up ticket reference finds nothing and leaks nothing', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket({ raisedBy: OTHER_USER })];
        const model = new ScriptedModel([call('ticket_status', { ticket: 'T9' }), "I couldn't find that ticket."]);
        const out = await runTurn(turnDeps(data, model), turnInput('status of that ticket', { actor: actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' }) }));
        assert.match(model.toolResults()[0], /No ticket "T9" is visible/);
        assert.doesNotMatch(model.toolResults()[0], /AC not cooling/);
        assert.equal(out.outcome, 'answer');
    });
});

describe('writes are proposed, confirmed, then run once', () => {
    const create = call('ticket_create', { description: 'AC leaking', description_source: 'person', location: 'cabin 4', property: null, urgent: false, attachment: null });

    it('propose shows a card built by code and changes nothing; Yes runs it without a model call', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const model = new ScriptedModel([create]);
        const first = await runTurn(turnDeps(data, model, audit), turnInput('AC leaking in cabin 4'));
        assert.equal(first.outcome, 'propose');
        assert.equal(first.reply!.awaitingConfirm, true);
        assert.match(first.reply!.text, /Work Square Andheri, cabin 4[\s\S]*AC leaking/);
        assert.equal(data.created.length, 0);
        assert.equal(first.state.pending?.kind, 'confirm');

        const second = await runTurn(turnDeps(data, model, audit), turnInput('yes', { state: first.state }));
        assert.equal(second.outcome, 'executed');
        assert.equal(model.calls.length, 1); // the Yes cost no model call
        assert.equal(data.created.length, 1);
        assert.equal(data.created[0].description, 'AC leaking (Location: cabin 4)');
        assert.match(second.reply!.text, /TKT-901/);
        assert.deepEqual(decisions(audit), ['confirm_shown', 'accepted', 'acted']);
        assert.equal(second.state.pending, null);
        assert.equal(data.episodes.length, 1);
    });

    it('the same Yes delivered twice creates one ticket', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create]), audit), turnInput('AC leaking in cabin 4'));
        await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('yes', { state: first.state }));
        const again = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('Yes', { state: first.state }));
        assert.equal(data.created.length, 1);
        assert.equal(again.outcome, 'not_executed');
        assert.equal(again.trace.reason, 'already_done');
    });

    it('No cancels; nothing is created', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create]), audit), turnInput('AC leaking in cabin 4'));
        const second = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('cancel', { state: first.state }));
        assert.equal(second.outcome, 'cancelled');
        assert.equal(data.created.length, 0);
        assert.equal(second.state.pending, null);
    });

    it('access is checked again at Yes: a building removed in between cancels the proposal', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create]), audit), turnInput('AC leaking in cabin 4'));
        const second = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('yes', { state: first.state, actor: actor({ propertyIds: [PAREL] }) }));
        assert.equal(second.outcome, 'not_executed');
        assert.equal(second.trace.reason, 'access_changed');
        assert.equal(data.created.length, 0);
    });

    it('a skill switched off between the card and the Yes does not run', async () => {
        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create])), turnInput('AC leaking in cabin 4'));
        const off = brainSettings({ skillModes: { 'ticket.create': 'off' } });
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, settings: off }));
        assert.equal(second.trace.reason, 'access_changed');
        assert.equal(data.created.length, 0);
    });

    it('a write skill in shadow (the default) shows the card but creates nothing on Yes', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const shadow = brainSettings({ skillModes: {} });
        const first = await runTurn(turnDeps(data, new ScriptedModel([create]), audit), turnInput('AC leaking in cabin 4', { settings: shadow }));
        const second = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('yes', { state: first.state, settings: shadow }));
        assert.equal(second.outcome, 'not_executed');
        assert.match(second.reply!.text, /Test mode/);
        assert.equal(data.created.length, 0);
        assert.ok(decisions(audit).includes('shadow'));
    });

    it('a tampered proposal in the stored thread is refused', async () => {
        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create])), turnInput('AC leaking in cabin 4'));
        const state = { ...first.state, pending: { ...first.state.pending!, payload: { propertyId: 'not-a-uuid', description: 'x' } } };
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state }));
        assert.equal(second.trace.reason, 'bad_proposal');
        assert.equal(data.created.length, 0);
    });

    it('the description must be the person\'s words: an "improved" one is sent back, and the model asks', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('ticket_create', { description: 'Compressor failure in the HVAC unit', description_source: 'person', location: null, property: null, urgent: false, attachment: null }),
            call('ask_user', { question: 'What is the problem? Please describe it in a line.', options: [] }),
        ]);
        const out = await runTurn(turnDeps(data, model), turnInput('raise a ticket please'));
        assert.match(model.toolResults()[0], /person's own words|MISSING description/);
        assert.equal(out.outcome, 'ask');
        assert.equal(out.state.pending?.kind, 'ask');
    });

    it('a correction instead of Yes goes back to the model with the proposal in view, and replaces it', async () => {
        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel([create])), turnInput('AC leaking in cabin 4'));
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: 'cabin 7', property: null, urgent: false, attachment: null })]);
        const second = await runTurn(turnDeps(data, model), turnInput('no wait, it is cabin 7', { state: first.state }));
        assert.match(model.lastUserText(), /confirmation card \(ticket_create\) is waiting/);
        assert.equal(second.outcome, 'propose');
        assert.match(second.reply!.text, /cabin 7/);
        assert.notEqual((second.state.pending as { opId: string }).opId, (first.state.pending as { opId: string }).opId);
    });
});

describe('roles', () => {
    const tenant = actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' });
    const vendor = actor({ roles: ['vendor'], ownRecordsOnly: true, recordRule: 'assigned_to_me' });
    const names = (m: ScriptedModel) => m.calls[0].tools.map(t => t.name);

    it('staff get every module; a client gets tickets, rooms and memory only; a vendor only reads tickets', async () => {
        const staff = new ScriptedModel(['Hello.']); await runTurn(turnDeps(new FakeBrainData(), staff), turnInput('hello there'));
        assert.ok(['tickets_list', 'ticket_create', 'room_book', 'electricity_consumption', 'tasks_mine', 'knowledge_ask', 'memory_remember', 'ask_user', 'handoff'].every(n => names(staff).includes(n)));

        const client = new ScriptedModel(['Hello.']); await runTurn(turnDeps(new FakeBrainData(), client), turnInput('hello there', { actor: tenant }));
        assert.ok(['tickets_list', 'ticket_create', 'room_book', 'memory_show'].every(n => names(client).includes(n)));
        assert.ok(!names(client).some(n => /^electricity|^tasks|^task_|^knowledge/.test(n)));

        const v = new ScriptedModel(['Hello.']); await runTurn(turnDeps(new FakeBrainData(), v), turnInput('hello there', { actor: vendor }));
        assert.ok(names(v).includes('tickets_list') && names(v).includes('ticket_status'));
        assert.ok(!names(v).some(n => ['ticket_create', 'ticket_add_photo', 'room_book', 'rooms_availability', 'electricity_consumption', 'tasks_mine', 'knowledge_ask'].includes(n)));
    });

    it('a client only ever sees tickets they raised, whatever the model passes', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket(), ticket({ number: 'TKT-202', title: 'Someone else\'s leak', raisedBy: OTHER_USER })];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'all', priority: null, property: null, raised_by_me: false }), 'You have TKT-101.']);
        await runTurn(turnDeps(data, model), turnInput('show all tickets', { actor: tenant }));
        assert.equal(data.queries[0].recordRule, 'raised_by_me');
        assert.match(model.toolResults()[0], /TKT-101/);
        assert.doesNotMatch(model.toolResults()[0], /TKT-202|Someone else/);
    });

    it('a tool the person does not have is answered like a tool that does not exist', async () => {
        const model = new ScriptedModel([call('electricity_consumption', { period: 'this_month', property: null }), "I can't help with electricity here."]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('how many units this month', { actor: tenant }));
        assert.match(model.toolResults()[0], /is not available/);
        assert.equal(out.trace.toolCalls[0].ok, false);
    });

    it('the org grid can only narrow: tickets set to questions removes the write tools', async () => {
        const model = new ScriptedModel(['Hello.']);
        await runTurn(turnDeps(new FakeBrainData(), model), turnInput('hello there', { settings: brainSettings({ grid: { property_admin: { tickets: 'questions', rooms: 'off' } } }) }));
        assert.ok(names(model).includes('tickets_list'));
        assert.ok(!names(model).some(n => ['ticket_create', 'ticket_add_photo', 'room_book', 'rooms_availability'].includes(n)));
    });

    it('a building outside the person\'s access cannot be named into scope', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket({ propertyId: PAREL, number: 'TKT-300' })];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'all', priority: null, property: 'Lower Parel', raised_by_me: false }), 'You only have access to Work Square Andheri.']);
        await runTurn(turnDeps(data, model), turnInput('tickets at lower parel'));
        assert.match(model.toolResults()[0], /not a property this person has access to/);
        assert.equal(data.queries.length, 0);
    });
});

describe('how a turn ends', () => {
    it('HR matters never reach the model and are not kept as text', async () => {
        const model = new ScriptedModel([]); const audit = new FakeAudit();
        const out = await runTurn(turnDeps(new FakeBrainData(), model, audit), turnInput('I want to file a grievance about harassment by my manager'));
        assert.equal(model.calls.length, 0);
        assert.equal(out.outcome, 'refuse');
        assert.match(out.reply!.text, /HR/);
        assert.ok(!JSON.stringify(out.state).includes('harassment'));
        assert.equal(audit.rows[0].actor_user_id, null); // the audit row cannot be traced to the person
    });

    it('"yes" or "2" with nothing of ours waiting is not ours: no model call, thread untouched', async () => {
        const model = new ScriptedModel([]);
        for (const word of ['yes', '2', 'ok']) {
            const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput(word));
            assert.equal(out.outcome, 'unsupported');
            assert.equal(out.reply, null);
            assert.equal(brainHandled(out), false);
        }
        assert.equal(model.calls.length, 0);
    });

    it('a question with options; the number picked is passed on as the option itself', async () => {
        const two = actor({ propertyIds: [ANDHERI, PAREL] });
        const m1 = new ScriptedModel([call('ask_user', { question: 'Which property?', options: ['Work Square Andheri', 'VFS Lower Parel'] })]);
        const first = await runTurn(turnDeps(new FakeBrainData(), m1), turnInput('book a room tomorrow at 3', { actor: two }));
        assert.equal(first.outcome, 'ask');
        assert.match(first.reply!.text, /1\) Work Square Andheri\n2\) VFS Lower Parel/);
        const m2 = new ScriptedModel(['Okay.']);
        await runTurn(turnDeps(new FakeBrainData(), m2), turnInput('2', { actor: two, state: first.state }));
        assert.match(m2.lastUserText(), /<message>\nVFS Lower Parel\n<\/message>/);
        assert.match(m2.lastUserText(), /you asked: "Which property\?"/);
    });

    it('questions in a row are capped: then the conversation is handed to a person', async () => {
        const ask = call('ask_user', { question: 'Can you say more?', options: [] });
        let state: unknown = null; let out;
        for (const text of ['hmm help me', 'the thing', 'you know, that one']) {
            out = await runTurn(turnDeps(new FakeBrainData(), new ScriptedModel([ask])), turnInput(text, { state }));
            state = out.state;
        }
        assert.equal(out!.outcome, 'handoff');
        assert.equal(out!.handoffTo, 'human');
    });

    it('a question that names choices no tool returned is not sent', async () => {
        const model = new ScriptedModel([call('ask_user', { question: 'Which room?', options: ['Sky Lounge 9', 'Room 4711'] })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('book me a room'));
        assert.equal(out.trace.grounded, false);
        assert.doesNotMatch(out.reply!.text, /4711/);
    });

    it('tasks go to the Task Manager\'s own assistant', async () => {
        const out = await runTurn(turnDeps(new FakeBrainData(), new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'wants to mark a task done' })])), turnInput('mark the DG set task done'));
        assert.equal(out.outcome, 'handoff');
        assert.equal(out.handoffTo, 'tasks_assistant');
        assert.equal(brainHandled(out), false);
    });

    it('the main model failing moves to the backup; every model failing keeps the thread as it was', async () => {
        const ok = await runTurn(turnDeps(new FakeBrainData(), new ScriptedModel([new Error('Claude could not answer (key 1: out of credit)'), 'Hello!'])), turnInput('hello there'));
        assert.equal(ok.outcome, 'answer');
        assert.deepEqual(ok.trace.hops.map(h => h.model), ['anthropic:test-main']);
        assert.equal(ok.trace.modelCalls[0].model, 'anthropic:test-backup');

        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: null, property: null, urgent: false, attachment: null })])), turnInput('AC leaking badly'));
        const down = await runTurn(turnDeps(data, new ScriptedModel([new Error('down'), new Error('down')])), turnInput('also check the lift please', { state: first.state }));
        assert.equal(down.outcome, 'error');
        assert.equal(brainHandled(down), false);
        assert.equal(down.state.pending?.kind, 'confirm'); // the open proposal is not lost
    });

    it('the per-hour limit stops the turn before any model call', async () => {
        const model = new ScriptedModel([]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model, new FakeAudit(), { allowMessage: () => false }), turnInput('show my tickets'));
        assert.equal(out.trace.reason, 'rate_limited');
        assert.equal(model.calls.length, 0);
    });

    it('nothing switched on for the role: says so, no model call', async () => {
        const model = new ScriptedModel([]);
        const off = brainSettings({ grid: { property_admin: { tickets: 'off', rooms: 'off', tasks: 'off', electricity: 'off', knowledge: 'off', memory: 'off' } } });
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('show my tickets', { settings: off }));
        assert.equal(out.outcome, 'unsupported');
        assert.equal(model.calls.length, 0);
    });
});

describe('photos and files', () => {
    it('a photo alone is shown to the model once; a ticket written from it says so on the card and carries the photo', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('ticket_create', { description: 'Water leaking from the ceiling AC unit', description_source: 'photo', location: null, property: null, urgent: false, attachment: 'A1' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('', { attachments: [photo()], images: [{ handle: 'A1', mime: 'image/jpeg', base64: 'AAAA' }] }));
        const sent = model.calls[0].messages.at(-1)!.blocks;
        assert.equal(sent.filter((b: Block) => b.type === 'image').length, 1);
        assert.match(model.lastUserText(), /open_files: A1 photo[\s\S]*shown to you below/);
        assert.equal(first.outcome, 'propose');
        assert.match(first.reply!.text, /written from your photo/);
        assert.match(first.reply!.text, /1 photo attached/);

        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, attachments: [photo()] }));
        assert.equal(second.outcome, 'executed');
        assert.ok(data.created[0].photo);
        assert.deepEqual(data.used.map(u => u.id), [FILE_1]);
        assert.match(second.reply!.text, /photo is attached/);
    });

    it('a photo sent earlier is attached to the ticket described next: nobody re-sends it', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: 'cabin 4', property: null, urgent: false, attachment: 'A1' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('AC leaking in cabin 4', { attachments: [photo()] })); // no image this turn
        assert.equal(model.calls[0].messages.at(-1)!.blocks.filter((b: Block) => b.type === 'image').length, 0);
        assert.match(first.reply!.text, /1 photo attached/);
        await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('haan', { state: first.state, attachments: [photo()] }));
        assert.ok(data.created[0].photo);
    });

    it('a photo that expired before the Yes: the ticket is still raised and the person is told the photo was not attached', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: null, property: null, urgent: false, attachment: 'A1' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('AC leaking a lot', { attachments: [photo()] }));
        data.files.clear();
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state }));
        assert.equal(second.outcome, 'executed');
        assert.match(second.reply!.text, /expired/);
        assert.equal(data.used.length, 0);
    });

    it('a file handle that was never issued is refused', async () => {
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: null, property: null, urgent: false, attachment: 'A7' }), 'Please send the photo.']);
        await runTurn(turnDeps(new FakeBrainData(), model), turnInput('AC leaking, see photo'));
        assert.match(model.toolResults()[0], /A7 is not an open/);
    });

    it('a photo is added to an existing ticket of the person', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'all', priority: null, property: null, raised_by_me: true }), call('ticket_add_photo', { ticket: 'T1', attachment: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('here is the photo for my AC ticket', { attachments: [photo()] }));
        assert.equal(first.outcome, 'propose');
        assert.match(first.reply!.text, /TKT-101/);
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, attachments: [photo()] }));
        assert.equal(second.outcome, 'executed');
        assert.equal(data.ticketPhotos.length, 1);
    });

    it('a file is attached to one of the person\'s own tasks', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('tasks_mine', {}), call('task_add_file', { task: 'K1', attachment: 'A1' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('attach this to my painting task', { attachments: [photo()] }));
        assert.match(first.reply!.text, /task 1: "Paint the lobby wall"/);
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, attachments: [photo()] }));
        assert.equal(second.outcome, 'executed');
        assert.deepEqual(data.taskFiles, [{ userId: USER, taskId: first.state.handles.K1.id }]);
    });
});

describe('rooms', () => {
    const window = { property: null, date: '2026-11-05', start_time: '16:00', end_time: '17:00' };

    it('availability, then a booking card, then one booking on Yes', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('rooms_availability', window), call('room_book', { room: 'R1', property: null, date: '2026-11-05', start_time: '16:00', end_time: '17:00', purpose: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('book the board room tomorrow 4 to 5'));
        assert.equal(first.outcome, 'propose');
        assert.match(first.reply!.text, /Board Room, Work Square Andheri[\s\S]*16:00 to 17:00/);
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state }));
        assert.equal(second.outcome, 'executed');
        assert.deepEqual(data.booked.map(b => [b.roomId, b.date, b.startTime]), [[ROOM_A, '2026-11-05', '16:00']]);
    });

    it('a room that is taken is not proposed; the model is told what is free', async () => {
        const data = new FakeBrainData(); data.taken.add(ROOM_A);
        const model = new ScriptedModel([call('room_book', { room: 'Board Room', property: null, date: '2026-11-05', start_time: '16:00', end_time: '17:00', purpose: null }), 'The Board Room is taken then. Huddle 2 is free.']);
        const out = await runTurn(turnDeps(data, model), turnInput('book the board room tomorrow 4 to 5'));
        assert.match(model.toolResults()[0], /NOT free[\s\S]*Huddle 2/);
        assert.equal(out.outcome, 'answer');
    });

    it('the slot being taken between the card and the Yes is reported honestly', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('room_book', { room: 'Board Room', property: null, date: '2026-11-05', start_time: '16:00', end_time: '17:00', purpose: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('book the board room tomorrow 4 to 5'));
        data.failBooking = 'SLOT_UNAVAILABLE';
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state }));
        assert.equal(second.outcome, 'not_executed');
        assert.match(second.reply!.text, /just taken/);
    });

    it('a past date or a backwards window is refused before any lookup', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('rooms_availability', { ...window, date: '2026-11-01' }), 'That date has passed.']);
        await runTurn(turnDeps(data, model), turnInput('rooms on 1 nov'));
        assert.match(model.toolResults()[0], /in the past/);
    });
});

describe('memory', () => {
    it('a preference is remembered only after Yes, and only in the person\'s own words', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('memory_remember', { key: 'usual_location', value: '3rd floor cabin 304' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('remember that I sit on the 3rd floor cabin 304'));
        assert.equal(first.outcome, 'propose');
        assert.equal(data.memory.length, 0);
        await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state }));
        assert.deepEqual(data.memory.map(m => [m.key, m.value]), [['usual_location', '3rd floor cabin 304']]);
    });

    it('an unknown key, a phone number and an HR matter are refused before anything is written', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('memory_remember', { key: 'salary', value: '50000' }), call('memory_remember', { key: 'preferred_name', value: 'call 9876543210' }), 'I can only remember a few preferences.',
        ]);
        await runTurn(turnDeps(data, model), turnInput('remember my salary and call 9876543210'));
        assert.match(model.toolResults()[0], /not valid|not something that can be remembered/);
        assert.match(model.toolResults()[1], /never remembered/);
        assert.equal(data.memory.length, 0);
    });

    it('a remembered property fills the gap, so the question is not asked', async () => {
        const data = new FakeBrainData();
        data.memory = [{ key: 'default_property', value: PAREL, label: 'VFS Lower Parel', source: 'whatsapp', confirmedAt: NOW.toISOString(), lastUsedAt: null }];
        const model = new ScriptedModel([call('ticket_create', { description: 'lift not working', description_source: 'person', location: null, property: null, urgent: false, attachment: null })]);
        const out = await runTurn(turnDeps(data, model), turnInput('lift not working', { actor: actor({ propertyIds: [ANDHERI, PAREL] }) }));
        assert.equal(out.outcome, 'propose');
        assert.match(out.reply!.text, /VFS Lower Parel/);
    });

    it('memory being down never blocks a turn', async () => {
        const data = new FakeBrainData(); data.failMemory = true;
        const out = await runTurn(turnDeps(data, new ScriptedModel(['Hello!'])), turnInput('hello there'));
        assert.equal(out.outcome, 'answer');
    });

    it('with memory switched off the memory tools are not offered', async () => {
        const model = new ScriptedModel(['Hello.']);
        await runTurn(turnDeps(new FakeBrainData(), model), turnInput('hello there', { settings: brainSettings({ memory: { enabled: false, profileDays: 180, episodeDays: 90 } }) }));
        assert.ok(!model.calls[0].tools.some(t => t.name.startsWith('memory_')));
    });
});

describe('shadow (dry run)', () => {
    it('thinks and records, writes no audit row, and never runs a write even on Yes', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: null, property: null, urgent: false, attachment: null })]);
        const first = await runTurn(turnDeps(data, model, audit), turnInput('AC leaking badly', { dryRun: true }));
        assert.equal(first.outcome, 'propose');
        const second = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('yes', { state: first.state, dryRun: true }));
        assert.equal(second.outcome, 'not_executed');
        assert.equal(data.created.length, 0);
        assert.equal(audit.rows.length, 0);
    });
});

describe('the trace', () => {
    it('records every model call and tool call with tokens and cost', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_count', { period: 'this_month', status: 'all', property: null }), 'This month there is 1 ticket at Work Square Andheri.']);
        const out = await runTurn(turnDeps(data, model), turnInput('how many tickets this month'));
        assert.equal(out.trace.modelCalls.length, 2);
        assert.equal(out.trace.tokensIn, 2000);
        assert.ok(Math.abs((out.trace.costUsd ?? 0) - 0.002) < 1e-9);
        assert.equal(out.trace.toolCalls[0].skillId, 'tickets.count');
        assert.equal(out.trace.skillId, 'tickets.count');
    });
});

describe('a reply only claims what really happened (review 2026-11-14)', () => {
    it('the ticket is raised but its photo could not be stored: the reply says so and the photo stays open', async () => {
        const data = new FakeBrainData(); data.failPhoto = true;
        const model = new ScriptedModel([call('ticket_create', { description: 'AC leaking', description_source: 'person', location: null, property: null, urgent: false, attachment: 'A1' })]);
        const first = await runTurn(turnDeps(data, model), turnInput('AC leaking a lot', { attachments: [photo()] }));
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, attachments: [photo()] }));
        assert.equal(second.outcome, 'executed');
        assert.match(second.reply!.text, /TKT-901[\s\S]*could not be attached/);
        assert.doesNotMatch(second.reply!.text, /photo is attached/);
        assert.equal(data.used.length, 0);
    });

    it('a ticket that got a photo between the card and the Yes is not reported as "photo added"', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('ticket_add_photo', { ticket: 'TKT-101', attachment: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('add this photo to TKT-101', { attachments: [photo()] }));
        assert.equal(first.outcome, 'propose');
        data.tickets[0].hasPhoto = true; // someone added one in the app meanwhile
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, attachments: [photo()] }));
        assert.equal(second.outcome, 'not_executed');
        assert.match(second.reply!.text, /already has a photo/);
        assert.equal(data.ticketPhotos.length, 0);
        assert.equal(data.used.length, 0);
    });
});

describe('questions are not thrown away for a date or a made-up choice (test set 2026-11-14)', () => {
    it('a question that names tomorrow\'s date is asked as written', async () => {
        const model = new ScriptedModel([call('ask_user', { question: 'Sure, a room for tomorrow (Thursday 5 Nov). What time do you need it, and for how long?', options: [] })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('book a meeting room for tomorrow'));
        assert.equal(out.outcome, 'ask');
        assert.match(out.reply!.text, /Thursday 5 Nov/);
        assert.equal(out.trace.grounded, true);
    });

    it('choices the model made up are dropped and the question is still asked', async () => {
        const model = new ScriptedModel([call('ask_user', { question: 'What time tomorrow do you need the room?', options: ['10:00 to 11:00', '14:00 to 15:00', 'Another time'] })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('book a meeting room for tomorrow'));
        assert.equal(out.outcome, 'ask');
        assert.equal(out.reply!.text, 'What time tomorrow do you need the room?');
        assert.equal(out.reply!.options, undefined);
        assert.equal(out.trace.reason, 'choices_dropped');
        assert.equal(out.trace.grounded, false); // recorded, so the console flags the turn for a look
        assert.deepEqual((out.state.pending as { options: string[] }).options, []);
    });

    it('a question that itself contains an invented ticket is still replaced', async () => {
        const model = new ScriptedModel([call('ask_user', { question: 'Do you mean TKT-999, which is assigned to the vendor?', options: [] })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('what about my complaint'));
        assert.equal(out.outcome, 'answer');
        assert.equal(out.trace.reason, 'ungrounded_question');
        assert.doesNotMatch(out.reply!.text, /TKT-999/);
    });

    it('asking for a person gets a plain answer that nobody is being connected', async () => {
        const model = new ScriptedModel([call('handoff', { to: 'human', reason: 'asked for a person' })]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('this is useless, I want to talk to a person'));
        assert.equal(out.outcome, 'handoff'); assert.equal(out.handoffTo, 'human');
        assert.match(out.reply!.text, /can't connect you to a person here/);
    });
});
