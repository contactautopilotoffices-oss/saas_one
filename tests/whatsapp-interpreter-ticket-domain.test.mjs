import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../backend/lib/whatsapp/processMessage.ts',import.meta.url),'utf8');

for (const resumeAssignment of [false, true]) test(resumeAssignment
    ? 'pilot recovery completes assignment for an interrupted open unassigned ticket'
    : 'pilot recovery preserves a persisted assignee and escalation progress',async()=>{
    let assigned=0;const writes=[];
    const ticket={id:'ticket',ticket_number:'TKT-1',raised_by:'user',property_id:'property',title:'Leak',description:'Leak',skill_group_code:'stored-skill',status:'in_progress',assigned_to:'original-resolver',hierarchy_id:'existing-hierarchy',current_escalation_level:3};
    if (resumeAssignment) { ticket.status='open';ticket.assigned_to=null; }
    const admin={from(table){let update=null;const query={select(){return query;},eq(){return query;},or(){return query;},limit(){return query;},is(){return query;},update(value){update=value;return query;},
        async maybeSingle(){return {data:table==='tickets'?ticket:table==='issue_categories'?{id:'category',skill_group_id:'skill',priority:'medium',sla_hours:24}:table==='escalation_hierarchies'?{id:'new-hierarchy'}:null};},
        async single(){return {data:ticket};},then(resolve){if(update){writes.push({table,update});Object.assign(ticket,update);}
            return Promise.resolve(resolve({data:table==='users'?[{id:'user',full_name:'User',phone:'919000000000'}]:null,error:null}));}};return query;}};
    const imports={crypto:require('crypto'),os:require('os'),path:require('path'),'fs/promises':require('fs/promises'),'fluent-ffmpeg':()=>assert.fail('no video'),sharp:()=>assert.fail('no photo'),
        '@/backend/lib/supabase/admin':{supabaseAdmin:admin},'@/backend/lib/ticketing':{resolveClassification:async()=>({issue_code:'leak',skill_group:'plumbing',confidence:'high',decisionSource:'rules',priority:'medium'}),logClassification:async()=>{}},
        '@/backend/lib/ticketing/classifyTicket':{classifyTicketEnhanced:()=>({issue_code:'leak'})},'@/backend/services/WhatsAppService':{WhatsAppService:{send:()=>assert.fail('outbox owns reply')}},
        './assistant/access':{getWhatsAppProperties:async()=>[{id:'property',organization_id:'org',name:'Office'}]},
        '@/backend/lib/ticketing/assignment':{processIntelligentAssignment:async(_db,rows)=>{assert.equal(rows[0].skill_group_code,'stored-skill');assigned++;ticket.assigned_to='another-resolver';}},
        '@/backend/services/NotificationService':{NotificationService:{afterTicketCreated:async()=>{},afterCriticalTicketCreated:async()=>{}}}};
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
        {exports,require:name=>{if(!(name in imports))throw new Error(name);return imports[name];},console:{log(){},error(){}},Date,Buffer});
    const result=await exports.processIncomingMessage('919000000000','Leak',null,null,false,null,null,false,'property','wamid',
        {userId:'user',requestId:'operation',interpreterInputHash:'fixed-input',skipTaskRouting:true,suppressReply:true,throwOnError:true});
    assert.equal(result.id,'ticket');assert.equal(assigned,resumeAssignment?1:0);assert.equal(ticket.assigned_to,resumeAssignment?'another-resolver':'original-resolver');
    assert.equal(ticket.current_escalation_level,3);assert.deepEqual(writes,[]);
});
