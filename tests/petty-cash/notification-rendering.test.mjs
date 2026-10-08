import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {PC_NOTIFICATION_EVENTS,PC_NOTIFICATION_TEMPLATES}=loadTs('frontend/lib/notifications/pettyCashTemplates.ts');
const {renderPcNotification,requestNotificationUrl}=loadTs('backend/lib/pettyCash/notificationRendering.ts');
test('all seven campaign contracts preserve parameter ordering and reject unconfirmed or mismatched mappings',()=>{
 for(const template of PC_NOTIFICATION_TEMPLATES){
  const event=PC_NOTIFICATION_EVENTS.find(event=>event.templateName===template.name);
  const variables=Object.fromEntries(template.params.map(key=>[key,`sample_${key}`]));variables.event_date='06 Oct 2026';variables.request_url='https://fms-dev-saas-one.vercel.app/example';
  const mapping={campaign_name:template.name,params:template.params,confirmed_live:true};
  const rendered=renderPcNotification(event,variables,mapping);
  assert.deepEqual([...rendered.params],[...template.params].map(key=>variables[key]));assert.equal(rendered.campaign,template.name);assert.doesNotMatch(rendered.text,/{{|undefined/);
  assert.equal(renderPcNotification(event,variables,{...mapping,confirmed_live:false}).campaign,null);
  assert.equal(renderPcNotification(event,variables,{...mapping,params:[...template.params].reverse()}).campaign,null);
 }
});
test('email escapes recipient values, rejects unknown variables and header injection; links use HTTPS request routes',()=>{
 const event=PC_NOTIFICATION_EVENTS[0];const variables={user_name:'<script>alert(1)</script>',request_no:'PC-1',property_name:'Property',requester_name:'Ravi',event_amount:'INR 150',next_action:'Allocate',request_url:'https://fms-dev-saas-one.vercel.app/request',event_date:'06 Oct 2026'};
 assert.match(renderPcNotification(event,variables,null,{html:'Hello {{user_name}}'}).html,/&lt;script&gt;/);
 assert.throws(()=>renderPcNotification(event,variables,null,{html:'{{unknown}}'}),/Unknown/);
 assert.throws(()=>renderPcNotification(event,variables,null,{subject:'Hello\nBcc: injected',html:'Hello'}),/Invalid/);
 assert.equal(requestNotificationUrl('org','request','https://fms-dev-saas-one.vercel.app/'),'https://fms-dev-saas-one.vercel.app/org/petty-cash?request_id=request');
 assert.throws(()=>requestNotificationUrl('org','request','http://example.test'),/HTTPS/);
});
