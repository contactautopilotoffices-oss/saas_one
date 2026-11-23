// 2026-11-18: understanding a swipe-reply (WhatsApp "reply to this message"). Before, the brain ignored which message
// was quoted, so "cancel this" or "yes" on an older message was read as if it stood alone.
// No database, no model key, no network and no WhatsApp: every dependency below is a fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runTurn, type TurnOutput } from '../../backend/lib/aiLayer/brain/loop/turn';
import { EMPTY_THREAD, findQuoted, withSentIds, type ThreadState } from '../../backend/lib/aiLayer/brain/memory/thread';
import { FakeAudit, FakeBrainData, NOW, ScriptedModel, call, photo, turnDeps, turnInput } from './brain-helpers';

const lanTicket = call('ticket_create', { description: 'My pc lan wire is broken', description_source: 'person', location: null, property: null, urgent: false, attachment: null });

/** The thread after the brain's reply went out with WhatsApp id `id` (what the channel does after sending). */
const sentAs = (out: TurnOutput, id: string): ThreadState => withSentIds(out.state, out.state.lastActiveAt!, [id]) ?? out.state;

describe('what was swiped on', () => {
    it('the quoted message is shown to the model, and the person\'s own message ids are kept', async () => {
        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel(['Yes, the Board Room is free then.'])), turnInput('is the board room free at 4?', { messageIds: ['in.1'] }));
        assert.deepEqual(first.state.history[0].ids, ['in.1']);
        const state = sentAs(first, 'out.1');
        assert.deepEqual(findQuoted(state, ['out.1'])?.text, 'Yes, the Board Room is free then.');
        const model = new ScriptedModel(['Which time should I book it for?']);
        await runTurn(turnDeps(data, model), turnInput('book this', { state, quotedIds: ['out.1'] }));
        assert.match(model.lastUserText(), /replying_to: the person swiped to reply to your message from 06:30 UTC: "Yes, the Board Room is free then\."/);
    });

    it('a quoted message that is no longer kept is said so, and the model is told not to guess', async () => {
        const model = new ScriptedModel(['Which message do you mean?']);
        await runTurn(turnDeps(new FakeBrainData(), model), turnInput('what about this', { quotedIds: ['very.old'] }));
        assert.match(model.lastUserText(), /replying_to: the person swiped to reply to an older message that is no longer in view[\s\S]*do not guess/);
    });

    it('a short "ok" swiped on a message of ours is not passed to the other bots as "not ours"', async () => {
        const data = new FakeBrainData();
        const first = await runTurn(turnDeps(data, new ScriptedModel(['Your AC ticket is assigned to Suresh.'])), turnInput('status of my ac ticket'));
        const model = new ScriptedModel(['Okay.']);
        const out = await runTurn(turnDeps(data, model), turnInput('ok', { state: sentAs(first, 'out.9'), quotedIds: ['out.9'] }));
        assert.notEqual(out.outcome, 'unsupported');
        assert.equal(model.calls.length, 1);
    });
});

describe('a swipe on a confirmation card', () => {
    it('"yes" swiped on the card confirms it, even while a question sits in front of it', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await runTurn(turnDeps(data, new ScriptedModel([lanTicket]), audit), turnInput('My pc lan wire is broken'));
        const cardState = sentAs(card, 'card.1');
        const ask = await runTurn(turnDeps(data, new ScriptedModel([call('ask_user', { question: 'Which floor?', options: [] })]), audit), turnInput('add my floor', { state: cardState }));
        assert.equal(ask.state.parked?.skillId, 'ticket.create');
        const model = new ScriptedModel([]);
        const yes = await runTurn(turnDeps(data, model, audit), turnInput('yes', { state: ask.state, quotedIds: ['card.1'] }));
        assert.equal(model.calls.length, 0);
        assert.equal(yes.outcome, 'executed');
        assert.equal(data.created.length, 1);
    });

    it('"cancel" swiped on the card cancels THAT card', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await runTurn(turnDeps(data, new ScriptedModel([lanTicket]), audit), turnInput('My pc lan wire is broken', { attachments: [photo()] }));
        const out = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('cancel', { state: sentAs(card, 'card.1'), quotedIds: ['card.1'] }));
        assert.equal(out.outcome, 'cancelled');
        assert.equal(data.created.length, 0);
    });

    it('"yes" swiped on a card that is already done or cancelled runs nothing', async () => {
        const data = new FakeBrainData(); const audit = new FakeAudit();
        const card = await runTurn(turnDeps(data, new ScriptedModel([lanTicket]), audit), turnInput('My pc lan wire is broken'));
        const cancelled = await runTurn(turnDeps(data, new ScriptedModel([]), audit), turnInput('cancel', { state: sentAs(card, 'card.1') }));
        const model = new ScriptedModel([]);
        const late = await runTurn(turnDeps(data, model, audit), turnInput('yes', { state: cancelled.state, quotedIds: ['card.1'] }));
        assert.equal(late.outcome, 'not_executed');
        assert.match(late.reply!.text, /had expired, so nothing was done/);
        assert.equal(data.created.length, 0);
        assert.equal(model.calls.length, 0);
    });
});

describe('sent ids on the thread', () => {
    it('go on the reply written at that time, at most ten, and nothing is saved when there is nothing new', () => {
        const at = NOW.toISOString();
        const s: ThreadState = { ...EMPTY_THREAD, history: [{ role: 'user', text: 'hi', at }, { role: 'assistant', text: 'Hello!', at }] };
        const next = withSentIds(s, at, ['a', 'b'])!;
        assert.deepEqual(next.history[1].ids, ['a', 'b']);
        assert.equal(next.history[0].ids, undefined);
        assert.equal(withSentIds(next, at, ['a']), null);
        assert.equal(withSentIds(s, '2020-01-01T00:00:00.000Z', ['a']), null);
    });
});
