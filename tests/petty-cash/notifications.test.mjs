import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {loadTs} from './load-ts.mjs';
const root=new URL('../..',import.meta.url).pathname;
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(path,entry.name)):entry.name.endsWith('.ts')?[join(path,entry.name)]:[]);}
test('financial Petty Cash routes and helpers have no notification hook or provider send path',()=>{
 for(const file of [...files(join(root,'app/api/petty-cash')),join(root,'backend/lib/pettyCash/actions.ts')]){
  const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/notifyPettyCash|sendEmail|sendTemplate|sendToMany|sendOutboxPush/,file);
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  for(const node of ast.statements)if(ts.isImportDeclaration(node))assert.doesNotMatch(node.moduleSpecifier.text,/services\/(Email|WhatsApp|AiSensy|Notification|PettyCashNotification)|pettyCash\/notify/,file);
 }
});
test('Petty Cash outbox email/push dispatch returns before generic notification handlers',async()=>{
 const calls=[];const event={id:'activity',event_type:'PETTY_CASH_SUBMITTED',payload:{}};
 const processor=loadTs('backend/services/EventProcessor.ts',{
  '@/backend/lib/supabase/admin':{supabaseAdmin:{}},
  '@/backend/services/EmailService':{EmailService:new Proxy({},{get(){throw new Error('Generic email fallback must not execute');}})},
  '@/backend/services/EmailRecipientResolver':{EmailRecipientResolver:{}},
  '@/backend/services/PettyCashNotificationService':{PettyCashNotificationService:{dispatch:async(_,channel)=>calls.push(channel)}}
 }).EventProcessor;
 await processor.processEvent(event);assert.deepEqual(calls,['email','push']);
});

test('Petty Cash WhatsApp dispatch uses only the outbox service and rejects missing event identity',async()=>{
 const calls=[];const event={id:'event',entity_id:'activity',event_type:'PETTY_CASH_SUBMITTED',payload:{}};
 const processor=loadTs('backend/services/WhatsAppEventProcessor.ts',{
  '@/backend/lib/supabase/admin':{supabaseAdmin:{}},
  '@/backend/services/WhatsAppRecipientResolver':{WhatsAppRecipientResolver:{}},
  '@/backend/services/WhatsAppQueueService':{WhatsAppQueueService:new Proxy({},{get(){throw new Error('Generic WhatsApp fallback must not execute');}})},
  '@/backend/services/PettyCashNotificationService':{PettyCashNotificationService:{dispatch:async(_,channel)=>calls.push(channel)}}
 }).WhatsAppEventProcessor;
 await processor.processEvent(event);assert.deepEqual(calls,['whatsapp']);
 await assert.rejects(processor.processEvent({...event,id:undefined}),/outbox identity required/);
});
