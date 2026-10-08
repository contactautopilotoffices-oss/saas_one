import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import * as config from '../backend/lib/whatsapp/interpreter/config.mjs';
const require=createRequire(import.meta.url),next=require('next/server');
const org='00000000-0000-4000-8000-000000000010',other='00000000-0000-4000-8000-000000000020',uid='00000000-0000-4000-8000-000000000001';
const source=await readFile(new URL('../app/api/whatsapp-assistant/settings/route.ts',import.meta.url),'utf8');
function harness({signedIn=true,role='org_super_admin',approved=true}={}) {
    const writes=[],calls=[],options=[],directoryReads=[];
    const admin={from(table){const filters={};const chain={select(){return chain;},eq(k,v){filters[k]=v;return chain;},async maybeSingle(){
        if(table==='organization_memberships')return {data:filters.organization_id===org&&filters.role===role?{role}:null};
        if(table==='users')return {data:{is_approved:approved,approval_status:approved?'approved':'pending'}};
        return {data:{config:config.defaultSettings}};
    },async upsert(value){writes.push(value);return {error:null};}};return chain;}};
    const imports={'next/server':next,zod:{z},'@/frontend/utils/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:signedIn?{id:uid}:null}})}})},
        '@/backend/lib/supabase/admin':{supabaseAdmin:admin},'@/backend/lib/whatsapp/interpreter/config.mjs':config,
        '@/backend/lib/whatsapp/interpreter/organization-users.mjs':{getOrganizationUsers:async(_admin,orgId)=>{directoryReads.push(orgId);return [{id:uid,name:'Test Member',email:'member@example.com',phone:'919000000000',selectable:true}];}},
        '@/backend/lib/whatsapp/interpreter/interpret.mjs':{interpretTurn:async (input,opts)=>{calls.push(input);options.push(opts);return {ok:true,intent:'details',fields:{start:'3 pm',end:'4 pm'}};}}};
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
        {exports,require:name=>{if(!imports[name])throw new Error(name);return imports[name];},process:{env:{GROQ_TASK_CHAT_API_KEY:'not-exposed'}},Date});
    return {...exports,writes,calls,options,directoryReads};
}
const request=(method='GET',body,organizationId=org)=>new next.NextRequest(`https://example.com/api/whatsapp-assistant/settings?organizationId=${organizationId}`,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
test('settings require login, approved current org super admin, and deny other organizations',async()=>{
    for(const options of [{signedIn:false},{role:'property_admin'},{role:'org_admin'},{approved:false}]) {
        const h=harness(options);assert.ok([401,403].includes((await h.GET(request())).status));assert.equal(h.writes.length,0);
    }
    const h=harness();assert.equal((await h.GET(request('GET',null,other))).status,403);
    const result=await (await h.GET(request())).json();assert.equal(result.readiness.llm,true);assert.equal(JSON.stringify(result).includes('not-exposed'),false);
});
test('cross-org save and arbitrary model or service action settings are rejected before writes',async()=>{
    const h=harness();
    assert.equal((await h.PUT(request('PUT',{organizationId:other,config:config.defaultSettings}))).status,403);
    assert.equal((await h.PUT(request('PUT',{organizationId:org,config:{...config.defaultSettings,action:'procurement.read'}}))).status,400);
    assert.equal(h.writes.length,0);
    assert.equal((await h.PUT(request('PUT',{organizationId:org,config:{...config.defaultSettings,enabled:true,pilotUserIds:[uid]}}))).status,200);
    assert.equal(h.writes[0].organization_id,org);
});
test('preview calls interpretation only and never creates application resources or stores settings',async()=>{
    const h=harness();
    const response=await h.POST(request('POST',{organizationId:org,workflow:'booking',text:'3 pm to 4 pm'}));
    assert.equal((await response.json()).executed,false);assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
    assert.equal((await h.POST(request('POST',{organizationId:org,workflow:'task',text:'done all'}))).status,400);
    assert.equal(h.calls.length,1);
});

test('approved admin preview requests safe provider diagnostics while denied previews never call Groq',async()=>{
    const h=harness();
    assert.equal((await h.POST(request('POST',{organizationId:org,workflow:'booking',text:'3 pm to 4 pm'}))).status,200);
    assert.equal(h.options[0]?.includeDiagnostics,true);
    assert.equal(h.writes.length,0);
    const denied=harness({role:'property_admin'});
    assert.equal((await denied.POST(request('POST',{organizationId:org,workflow:'booking',text:'3 pm to 4 pm'}))).status,403);
    assert.equal(denied.calls.length,0);
});
const directoryRequest=orgId=>new next.NextRequest(`https://example.com/api/whatsapp-assistant/settings?organizationId=${orgId}&view=users`);
test('user picker directory requires approved same-organization super admin before reading users',async()=>{
    for(const options of [{signedIn:false},{role:'property_admin'},{approved:false}]) {
        const h=harness(options);assert.ok([401,403].includes((await h.GET(directoryRequest(org))).status));assert.equal(h.directoryReads.length,0);
    }
    const h=harness();assert.equal((await h.GET(directoryRequest(other))).status,403);assert.equal(h.directoryReads.length,0);
    const data=await (await h.GET(directoryRequest(org))).json();
    assert.equal(data.users[0].name,'Test Member');assert.deepEqual(h.directoryReads,[org]);
});
test('saving a selected user from outside the active organization is rejected',async()=>{
    const h=harness();
    const result=await h.PUT(request('PUT',{organizationId:org,config:{...config.defaultSettings,enabled:true,pilotUserIds:[other]}}));
    assert.equal(result.status,400);assert.equal(h.writes.length,0);
});
