import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as protocol from '../backend/lib/whatsapp/assistant/protocol.mjs';
import { isExplicitTaskCommand, isDirectBookingRequest } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';

const require = createRequire(import.meta.url);
const next = require('next/server');
const source = await readFile(new URL('../app/api/webhooks/aisensy/route.ts', import.meta.url), 'utf8');

function handler(env, enqueue = async () => 'event-1', overrides = {}) {
    const callbacks = [];
    const logs = [];
    const exports = {};
    const imports = {
        'node:crypto': require('node:crypto'),
        'next/server': { ...next, after: callback => callbacks.push(callback) },
        '@/backend/lib/whatsapp/assistant/protocol.mjs': protocol,
        '@/backend/lib/whatsapp/assistant/runtime': { enqueueAssistantMessage: enqueue, drainWhatsAppPhone: async () => {} },
        '@/backend/lib/whatsapp/processMessage': { processIncomingMessage: async () => {} },
        '@/backend/lib/whatsapp/greeting': { isGreetingMessage: () => false },
        '@/backend/services/AiSensyService': { AiSensyService: { sendGreeting: async () => {} } },
        '@/whatsapp-test/freeformTest': { handleFreeformTest: async () => false },
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter': {TaskMessageRouter:{routeInboundMessage:async()=>({handledByTaskManager:false})}},
        '@/task-manager/TaskIdempotencyService': {TaskIdempotencyService:{isDuplicateWebhook:async()=>false,recordProcessedWebhook:()=>{}}},
        '@/backend/lib/whatsapp/interpreter/context': {isInterpreterPilot:async()=>false,lookupQuotedContext:async()=>null,getConversationRoutingState:async()=>({taskActive:false,facilityActive:false})},
        '@/backend/lib/whatsapp/interpreter/coordinator.mjs': {isExplicitTaskCommand,isDirectBookingRequest},
        ...overrides,
    };
    imports['@/backend/lib/whatsapp/interpreter/context']={getConversationRoutingState:async()=>({taskActive:false,facilityActive:false}),...imports['@/backend/lib/whatsapp/interpreter/context']};
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, require: name => { if (!(name in imports)) throw new Error('Unexpected import ' + name); return imports[name]; },
        Buffer, URL, Date, process: { env }, console: { info: (...args) => logs.push(args), error() {} } });
    return { ...exports, callbacks, logs };
}

const payload = { topic: 'message.sender.user', data: { phone: '919876543210', messageId: 'wamid-1', message: 'Hi' } };
const request = (body = payload, token = 'secret') => new next.NextRequest('https://example.com/api/webhooks/aisensy', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-aisensy-secret': token }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('webhook health identifies interpreter deployment and global switch without exposing credentials',async()=>{
    for(const enabled of ['true','false']) {
        const route=handler({AISENSY_ASSISTANT_ENABLED:'true',WHATSAPP_LLM_INTERPRETER_ENABLED:enabled,AISENSY_PROJECT_ID:'private-project',AISENSY_PROJECT_API_KEY:'private-key'});
        const response=await route.GET();const body=await response.json();
        assert.equal(body.interpreterEnabled,enabled==='true');assert.equal(body.routingVersion,'ticket-photo-submit-v1');
        assert.equal(JSON.stringify(body).includes('private'),false);
    }
});

test('pilot persists before task audit dedup and retains quoted IDs and service timestamp',async()=>{
    let stored;
    const route=handler({AISENSY_ASSISTANT_ENABLED:'true'},async input=>{stored=input;return 'pilot-event';},{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,lookupQuotedContext:async()=>null},
        '@/task-manager/TaskIdempotencyService':{TaskIdempotencyService:{isDuplicateWebhook:()=>assert.fail('pilot uses durable dedup'),recordProcessedWebhook:()=>assert.fail('must persist first')}},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{routeInboundMessage:()=>assert.fail('facility draft bypasses Task Manager')}}
    });
    const response=await route.POST(request({topic:'message.sender.user',project_id:'project-1',data:{message:{phone_number:'919876543210',messageId:'pilot-wamid',message_content:{text:'3 PM to 4 PM'},context:{id:'old-prompt',submitted_message_id:'alias'},sent_at:1791201600}}}));
    assert.equal(response.status,200);
    assert.equal(stored.interpreter,true);
    assert.deepEqual(Array.from(stored.quotedIds),['old-prompt','alias']);
    assert.equal(stored.inboundAt,new Date(1791201600*1000).toISOString());
});
test('direct boardroom request bypasses stale task context without changing task commands',async()=>{
    let stored;
    const route=handler({},async input=>{stored=input;return 'direct-booking';},{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,getConversationRoutingState:async()=>({taskActive:true,facilityActive:false})},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{classifyMessage:()=>assert.fail('clear direct facility request must not be classified from task context'),routeInboundMessage:()=>assert.fail('no task action')}}
    });
    for (const message of ['Book boardroom today from 5 pm to 6 pm','Book boardroom today from 5 pm to 6 pm for task planning','Book boardroom for ticket review today from 5 pm to 6 pm']) {
        assert.equal((await route.POST(request({...payload,data:{...payload.data,message}}))).status,200);
        assert.equal(stored.interpreter,true);
    }
});

test('pilot persistence failure remains retryable without an early task audit mark',async()=>{
    const route=handler({},async()=>{throw new Error('storage unavailable');},{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true},
        '@/task-manager/TaskIdempotencyService':{TaskIdempotencyService:{recordProcessedWebhook:()=>assert.fail('no audit before storage')}}
    });
    assert.equal((await route.POST(request())).status,503);
    assert.equal(route.callbacks.length,0);
});

test('explicit task command stays with legacy Task Manager and cannot alter facility state',async()=>{
    let called=false;
    const route=handler({},()=>assert.fail('task must not advance facility draft'),{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{routeInboundMessage:async()=>{called=true;return {handledByTaskManager:true};}}}
    });
    const response=await route.POST(request({...payload,data:{...payload.data,message:'done 1'}}));
    assert.equal(called,true);assert.equal((await response.json()).routedTo,'TASK_MANAGER');
});

for (const [text, contexts] of [
    ['1',{taskActive:true,taskChoicePending:true,facilityActive:false}],
    ['2',{taskActive:true,taskChoicePending:true,facilityActive:false}],
    ['Cancel',{taskActive:true,taskChoicePending:false,facilityActive:false}],
    ['What should I do next?',{taskActive:true,taskChoicePending:false,facilityActive:false}],
]) test(`pilot preserves Task Manager conversation reply: ${text}`,async()=>{
    const routed=[];
    const route=handler({},()=>assert.fail('task conversation must not be sent to the facility interpreter'),{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,getConversationRoutingState:async()=>contexts},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{classifyMessage:async()=>({system:'TASK_MANAGER'}),routeInboundMessage:async input=>{routed.push(input.text);return {handledByTaskManager:true};}}}
    });
    const response=await route.POST(request({...payload,data:{...payload.data,message:text}}));
    assert.equal((await response.json()).routedTo,'TASK_MANAGER');assert.deepEqual(routed,[text]);
});

test('pilot task execution failure cannot fall through to a facility action',async()=>{
    let enqueued=0;
    const route=handler({},async()=>{enqueued++;return 'event';},{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{routeInboundMessage:async()=>{throw new Error('task storage failed');}}}
    });
    assert.equal((await route.POST(request({...payload,data:{...payload.data,message:'done 1'}}))).status,503);
    assert.equal(enqueued,0);
});

test('explicit CANCEL TASKS and quoted task cancellation stay outside facility drafts',async()=>{
    const texts=[];
    const route=handler({},()=>assert.fail('task cancellation must not advance facility draft'),{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,lookupQuotedContext:async()=>({workflow:'task'})},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{routeInboundMessage:async input=>{texts.push(input.text);return {handledByTaskManager:true};}}}
    });
    assert.equal((await route.POST(request({...payload,data:{...payload.data,message:'Cancel Tasks'}}))).status,200);
    assert.equal((await route.POST(request({topic:'message.sender.user',data:{message:{phone_number:'919876543210',messageId:'cancel-quoted',message_content:{text:'Cancel'},context:{id:'task-prompt'}}}}))).status,200);
    assert.deepEqual(texts,['cancel','Cancel']);
});

test('quoted task mutation and unknown quote require clarification rather than executing current task numbers',async()=>{
    let saved;
    const route=handler({},async input=>{saved=input;return 'event';},{
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,lookupQuotedContext:async()=>({workflow:'task'})},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':{TaskMessageRouter:{routeInboundMessage:()=>assert.fail('old task quote cannot complete current task 1')}}
    });
    await route.POST(request({topic:'message.sender.user',data:{message:{phone_number:'919876543210',messageId:'quoted-task-command',message_content:{text:'done 1'},context:{id:'old-task-list'}}}}));
    assert.equal(saved.interpreter,true);
});

test('enabled webhook accepts the plain URL without a secret', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' });
    const plainRequest = new next.NextRequest('https://example.com/api/webhooks/aisensy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const response = await route.POST(plainRequest);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(route.callbacks.length, 1);
});

test('a leftover webhook secret environment variable does not reject inbound messages', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'old-secret' });
    assert.equal((await route.POST(request(payload, 'wrong'))).status, 200);
});

test('webhook validates JSON and requires stable message ID', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' });
    assert.equal((await route.POST(request('{bad'))).status, 400);
    assert.equal((await route.POST(request({ ...payload, data: { ...payload.data, messageId: '' } }))).status, 400);
    assert.equal(route.callbacks.length, 0);
});

test('webhook persists before acknowledging and defers work without waiting for cron', async () => {
    let stored;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' }, async input => { stored = input; return 'event-1'; });
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(stored.messageId, 'wamid-1');
    assert.equal(route.callbacks.length, 1);
});

test('outbound events are ignored and persistence failure requests delivery retry', async () => {
    let called = false;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' }, async () => { called = true; throw new Error('DB unavailable'); });
    const ignored = await route.POST(request({ ...payload, topic: 'message.sent.business' }));
    assert.equal((await ignored.json()).ignored, true);
    assert.equal(called, false);
    assert.equal((await route.POST(request())).status, 503);
    assert.equal(route.callbacks.length, 0);
});


test('ignored payloads report their nested structure without exposing message or phone values', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' });
    const unknown = { topic: 'message.sender.user', data: { unusualContact: { number: '919876543210' }, unusualMessage: { body: 'private greeting text', id: 'private-id' } } };
    const response = await route.POST(request(unknown));
    assert.deepEqual(await response.json(), { ok: true, ignored: true });
    const diagnostic = route.logs.find(entry => entry[0] === '[AiSensyWebhook] Payload inspected');
    assert.ok(diagnostic, 'every parsed request should emit a diagnostic');
    assert.equal(typeof diagnostic[1], 'string');
    const details = JSON.parse(diagnostic[1]);
    assert.equal(details.assistantEnabled, true);
    assert.equal(details.normalized, false);
    assert.equal(details.shape.data.unusualContact.number, 'string');
    assert.equal(details.shape.data.unusualMessage.body, 'string');
    const output = JSON.stringify(route.logs);
    for (const sensitive of ['919876543210', 'private greeting text', 'private-id']) assert.equal(output.includes(sensitive), false);
    assert.equal(route.callbacks.length, 0);
});


test('AiSensy nested project message is persisted and schedules the reply worker', async () => {
    let stored;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' }, async input => { stored = input; return 'event-aisensy'; });
    const response = await route.POST(request({ topic: 'message.sender.user', data: { message: {
        phone_number: '919876543210', message_content: { text: 'Hi' }, message_type: 'TEXT',
        type: 'message', id: 'provider-record', messageId: 'wamid-project-1',
    } } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(stored.text, 'Hi');
    assert.equal(stored.messageId, 'wamid-project-1');
    assert.equal(route.callbacks.length, 1);
});

test('AiSensy image message_content retains the caption and media URL for ticket creation',()=>{
    const result=protocol.normalizeInbound({topic:'message.sender.user',data:{message:{phone_number:'919876543210',messageId:'image-id',message_type:'IMAGE',message_content:{url:'https://media.aisensy.com/photo.jpg',caption:'Floor lighting is not working'}}}});
    assert.equal(result?.text,'Floor lighting is not working');
    assert.equal(result?.mediaUrl,'https://media.aisensy.com/photo.jpg');
    assert.equal(result?.mediaType,'image');
});
