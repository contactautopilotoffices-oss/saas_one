import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('membership approval migration preserves active grants and pending state independently of shared profiles', async () => {
    const db = new PGlite();
    try {
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE TABLE users(id text PRIMARY KEY,is_approved boolean,approval_status text);
            CREATE TABLE organization_memberships(user_id text,organization_id text,is_active boolean);
            CREATE TABLE property_memberships(user_id text,property_id text,is_active boolean);
            INSERT INTO users VALUES ('pending',false,'pending'),('approved',true,'approved');
            INSERT INTO organization_memberships VALUES ('pending','o1',false),('pending','o2',false),('approved','o3',true);
            INSERT INTO property_memberships VALUES ('pending','p1',false),('pending','p2',false),('approved','revoked',false);`);
        const migration = await readFile(new URL('../../supabase/migrations/20261005000001_membership_approval_scope.sql', import.meta.url), 'utf8');
        await db.exec(migration);
        assert.deepEqual((await db.query('select approval_status from property_memberships order by property_id')).rows.map(r => r.approval_status), ['pending','pending','inactive']);
        await db.exec("update property_memberships set is_active=true where property_id='p1'; update users set is_approved=true,approval_status='approved' where id='pending'");
        assert.equal((await db.query("select approval_status from property_memberships where property_id='p2'")).rows[0].approval_status, 'pending');
        assert.equal((await db.query("select approval_status from organization_memberships where organization_id='o2'")).rows[0].approval_status, 'pending');
        await db.exec("update property_memberships set is_active=false where property_id='p1'");
        assert.equal((await db.query("select approval_status from property_memberships where property_id='p1'")).rows[0].approval_status, 'inactive');
        await db.exec("update property_memberships set is_active=false,approval_status='rejected' where property_id='p2'");
        assert.equal((await db.query("select approval_status from property_memberships where property_id='p2'")).rows[0].approval_status, 'rejected');
        await db.exec("insert into property_memberships(user_id,property_id,is_active) values ('approved','new-pending',false)");
        assert.equal((await db.query("select approval_status from property_memberships where property_id='new-pending'")).rows[0].approval_status, 'pending');
        assert.equal((await db.query("select is_active from organization_memberships where organization_id='o3'")).rows[0].is_active, true);
        await assert.rejects(db.exec("update property_memberships set approval_status='anything' where property_id='new-pending'"), /check constraint/i);
        // Re-applying the additive SQL must not overwrite reviewed membership states.
        await db.exec(migration);
        assert.equal((await db.query("select approval_status from property_memberships where property_id='p2'")).rows[0].approval_status, 'rejected');
    } finally { await db.close(); }
});
