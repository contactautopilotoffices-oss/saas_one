import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Runs the real migration against a bare Postgres with just enough of the existing
// schema (organizations, users, POs, PO lines, payments) for its foreign keys.
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function setup() {
    const db = new PGlite();
    await db.exec(`
        CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;
        CREATE TABLE organizations(id uuid primary key);
        CREATE TABLE users(id uuid primary key, full_name text);
        CREATE TABLE zoho_purchase_orders(id uuid primary key, organization_id uuid, po_number text, vendor_id text, vendor_name text, status text, po_amount numeric);
        CREATE TABLE zoho_po_line_items(id uuid primary key);
        CREATE TABLE po_payments(id uuid primary key);
        INSERT INTO organizations VALUES ('${id(1)}'),('${id(2)}');
        INSERT INTO users VALUES ('${id(10)}','Purchase'),('${id(11)}','Approver');
        INSERT INTO zoho_purchase_orders VALUES ('${id(100)}','${id(1)}','PO-1','zc-1','Clean Co','approved',10000);
    `);
    const sql = (await readFile(new URL('../../supabase/migrations/20261020000001_invoice_control.sql', import.meta.url), 'utf8'));
    // Supabase installs pgcrypto itself; the stub has gen_random_uuid() built in.
    await db.exec(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    return db;
}

const link = (db, hash = 'h1', expires = "NOW() + interval '1 hour'") =>
    db.query(`INSERT INTO invoice_intake_links(organization_id, po_id, token_hash, created_by, expires_at) VALUES ('${id(1)}','${id(100)}',$1,'${id(10)}', ${expires}) RETURNING id`, [hash]);

const submit = async (db, over = {}) => {
    const a = { hash: 'h1', org: null, po: null, user: null, path: 'p/1.pdf', ref: 'INV-1', idem: null, ...over };
    return (await db.query('SELECT invoice_register_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) r',
        [a.hash, a.org, a.po, a.user, a.path, 'inv.pdf', 'application/pdf', 1000, 'abc', 'INV/81', null, a.ref, a.idem])).rows[0].r;
};

test('AT-005/041: a link accepts exactly one submission; a replay is refused', async () => {
    const db = await setup();
    try {
        await link(db);
        const first = await submit(db);
        assert.equal(first.outcome, 'created');
        assert.equal((await db.query('SELECT status, submission_count FROM invoice_intake_links')).rows[0].status, 'used');
        const again = await submit(db, { path: 'p/2.pdf', ref: 'INV-2' });
        assert.equal(again.outcome, 'unavailable');
        assert.equal((await db.query('SELECT count(*)::int n FROM invoices')).rows[0].n, 1);
        assert.equal((await db.query('SELECT count(*)::int n FROM invoice_documents')).rows[0].n, 1);
    } finally { await db.close(); }
});

test('AT-004: expired, revoked and unknown links all answer the same way, and nothing is created', async () => {
    const db = await setup();
    try {
        await link(db, 'expired', "NOW() - interval '1 minute'");
        await link(db, 'revoked');
        await db.exec("UPDATE invoice_intake_links SET status='revoked' WHERE token_hash='revoked'");
        for (const hash of ['expired', 'revoked', 'nope']) assert.deepEqual({ ...(await submit(db, { hash })) }, { outcome: 'unavailable' });
        assert.equal((await db.query('SELECT count(*)::int n FROM invoices')).rows[0].n, 0);
        assert.equal((await db.query("SELECT status FROM invoice_intake_links WHERE token_hash='expired'")).rows[0].status, 'expired');
    } finally { await db.close(); }
});

test('AT-009: PO and organisation come from the link, never from the caller', async () => {
    const db = await setup();
    try {
        await link(db);
        const r = await submit(db, { org: id(2), po: id(999) });
        assert.equal(r.outcome, 'created');
        const inv = (await db.query('SELECT organization_id, po_id, vendor_key, invoice_number_norm FROM invoices')).rows[0];
        assert.equal(inv.organization_id, id(1));
        assert.equal(inv.po_id, id(100));
        assert.equal(inv.vendor_key, 'zc-1');
        assert.equal(inv.invoice_number_norm, 'INV81');
    } finally { await db.close(); }
});

test('internal upload is recorded with the actor and needs no link; idempotency key replays', async () => {
    const db = await setup();
    try {
        const r = await submit(db, { hash: null, org: id(1), po: id(100), user: id(10), idem: 'k1' });
        assert.equal(r.outcome, 'created');
        const replay = await submit(db, { hash: null, org: id(1), po: id(100), user: id(10), idem: 'k1', path: 'p/x.pdf', ref: 'INV-9' });
        assert.equal(replay.outcome, 'duplicate_request');
        assert.equal(replay.invoice_id, r.invoice_id);
        assert.equal((await db.query('SELECT count(*)::int n FROM invoices')).rows[0].n, 1);
        const ev = (await db.query('SELECT actor_type, actor_user_id FROM invoice_audit_events')).rows[0];
        assert.equal(ev.actor_type, 'user');
        assert.equal(ev.actor_user_id, id(10));
        await assert.rejects(submit(db, { hash: null, org: id(1), po: id(100), user: null, ref: 'INV-8', path: 'p/y.pdf' }), /internal submission needs/);
    } finally { await db.close(); }
});

async function request(db, extra = '') {
    return (await db.query(`INSERT INTO invoice_fast_track_requests(organization_id, po_id, requested_by, requested_amount, urgency_reason, doc_due_at ${extra ? ',' + extra.split('=')[0] : ''})
        VALUES ('${id(1)}','${id(100)}','${id(10)}', 5000, 'critical material', NOW() + interval '7 days' ${extra ? ',' + extra.split('=')[1] : ''}) RETURNING id`)).rows[0].id;
}
const decide = async (db, reqId, approver, decision, amount, reason = 'authorised') =>
    (await db.query('SELECT invoice_fast_track_decide($1,$2,$3,$4,$5,$6,$7) r', [id(1), reqId, approver, decision, amount, reason, 3])).rows[0].r;

test('AT-026/029/030/036: decisions respect the asker, the amount and the state', async () => {
    const db = await setup();
    try {
        const req = await request(db);
        assert.equal((await decide(db, req, id(10), 'approved', 5000)).outcome, 'self_approval');
        assert.equal((await decide(db, req, id(11), 'approved', 6000)).outcome, 'invalid_amount');
        assert.equal((await decide(db, req, id(11), 'approved', null)).outcome, 'invalid_amount');
        assert.equal((await decide(db, req, id(11), 'approved', 5000, ' ')).outcome, 'reason_required');
        assert.equal((await db.query('SELECT count(*)::int n FROM invoice_fast_track_decisions')).rows[0].n, 0, 'a refused decision leaves no trace');

        const ok = await decide(db, req, id(11), 'approved', 4000, 'authorised under policy');
        assert.equal(ok.outcome, 'ok');
        const row = (await db.query('SELECT status, approved_amount, invoice_pending, documentation_state FROM invoice_fast_track_requests')).rows[0];
        assert.equal(row.status, 'approved');
        assert.equal(Number(row.approved_amount), 4000);
        // AT-031: approval never touches the invoice side.
        assert.equal(row.invoice_pending, true);
        assert.equal(row.documentation_state, 'pending');
        // Decided once: a second decision is refused.
        assert.equal((await decide(db, req, id(11), 'rejected', null, 'changed my mind')).outcome, 'invalid_state');

        const other = await request(db);
        assert.equal((await decide(db, other, id(11), 'rejected', null, 'not justified')).outcome, 'ok');
        assert.equal((await db.query('SELECT status FROM invoice_fast_track_requests WHERE id=$1', [other])).rows[0].status, 'rejected');
        const third = await request(db);
        assert.equal((await decide(db, third, id(11), 'needs_information', null, 'send the delivery note')).status, 'needs_information');
        assert.equal((await db.query("SELECT count(*)::int n FROM invoice_audit_events WHERE event_type LIKE 'fast_track_%'")).rows[0].n, 3);
    } finally { await db.close(); }
});

test('AT-047: audit events and decisions cannot be edited or deleted', async () => {
    const db = await setup();
    try {
        const req = await request(db);
        await decide(db, req, id(11), 'approved', 5000);
        await assert.rejects(db.query('DELETE FROM invoice_audit_events'), /append-only/);
        await assert.rejects(db.query("UPDATE invoice_audit_events SET event_type='x'"), /append-only/);
        await assert.rejects(db.query('DELETE FROM invoice_fast_track_decisions'), /append-only/);
        await assert.rejects(db.query('UPDATE invoice_fast_track_decisions SET reason=$1', ['edited']), /append-only/);
    } finally { await db.close(); }
});

test('AT-039/040: RLS is on for every table and the browser roles have no function access', async () => {
    const db = await setup();
    try {
        const tables = (await db.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'invoice%' AND relkind='r'")).rows;
        assert.ok(tables.length >= 9);
        for (const t of tables) assert.equal(t.relrowsecurity, true, `${t.relname} must have RLS on`);
        assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE tablename LIKE 'invoice%'")).rows[0].n, 0, 'no policy means no browser access');
        for (const fn of ['invoice_register_submission', 'invoice_fast_track_decide']) {
            const r = await db.query(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u FROM pg_proc p WHERE proname=$1`, [fn]);
            assert.deepEqual([r.rows[0].a, r.rows[0].u], [false, false], fn);
        }
    } finally { await db.close(); }
});

test('constraints: money is fixed-precision, one submission per link, positive amounts', async () => {
    const db = await setup();
    try {
        const cols = (await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='invoices' AND column_name IN ('invoice_total','taxable_amount','tax_amount')")).rows;
        for (const c of cols) assert.equal(c.data_type, 'numeric');
        await assert.rejects(db.query(`INSERT INTO invoice_fast_track_requests(organization_id,po_id,requested_by,requested_amount,urgency_reason,doc_due_at) VALUES ('${id(1)}','${id(100)}','${id(10)}',0,'x',NOW())`), /check/i);
        await assert.rejects(db.query(`INSERT INTO invoice_intake_links(organization_id,po_id,token_hash,created_by,expires_at,submission_count) VALUES ('${id(1)}','${id(100)}','z','${id(10)}',NOW(),2)`), /check/i);
    } finally { await db.close(); }
});

// --- the PO payment schedule tables (20261020000002) ---------------------------------------
test('schedule tables: one schedule per PO, checks hold, progress log is append-only, RLS on', async () => {
    const db = await setup();
    try {
        await db.exec(await readFile(new URL('../../supabase/migrations/20261020000002_po_payment_schedule.sql', import.meta.url), 'utf8'));
        const sched = (await db.query(`INSERT INTO po_payment_schedules(organization_id, po_id) VALUES ('${id(1)}','${id(100)}') RETURNING id`)).rows[0].id;
        await assert.rejects(db.query(`INSERT INTO po_payment_schedules(organization_id, po_id) VALUES ('${id(1)}','${id(100)}')`), /unique|duplicate/i);

        const ms = (extra = '') => db.query(`INSERT INTO po_payment_milestones(organization_id, schedule_id, po_id, seq, label, percent, amount ${extra ? ',' + extra.split('=')[0] : ''}) VALUES ('${id(1)}','${sched}','${id(100)}', 1, '50% advance', 50, 5000 ${extra ? ',' + extra.split('=')[1] : ''})`);
        await ms();
        await assert.rejects(ms(), /unique|duplicate/i, 'one milestone per position');
        await assert.rejects(db.query(`INSERT INTO po_payment_milestones(organization_id, schedule_id, po_id, seq, label, percent, amount) VALUES ('${id(1)}','${sched}','${id(100)}', 2, 'x', 120, 1)`), /check/i);
        await assert.rejects(db.query(`INSERT INTO po_payment_milestones(organization_id, schedule_id, po_id, seq, label, percent, amount, state) VALUES ('${id(1)}','${sched}','${id(100)}', 3, 'x', 10, 1, 'paid')`), /check/i, 'a milestone is only pending or due; it never becomes "paid" here');

        await db.query(`INSERT INTO po_progress_log(organization_id, po_id, kind, progress_pct, recorded_on) VALUES ('${id(1)}','${id(100)}','progress',25,'2026-10-12')`);
        await assert.rejects(db.query(`INSERT INTO po_progress_log(organization_id, po_id, kind, recorded_on) VALUES ('${id(1)}','${id(100)}','progress','2026-10-12')`), /check/i, 'a progress entry needs its %');
        await assert.rejects(db.query('DELETE FROM po_progress_log'), /append-only/);
        await assert.rejects(db.query('UPDATE po_progress_log SET progress_pct = 90'), /append-only/);

        for (const t of ['po_payment_schedules', 'po_payment_milestones', 'po_progress_log']) {
            assert.equal((await db.query('SELECT relrowsecurity r FROM pg_class WHERE relname=$1', [t])).rows[0].r, true, t);
            assert.equal((await db.query('SELECT count(*)::int n FROM pg_policies WHERE tablename=$1', [t])).rows[0].n, 0);
        }
        // A PO with history cannot be hard-deleted: the cascade would have to erase the
        // append-only log. That is deliberate (the Zoho sync upserts and never deletes POs).
        await assert.rejects(db.exec(`DELETE FROM zoho_purchase_orders WHERE id='${id(100)}'`), /append-only/);
        assert.equal((await db.query('SELECT count(*)::int n FROM po_payment_milestones')).rows[0].n, 1, 'nothing was half-deleted');
    } finally { await db.close(); }
});
