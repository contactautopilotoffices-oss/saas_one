import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('User Management audit columns install repeatably and preserve membership access',async()=>{
 const db=new PGlite();try{
  const actor='11111111-1111-4111-8111-111111111111';
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE property_memberships(user_id uuid,is_active boolean,role text);CREATE TABLE organization_memberships(user_id uuid,is_active boolean,role text);INSERT INTO users VALUES('${actor}');INSERT INTO property_memberships VALUES('${actor}',false,'staff');INSERT INTO organization_memberships VALUES('${actor}',true,'accounts');`);
  await assert.rejects(db.exec('UPDATE property_memberships SET updated_at=now()'),/does not exist/);
  const migration=await readFile(new URL('../../supabase/migrations/20261007000003_user_membership_audit_columns.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query("select count(*) n from information_schema.columns where table_schema='public' and column_name in ('updated_at','updated_by')")).rows[0].n,6);
  await db.query('UPDATE property_memberships SET updated_at=now(),updated_by=$1',[actor]);
  const member=(await db.query('SELECT * FROM property_memberships')).rows[0];assert.equal(member.is_active,false);assert.equal(member.role,'staff');assert.equal(member.updated_by,actor);assert.ok(member.updated_at);
  assert.equal((await db.query('SELECT is_active FROM organization_memberships')).rows[0].is_active,true);
 }finally{await db.close();}
});
