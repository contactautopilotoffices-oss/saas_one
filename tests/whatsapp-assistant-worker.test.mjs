import test from 'node:test';
import assert from 'node:assert/strict';
import { drainPhone } from '../backend/lib/whatsapp/assistant/worker.mjs';
import { campaignOptions } from '../backend/lib/whatsapp/assistant/templates.mjs';

function memoryStore() {
    const event = { id: 'event-1', payload: {}, snapshot: null, reply: null, status: 'pending' };
    let locked = false;
    let state;
    return {
        event, get state() { return state; },
        async claim() {
            if (locked || event.status === 'sent') return null;
            locked = true;
            return { event: structuredClone(event), token: 'lease' };
        },
        async save(claim, next, reply) { state = next; event.reply = reply; event.status = 'ready'; },
        async finish(claim, error) { event.status = error ? (event.reply ? 'ready' : 'pending') : 'sent'; locked = false; },
    };
}

test('failed AiSensy delivery retries persisted reply without repeating submission', async () => {
    const store = memoryStore();
    let created = 0;
    let sends = 0;
    const worker = { store, dependencies: {},
        advance: async () => { created++; return { session: null, reply: { key: 'ticket_created', params: ['TKT-1','Hub','Broken AC'] } }; },
        send: async () => ({ success: ++sends > 1, error: 'temporary provider failure' }),
    };
    assert.equal(await drainPhone('919876543210', worker), 0);
    assert.equal(store.event.status, 'ready');
    assert.equal(await drainPhone('919876543210', worker), 1);
    assert.equal(created, 1);
    assert.equal(sends, 2);
    assert.equal(store.event.status, 'sent');
});

test('simultaneous workers use sender lease and send only once', async () => {
    const store = memoryStore();
    let sends = 0;
    const worker = { store, dependencies: {},
        advance: async () => ({ session: { step: 'menu' }, reply: { key: 'menu', params: [] } }),
        send: async () => { sends++; return { success: true }; },
    };
    await Promise.all([drainPhone('919876543210', worker), drainPhone('919876543210', worker)]);
    assert.equal(sends, 1);
    assert.equal(store.state.id, 'event-1');
});

test('campaign mapping preserves approved variable order and sanitizes values', () => {
    const request = campaignOptions('919876543210', { key: 'ticket_created', params: ['TKT-1','Hub\nOne','AC\tleak'] }, { ticket_created: 'custom-campaign' });
    assert.equal(request.campaignName, 'custom-campaign');
    assert.deepEqual(request.templateParams, ['TKT-1','Hub One','AC leak']);
    assert.throws(() => campaignOptions('919876543210', { key: 'booking_review', params: [] }));
});

test('a direct captioned photo has an idempotency key before ticket creation', async () => {
    const { advance } = await import('../backend/lib/whatsapp/assistant/engine.mjs');
    const store = memoryStore();
    store.event.id = '00000000-0000-4000-8000-000000000001';
    store.event.payload = { phone: '919876543210', messageId: 'photo-1', text: 'Lift stuck', mediaUrl: 'https://example.com/photo.jpg', mediaType: 'image' };
    const requests = [];
    const dependencies = {
        findUser: async () => ({ id: 'u1' }),
        properties: async () => [{ id: 'p1', name: 'Hub', organization_id: 'o1' }],
        createTicket: async request => { requests.push(request); return { id: 't1', ticket_number: 'TKT-1', title: request.title }; },
    };
    await drainPhone('919876543210', { store, advance, dependencies, send: async () => ({ success: true }) });
    assert.equal(requests[0].requestId, store.event.id);
    assert.equal(requests[0].title, 'Lift stuck');
});


test('permanent campaign failure does not block the next greeting menu', async () => {
    const events = [
        { id: 'missing-template', payload: {}, reply: { key: 'select', params: [] }, status: 'ready' },
        { id: 'new-hi', payload: { text: 'Hi' }, snapshot: { step: 'property' }, reply: null, status: 'pending' },
    ];
    const store = {
        async claim() { const event = events.find(item => !['sent', 'failed'].includes(item.status)); return event ? { event, token: 'lease' } : null; },
        async save(claim, state, reply) { claim.event.reply = reply; },
        async finish(claim, error) { claim.event.status = error ? 'ready' : 'sent'; },
        async fail(claim, error) { claim.event.status = 'failed'; claim.event.error = error; },
    };
    const sent = [];
    const processed = await drainPhone('919876543210', {
        store, dependencies: {}, advance: async () => ({ session: { step: 'menu' }, reply: { key: 'menu', params: [] } }),
        send: async (phone, reply) => { sent.push(reply.key); return reply.key === 'select' ?
            { success: false, retryable: false, error: 'Campaign not found' } : { success: true }; },
    });
    assert.equal(processed, 1);
    assert.deepEqual(sent, ['select', 'menu']);
    assert.equal(events[0].status, 'failed');
    assert.equal(events[1].status, 'sent');
});


test('outbox-only completion retries finalization without submitting or sending a duplicate success reply', async () => {
    const store = memoryStore();
    let submissions = 0;
    let sends = 0;
    const originalFinish = store.finish;
    let finishes = 0;
    store.finish = async (claim, error) => {
        if (!error && ++finishes === 1) throw new Error('Temporary finish failure');
        await originalFinish(claim, error);
        if (error) store.event.status = 'ready';
    };
    const worker = { store, dependencies: {}, advance: async () => { submissions++; return { session: null, reply: null }; },
        send: async () => { sends++; return { success: true }; } };
    await drainPhone('919876543210', worker);
    await drainPhone('919876543210', worker);
    assert.equal(submissions, 1);
    assert.equal(sends, 0);
    assert.equal(store.event.status, 'sent');
});
