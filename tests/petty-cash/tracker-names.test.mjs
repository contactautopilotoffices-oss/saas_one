import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadTs} from './load-ts.mjs';
const {NextResponse}=createRequire(import.meta.url)('next/server');
function fixture(rows,denied=false){const ids=[];let reports=0;const access=denied?NextResponse.json({error:'Forbidden'},{status:403}):{user:{id:'reader'},organizationId:'org'};const route=loadTs('app/api/petty-cash/tracker/route.ts',{'next/server':{NextResponse},'@/backend/lib/pettyCash/access':{resolvePettyCashAccess:async()=>access,isPettyCashAccessError:()=>denied,readOrgId:()=> 'org'},'@/backend/lib/pettyCash/api':{pcError:error=>NextResponse.json({error:error.message},{status:500})},'@/backend/lib/supabase/admin':{supabaseAdmin:{rpc:async()=>{reports++;return {data:{rows},error:null};},from:()=>({select(){return this;},in:async(_,values)=>{ids.push(values);return {data:values.map(id=>({id,full_name:`Name ${id}`})),error:null};}})}}});return {route,ids,reports:()=>reports};}
test('tracker resolves only missing names from authorized rows, in bounded batches',async()=>{
 const f=fixture(Array.from({length:401},(_,i)=>({assigned_allocator_id:`actor-${i}`})));const response=await f.route.GET({});assert.equal(response.status,200);assert.deepEqual(f.ids.map(ids=>ids.length),[200,200,1]);assert.equal((await response.json()).rows[0].assigned_allocator_name,'Name actor-0');
 const ready=fixture([{assigned_allocator_id:'actor',assigned_allocator_name:'Existing name'}]);await ready.route.GET({});assert.equal(ready.ids.length,0);
});
test('denied report access prevents actor lookups and report queries',async()=>{const f=fixture([{assigned_allocator_id:'private'}],true);assert.equal((await f.route.GET({})).status,403);assert.equal(f.reports(),0);assert.equal(f.ids.length,0);});
