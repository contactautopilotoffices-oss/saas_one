import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * Step 3 migration check. Runs 20261007000001_task_manager_access_control.sql on an isolated in-memory
 * Postgres (PGlite) against minimal stand-ins for the existing tables. Touches no real database.
 */
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIGRATION = new URL('../supabase/migrations/20261007000001_task_manager_access_control.sql', import.meta.url);

async function freshDb() {
    const db = new PGlite();
    await db.exec(`
        CREATE TABLE users(id uuid primary key);
        CREATE TABLE departments(id uuid primary key default gen_random_uuid(), name text unique not null);
        CREATE TABLE employee_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, department_id uuid, task_role text default 'employee', is_active boolean default true);
        INSERT INTO departments(id, name) VALUES ('${uuid(1)}','Tech'), ('${uuid(2)}','Procurement');
        INSERT INTO users(id) VALUES ('${uuid(11)}'),('${uuid(12)}'),('${uuid(13)}'),('${uuid(14)}'),('${uuid(15)}');
        INSERT INTO employee_profiles(user_id, department_id, task_role, is_active) VALUES
            ('${uuid(11)}','${uuid(1)}','reporting_manager',true),   -- Tech manager
            ('${uuid(12)}','${uuid(1)}','employee',true),            -- Tech employee
            ('${uuid(12)}','${uuid(1)}','employee',true),            -- duplicate profile for the same user
            ('${uuid(13)}','${uuid(1)}','employee',false),           -- inactive Tech employee
            ('${uuid(14)}','${uuid(2)}','employee',true),            -- Procurement
            (NULL,'${uuid(1)}','employee',true);                     -- Tech profile with no user account
    `);
    return db;
}

test('migration creates both tables and seeds ONLY the active, linked Tech team', async () => {
    const db = await freshDb();
    await db.exec(await readFile(MIGRATION, 'utf8'));

    const depts = (await db.query(`SELECT d.name, s.enabled FROM task_manager_department_settings s JOIN departments d ON d.id = s.department_id`)).rows;
    assert.deepEqual(depts, [{ name: 'Tech', enabled: true }], 'only Tech is switched ON');

    const onboarded = (await db.query(`SELECT user_id::text AS u, kickoff_type, source FROM task_manager_onboarding ORDER BY user_id`)).rows;
    assert.deepEqual(onboarded, [
        { u: uuid(11), kickoff_type: 'manager', source: 'backfill' },
        { u: uuid(12), kickoff_type: 'employee', source: 'backfill' },
    ], 'Tech manager + Tech employee only; not inactive, not Procurement, not the unlinked profile');

    const procurement = (await db.query(`SELECT 1 FROM task_manager_onboarding WHERE user_id = '${uuid(14)}'`)).rows;
    assert.equal(procurement.length, 0, 'Procurement stays NOT onboarded');
});

test('migration is safe to re-run and never overwrites later changes', async () => {
    const db = await freshDb();
    const sql = await readFile(MIGRATION, 'utf8');
    await db.exec(sql);

    // An admin switches Tech OFF and removes a Tech kickoff record.
    await db.exec(`UPDATE task_manager_department_settings SET enabled = false`);
    await db.exec(`DELETE FROM task_manager_onboarding WHERE user_id = '${uuid(12)}'`);

    await db.exec(sql); // run again
    const enabled = (await db.query(`SELECT enabled FROM task_manager_department_settings`)).rows;
    assert.deepEqual(enabled, [{ enabled: false }], 're-run keeps the admin choice (does not flip Tech back ON)');
    // The deleted record is re-seeded by design only if missing; the manager row is untouched.
    const count = (await db.query(`SELECT count(*)::int AS n FROM task_manager_onboarding`)).rows[0].n;
    assert.equal(count, 2);
});

test('constraints reject bad values and RLS is enabled with no public policies', async () => {
    const db = await freshDb();
    await db.exec(await readFile(MIGRATION, 'utf8'));

    await assert.rejects(
        db.exec(`INSERT INTO task_manager_onboarding(user_id, source) VALUES ('${uuid(15)}', 'telepathy')`),
        /check/i,
        'unknown source is rejected'
    );
    await assert.rejects(
        db.exec(`INSERT INTO task_manager_onboarding(user_id, source, kickoff_type) VALUES ('${uuid(15)}', 'manual', 'boss')`),
        /check/i,
        'unknown kickoff_type is rejected'
    );

    const rls = (await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('task_manager_department_settings','task_manager_onboarding') ORDER BY relname`)).rows;
    assert.deepEqual(rls.map(r => r.relrowsecurity), [true, true]);
    const policies = (await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('task_manager_department_settings','task_manager_onboarding')`)).rows[0].n;
    assert.equal(policies, 0, 'no policies: only the server (service role) can touch these tables');
});

test('deleting a user or department cleans up (no orphans, no errors)', async () => {
    const db = await freshDb();
    await db.exec(await readFile(MIGRATION, 'utf8'));

    await db.exec(`DELETE FROM employee_profiles WHERE user_id = '${uuid(11)}'`);
    await db.exec(`DELETE FROM users WHERE id = '${uuid(11)}'`);
    const left = (await db.query(`SELECT user_id::text AS u FROM task_manager_onboarding`)).rows.map(r => r.u);
    assert.deepEqual(left, [uuid(12)], 'onboarding row removed with the user');

    await db.exec(`DELETE FROM departments WHERE id = '${uuid(1)}'`);
    const settings = (await db.query(`SELECT count(*)::int AS n FROM task_manager_department_settings`)).rows[0].n;
    assert.equal(settings, 0, 'department setting removed with the department');
});

test('team sharing column: added with a safe default (off), keeps existing rows, safe to re-run', async () => {
    const db = await freshDb();
    await db.exec(await readFile(MIGRATION, 'utf8'));
    const sharing = await readFile(new URL('../supabase/migrations/20261007000002_task_manager_team_sharing.sql', import.meta.url), 'utf8');

    await db.exec(sharing);
    await db.exec(sharing); // re-run

    const tech = (await db.query(`SELECT d.name, s.enabled, s.peer_assign FROM task_manager_department_settings s JOIN departments d ON d.id = s.department_id`)).rows;
    assert.deepEqual(tech, [{ name: 'Tech', enabled: true, peer_assign: false }], 'existing Tech row untouched, sharing OFF by default');

    await db.exec(`INSERT INTO task_manager_department_settings(department_id, peer_assign) VALUES ('${uuid(2)}', true)`);
    const proc = (await db.query(`SELECT enabled, peer_assign FROM task_manager_department_settings WHERE department_id = '${uuid(2)}'`)).rows;
    assert.deepEqual(proc, [{ enabled: false, peer_assign: true }], 'sharing can be ON while the department itself is still OFF');
});

test('notification delegation column: safe default (off), existing rows and sharing untouched, safe to re-run', async () => {
    const db = await freshDb();
    await db.exec(await readFile(MIGRATION, 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261007000002_task_manager_team_sharing.sql', import.meta.url), 'utf8'));
    const delegation = await readFile(new URL('../supabase/migrations/20261007000003_task_manager_notification_delegation.sql', import.meta.url), 'utf8');

    await db.exec(`UPDATE task_manager_department_settings SET peer_assign = true`);
    await db.exec(delegation);
    await db.exec(delegation); // re-run

    const row = (await db.query(`SELECT enabled, peer_assign, notifications_delegated FROM task_manager_department_settings`)).rows;
    assert.deepEqual(row, [{ enabled: true, peer_assign: true, notifications_delegated: false }], 'earlier settings kept; delegation OFF by default');
});
