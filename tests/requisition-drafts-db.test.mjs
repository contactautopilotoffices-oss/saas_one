import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('drafts are private, access-scoped, separate from submissions and cannot cross organizations', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.user_id', true)::uuid $$;
            CREATE TABLE users(id uuid PRIMARY KEY, is_master_admin boolean DEFAULT false);
            CREATE TABLE organizations(id uuid PRIMARY KEY);
            CREATE TABLE properties(id uuid PRIMARY KEY, organization_id uuid, is_active boolean DEFAULT true, deleted_at timestamptz);
            CREATE TABLE organization_memberships(user_id uuid, organization_id uuid, role text, is_active boolean DEFAULT true);
            CREATE TABLE property_memberships(user_id uuid, property_id uuid, is_active boolean DEFAULT true);
            INSERT INTO users VALUES ('11111111-1111-4111-8111-111111111111',false), ('22222222-2222-4222-8222-222222222222',false);
            INSERT INTO organizations VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
            INSERT INTO properties(id, organization_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
            INSERT INTO property_memberships(user_id,property_id) SELECT id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' FROM users;
        `);
        await db.exec(await readFile(new URL('../supabase/migrations/20261005000001_monthly_requisition_drafts.sql', import.meta.url), 'utf8'));
        await db.exec(`SET ROLE authenticated; SET test.user_id = '11111111-1111-4111-8111-111111111111'`);
        const insert = `INSERT INTO monthly_requisition_drafts(user_id,organization_id,property_id,requisition_month,requisition_year,floor_tag,payload)
            VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc',10,2026,'All Floors','{"items":[]}')`;
        await db.exec(insert);
        assert.equal((await db.query('SELECT * FROM monthly_requisition_drafts')).rows.length, 1);
        const oldRevision = (await db.query('SELECT updated_at FROM monthly_requisition_drafts')).rows[0].updated_at;
        await db.exec(`UPDATE monthly_requisition_drafts SET payload = '{"notes":"newer tab"}', updated_at = now() + interval '1 second'`);
        assert.equal((await db.query('UPDATE monthly_requisition_drafts SET payload = $1 WHERE updated_at = $2 RETURNING id',
            ['{}', oldRevision])).rows.length, 0, 'Stale saves must not overwrite newer edits');
        assert.equal((await db.query('DELETE FROM monthly_requisition_drafts WHERE updated_at = $1 RETURNING id',
            [oldRevision])).rows.length, 0, 'Submission cleanup must not delete a newer draft');
        await db.exec(`SET test.user_id = '22222222-2222-4222-8222-222222222222'`);
        assert.equal((await db.query('SELECT * FROM monthly_requisition_drafts')).rows.length, 0);
        assert.equal((await db.query('DELETE FROM monthly_requisition_drafts RETURNING id')).rows.length, 0);
        await assert.rejects(db.exec(insert), /row-level security/);
        await db.exec(`SET test.user_id = '11111111-1111-4111-8111-111111111111'`);
        await assert.rejects(db.exec(insert.replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')), /row-level security/);
        await db.exec('RESET ROLE; UPDATE property_memberships SET is_active = false');
        await db.exec('SET ROLE authenticated');
        assert.equal((await db.query('SELECT * FROM monthly_requisition_drafts')).rows.length, 0);
        await db.exec('RESET ROLE');
        assert.equal((await db.query("SELECT count(*)::int AS n FROM monthly_requisition_drafts")).rows[0].n, 1);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'monthly_requisition_drafts'::regclass AND NOT tgisinternal")).rows[0].n, 0);
    } finally { await db.close(); }
});
