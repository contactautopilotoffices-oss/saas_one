import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
import { readFile } from 'node:fs/promises';
import { setup, id, call, evidence } from './database.mjs';

test('Petty Cash event registry maps fifteen events to seven exact sequential templates', () => {
 const { PC_NOTIFICATION_EVENTS, PC_NOTIFICATION_TEMPLATES } = loadTs('frontend/lib/notifications/pettyCashTemplates.ts');
 assert.equal(PC_NOTIFICATION_EVENTS.length,15);assert.equal(PC_NOTIFICATION_TEMPLATES.length,7);
 for(const template of PC_NOTIFICATION_TEMPLATES){assert.deepEqual([...template.body.matchAll(/{{(\d+)}}/g)].map(m=>+m[1]),[...template.params].map((_,i)=>i+1));assert.ok(template.body.length<=1024);assert.equal(template.params.at(-1),'request_url');}
 assert.equal(PC_NOTIFICATION_EVENTS.find(e=>e.action==='allocate').templateName,'pc_action_required_v1');
});

export async function notificationDatabase(){
 const db=await setup();
 await db.exec(`ALTER TABLE users ADD COLUMN phone text; UPDATE users SET email='fixture'||right(id::text,2)||'@example.test',phone='9190000000'||right(id::text,2);
 CREATE TABLE event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,entity_id uuid,payload jsonb,status text DEFAULT 'pending',retry_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261007000001_petty_cash_omnichannel.sql',import.meta.url),'utf8'));
 return db;
}

test('transactional events carry exact expense identity and do not replay or notify on drafts/failed actions',async()=>{
 const db=await notificationDatabase();try{
  await call(db,'pc_create_request',[id(11),id(1),{amount_requested:20,purpose:'Draft',save_draft:true}]);
  assert.equal((await db.query('select count(*) n from event_outbox')).rows[0].n,0);
  let r=await call(db,'pc_create_request',[id(11),id(1),{amount_requested:150,purpose:'Notification cash'}]);
  await assert.rejects(call(db,'pc_action',[id(13),r.id,'allocate',{expected_version:r.version,allocated_amount:150}]));
  assert.equal((await db.query('select count(*) n from event_outbox')).rows[0].n,1);
  r=await call(db,'pc_action',[id(12),r.id,'allocate',{expected_version:r.version,allocated_amount:150}]);r=await call(db,'pc_action',[id(13),r.id,'approve',{expected_version:r.version}]);
  r=await call(db,'pc_action',[id(14),r.id,'pay',{expected_version:r.version,paid_mode:'Cash',documents:[{upload_id:await evidence(db,14)}]}]);
  const body={amount:100,description:'Partial without bill',category:'Travel',vendor:'Fixture',expense_date:'2026-10-06',payment_mode:'Cash',idempotency_key:id(701)};
  const e=await call(db,'pc_expense',[id(11),r.id,body]);await call(db,'pc_expense',[id(11),r.id,body]);
  await call(db,'pc_expense',[id(11),r.id,{...body,amount:10,idempotency_key:id(702)}]);
  const events=(await db.query("select * from event_outbox where event_type='PETTY_CASH_EXPENSE_RECORDED' order by created_at,id")).rows;
  assert.equal(events.length,2);assert.equal(new Set(events.map(e=>e.entity_id)).size,2);const first=events.find(event=>event.payload.expense_id===e.id);assert.ok(first);assert.equal(first.payload.amounts.expense,'100.00');assert.equal(first.payload.amounts.remaining,'50.00');
  await call(db,'pc_review_expense',[id(14),e.id,'accepted','Checked']);await call(db,'pc_review_expense',[id(14),e.id,'accepted','Checked']);
  assert.equal((await db.query("select count(*) n from event_outbox where event_type='PETTY_CASH_EXPENSE_ACCEPTED'")).rows[0].n,1);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261007000001_petty_cash_omnichannel.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*) n from event_outbox')).rows[0].n,7);
 }finally{await db.close();}
});

test('specific users and selected roles remain scoped to current task and active internal request access',async()=>{
 const db=await notificationDatabase();try{
  const r=await call(db,'pc_create_request',[id(11),id(1),{amount_requested:150,purpose:'Recipients'}]);
  const recipients=async(feature,rule)=> (await db.query('select * from pc_notification_recipients($1,$2,$3)',[r.id,feature,rule])).rows;
  assert.deepEqual((await recipients('petty_cash_submitted',{notify_assignee:true})).map(u=>u.id),[id(12)]);
  assert.equal((await recipients('petty_cash_submitted',{notify_assignee:false})).length,0);
  assert.deepEqual((await recipients('petty_cash_submitted',{user_ids:[id(12),id(16),id(15),id(11)]})).map(u=>u.id),[id(12)]);
  assert.deepEqual((await recipients('petty_cash_submitted',{roles:['staff']})).map(u=>u.id),[id(12)]);
  await db.query('update property_memberships set is_active=false where user_id=$1',[id(12)]);assert.equal((await recipients('petty_cash_submitted',{notify_assignee:true,user_ids:[id(12)]})).length,0);
 }finally{await db.close();}
});
