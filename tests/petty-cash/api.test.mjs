import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { loadTs } from './load-ts.mjs';
const user='00000000-0000-0000-0000-000000000011',org='00000000-0000-0000-0000-000000000001',id='00000000-0000-0000-0000-000000000030';
const access={user:{id:user},organizationId:org,canManageRouting:false};
const auth={'@/backend/lib/pettyCash/access':{resolvePettyCashAccess:async()=>access,isPettyCashAccessError:()=>false,readOrgId:()=>org}};
const request=(body)=>new NextRequest('http://fixture/api/petty-cash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

for (const route of ['context', 'assignments']) {
 test(`${route} returns the assigned user when routing also references its updater`, async () => {
  const property='00000000-0000-0000-0000-000000000003';
  const allocator={id:'00000000-0000-0000-0000-000000000012',full_name:'Assigned allocator',email:'allocator@example.test'};
  const updater={id:user,full_name:'Routing administrator',email:'admin@example.test'};
  const relationships=[
   {column:'user_id',constraint:'petty_cash_property_assignments_user_id_fkey',user:allocator},
   {column:'updated_by',constraint:'petty_cash_property_assignments_updated_by_fkey',user:updater},
  ];
  // Model PostgREST's ambiguous-FK response at the HTTP boundary, using the real client.
  const fetch=async input=>{
   const url=new URL(typeof input==='string'?input:input.url);
   let data;
   if(url.pathname.endsWith('/petty_cash_property_assignments')){
    const embed=url.searchParams.get('select').match(/user:users(?:!([^()]+))?\(/);
    const hint=embed?.[1];
    const matches=relationships.filter(r=>!hint||hint===r.column||hint===r.constraint);
    if(matches.length!==1)return new Response(JSON.stringify({code:'PGRST201',message:"Could not embed because more than one relationship was found for 'petty_cash_property_assignments' and 'users'"}),{status:300});
    data=[{property_id:property,user_id:allocator.id,updated_by:updater.id,kind:'allocator',user:matches[0].user}];
   }else if(url.pathname.endsWith('/rpc/pc_wallet')){
    data={balance:0,can_request:true};
   }else{
    data=[{id:property,name:'Fixture property',code:'FIX'}];
   }
   return new Response(JSON.stringify(data),{status:200});
  };
  const database=createClient('http://fixture.supabase.test','fixture-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false}});
  const scopedAccess={...access,propertyIds:[property],roles:['ops_super_admin'],canManageRouting:true,isAdmin:true};
  const {GET}=loadTs(`app/api/petty-cash/${route}/route.ts`,{
   ...auth,'@/backend/lib/pettyCash/access':{...auth['@/backend/lib/pettyCash/access'],resolvePettyCashAccess:async()=>scopedAccess},
   '@/backend/lib/supabase/admin':{supabaseAdmin:database},
  });
  const response=await GET(new NextRequest(`http://fixture/api/petty-cash/${route}?org_id=${org}`));
  const body=await response.json();
  assert.equal(response.status,200,body.error);
  assert.deepEqual((route==='context'?body.routes:body.assignments)[0].user,allocator);
 });
}
test('bulk action accepts only allocation/approval and reports independent failures without deleting anything',async()=>{
 const called=[];const mocks={...auth,'@/backend/lib/pettyCash/api':{pcRequest:async(_a,rid)=>rid===id?{id}:null,isUuid:x=>typeof x==='string'&&x.length===36},'@/backend/lib/pettyCash/actions':{applyPettyCashAction:async(a,rid,action,body)=>{called.push({rid,action,body});return {data:{id:rid},error:null};}}};
 const {POST}=loadTs('app/api/petty-cash/bulk/route.ts',mocks);
 assert.equal((await POST(request({action:'pay',items:[{id}]}))).status,400);
 assert.equal((await POST(request({action:'approve',items:[{id},{id}]}))).status,400);
 const response=await POST(request({action:'allocate',items:[{id,expected_version:0,allocated_amount:10},{id:'00000000-0000-0000-0000-000000000031',expected_version:0}]}));const data=await response.json();assert.equal(data.results[0].ok,true);assert.equal(data.results[1].ok,false);assert.equal(called.length,1);assert.ok(called[0].body.remark.includes('Batch'));
});
test('detail request authorization happens before any proof, expense or activity query',async()=>{
 let reads=0;const mocks={...auth,'@/backend/lib/pettyCash/api':{pcRequest:async()=>null},'@/backend/lib/pettyCash/actions':{},'@/backend/lib/supabase/admin':{supabaseAdmin:{from:()=>{reads++;throw Error('Should not read evidence');}}}};
 const {GET}=loadTs('app/api/petty-cash/[id]/route.ts',mocks);const response=await GET(new NextRequest('http://fixture'),{params:Promise.resolve({id})});assert.equal(response.status,404);assert.equal(reads,0);
});
test('private upload rejects spoofed/oversized files and records owned metadata without a public URL',async()=>{
 let writes=0;const inserted=[];
 const database={storage:{from:()=>({upload:async()=>{writes++;return {error:null};}})},from:()=>({insert:async value=>{inserted.push(value);return {error:null};}})};
 const {POST}=loadTs('app/api/petty-cash/upload/route.ts',{...auth,'@/backend/lib/supabase/admin':{supabaseAdmin:database}});
 const upload=(bytes,type,name='receipt.png')=>{const form=new FormData();form.append('file',new File([bytes],name,{type}));return POST(new NextRequest('http://fixture/upload',{method:'POST',body:form}));};
 assert.equal((await upload('This is not a PDF','application/pdf','invoice.pdf')).status,400);
 assert.equal((await upload('%PDF-1.4\nnot really a PDF\n%%EOF','application/pdf','fake.pdf')).status,400);
 assert.equal((await upload(new Uint8Array(16*1024*1024),'image/png')).status,400);
 const png=await sharp({create:{width:16,height:16,channels:3,background:'white'}}).png().toBuffer();assert.equal((await upload(png,'application/pdf')).status,400);
 const response=await upload(png,'image/png');const data=await response.json();assert.equal(response.status,200);assert.ok(data.upload_id);assert.equal(data.url,undefined);assert.equal(writes,1);assert.equal(inserted[0].uploaded_by,user);assert.ok(inserted[0].storage_path.startsWith(`${org}/${user}/`));
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 assert.equal((await upload(pdf,'application/pdf','valid.pdf')).status,200);assert.equal(writes,2);
});
test('tenant and vendor variants are excluded consistently, internal roles and single organization scoping remain allowed',()=>{
 const {pettyCashCaps}=loadTs('frontend/lib/pettyCash/roles.ts');
 for(const role of ['tenant','tenant_user','tenant_admin','super_tenant','vendor','food_vendor','maintenance_vendor','cafeteria_vendor','pantry_vendor','external_vendor'])assert.equal(pettyCashCaps({org_id:org,org_role:role},org).canSee,false,role);
 for(const role of ['mst','staff','hr','hr_head','security','procurement','property_admin','org_admin','org_super_admin','ops_super_admin','accounts','bd_rep','bd_admin'])assert.equal(pettyCashCaps({org_id:org,org_role:role},org).canSee,true,role);
 assert.equal(pettyCashCaps({org_id:org,org_role:'mst'},'other-org').canSee,false);
});
test('detail balance uses cents so fully spent decimal amounts show exact zero',async()=>{
 const data={petty_cash_documents:[],petty_cash_activity:[],petty_cash_expenses:[],petty_cash_wallet_entries:[{kind:'credit',amount:.3},{kind:'debit',amount:.1},{kind:'debit',amount:.2}],petty_cash_settlement_status:null};
 const query=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:()=>Promise.resolve({data:data[table],error:null}),then:resolve=>Promise.resolve({data:data[table],error:null}).then(resolve)};return q;};
 const {GET}=loadTs('app/api/petty-cash/[id]/route.ts',{...auth,'@/backend/lib/pettyCash/api':{pcRequest:async()=>({id})},'@/backend/lib/pettyCash/actions':{},'@/backend/lib/supabase/admin':{supabaseAdmin:{from:query}}});
 const result=await GET(new NextRequest('http://fixture'),{params:Promise.resolve({id})});assert.equal((await result.json()).balance,0);
});

test('request detail exposes credited cash, partial spending and remaining cash from ledger entries',async()=>{
 const data={petty_cash_documents:[],petty_cash_activity:[],petty_cash_expenses:[],petty_cash_wallet_entries:[{kind:'credit',amount:'150.00'},{kind:'debit',amount:'100.00'}],petty_cash_settlement_status:null};
 const query=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:()=>Promise.resolve({data:data[table],error:null}),then:resolve=>Promise.resolve({data:data[table],error:null}).then(resolve)};return q;};
 const {GET}=loadTs('app/api/petty-cash/[id]/route.ts',{...auth,'@/backend/lib/pettyCash/api':{pcRequest:async()=>({id,workflow_version:2,status:'paid',paid_amount:150})},'@/backend/lib/pettyCash/actions':{},'@/backend/lib/supabase/admin':{supabaseAdmin:{from:query}}});
 const response=await GET(new NextRequest('http://fixture'),{params:Promise.resolve({id})});const body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(body.wallet,{received:150,spent:100,returned:0,balance:50});assert.equal(body.balance,50);
});

test('expense history returns dated, owned request/property references and private bill metadata',async()=>{
 const fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url);
  assert.ok(url.pathname.endsWith('/rpc/pc_my_expenses'),'History must use the authorized expense RPC');
  assert.deepEqual(JSON.parse(options.body),{actor:user,org});
  const select=url.searchParams.get('select');
  const expense={id,request_id:id,amount:100,expense_date:'2026-10-03',description:'Travel bill'};
  if(select.includes('request:petty_cash_requests!request_id'))expense.request={id,request_no:'PC-2026-00002'};
  if(select.includes('property:properties!property_id'))expense.property={id:'00000000-0000-0000-0000-000000000003',name:'Property A'};
  if(select.includes('documents:petty_cash_documents!expense_id'))expense.documents=[{id:'00000000-0000-0000-0000-000000000099',file_name:'travel-bill.pdf',file_type:'application/pdf'}];
  return new Response(JSON.stringify([expense]),{status:200,headers:{'Content-Range':'0-0/1'}});
 };
 const database=createClient('http://fixture.supabase.test','fixture-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false}});
 const {GET}=loadTs('app/api/petty-cash/expenses/route.ts',{...auth,'@/backend/lib/supabase/admin':{supabaseAdmin:database}});
 const response=await GET(new NextRequest(`http://fixture/api/petty-cash/expenses?org_id=${org}`));const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.expenses[0].request?.request_no,'PC-2026-00002');assert.equal(body.expenses[0].property?.name,'Property A');assert.equal(body.expenses[0].documents?.[0]?.file_name,'travel-bill.pdf');assert.equal(body.expenses[0].documents[0].file_url,undefined);assert.equal(body.expenses[0].expense_date,'2026-10-03');
});
