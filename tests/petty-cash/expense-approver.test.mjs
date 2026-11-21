// Petty cash: configurable expense approver per property (2026-11-20 migration).
//
// Applies every petty cash migration in order, like workflow-audit.test.mjs, so these tests
// exercise the SQL production runs. Fixture users (database.mjs): 10 org_super_admin,
// 11 mst (requester), 12 staff (allocator), 13 property_admin (approver), 14 accounts,
// 15 food_vendor, 16 staff. Property A = id(3), B = id(4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setup, id, call } from './database.mjs';

const LATER_MIGRATIONS = [
    '20261007000001_petty_cash_omnichannel.sql',
    '20261007000002_petty_cash_push_notifications.sql',
    '20261013000001_petty_cash_duplicate_utr_prevention.sql',
    '20261013000002_petty_cash_disbursement_no_proof_required.sql',
    '20261029000001_petty_cash_enhancements.sql',
    '20261030000001_petty_cash_audit_fixes.sql',
    '20261030000002_petty_cash_cancel_after_payout.sql',
    '20261113000005_petty_cash_chat_proof_no_bill.sql',
    '20261120000001_petty_cash_expense_approver.sql',
];
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const NO_BILL = 'Auto rickshaw fare, driver gives no receipt';

async function current() {
    const db = await setup();
    await db.exec(`ALTER TABLE users ADD COLUMN phone text;
     CREATE TABLE event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,entity_id uuid,payload jsonb,status text DEFAULT 'pending',retry_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
    for (const file of LATER_MIGRATIONS) await db.exec(await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
    return db;
}
const upload = async (db, owner) => {
    const u = randomUUID();
    await db.query('insert into petty_cash_uploads(id,organization_id,uploaded_by,storage_path,file_name,file_type) values ($1,$2,$3,$4,$5,$6)', [u, id(1), id(owner), `${id(1)}/${id(owner)}/${u}.pdf`, 'bill.pdf', 'application/pdf']);
    return u;
};
const act = (db, user, r, kind, extra = {}) => call(db, 'pc_action', [id(user), r.id, kind, { expected_version: r.version, ...extra }]);
const create = (db, extra = {}, user = 11) => call(db, 'pc_create_request', [id(user), id(1), { amount_requested: 5000, purpose: 'Site pantry', property_id: id(3), ...extra }]);
const expense = (db, r, extra = {}, user = 11) => call(db, 'pc_expense', [id(user), r.id, { idempotency_key: randomUUID(), amount: 100, description: 'Tea', category: 'Pantry', vendor: 'Chai Point', expense_date: TODAY, payment_mode: 'Cash', no_bill_reason: NO_BILL, ...extra }]);
async function funded(db, amount = 5000) {
    let r = await create(db, { amount_requested: amount });
    r = await act(db, 12, r, 'allocate', { allocated_amount: amount });
    r = await act(db, 13, r, 'approve');
    return act(db, 14, r, 'pay', { paid_mode: 'UPI', payment_ref: 'UTR' + randomUUID().slice(0, 8), documents: [{ upload_id: await upload(db, 14) }] });
}
// Routing with the optional expense-approver stage. 12/13 stay allocator/approver.
const route = (db, { expenseApprover = null, backups = [] } = {}, prop = id(3)) =>
    call(db, 'pc_set_routing', [id(10), prop, id(12), id(13), [], [], null, expenseApprover, backups]);
const run = async fn => { const db = await current(); try { await fn(db); } finally { await db.close(); } };
const expenseRow = async (db, eid) => (await db.query('select * from petty_cash_expenses where id=$1', [eid])).rows[0];
const queue = async (db, user) => (await db.query('select id from pc_expenses_to_review($1,$2)', [id(user), id(1)])).rows.map(row => row.id);

// ---------------------------------------------------------------- configuration

test('routing saves an expense approver, records it in history and clears it again', () => run(async db => {
    const saved = await route(db, { expenseApprover: id(16) });
    assert.equal(saved.expense_approver_id, id(16));
    assert.equal((await db.query("select user_id from petty_cash_property_assignments where property_id=$1 and kind='expense_approver' and is_active and is_primary", [id(3)])).rows[0].user_id, id(16));
    assert.equal((await db.query('select expense_approver_id from petty_cash_configuration_activity order by created_at desc limit 1')).rows[0].expense_approver_id, id(16));

    const cleared = await route(db, { expenseApprover: null });
    assert.equal(cleared.expense_approver_id, null);
    assert.equal((await db.query("select count(*) n from petty_cash_property_assignments where property_id=$1 and kind='expense_approver' and is_active", [id(3)])).rows[0].n, 0);
}));

test('routing rejects an ineligible expense approver and backups without a primary', () => run(async db => {
    // 15 is a food_vendor on this property, so not an eligible internal user.
    await assert.rejects(route(db, { expenseApprover: id(15) }), /eligible internal users/);
    await assert.rejects(route(db, { expenseApprover: null, backups: [id(16)] }), /before adding its backups/);
    await assert.rejects(route(db, { expenseApprover: id(16), backups: [id(16)] }), /distinct eligible primary and backup/);
}));

test('only a super admin can set the expense approver', () => run(async db => {
    await assert.rejects(call(db, 'pc_set_routing', [id(14), id(3), id(12), id(13), [], [], null, id(16), []]), /Forbidden/);
}));

// ---------------------------------------------------------------- routing each expense

test('a new expense is stamped with the property expense approver, and nobody is routed their own spend', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const e = await expense(db, r);
    assert.equal((await expenseRow(db, e.id)).assigned_expense_approver_id, id(16));

    // Route the approver's own spends to nobody: self-review is blocked anyway.
    await route(db, { expenseApprover: id(11) });
    const own = await expense(db, r, { amount: 50, description: 'Milk' });
    assert.equal((await expenseRow(db, own.id)).assigned_expense_approver_id, null);
}));

test('re-routing moves only the expenses still awaiting a decision', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const decided = await expense(db, r, { amount: 120, description: 'Snacks' });
    const waiting = await expense(db, r, { amount: 140, description: 'Water cans' });
    await call(db, 'pc_review_expense', [id(16), decided.id, 'accepted', '']);

    await route(db, { expenseApprover: id(13) });
    assert.equal((await expenseRow(db, waiting.id)).assigned_expense_approver_id, id(13));
    assert.equal((await expenseRow(db, decided.id)).assigned_expense_approver_id, id(16));
    assert.equal((await expenseRow(db, decided.id)).reviewed_by, id(16));
}));

// ---------------------------------------------------------------- review

test('the configured expense approver can approve, and the decision is stamped for reconciliation', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const e = await expense(db, r);
    const reviewed = await call(db, 'pc_review_expense', [id(16), e.id, 'accepted', 'Checked against the chat approval']);
    assert.equal(reviewed.review_status, 'accepted');
    assert.equal(reviewed.reviewed_by, id(16));
    assert.ok(reviewed.reviewed_at);
    const activity = (await db.query("select actor_id,metadata from petty_cash_activity where action='expense_accepted' order by created_at desc limit 1")).rows[0];
    assert.equal(activity.actor_id, id(16));
    assert.equal(activity.metadata.reviewer_role, 'expense_approver');
}));

test('accounts keep reviewing expenses whether or not an expense approver is configured', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const routed = await expense(db, r, { amount: 90, description: 'Sugar' });
    const byAccounts = await call(db, 'pc_review_expense', [id(14), routed.id, 'accepted', '']);
    assert.equal(byAccounts.reviewed_by, id(14));
    assert.equal((await db.query("select metadata from petty_cash_activity where action='expense_accepted' order by created_at desc limit 1")).rows[0].metadata.reviewer_role, 'accounts');

    await route(db, { expenseApprover: null });
    const unrouted = await expense(db, r, { amount: 80, description: 'Tea leaves' });
    assert.equal((await call(db, 'pc_review_expense', [id(14), unrouted.id, 'accepted', ''])).review_status, 'accepted');
}));

test('a user who is not routed the expense and is not accounts cannot review it', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const e = await expense(db, r);
    // 13 approves cash requests for this property but is not the expense approver.
    await assert.rejects(call(db, 'pc_review_expense', [id(13), e.id, 'accepted', '']), /Forbidden/);
    // The person who spent it can never approve their own expense.
    await assert.rejects(call(db, 'pc_review_expense', [id(11), e.id, 'accepted', '']), /Forbidden/);
}));

test('being the expense approver is scoped to the property it was configured on', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const scoped = async prop => (await db.query('select pc_expense_approver($1,$2,$3) ok', [id(16), id(1), prop])).rows[0].ok;
    assert.equal(await scoped(id(3)), true);
    assert.equal(await scoped(id(4)), false);
    // Clearing the stage on the property takes the right away again.
    await route(db, { expenseApprover: null });
    assert.equal(await scoped(id(3)), false);
}));

test('rejection still needs a reason, and a withdrawn expense cannot be reviewed', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const e = await expense(db, r);
    await assert.rejects(call(db, 'pc_review_expense', [id(16), e.id, 'rejected', '  ']), /rejection reason required/);
    await call(db, 'pc_review_expense', [id(16), e.id, 'rejected', 'Bill does not match the amount']);
    await call(db, 'pc_withdraw_expense', [id(11), e.id, 'Claiming it on the next advance instead']);
    await assert.rejects(call(db, 'pc_review_expense', [id(16), e.id, 'accepted', '']), /withdrawn expense cannot be reviewed/);
}));

// ---------------------------------------------------------------- queues

test('the queue and the pending count show each person only what is theirs to decide', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const routed = await expense(db, r, { amount: 110, description: 'Biscuits' });

    assert.deepEqual(await queue(db, 16), [routed.id]);
    assert.equal((await call(db, 'pc_pending_counts', [id(16), id(1)])).expense_approvals, 1);
    // Accounts only own the expenses no approver is configured for.
    assert.deepEqual(await queue(db, 14), []);
    assert.equal((await call(db, 'pc_pending_counts', [id(14), id(1)])).expense_approvals, 0);
    // The requester never reviews their own spend, and an unrelated user sees nothing.
    assert.deepEqual(await queue(db, 11), []);
    assert.deepEqual(await queue(db, 13), []);

    await call(db, 'pc_review_expense', [id(16), routed.id, 'accepted', '']);
    assert.deepEqual(await queue(db, 16), []);
    assert.equal((await call(db, 'pc_pending_counts', [id(16), id(1)])).expense_approvals, 0);
}));

test('with no expense approver configured the queue falls back to accounts, as it works today', () => run(async db => {
    const r = await funded(db);
    const e = await expense(db, r, { amount: 70, description: 'Courier' });
    assert.deepEqual(await queue(db, 14), [e.id]);
    assert.equal((await call(db, 'pc_pending_counts', [id(14), id(1)])).expense_approvals, 1);
}));

test('the expense approver can read the funded request behind the expense, but not a draft', () => run(async db => {
    await route(db, { expenseApprover: id(16) });
    const draft = await create(db, { status: 'draft' });
    assert.equal((await db.query('select pc_can_read($1,$2) ok', [id(16), draft.id])).rows[0].ok, false);
    const r = await funded(db);
    assert.equal((await db.query('select pc_can_read($1,$2) ok', [id(16), r.id])).rows[0].ok, true);
}));

// ---------------------------------------------------------------- grants

test('the new functions are callable only by the service role', () => run(async db => {
    for (const signature of ['public.pc_expense_approver(uuid,uuid,uuid)', 'public.pc_expenses_to_review(uuid,uuid)', 'public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric,uuid,uuid[])']) {
        assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed', ['service_role', signature, 'EXECUTE'])).rows[0].allowed, true, signature);
        assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed', ['authenticated', signature, 'EXECUTE'])).rows[0].allowed, false, signature);
    }
    // The 7-argument routing function is replaced, not left behind as an ambiguous overload.
    assert.equal((await db.query("select to_regprocedure('public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric)') is not null as exists")).rows[0].exists, false);
}));

test('the migration can be applied twice', () => run(async db => {
    const migration = await readFile(new URL('../../supabase/migrations/20261120000001_petty_cash_expense_approver.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await route(db, { expenseApprover: id(16) });
    const r = await funded(db);
    const e = await expense(db, r);
    assert.equal((await expenseRow(db, e.id)).assigned_expense_approver_id, id(16));
}));
