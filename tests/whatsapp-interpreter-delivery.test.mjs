import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSessionReply, providerIds } from '../backend/lib/whatsapp/interpreter/delivery.mjs';
const env={AISENSY_PROJECT_ID:'project-1',AISENSY_PROJECT_API_KEY:'project-password'};
const now=new Date('2026-10-05T12:00:00Z');
test('Project API sends dynamic text and preserves provider aliases without campaign credentials',async()=>{
    let request;
    const result=await sendSessionReply('919000000000','Please choose a room','2026-10-05T11:00:00Z',{env,now,fetch:async(url,options)=>{request={url,options};return new Response(JSON.stringify({messages:[{id:'wamid-1',submitted_message_id:'submission-1'}]}));}});
    assert.equal(result.success,true);
    assert.deepEqual(result.messageIds,['wamid-1','submission-1']);
    assert.equal(request.options.headers['X-AiSensy-Project-API-Pwd'],'project-password');
    assert.equal(JSON.parse(request.options.body).text.body,'Please choose a room');
    assert.match(request.url,/project-1\/messages$/);
});
test('closed, invalid or future service windows never call Project API',async()=>{
    for(const stamp of ['2026-10-04T12:00:00Z',null,'bad','2026-10-06T12:00:00Z']) {
        const result=await sendSessionReply('919000000000','reply',stamp,{env,now,fetch:()=>assert.fail('outside window')});
        assert.equal(result.success,false);assert.equal(result.error,'SESSION_WINDOW_CLOSED');
    }
});
test('provider failure and missing credentials return structured safe failures',async()=>{
    const missing=await sendSessionReply('919000000000','reply',now.toISOString(),{env:{},now});
    assert.equal(missing.retryable,false);
    const rejected=await sendSessionReply('919000000000','reply',now.toISOString(),{env,now,fetch:async()=>new Response('{}',{status:429})});
    assert.equal(rejected.retryable,true);
    const invalid=await sendSessionReply('919000000000','reply',now.toISOString(),{env,now,fetch:async()=>new Response('{"success":false}')});
    assert.equal(invalid.success,false);
    assert.deepEqual(providerIds({id:'request-log-id',contact:{id:'not-a-message'}}),[]);
    assert.deepEqual(providerIds({data:{message:{id:'provider-record',messageId:'wamid-nested',submitted_message_id:'submission-nested'}}}),['provider-record','wamid-nested','submission-nested']);
    const noBody=await sendSessionReply('919000000000','reply',now.toISOString(),{env,now,fetch:async()=>new Response(null,{status:204})});
    assert.equal(noBody.success,true,'accepted response without IDs must not cause a duplicate resend');
});
