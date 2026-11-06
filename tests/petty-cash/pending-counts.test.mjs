import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,id,call} from './database.mjs';
test('missing pending-count RPC repair installs restricted execution and correct task counts without changing request data',async()=>{
 const db=await setup();try{
  const r=await call(db,'pc_create_request',[id(11),id(1),{amount_requested:150,purpose:'Counts fixture'}]);
  await db.exec('DROP FUNCTION public.pc_pending_counts(uuid,uuid)');assert.equal((await db.query("select to_regprocedure('public.pc_pending_counts(uuid,uuid)') is not null as exists")).rows[0].exists,false);
  const migration=await readFile(new URL('../../supabase/migrations/20261006000001_petty_cash_pending_counts.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query("select has_function_privilege('service_role','public.pc_pending_counts(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,true);assert.equal((await db.query("select has_function_privilege('authenticated','public.pc_pending_counts(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await call(db,'pc_pending_counts',[id(11),id(1)])).mine,1);assert.equal((await call(db,'pc_pending_counts',[id(12),id(1)])).allocations,1);assert.equal((await call(db,'pc_pending_counts',[id(13),id(1)])).approvals,0);await assert.rejects(call(db,'pc_pending_counts',[id(15),id(1)]),/Forbidden/);
  assert.equal((await db.query('select version from petty_cash_requests where id=$1',[r.id])).rows[0].version,r.version);assert.equal((await db.query('select count(*) n from petty_cash_wallet_entries')).rows[0].n,0);
 }finally{await db.close();}
});
