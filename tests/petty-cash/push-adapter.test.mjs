import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,id} from './database.mjs';
import {loadTs} from './load-ts.mjs';
import {notificationAdapter} from './notification-adapter.mjs';
async function fixture(){
 const db=await setup();await db.exec(`CREATE TABLE notifications(id uuid PRIMARY KEY,user_id uuid,organization_id uuid,property_id uuid,notification_type text,title text,message text,deep_link text,is_read boolean);CREATE TABLE push_tokens(user_id uuid,token text,browser text,is_active boolean,updated_at timestamptz DEFAULT now());CREATE TABLE notification_delivery(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid,push_token text,delivery_status text);`);
 const calls=[];let fail=false;const mocks={'@/backend/lib/supabase/admin':{supabaseAdmin:notificationAdapter(db)},'@/backend/lib/firebase':{firebaseAdmin:{messaging:()=>({send:async message=>{calls.push(message);if(fail)throw new Error('Unknown provider outcome');return 'message-id';}})}}};for(const name of ['./WhatsAppService','./WhatsAppQueueService','./EmailService','./EventProcessor','./EmailRecipientResolver','./WhatsAppRecipientResolver'])mocks[name]={};
 const service=loadTs('backend/services/NotificationService.ts',mocks).NotificationService;
 const payload={deliveryId:id(901),userId:id(12),organizationId:id(1),propertyId:id(3),type:'PETTY_CASH_SUBMITTED',title:'Request submitted',message:'PC-1: Allocate cash',deepLink:`https://fms-dev-saas-one.vercel.app/${id(1)}/petty-cash?request_id=${id(902)}`};return {db,calls,service,payload,setFail:()=>fail=true};
}
test('Push adapter persists one standard in-app notification and deduplicates device delivery',async()=>{
 const f=await fixture();try{
  await f.db.query('insert into push_tokens(user_id,token,browser,is_active) values($1,$2,$3,true)',[id(12),'active-device','Chrome']);
  await f.db.query('insert into push_tokens(user_id,token,browser,is_active) values($1,$2,$3,false)',[id(12),'inactive-device','Firefox']);
  assert.equal((await f.service.sendOutboxPush(f.payload)).success,true);await f.db.query('update notifications set is_read=true');assert.equal((await f.service.sendOutboxPush(f.payload)).success,true);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].data.deepLink,f.payload.deepLink);assert.equal(f.calls[0].webpush.fcmOptions.link,f.payload.deepLink);assert.equal(f.calls[0].token,'active-device');assert.equal((await f.db.query('select count(*) n from notifications')).rows[0].n,1);assert.equal((await f.db.query('select is_read from notifications')).rows[0].is_read,true);
 }finally{await f.db.close();}
});
test('Push without active devices retains in-app notification; unknown FCM outcomes require reconciliation',async()=>{
 const f=await fixture();try{
  assert.equal((await f.service.sendOutboxPush(f.payload)).success,true);assert.equal(f.calls.length,0);
  await f.db.query('insert into push_tokens(user_id,token,is_active) values($1,$2,true)',[id(12),'device']);f.setFail();const result=await f.service.sendOutboxPush({...f.payload,deliveryId:id(903)});assert.equal(result.success,false);assert.equal(result.ambiguous,true);
 }finally{await f.db.close();}
});

test('Outbox Push does not call FCM when its device attempt cannot be persisted',async()=>{
 const f=await fixture();try{
  await f.db.query('insert into push_tokens(user_id,token,is_active) values($1,$2,true)',[id(12),'device']);
  await f.db.exec("ALTER TABLE notification_delivery ADD CONSTRAINT block_fixture_attempt CHECK(delivery_status <> 'PENDING')");
  await assert.rejects(f.service.sendOutboxPush(f.payload),/block_fixture_attempt/);assert.equal(f.calls.length,0);
 }finally{await f.db.close();}
});
