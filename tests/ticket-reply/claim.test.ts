import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claimTicketReply, replies, type TicketReplyDeps } from '../../backend/lib/whatsapp/ticketReply';

const PHONE = '919876543210';
const LOHIT = 'user-lohit', RAHUL = 'user-rahul';
const ticket = { id: 'ticket-1', ticket_number: 'TICK-1042', raised_by: LOHIT, assigned_to: RAHUL };

/** A swipe-reply in the shape normalizeInbound reads. */
const swipe = (fields: Record<string, unknown> = {}) => ({
    data: { phone: PHONE, messageId: 'wamid.in', message: { text: { body: 'Attached the approval' }, context: { id: 'wamid.out' }, ...fields } },
});

function fake(overrides: Partial<TicketReplyDeps> = {}) {
    const sent: string[] = [];
    const added: unknown[] = [];
    const calls = { quote: 0 };
    const deps: TicketReplyDeps = {
        quote: async () => { calls.quote++; return { workflow: 'ticket_reply', conversation_id: 'comment-1' }; },
        ticketOfComment: async () => ticket,
        findUser: async () => ({ id: LOHIT }),
        addComment: async input => { added.push(input); return 'added'; },
        send: async (_phone, text) => { sent.push(text); },
        ...overrides,
    };
    return { deps, sent, added, calls };
}

describe('messages that are not ticket swipes go to the bots untouched', () => {
    it('a plain message is passed on without reading the database', async () => {
        const f = fake();
        const result = await claimTicketReply({ data: { phone: PHONE, messageId: 'm', message: { text: { body: 'hello' } } } }, f.deps);
        assert.equal(result.handled, false);
        assert.equal(f.calls.quote, 0);
        assert.equal(f.sent.length, 0);
    });

    for (const workflow of ['task', 'ticket', 'booking', 'menu']) {
        it(`a swipe on a ${workflow} message stays with its bot`, async () => {
            const f = fake({ quote: async () => ({ workflow, conversation_id: 'x' }) });
            assert.equal((await claimTicketReply(swipe(), f.deps)).handled, false);
            assert.equal(f.added.length, 0);
            assert.equal(f.sent.length, 0);
        });
    }

    it('a swipe on an unknown message stays with the bots', async () => {
        const f = fake({ quote: async () => null });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, false);
    });

    it('junk payloads are passed on and never throw', async () => {
        const f = fake();
        for (const body of [null, undefined, 'text', 42, [], {}]) assert.equal((await claimTicketReply(body, f.deps)).handled, false);
    });
});

describe('a swipe-reply to a ticket notification', () => {
    it('adds the text as the comment of the person who swiped, and confirms', async () => {
        const f = fake();
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.deepEqual(f.added, [{ ticketId: 'ticket-1', userId: LOHIT, text: 'Attached the approval', messageId: 'wamid.in', repliedToCommentId: 'comment-1' }]);
        assert.deepEqual(f.sent, [replies.added('TICK-1042')]);
    });

    it('works for the assignee too', async () => {
        const f = fake({ findUser: async () => ({ id: RAHUL }) });
        await claimTicketReply(swipe(), f.deps);
        assert.equal((f.added[0] as { userId: string }).userId, RAHUL);
    });

    it('a re-delivered message adds nothing and sends no second confirmation', async () => {
        const f = fake({ addComment: async () => 'duplicate' });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.equal(f.sent.length, 0);
    });

    it('someone no longer on the ticket cannot post to it', async () => {
        for (const findUser of [async () => ({ id: 'someone-else' }), async () => null]) {
            const f = fake({ findUser });
            assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
            assert.equal(f.added.length, 0);
            assert.deepEqual(f.sent, [replies.notOnTicket('TICK-1042')]);
        }
    });

    it('a deleted ticket is reported, not passed to the bots', async () => {
        const f = fake({ ticketOfComment: async () => null });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.deepEqual(f.sent, [replies.gone]);
    });
});

describe('files are not added yet, and never reach the bots', () => {
    const cases: [string, Record<string, unknown>][] = [
        ['a photo', { type: 'image', image: { url: 'https://x/a.jpg' }, text: undefined }],
        ['a photo with a caption', { type: 'image', image: { url: 'https://x/a.jpg', caption: 'see attached' }, text: undefined }],
        ['a document with no caption', { type: 'document', document: { url: 'https://x/a.pdf' }, text: undefined }],
        ['a document with a caption', { type: 'document', document: { url: 'https://x/a.pdf' }, text: { body: 'see attached' } }],
        ['a voice note', { type: 'audio', url: 'https://x/a.ogg', text: undefined }],
    ];
    for (const [name, fields] of cases) {
        it(`${name} adds nothing and asks them to use FMS`, async () => {
            const f = fake();
            assert.equal((await claimTicketReply(swipe(fields), f.deps)).handled, true);
            assert.equal(f.added.length, 0);
            assert.deepEqual(f.sent, [replies.fileNotAdded('TICK-1042')]);
        });
    }
});

describe('failures', () => {
    it('a database failure during the lookup asks them to resend instead of becoming a new ticket draft', async () => {
        const f = fake({ quote: async () => { throw new Error('db down'); } });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.deepEqual(f.sent, [replies.failed]);
    });

    it('a failed comment tells the person it was not added', async () => {
        const f = fake({ addComment: async () => { throw new Error('insert failed'); } });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.deepEqual(f.sent, [replies.failed]);
    });

    it('a failed confirmation does not undo a saved comment or throw', async () => {
        const f = fake({ send: async () => { throw new Error('send failed'); } });
        assert.equal((await claimTicketReply(swipe(), f.deps)).handled, true);
        assert.equal(f.added.length, 1);
    });
});
