// 2026-11-18: what is open in a conversation, built from the owner's failing WhatsApp chats (the LAN wire ticket that
// could not be cancelled and kept being offered, the "I'm not getting this right" on the first message, a reply of "0").
// No database, no model key, no network and no WhatsApp: every dependency below is a fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runTurn, type TurnOutput } from '../../backend/lib/aiLayer/brain/loop/turn';
import { isCancelPhrase, sameQuestion } from '../../backend/lib/aiLayer/brain/loop/intent';
import { EMPTY_THREAD, mergeThreads, openThread, waitingCard, type ThreadState } from '../../backend/lib/aiLayer/brain/memory/thread';
import { FILE_1, FakeAudit, FakeBrainData, NOW, ScriptedModel, call, photo, turnDeps, turnInput } from './brain-helpers';

const FILE_2 = 'eeee5555-5555-4555-8555-555555555556';
const lanTicket = (attachment: string | null = 'A1') => call('ticket_create', { description: 'My pc lan wire is broken', description_source: 'person', location: null, property: null, urgent: false, attachment });

/** One turn on top of the previous one, with the same fake world. */
async function turn(data: FakeBrainData, audit: FakeAudit, steps: ConstructorParameters<typeof ScriptedModel>[0], text: string, prev: TurnOutput | null, files = [photo()]) {
    const model = new ScriptedModel(steps);
    const out = await runTurn(turnDeps(data, model, audit), turnInput(text, { state: prev?.state ?? null, attachments: files.filter(f => !data.used.some(u => u.id === f.id)) }));
    return { out, model };
}

describe('a waiting card survives a side question', () => {
    it('the card stays open, the reminder is said once in code, and a later "cancel it" really cancels it', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await turn(data, audit, [lanTicket()], 'My pc lan wire is broken', null);
        assert.equal(card.out.outcome, 'propose');

        // The owner's chat: a room question while the card waits. Before: the card was silently dropped.
        const side = await turn(data, audit, ['There are no meeting rooms set up at Work Square Andheri.'], 'is the boardroom available for meeting?', card.out);
        assert.equal(side.out.outcome, 'answer');
        assert.match(side.out.reply!.text, /no meeting rooms/);
        assert.match(side.out.reply!.text, /still waiting/);
        assert.equal(side.out.state.pending?.kind, 'confirm', 'the card is still open');
        assert.match(side.model.lastUserText(), /confirmation card \(ticket_create\) is waiting/);

        const side2 = await turn(data, audit, ['The Board Room is not set up here.'], 'and the conference room?', side.out);
        assert.doesNotMatch(side2.out.reply!.text, /still waiting/, 'the reminder is never repeated');
        assert.equal(side2.out.state.pending?.kind, 'confirm');

        // "cancel it" is a cancel now (before: only the bare word "cancel" was).
        const cancel = await turn(data, audit, [], 'cancel it', side2.out);
        assert.equal(cancel.model.calls.length, 0, 'decided by code, no model call');
        assert.equal(cancel.out.outcome, 'cancelled');
        assert.match(cancel.out.reply!.text, /Cancelled\. Nothing was changed\./);
        assert.equal(cancel.out.state.pending, null);
        assert.equal(data.created.length, 0, 'no ticket raised');
        assert.ok(audit.rows.some(r => r.decision === 'cancelled'));
        assert.deepEqual(data.used.map(u => u.id), [FILE_1], 'the photo is set aside so it is not offered again');
        assert.match(cancel.out.state.closed[0].label, /lan wire/i);

        // The closed topic is in view for every later turn, and the photo is no longer an open file.
        const later = await turn(data, audit, ['Sure, what is the problem?'], 'I have another issue', cancel.out);
        assert.match(later.model.lastUserText(), /closed_by_person: "ticket: My pc lan wire is broken"\. Do not offer/);
        assert.match(later.model.lastUserText(), /open_files: none/);
    });

    it('after the reminder a bare Yes confirms; after a side answer with no reminder, the card is shown again first', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await turn(data, audit, [lanTicket()], 'My pc lan wire is broken', null);
        const side = await turn(data, audit, ['No rooms are set up here.'], 'any meeting room free?', card.out);
        const yes = await turn(data, audit, [], 'yes', side.out);
        assert.equal(yes.out.outcome, 'executed', 'the reminder was the last thing said, so Yes means the card');
        assert.equal(data.created.length, 1);

        const data2 = new FakeBrainData(); const audit2 = new FakeAudit();
        const c2 = await turn(data2, audit2, [lanTicket()], 'My pc lan wire is broken', null);
        const s1 = await turn(data2, audit2, ['No rooms are set up here.'], 'any meeting room free?', c2.out);
        const s2 = await turn(data2, audit2, ['The Board Room is not set up here.'], 'what about the board room', s1.out);
        const ambiguous = await turn(data2, audit2, [], 'yes', s2.out);
        assert.equal(ambiguous.out.outcome, 'propose', 'nothing runs on a guess');
        assert.match(ambiguous.out.reply!.text, /Just to be sure[\s\S]*lan wire/i);
        assert.equal(data2.created.length, 0);
        const sure = await turn(data2, audit2, [], 'yes', ambiguous.out);
        assert.equal(sure.out.outcome, 'executed');
        assert.equal(data2.created.length, 1);
    });

    it('a question about the card parks it; once the question is answered the card is back in front', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await turn(data, audit, [lanTicket()], 'My pc lan wire is broken', null);
        const ask = await turn(data, audit, [call('ask_user', { question: 'Which floor is your desk on?', options: [] })], 'can you add the floor?', card.out);
        assert.equal(ask.out.state.pending?.kind, 'ask');
        assert.equal(ask.out.state.parked?.skillId, 'ticket.create');
        assert.ok(waitingCard(ask.out.state));
        assert.match(ask.model.lastUserText(), /pending: a confirmation card/);
        const answer = await turn(data, audit, ['Noted.'], '4th floor', ask.out);
        assert.match(answer.model.lastUserText(), /waiting_card: a confirmation card \(ticket_create\)/);
        assert.equal(answer.out.state.pending?.kind, 'confirm');
        assert.equal(answer.out.state.parked, null);
    });
});

describe('cancelling in the person\'s own words', () => {
    it('short phrases are taken by code; a phrase naming something else is left to the model', () => {
        for (const t of ['cancel', 'cancel it', 'Cancel this', 'cancel the lan ticket', 'please cancel that', 'no, cancel it', 'drop it', 'forget it', 'leave it',
            "don't raise it", 'dont raise the ticket', 'i dont want it', 'rehne do', 'cancel kar do', 'nahi chahiye', 'रहने दो']) {
            assert.ok(isCancelPhrase(t, 'ticket.create'), t);
        }
        for (const t of ['cancel my booking', 'cancel the booking', 'no', 'yes', 'I dont want to raise the lan ticket i wanna cancel it because it is fixed now',
            'cancel the meeting room tomorrow', 'can you cancel', 'what is cancelled']) {
            assert.ok(!isCancelPhrase(t, 'ticket.create'), t);
        }
        assert.ok(isCancelPhrase('cancel the booking', 'room.book'));
    });

    it('a long sentence goes to the model, which closes the topic; code says it was cancelled and sets the photo aside', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await turn(data, audit, [lanTicket()], 'My pc lan wire is broken', null);
        const close = await turn(data, audit, [call('close_topic', { what: 'LAN wire ticket', files: [] }), ''], 'I dont want to raise the lan ticket i wanna cancel it', card.out);
        assert.equal(close.out.outcome, 'cancelled');
        assert.equal(close.out.reply!.text, 'Cancelled. Nothing was changed.');
        assert.equal(close.out.state.pending, null);
        assert.deepEqual(data.used.map(u => u.id), [FILE_1]);
        assert.deepEqual(close.out.state.closed.map(c => c.label), ['LAN wire ticket']);
        assert.ok(close.out.trace.toolCalls.some(t => t.skillId === 'close_topic'));
    });

    it('closing an offer (no card) sets the named photo aside, and anything else in the message is still answered', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const out = await turn(data, audit, [call('close_topic', { what: 'LAN wire ticket', files: ['A1'] }), 'Your tickets are all closed.'], 'no leave the lan thing. any open tickets?', null);
        assert.match(out.out.reply!.text, /^Okay, I have dropped that\. Nothing was raised or changed\.\n\nYour tickets are all closed\.$/);
        assert.deepEqual(data.used.map(u => u.id), [FILE_1]);
        assert.equal(out.out.state.closed[0].label, 'LAN wire ticket');
    });

    it('a shadow (test) run never sets a photo aside or writes the audit log', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const model = new ScriptedModel([call('close_topic', { what: 'LAN wire ticket', files: ['A1'] }), '']);
        const out = await runTurn(turnDeps(data, model, audit), turnInput('drop the lan ticket and the photo', { attachments: [photo()], dryRun: true }));
        assert.equal(out.reply!.text, 'Okay, I have dropped that. Nothing was raised or changed.');
        assert.equal(data.used.length, 0);
        assert.equal(audit.rows.length, 0);
    });
});

describe('cancelling the right thing', () => {
    it('dropping only a photo keeps the waiting card', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        data.files.set(FILE_2, { bytes: new Uint8Array([4]), mime: 'image/jpeg', fileName: 'photo2.jpg' });
        const files = [photo(), photo({ handle: 'A2', id: FILE_2 })];
        const card = await turn(data, audit, [lanTicket('A1')], 'My pc lan wire is broken', null, files);
        const out = await turn(data, audit, [call('close_topic', { what: 'the second photo', files: ['A2'], cancel_card: false }), ''], 'ignore the second photo', card.out, files);
        assert.equal(out.out.reply!.text, 'Okay, I have dropped that. Nothing was raised or changed.');
        assert.equal(out.out.state.pending?.kind, 'confirm', 'the card stays');
        assert.deepEqual(data.used.map(u => u.id), [FILE_2]);
        assert.ok(!audit.rows.some(r => r.decision === 'cancelled'));
    });

    it('"leave it" answering a question in front of a parked card goes to the model, not the card shortcut', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await turn(data, audit, [lanTicket()], 'My pc lan wire is broken', null);
        const ask = await turn(data, audit, [call('ask_user', { question: 'Add the floor number?', options: ['Add floor', 'Leave it'] })], 'can you add where my desk is?', card.out);
        const model = new ScriptedModel(['Okay, no floor added.']);
        const out = await runTurn(turnDeps(data, model, audit), turnInput('leave it', { state: ask.out.state, attachments: [photo()] }));
        assert.equal(model.calls.length, 1, 'the model read it');
        assert.equal(out.state.pending?.kind, 'confirm', 'the card is back in front, not cancelled');
    });
});

describe('questions in a row', () => {
    it('a streak left over from an earlier question does not end a NEW request at once', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const state: ThreadState = { ...EMPTY_THREAD, lastActiveAt: NOW.toISOString(), askStreak: 2, pending: { kind: 'ask', question: 'Is that the property you mean?', options: ['Work Square Andheri'], at: NOW.toISOString() } };
        const out = await runTurn(turnDeps(data, new ScriptedModel([call('ask_user', { question: 'Which date and time do you need the room?', options: [] })]), audit), turnInput('Can i book a meeting room?', { state }));
        assert.equal(out.outcome, 'ask', 'before: "I\'m not getting this right" on the first message');
        assert.equal(out.state.askStreak, 1);
    });

    it('asking the SAME thing again still ends with the hand-off after the limit', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const q = call('ask_user', { question: 'Which date and time do you need the room?', options: [] });
        let prev: TurnOutput | null = null;
        const outcomes: string[] = [];
        for (const text of ['book a room', 'hmm', 'not sure']) {
            const { out } = await turn(data, audit, [q], text, prev, []);
            outcomes.push(out.outcome); prev = out;
        }
        assert.deepEqual(outcomes, ['ask', 'ask', 'handoff']);
        assert.ok(sameQuestion('Which date and time do you need the room?', 'Which date and time do you need the meeting room?'));
        assert.ok(!sameQuestion('Which property?', 'What time should it start?'));
    });
});

describe('numbers outside the list', () => {
    it('"0" (or 5 for two choices) gets "pick 1 to N", keeps the question, and calls no model', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const state: ThreadState = { ...EMPTY_THREAD, lastActiveAt: NOW.toISOString(), askStreak: 1, pending: { kind: 'ask', question: 'Raise it?', options: ['Yes, raise it', 'No, leave it'], at: NOW.toISOString() } };
        const model = new ScriptedModel([]);
        const out = await runTurn(turnDeps(data, model, audit), turnInput('0', { state }));
        assert.equal(model.calls.length, 0);
        assert.equal(out.reply!.text, 'Please reply with a number from 1 to 2.');
        assert.equal(out.state.pending?.kind, 'ask');
        const one: ThreadState = { ...state, pending: { kind: 'ask', question: 'Is that the property you mean?', options: ['A Mafatlal Chambers'], at: NOW.toISOString() } };
        const out1 = await runTurn(turnDeps(data, model, audit), turnInput('0', { state: one }));
        assert.equal(out1.reply!.text, 'Please reply with 1.');
    });
});

describe('a new photo on the same card', () => {
    it('the card says plainly that the new photo replaces the earlier one', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        data.files.set(FILE_2, { bytes: new Uint8Array([4]), mime: 'image/jpeg', fileName: 'photo2.jpg' });
        const files = [photo(), photo({ handle: 'A2', id: FILE_2 })];
        const first = await turn(data, audit, [lanTicket('A1')], 'My pc lan wire is broken', null, files);
        assert.doesNotMatch(first.out.reply!.text, /replaces/);
        const second = await turn(data, audit, [lanTicket('A2')], 'use this photo instead', first.out, files);
        assert.match(second.out.reply!.text, /^📷 Using your new photo \(it replaces the earlier one\)\./);
    });
});

describe('two turns saving at once', () => {
    it('nothing is lost: both exchanges are kept, and the open card made by the other turn stays', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const base = await turn(data, audit, ['Hello! How can I help?'], 'hi', null, []);
        const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
        // Two messages arrive together and both turns start from the same saved state.
        const a = await runTurn(turnDeps(data, new ScriptedModel([lanTicket(null)]), audit, { now: () => at(1) }), turnInput('my lan wire is broken', { state: base.out.state }));
        const b = await runTurn(turnDeps(data, new ScriptedModel(['You have no open tickets.']), audit, { now: () => at(1.01) }), turnInput('any open tickets?', { state: base.out.state }));
        // a saved first; b's save finds the thread changed and merges instead of overwriting.
        const merged = mergeThreads(a.state, base.out.state, b.state, b.state.lastActiveAt!);
        const texts = merged.history.map(h => h.text);
        assert.ok(texts.includes('my lan wire is broken'));
        assert.ok(texts.includes('any open tickets?'));
        assert.ok(texts.includes('You have no open tickets.'));
        assert.equal(merged.pending?.kind, 'confirm', "a's card is not wiped by b, which changed nothing that was open");
        assert.equal(openThread(merged, at(2)).pending?.kind, 'confirm');
    });
});
