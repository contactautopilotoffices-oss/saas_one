import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import * as config from '../backend/lib/whatsapp/interpreter/config.mjs';
const source=await readFile(new URL('../backend/lib/whatsapp/interpreter/context.ts',import.meta.url),'utf8');
function context({task=null,state=null,pending=[],error=null}={}){
    const reads=[];
    const admin={from(table){const query={select(){return query;},eq(field,value){reads.push([table,field,value]);return query;},gt(){return query;},contains(){return query;},in(){return query;},limit(){return query;},
        maybeSingle(){return query;},then(resolve,reject){return Promise.resolve({data:table==='conversation_context'?task:table==='whatsapp_assistant_sessions'?{state}:pending,error}).then(resolve,reject);}};return query;}};
    const imports={'@/backend/lib/supabase/admin':{supabaseAdmin:admin},'../assistant/access':{},'./config.mjs':config};
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],Date,Set,Map,process:{env:{}}});
    return {read:exports.getConversationRoutingState,reads};
}
test('routing reads recipient-scoped state without modifying Task Manager or facility contexts',async()=>{
    const app=context({task:{context_data:{state:'AWAITING_SYSTEM_CHOICE'}},state:{llmVersion:1,active:'booking',drafts:{booking:{expiresAt:Date.now()+60000}}}});
    const result=await app.read('919000000000');assert.equal(result.taskActive,true);assert.equal(result.taskChoicePending,true);assert.equal(result.facilityActive,true);
    // The one global read is the Task Manager settings row (Step 4 gateway switch); every recipient-scoped read must still use the recipient's phone.
    assert.deepEqual(app.reads.filter(([_table,field,phone])=>(field==='phone'||field==='phone_number')&&phone!=='TEST_CONFIG').map(([_table,_field,phone])=>phone),['919000000000','919000000000','919000000000']);
});
test('expired facility drafts release task routing but pending pilot events reserve their conversation',async()=>{
    const options={task:{context_data:{}},state:{llmVersion:1,active:'booking',drafts:{booking:{expiresAt:Date.now()-1000}}}};
    assert.equal((await context(options).read('919000000000')).facilityActive,false);
    assert.equal((await context({...options,pending:[{id:'queued-booking-selection'}]}).read('919000000000')).facilityActive,true);
});
test('routing storage errors fail closed instead of guessing which service should execute',async()=>{
    await assert.rejects(context({error:{message:'storage unavailable'}}).read('919000000000'),/Conversation routing unavailable/);
});

const pilotId='00000000-0000-4000-8000-000000000001';
function eligibility({env={},user={id:pilotId},properties=[{organization_id:'private-org-id'}],settings={...config.defaultSettings,enabled:true,pilotUserIds:[pilotId]}}={}) {
    const logs=[];
    const imports={
        '@/backend/lib/supabase/admin':{supabaseAdmin:{from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{config:settings},error:null})})}},
        '../assistant/access':{findWhatsAppUser:async()=>user,getWhatsAppProperties:async()=>properties},
        './config.mjs':config,
    };
    const exports={};
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
        {exports,require:name=>imports[name],Date,Set,Map,process:{env},console:{info:(...args)=>logs.push(args)}});
    return {check:exports.isInterpreterPilot,logs};
}

test('routing explains each legacy fallback without logging sender, project, account or message data',async()=>{
    const ready={WHATSAPP_LLM_INTERPRETER_ENABLED:'true',AISENSY_ASSISTANT_ENABLED:'true',AISENSY_PROJECT_ID:'private-project-id'};
    for(const [options,reason] of [
        [{env:{...ready,WHATSAPP_LLM_INTERPRETER_ENABLED:'false'}},'llm_disabled'],
        [{env:{...ready,AISENSY_ASSISTANT_ENABLED:'false'}},'assistant_disabled'],
        [{env:{...ready,AISENSY_PROJECT_ID:''}},'project_not_configured'],
        [{env:{...ready,AISENSY_PROJECT_ID:'other-project'}},'project_mismatch'],
        [{env:ready,user:null},'sender_not_approved_or_not_unique'],
        [{env:ready,properties:[]},'no_active_properties'],
        [{env:ready,settings:{...config.defaultSettings}},'organization_disabled'],
        [{env:ready,settings:{...config.defaultSettings,enabled:true,pilotUserIds:[]}},'sender_not_in_pilot'],
    ]) {
        const app=eligibility(options);
        assert.equal(await app.check({phone:'919876543210',projectId:'private-project-id'}),false);
        assert.equal(app.logs.length,1);
        assert.equal(app.logs[0][1].reason,reason);
        assert.equal(app.logs[0][1].route,'legacy');
        const logged=JSON.stringify(app.logs);
        assert.equal(logged.includes('private'),false);
        assert.equal(logged.includes(pilotId),false);
        assert.equal(logged.includes('919876543210'),false);
    }
});

test('eligible sender is logged as AI without changing organization or account restrictions',async()=>{
    const app=eligibility({env:{WHATSAPP_LLM_INTERPRETER_ENABLED:'true',AISENSY_ASSISTANT_ENABLED:'true',AISENSY_PROJECT_ID:'private-project-id'}});
    assert.equal(await app.check({phone:'919876543210',projectId:'private-project-id'}),true);
    assert.equal(app.logs[0][1].route,'ai');
    assert.equal(app.logs[0][1].reason,'eligible');
});
test('all-user ingress still requires a unique approved sender and active properties',async()=>{
    const ready={WHATSAPP_LLM_INTERPRETER_ENABLED:'true',AISENSY_ASSISTANT_ENABLED:'true',AISENSY_PROJECT_ID:'private-project-id'};
    const settings={...config.defaultSettings,enabled:true,accessMode:'all',pilotUserIds:[]};
    assert.equal(await eligibility({env:ready,settings}).check({phone:'919876543210',projectId:'private-project-id'}),true);
    for(const extra of [{user:null},{properties:[]}]) {
        assert.equal(await eligibility({env:ready,settings,...extra}).check({phone:'919876543210',projectId:'private-project-id'}),false);
    }
});
