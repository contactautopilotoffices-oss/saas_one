import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,id,call,evidence} from './database.mjs';
import {loadTs} from './load-ts.mjs';
import {notificationAdapter} from './notification-adapter.mjs';
async function fixture(){
 const db=await setup();await db.exec(`ALTER TABLE users ADD COLUMN phone text;UPDATE users SET email='fixture'||right(id::text,2)||'@example.test',phone='9190000000'||right(id::text,2);CREATE TABLE event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,entity_id uuid,payload jsonb,status text DEFAULT 'pending',retry_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());CREATE TABLE organization_settings(organization_id uuid PRIMARY KEY,notification_matrix jsonb,whatsapp_templates jsonb,email_templates jsonb,timezone text);CREATE TABLE system_config(key text,value jsonb);INSERT INTO organization_settings(organization_id)VALUES('${id(1)}');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261007000001_petty_cash_omnichannel.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261007000002_petty_cash_push_notifications.sql',import.meta.url),'utf8'));
 const email=[],whatsapp=[],push=[];let waResult={success:true};
 const mocks={'./NotificationService':{NotificationService:{sendOutboxPush:async args=>{push.push(args);return {success:true};}}},'@/backend/lib/supabase/admin':{supabaseAdmin:notificationAdapter(db)},'./EmailService':{EmailService:{sendTransactionalEmail:async args=>{email.push(args);return {success:true};}}},'./AiSensyService':{AiSensyService:{sendTemplate:async args=>{whatsapp.push(args);return waResult;}}}};
 const service=loadTs('backend/services/PettyCashNotificationService.ts',mocks).PettyCashNotificationService;
 const catalog=loadTs('frontend/lib/notifications/pettyCashTemplates.ts');
 const configure=async(feature,rule)=>{const event=catalog.PC_NOTIFICATION_EVENTS.find(e=>e.key===feature);const template=catalog.PC_NOTIFICATION_TEMPLATES.find(t=>t.name===event.templateName);await db.query('update organization_settings set notification_matrix=$1,whatsapp_templates=$2 where organization_id=$3',[{petty_cash:{[feature]:rule}},{[feature]:{campaign_name:template.name,params:template.params,confirmed_live:true}},id(1)]);};
 const event=async type=>(await db.query('select * from event_outbox where event_type=$1 order by created_at desc,id desc limit 1',[type])).rows[0];
 let r=await call(db,'pc_create_request',[id(11),id(1),{amount_requested:150,purpose:'Delivery fixture'}]);
 return {db,service,email,whatsapp,push,configure,event,request:r,setWa:result=>waResult=result};
}
const both={enabled:true,channels:{email:true,whatsapp:true},roles:[],user_ids:[id(12)],notify_assignee:false};
test('Omnichannel selects explicit users; disabled and empty property overrides suppress delivery',async()=>{
 const f=await fixture();try{
  const event=await f.event('PETTY_CASH_SUBMITTED');await f.service.dispatch(event,'email');assert.equal(f.email.length,0);
  await f.configure('petty_cash_submitted',{...both,property_overrides:{[id(3)]:{enabled:false}}});await f.service.dispatch(event,'email');assert.equal(f.email.length,0);
  await f.configure('petty_cash_submitted',{...both,property_overrides:{[id(3)]:{user_ids:[],roles:[],notify_assignee:false}}});await f.service.dispatch(event,'whatsapp');assert.equal(f.whatsapp.length,0);
  await f.configure('petty_cash_submitted',both);await f.service.dispatch(event,'email');await f.service.dispatch(event,'whatsapp');assert.equal(f.email.length,1);assert.equal(f.whatsapp.length,1);assert.equal(f.whatsapp[0].campaignName,'pc_action_required_v1');assert.equal(f.whatsapp[0].templateParams.length,7);assert.match(f.whatsapp[0].templateParams.at(-1),/fms-dev-saas-one\.vercel\.app\/.*petty-cash\?request_id=/);
 }finally{await f.db.close();}
});
test('concurrent outbox retries do not resend sent channels; only failed WhatsApp retries',async()=>{
 const f=await fixture();try{
  await f.configure('petty_cash_submitted',both);f.setWa({success:false,error:'AiSensy HTTP 429'});const event=await f.event('PETTY_CASH_SUBMITTED');
  await Promise.all([f.service.dispatch(event,'email'),f.service.dispatch(event,'email')]);await f.service.dispatch(event,'whatsapp');assert.equal(f.email.length,1);assert.equal(f.whatsapp.length,1);
  await f.service.dispatch(event,'email');assert.equal(f.email.length,1);
  await f.db.query("update petty_cash_notification_deliveries set next_attempt_at=now()-interval '1 minute' where status='failed'");f.setWa({success:true});await f.service.processDue();assert.equal(f.whatsapp.length,2);assert.equal(f.email.length,1);assert.equal((await f.db.query("select count(*) n from petty_cash_notification_deliveries where status='sent'")).rows[0].n,2);
 }finally{await f.db.close();}
});
test('queued tasks are skipped after membership removal and ambiguous provider results are not resent',async()=>{
 const f=await fixture();try{
  await f.configure('petty_cash_submitted',both);const event=await f.event('PETTY_CASH_SUBMITTED');await f.service.enqueue(event,'email');await f.db.query('update property_memberships set is_active=false where user_id=$1',[id(12)]);await f.service.processDue();assert.equal(f.email.length,0);assert.equal((await f.db.query('select status from petty_cash_notification_deliveries')).rows[0].status,'skipped');
  await f.db.query('update property_memberships set is_active=true where user_id=$1',[id(12)]);f.setWa({success:false,ambiguous:true,error:'Unknown provider outcome'});await f.service.dispatch(event,'whatsapp');await f.service.dispatch(event,'whatsapp');assert.equal(f.whatsapp.length,1);assert.equal((await f.db.query("select status from petty_cash_notification_deliveries where channel='whatsapp'")).rows[0].status,'ambiguous');
 }finally{await f.db.close();}
});
test('two partial expenses within two minutes notify independently with exact amounts and optional bills',async()=>{
 const f=await fixture();try{
  let r=f.request;r=await call(f.db,'pc_action',[id(12),r.id,'allocate',{expected_version:r.version,allocated_amount:150}]);r=await call(f.db,'pc_action',[id(13),r.id,'approve',{expected_version:r.version}]);r=await call(f.db,'pc_action',[id(14),r.id,'pay',{expected_version:r.version,paid_mode:'Cash',documents:[{upload_id:await evidence(f.db,14)}]}]);
  await f.configure('petty_cash_expense_recorded',{...both,user_ids:[id(14)],channels:{email:true,whatsapp:false}});
  for(const [amount,key] of [[100,801],[10,802]]){await call(f.db,'pc_expense',[id(11),r.id,{amount,description:'Optional receipt expense',category:'Travel',vendor:'Fixture',expense_date:'2026-10-06',payment_mode:'Cash',idempotency_key:id(key)}]);await f.service.dispatch(await f.event('PETTY_CASH_EXPENSE_RECORDED'),'email');}
  assert.equal(f.email.length,2);assert.notEqual(f.email[0].idempotencyKey,f.email[1].idempotencyKey);assert.match(f.email[0].html,/INR 100\.00/);assert.match(f.email[1].html,/INR 10\.00/);assert.match(f.email[0].html,/Bills and receipts are optional/);
 }finally{await f.db.close();}
});

test('invalid custom email cannot block a valid WhatsApp-only campaign',async()=>{
 const f=await fixture();try{
  await f.configure('petty_cash_submitted',{...both,channels:{email:false,whatsapp:true}});
  await f.db.query('update organization_settings set email_templates=$1 where organization_id=$2',[{petty_cash_submitted:{html:'{{unknown_variable}}',subject:'Broken\nsubject'}},id(1)]);
  await f.service.dispatch(await f.event('PETTY_CASH_SUBMITTED'),'whatsapp');assert.equal(f.whatsapp.length,1);assert.equal(f.email.length,0);assert.equal((await f.db.query('select status from petty_cash_notification_deliveries')).rows[0].status,'sent');
 }finally{await f.db.close();}
});

test('a resubmission suppresses old allocation alerts even when the assigned allocator is unchanged',async()=>{
 const f=await fixture();try{
  await f.configure('petty_cash_submitted',both);const old=await f.event('PETTY_CASH_SUBMITTED');await f.service.enqueue(old,'email');
  let r=await call(f.db,'pc_action',[id(12),f.request.id,'allocate',{expected_version:f.request.version,allocated_amount:150}]);
  r=await call(f.db,'pc_action',[id(13),r.id,'send_back',{expected_version:r.version,remark:'Correct amount'}]);
  r=await call(f.db,'pc_action',[id(11),r.id,'resubmit',{expected_version:r.version,amount_requested:100,purpose:'Corrected amount'}]);
  await f.service.processDue(old.id,'email');assert.equal(f.email.length,0);assert.equal((await f.db.query('select status from petty_cash_notification_deliveries where event_id=$1',[old.id])).rows[0].status,'skipped');
  const current=(await f.db.query("select * from event_outbox where event_type='PETTY_CASH_SUBMITTED' and payload->>'request_version'=$1",[String(r.version)])).rows[0];await f.service.dispatch(current,'email');assert.equal(f.email.length,1);assert.match(f.email[0].text,/Amount: INR 100.00/);
 }finally{await f.db.close();}
});

test('Push follows explicit Omnichannel recipients, is independently deduplicated and obeys overrides',async()=>{
 const f=await fixture();try{
  await f.db.query('update users set email=null,phone=null where id=$1',[id(12)]);
  const event=await f.event('PETTY_CASH_SUBMITTED');await f.service.dispatch(event,'push');assert.equal(f.push.length,0);
  await f.configure('petty_cash_submitted',{...both,channels:{email:false,whatsapp:false,push:true}});
  await f.service.dispatch(event,'push');await f.service.dispatch(event,'push');assert.equal(f.push.length,1);assert.equal(f.push[0].userId,id(12));assert.equal(f.email.length,0);assert.equal(f.whatsapp.length,0);assert.match(f.push[0].deepLink,new RegExp(`petty-cash\\?request_id=${f.request.id}`));
  assert.equal((await f.db.query('select channel,status from petty_cash_notification_deliveries')).rows[0].channel,'push');
  await f.configure('petty_cash_submitted',{...both,channels:{push:true},property_overrides:{[id(3)]:{channels:{push:false}}}});await f.service.dispatch(event,'push');assert.equal(f.push.length,1);
 }finally{await f.db.close();}
});
