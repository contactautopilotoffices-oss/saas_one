import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { defaultSettings, pilotAllowed, settingsSchema } from '../backend/lib/whatsapp/interpreter/config.mjs';
const uid='00000000-0000-4000-8000-000000000001', org='00000000-0000-4000-8000-000000000010';
test('pilot defaults off and rejects arbitrary tools, models and secrets in organization settings',()=>{
    assert.equal(defaultSettings.enabled,false);
    assert.equal(pilotAllowed({...defaultSettings,enabled:true},uid),false);
    assert.equal(pilotAllowed({...defaultSettings,enabled:true,pilotUserIds:[uid]},uid),true);
    for(const extra of [{model:'override'},{apiKey:'secret'},{actions:['task.complete']},{defaultDate:'invent'}]) assert.equal(settingsSchema.safeParse({...defaultSettings,...extra}).success,false);
});
test('old settings remain selected-user only; all-user mode is explicit and respects disable',()=>{
    const old={enabled:true,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',pilotUserIds:[]};
    assert.equal(settingsSchema.parse(old).accessMode,'selected');
    assert.equal(pilotAllowed(old,uid),false);
    assert.equal(pilotAllowed({...old,accessMode:'all'},uid),true);
    assert.equal(pilotAllowed({...old,accessMode:'all',enabled:false},uid),false);
    assert.equal(settingsSchema.safeParse({...old,accessMode:'unknown'}).success,false);
});
test('database restricts settings to active org super admin and hides outgoing reply context',async()=>{
    const db=new PGlite();
    try {
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        CREATE TABLE organizations(id uuid primary key); CREATE TABLE tickets(id uuid primary key); CREATE TABLE users(id uuid primary key,is_approved boolean,approval_status text);
        CREATE TABLE organization_memberships(user_id uuid,organization_id uuid,role text,is_active boolean);
        GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
        GRANT SELECT ON users,organization_memberships TO authenticated;
        INSERT INTO organizations VALUES('${org}'); INSERT INTO users VALUES('${uid}',true,'approved');
        INSERT INTO organization_memberships VALUES('${uid}','${org}','org_super_admin',true);`);
        await db.exec(await readFile(new URL('../supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql',import.meta.url),'utf8'));
        await db.exec(`SET request.jwt.claim.sub='${uid}'; SET ROLE authenticated;`);
        await db.query('INSERT INTO whatsapp_interpreter_settings(organization_id,config) VALUES($1,$2)',[org,defaultSettings]);
        assert.equal((await db.query('SELECT * FROM whatsapp_interpreter_settings')).rows.length,1);
        await assert.rejects(db.query('SELECT * FROM whatsapp_outgoing_context'),/permission denied/);
        await db.exec('RESET ROLE; UPDATE organization_memberships SET is_active=false; SET ROLE authenticated;');
        assert.equal((await db.query('SELECT * FROM whatsapp_interpreter_settings')).rows.length,0);
        await assert.rejects(db.query('INSERT INTO whatsapp_interpreter_settings(organization_id,config) VALUES($1,$2)',[org,defaultSettings]),/row-level security/);
        await db.exec('RESET ROLE;');
        await db.exec(await readFile(new URL('../supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql',import.meta.url),'utf8'));
        assert.equal((await db.query('SELECT * FROM whatsapp_interpreter_settings')).rows.length,1,'reapplying additive migration preserves settings');
    } finally {await db.close();}
});
