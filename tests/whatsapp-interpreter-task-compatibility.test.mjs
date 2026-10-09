import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';
import * as protocol from '../backend/lib/whatsapp/assistant/protocol.mjs';
import { isExplicitTaskCommand, isDirectBookingRequest } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';
const next=createRequire(import.meta.url)('next/server');
const sources=Object.fromEntries(await Promise.all(['task-manager/TaskGateway.ts','task-manager/TaskErrorHandler.ts','task-manager/TaskCommandHandler.ts','task-manager/TaskMessageRouter.ts','app/api/webhooks/aisensy/route.ts'].map(async path=>[path,await readFile(new URL('../'+path,import.meta.url),'utf8')])));
function load(path,imports){const exports={};vm.runInNewContext(ts.transpileModule(sources[path],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>{assert.ok(name in imports,`unexpected import ${name}`);return imports[name];},Date,URL,Buffer,process:{env:{AISENSY_ASSISTANT_ENABLED:'true'}},console:{info(){},error(){}}});return exports;}
function setup({facilityActive=false,choice=false,testingConfig=null}={}){
    const contexts=new Map([['TASK_MANAGER',{context_data:choice?{state:'AWAITING_SYSTEM_CHOICE'}:{}}]]),tasks=[{id:'task-1',title:'Review report',status:'pending'}],messages=[],events=[],callbacks=[],audits=[];
    const db={getConversationContext:async(_phone,system)=>contexts.get(system)||null,
        getEmployeeByPhone:async()=>({id:'employee',name:'User',role:'employee'}),getDailyAssignments:async()=>tasks,
        setConversationContext:async params=>contexts.set(params.system,{context_data:params.contextData||{}}),
        clearConversationContext:async(_phone,system)=>contexts.delete(system),getTestingConfig:async()=>testingConfig,
        updateAssignmentStatus:async params=>{const task=tasks.find(t=>t.id===params.assignmentId);task.status=params.status;return task;},logAudit:async entry=>audits.push(entry)};
    const imports={'./TaskDatabaseService':{TaskDatabaseService:db},'./TaskMessagingService':{TaskMessagingService:{sendMessage:async(_phone,text)=>messages.push(text)}}};
    // Step 3 access gate: this suite checks the EXISTING behaviour for unlocked people, so everyone is unlocked here.
    imports['./TaskAccessService']={TaskAccessService:{check:async()=>({allowed:true,reason:'ok',message:''})}};
    imports['./PermissionService']={PermissionService:{visibleAndAssignable:async(_actor,list)=>list}};
    imports['./TaskGateway']=load('task-manager/TaskGateway.ts',{});imports['./TaskGatewayExecutor']={TaskGatewayExecutor:{}};imports['./SuperuserAIInterpreter']={SuperuserAIInterpreter:{}}; // Step 4 gateway is OFF in this suite
    imports['./TaskErrorHandler']=load('task-manager/TaskErrorHandler.ts',{});
    imports['./TaskCommandHandler']=load('task-manager/TaskCommandHandler.ts',imports);
    const router=load('task-manager/TaskMessageRouter.ts',imports);
    const route=load('app/api/webhooks/aisensy/route.ts',{
        'next/server':{...next,after:fn=>callbacks.push(fn)},'@/backend/lib/whatsapp/assistant/protocol.mjs':protocol,
        '@/backend/lib/whatsapp/assistant/runtime':{enqueueAssistantMessage:async event=>{events.push(event);return 'event';},drainWhatsAppPhone:async()=>{}},
        '@/backend/lib/whatsapp/processMessage':{processIncomingMessage:()=>assert.fail('no default ticket')},
        '@/backend/lib/whatsapp/greeting':{isGreetingMessage:()=>false},'@/backend/services/AiSensyService':{AiSensyService:{}},
        '@/whatsapp-test/freeformTest':{handleFreeformTest:async()=>false},
        '@/task-manager/TaskImportInbound':{claimTaskImport:async()=>({handled:false})},'@/task-manager/brain/shadow':{scheduleShadow:()=>undefined},'@/task-manager/brain/live':{claimSmartChat:async()=>({handled:false})},'@/task-manager/TaskMessageRouter':router,
        '@/task-manager/TaskIdempotencyService':{TaskIdempotencyService:{isDuplicateWebhook:async()=>false,recordProcessedWebhook(){}}},
        '@/backend/lib/whatsapp/interpreter/coordinator.mjs':{isExplicitTaskCommand,isDirectBookingRequest},
        '@/backend/lib/whatsapp/interpreter/context':{isInterpreterPilot:async()=>true,lookupQuotedContext:async()=>({workflow:'task'}),
            getConversationRoutingState:async()=>({taskActive:contexts.has('TASK_MANAGER'),taskChoicePending:contexts.get('TASK_MANAGER')?.context_data?.state==='AWAITING_SYSTEM_CHOICE',facilityActive})},
    });
    return {tasks,messages,events,contexts,audits,async send(text,quoted=false){return route.POST(new next.NextRequest('https://example.com/api/webhooks/aisensy',{method:'POST',body:JSON.stringify({topic:'message.sender.user',data:{message:{phone_number:'919000000000',messageId:'message-'+text,message_content:{text},...(quoted?{context:{id:'old-task-digest'}}:{})}}})}));}};
}
test('real task completion keeps its existing handler and reply while a facility request is pending',async()=>{
    const app=setup({facilityActive:true});assert.equal((await (await app.send('done 1')).json()).routedTo,'TASK_MANAGER');
    assert.equal(app.tasks[0].status,'completed');assert.match(app.messages[0],/Marked task #1/);assert.equal(app.events.length,0);
});
test('real Task Manager numbered choices still list tasks and switch to facility',async()=>{
    const tasks=setup({choice:true});await tasks.send('1');assert.match(tasks.messages[0],/Tasks for today/);assert.equal(tasks.events.length,0);
    const facility=setup({choice:true});await facility.send('2');assert.equal(facility.contexts.has('TASK_MANAGER'),false);assert.equal(facility.contexts.has('FACILITY'),true);assert.match(facility.messages[0],/Switched to Facility Bot/);assert.equal(facility.events.length,0);
});
test('quoted Task Manager system choices are preserved only when pending without a facility request',async()=>{
    const tasks=setup({choice:true});await tasks.send('1',true);assert.match(tasks.messages[0],/Tasks for today/);assert.equal(tasks.events.length,0);
    const facility=setup({choice:true});await facility.send('2',true);assert.equal(facility.contexts.has('TASK_MANAGER'),false);assert.match(facility.messages[0],/Switched to Facility Bot/);assert.equal(facility.events.length,0);
    const competing=setup({choice:true,facilityActive:true});await competing.send('1',true);assert.equal(competing.messages.length,0);assert.equal(competing.events[0].interpreter,true);
    const expired=setup({choice:false});await expired.send('1',true);assert.equal(expired.messages.length,0);assert.equal(expired.events[0].interpreter,true);
});
test('real task-only cancellation and unknown replies retain their existing responses',async()=>{
    const cancel=setup();await cancel.send('cancel');assert.equal(cancel.contexts.has('TASK_MANAGER'),false);assert.match(cancel.messages[0],/session cleared/);assert.equal(cancel.events.length,0);
    const unknown=setup();await unknown.send('What should I do next?');assert.match(unknown.messages[0],/not sure/);assert.equal(unknown.events.length,0);
});
test('competing numbered reply goes to clarification and never completes a task',async()=>{
    const app=setup({facilityActive:true,choice:true});await app.send('1');assert.equal(app.tasks[0].status,'pending');assert.equal(app.messages.length,0);assert.equal(app.events[0].interpreter,true);
});
test('old quoted task completion cannot mutate the current task list',async()=>{
    const app=setup({facilityActive:true});await app.send('done 1',true);assert.equal(app.tasks[0].status,'pending');assert.equal(app.messages.length,0);assert.equal(app.events[0].interpreter,true);
});
test('Task Manager test whitelist remains enforced for pilot senders',async()=>{
    const app=setup({testingConfig:{enabled:true,employees:[]}});await app.send('done 1');assert.equal(app.tasks[0].status,'pending');assert.equal(app.messages.length,0);assert.equal(app.events[0].interpreter,true);
});
