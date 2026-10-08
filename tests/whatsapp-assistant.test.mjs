import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../backend/lib/whatsapp/assistant/engine.mjs';
import * as protocol from '../backend/lib/whatsapp/assistant/protocol.mjs';
import { runAssistantChecks } from './whatsapp-assistant-checks.mjs';

test('WhatsApp ticket and booking conversation', async (t) => {
    const checks = await runAssistantChecks(engine, protocol);
    for (const name of checks) await t.test(name, () => {});
});

test('expired submission buttons cannot start an accidental ticket', async () => {
    const result = await engine.advance({ text: 'Submit Ticket', mediaUrl: null }, null, {
        findUser: async () => ({ id: 'u1' }), properties: async () => [{ id: 'p1', name: 'Hub' }],
    });
    if (result.session !== null || result.reply.key !== 'notice') throw new Error('Expired button must ask user to start again');
});

test('a reserved word in a photo caption still becomes the ticket title', async () => {
    let title;
    const result = await engine.advance({ phone: '919876543210', text: 'Cancel', mediaUrl: 'https://example.com/photo.jpg', mediaType: 'image', messageId: 'photo-2', requestId: 'request-2' }, null, {
        findUser: async () => ({ id: 'u1' }), properties: async () => [{ id: 'p1', name: 'Hub' }],
        createTicket: async request => { title = request.title; return { ticket_number: 'TKT-2', title }; },
    });
    if (title !== 'Cancel' || result.reply.key !== 'ticket_created') throw new Error('Caption must not be treated as a command');
});

test('outer image metadata is retained for nested message payloads', () => {
    const result = protocol.normalizeInbound({ topic: 'message.sender.user', data: { phone: '919876543210', message: 'AC leaking', messageId: 'image-1' }, messageType: 'image', mediaUrl: 'https://example.com/photo.jpg' });
    if (result.mediaType !== 'image' || !result.mediaUrl) throw new Error('Outer image metadata must be retained');
});

test('opaque provider button IDs use the human-readable quick-reply title', () => {
    const result = protocol.normalizeInbound({ topic: 'message.sender.user', data: { phone: '919876543210', messageId: 'button-2', message: { interactive: { button_reply: { id: 'provider-button-0', title: 'Create Ticket' } } } } });
    if (result.text !== 'Create Ticket') throw new Error('An opaque button ID must not hide the action title');
});


test('AiSensy project webhook reads nested phone text type and WhatsApp message ID', () => {
    const payload = { id: 'delivery-1', topic: 'message.sender.user', delivery_attempt: '1', data: { message: {
        id: 'provider-record-1', type: 'message', phone_number: '919876543210', sender: 'user',
        message_content: { text: 'Hi' }, message_type: 'TEXT', messageId: 'wamid-aisensy-1',
    } } };
    const expected = { phone: '919876543210', messageId: 'wamid-aisensy-1', text: 'Hi', mediaUrl: null, mediaType: 'text' };
    assert.deepEqual(protocol.normalizeInbound(payload), expected);
    assert.deepEqual(protocol.normalizeInbound({ ...payload, id: 'delivery-2', delivery_attempt: '2' }), expected);
    assert.equal(protocol.normalizeInbound({ ...payload, topic: 'message.sent.business' }), null);
});
test('legacy booking review keeps a valid template parameter when non-tenant credits are skipped',async()=>{
    const property={id:'p1',name:'Hub'},room={id:'r1',name:'Boardroom'},slot={id:'s1',start_time:'14:00',end_time:'15:00'};
    const result=await engine.advance({text:'details',phone:'919876543210'},
        {id:'request',userId:'u1',step:'booking_confirm',property,room,slot,date:'2099-10-01'},
        {findUser:async()=>({id:'u1'}),properties:async()=>[property],creditSummary:async()=>null});
    assert.equal(result.reply.key,'booking_review');
    assert.equal(typeof result.reply.params[4],'string');
    assert.doesNotMatch(result.reply.params[4],/null|undefined/i);
});
