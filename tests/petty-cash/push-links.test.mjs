import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../public/firebase-messaging-sw.js',import.meta.url),'utf8');
test('Firebase browser click opens the specific request for automatic and data-only notifications',async()=>{
 const handlers={},opened=[];const origin='https://fms-dev-saas-one.vercel.app';const link=origin+'/org/petty-cash?request_id=request';let background;
 const clients={matchAll:async()=>[],openWindow:async url=>opened.push(url)};
 vm.runInNewContext(source,{importScripts(){},firebase:{initializeApp(){},messaging:()=>({onBackgroundMessage:callback=>background=callback})},self:{addEventListener:(name,callback)=>handlers[name]=callback,location:{origin},clients,registration:{showNotification(){}}},clients,URL,console:{log(){}}});
 for(const data of [{FCM_MSG:{data:{deepLink:link}}},{FCM_MSG:{fcmOptions:{link}}},{deep_link:link},{deepLink:link},{url:link}]){
  let pending;handlers.notificationclick({notification:{data,close(){}},waitUntil:promise=>pending=promise});await pending;assert.equal(opened.at(-1),link);
 }
 assert.equal(opened.length,5);assert.equal(typeof background,'function');
});
