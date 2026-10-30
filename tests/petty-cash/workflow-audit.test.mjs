// Petty cash workflow audit, 2026-10-30.
//
// Unlike database.mjs alone, this suite applies EVERY petty cash migration in order
// (2026-10-07 omnichannel, 2026-10-13 UTR + no-proof payout, 2026-10-29 enhancements and
// the 2026-10-30 audit fixes), so it exercises the SQL that production actually runs.
//
// Plain tests cover controls, the bug fixes and the rules agreed on 30 Oct. "POLICY" tests
// record behaviour that is intended today but worth revisiting.
// Bug IDs match docs/testing/petty-cash-workflow-audit-2026-10-30.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setup, id, call } from './database.mjs';
import { loadTs } from './load-ts.mjs';

const LATER_MIGRATIONS = [
    '20261007000001_petty_cash_omnichannel.sql',
    '20261007000002_petty_cash_push_notifications.sql',
    '20261013000001_petty_cash_duplicate_utr_prevention.sql',
    '20261013000002_petty_cash_disbursement_no_proof_required.sql',
    '20261029000001_petty_cash_enhancements.sql',
    '20261030000001_petty_cash_audit_fixes.sql',
    '20261030000002_petty_cash_cancel_after_payout.sql',
];
const istDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const TODAY = istDate();
const NO_BILL = 'Auto rickshaw fare, driver gives no receipt';

// Fixture users (database.mjs): 10 org_super_admin, 11 mst (requester), 12 staff (allocator),
// 13 property_admin (approver), 14 accounts, 15 food_vendor, 16 staff. Property A = id(3), B = id(4).
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
const reload = async (db, r) => (await db.query('select * from petty_cash_requests where id=$1', [r.id])).rows[0];
const expense = (db, r, extra = {}) => call(db, 'pc_expense', [id(11), r.id, { idempotency_key: randomUUID(), amount: 100, description: 'Tea', category: 'Pantry', vendor: 'Chai Point', expense_date: TODAY, payment_mode: 'Cash', no_bill_reason: NO_BILL, ...extra }]);
const billed = async (db, r, extra = {}) => expense(db, r, { documents: [{ upload_id: await upload(db, 11) }], no_bill_reason: undefined, ...extra });
async function funded(db, amount = 5000) {
    let r = await create(db, { amount_requested: amount });
    r = await act(db, 12, r, 'allocate', { allocated_amount: amount });
    r = await act(db, 13, r, 'approve');
    return act(db, 14, r, 'pay', { paid_mode: 'UPI', payment_ref: 'UTR' + randomUUID().slice(0, 8), documents: [{ upload_id: await upload(db, 14) }] });
}
const run = async fn => { const db = await current(); try { await fn(db); } finally { await db.close(); } };

// ---------------------------------------------------------------- working controls

test('happy path: request, allocate (partial), approve, pay, spend, return, settle, accept, close', () => run(async db => {
    let r = await create(db, { amount_requested: 5000 });
    assert.equal(r.status, 'submitted');
    r = await act(db, 12, r, 'allocate', { allocated_amount: 4000, remark: 'Trim to monthly norm' });
    assert.equal(r.status, 'pending_approval');
    r = await act(db, 13, r, 'approve');
    assert.equal(Number(r.approved_amount), 4000);
    r = await act(db, 14, r, 'pay', { paid_mode: 'Cash', documents: [] });
    assert.equal(r.status, 'paid');
    const e1 = await billed(db, r, { amount: 1200 });
    const e2 = await expense(db, r, { amount: 300, vendor: 'Stationery Mart' });
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), r.id])), 2500);
    r = await act(db, 14, await reload(db, r), 'return', { amount_returned: 2500, remark: 'Unused cash received at front desk' });
    r = await act(db, 11, await reload(db, r), 'settle', { remark: 'All spent or returned' });
    assert.equal(r.status, 'settlement_submitted');
    for (const e of [e1, e2]) await call(db, 'pc_review_expense', [id(14), e.id, 'accepted', '']);
    r = await act(db, 14, await reload(db, r), 'close', { remark: 'Reconciled' });
    assert.equal(r.status, 'closed');
    assert.ok(Number((await db.query("select count(*) n from event_outbox where event_type='PETTY_CASH_EXPENSE_RECORDED'")).rows[0].n) === 2);
}));

test('allocation limits: cannot exceed requested, be zero, negative or have 3 decimals', () => run(async db => {
    const r = await create(db, { amount_requested: 1000 });
    for (const bad of [1000.01, 1500, 0, -5, 10.005]) await assert.rejects(act(db, 12, r, 'allocate', { allocated_amount: bad }), /Invalid allocated amount/);
}));

test('approver cannot change the allocated amount; must send back', () => run(async db => {
    let r = await create(db, { amount_requested: 1000 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 800 });
    await assert.rejects(act(db, 13, r, 'approve', { approved_amount: 900 }), /Send back to change amount/);
    await assert.rejects(act(db, 13, r, 'send_back'), /Reason is required/);
    r = await act(db, 13, r, 'send_back', { remark: 'Attach quotation' });
    assert.equal(r.status, 'sent_back');
    assert.equal(r.sent_back_stage, 'approval');
    r = await act(db, 11, r, 'resubmit', { amount_requested: 900, purpose: 'Site pantry with quote' });
    assert.equal(r.status, 'submitted');
    assert.equal(Number(r.amount_requested), 900);
}));

test('wrong actor, stale screen and self action are blocked', () => run(async db => {
    const r = await create(db, { amount_requested: 1000 });
    await assert.rejects(act(db, 13, r, 'allocate', { allocated_amount: 500 }), /Forbidden/); // approver at allocation stage
    await assert.rejects(act(db, 11, r, 'allocate', { allocated_amount: 500 }), /self action/);
    await assert.rejects(act(db, 12, { ...r, version: r.version + 3 }, 'allocate', { allocated_amount: 500 }), /Request changed/);
    await assert.rejects(create(db, {}, 12), /Self allocation or approval is not allowed/);
    await assert.rejects(create(db, {}, 15), /Forbidden/); // food vendor
    await assert.rejects(act(db, 12, r, 'reject'), /Reason is required/);
}));

test('payment validations: accounts only, exact amount, reference for non-cash, no future date, cancel after payout needs a reason', () => run(async db => {
    let r = await create(db, { amount_requested: 1000 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 800 });
    r = await act(db, 13, r, 'approve');
    await assert.rejects(act(db, 16, r, 'pay', { paid_mode: 'Cash' }), /Forbidden/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash', paid_amount: 1000 }), /must equal approved/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'UPI' }), /Payment reference required/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cheque' }), /Payment mode required/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash', payment_date: '2099-01-01' }), /future/);
    r = await act(db, 14, r, 'pay', { paid_mode: 'Cash' });
    assert.equal(Number(r.paid_amount), 800);
    await assert.rejects(act(db, 11, r, 'cancel'), /A reason is required to cancel a paid request/);
}));

test('expense validations: balance, future date, proof above threshold, spend mode, reference', () => run(async db => {
    const r = await funded(db, 2000);
    await assert.rejects(expense(db, r, { amount: 2000.01 }), /insufficient balance/);
    await assert.rejects(expense(db, r, { expense_date: '2099-01-01' }), /valid date/);
    await assert.rejects(expense(db, r, { amount: 501 }), /Proof \/ bill is required for expenses exceeding ₹500/);
    await expense(db, r, { amount: 500 }); // exactly at threshold: no bill needed, reason given
    await assert.rejects(expense(db, r, { spend_mode: 'Personal' }), /Invalid spend mode/);
    await assert.rejects(expense(db, r, { payment_mode: 'UPI', payment_ref: '' }), /Payment details required/);
}));

test('settle and close gates: zero balance to settle, every expense accepted to close, requester cannot close', () => run(async db => {
    let r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 400 });
    await assert.rejects(act(db, 11, await reload(db, r), 'settle'), /Wallet balance must be zero/);
    await assert.rejects(act(db, 14, await reload(db, r), 'return', { amount_returned: 700, remark: 'x' }), /Valid returned amount/);
    await assert.rejects(act(db, 14, await reload(db, r), 'return', { amount_returned: 600 }), /Valid returned amount/); // no remark
    await act(db, 14, await reload(db, r), 'return', { amount_returned: 600, remark: 'Cash back' });
    r = await act(db, 11, await reload(db, r), 'settle');
    await assert.rejects(act(db, 14, r, 'close'), /Accept all proofs/);
    await call(db, 'pc_review_expense', [id(14), e.id, 'accepted', '']);
    await assert.rejects(act(db, 11, await reload(db, r), 'close'), /Forbidden/);
}));

// ---------------------------------------------------------------- rules agreed on 30 Oct

test('RULE: parallel requests stay allowed, even while holding unspent cash', () => run(async db => {
    const first = await funded(db, 5000);
    await expense(db, first, { amount: 100 });
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), first.id])), 4900);
    assert.equal((await create(db, { amount_requested: 3000 })).status, 'submitted');
    assert.equal((await create(db, { amount_requested: 3000 })).status, 'submitted');
}));

test('RULE: bill date cannot be before the request date; same day and later are fine', () => run(async db => {
    const r = await funded(db, 2000);
    await db.query("update petty_cash_requests set created_at=now()-interval '10 days' where id=$1", [r.id]);
    await assert.rejects(expense(db, r, { expense_date: istDate(-11) }), /Bill date cannot be before the request date/);
    await assert.rejects(expense(db, r, { expense_date: '2019-01-01' }), /Bill date cannot be before the request date/);
    await expense(db, r, { expense_date: istDate(-10), amount: 10 });
    await expense(db, r, { expense_date: istDate(-3), amount: 11 });
}));

test('RULE: an expense without a bill needs a reason of at least 10 characters', () => run(async db => {
    const r = await funded(db, 2000);
    await assert.rejects(expense(db, r, { no_bill_reason: undefined }), /Explain why there is no bill/);
    await assert.rejects(expense(db, r, { no_bill_reason: '  NA  ' }), /Explain why there is no bill/);
    const e = await expense(db, r, { amount: 40, no_bill_reason: `  ${NO_BILL}  ` });
    assert.equal(e.no_bill_reason, NO_BILL);
    const withBill = await billed(db, r, { amount: 60, no_bill_reason: 'ignored because a bill is attached' });
    assert.equal(withBill.no_bill_reason, null);
    await assert.rejects(expense(db, r, { amount: 700, no_bill_reason: NO_BILL }), /Proof \/ bill is required/); // reason never replaces a required bill
}));

test('RULE: cancel after payout, nothing spent: pending until accounts confirms the full cash is back', () => run(async db => {
    let r = await funded(db, 1000);
    await assert.rejects(act(db, 14, r, 'cancel', { remark: 'Accounts tries' }), /Forbidden/);
    await assert.rejects(act(db, 10, r, 'cancel', { remark: 'Admin tries' }), /Forbidden/);
    r = await act(db, 11, r, 'cancel', { remark: 'Event postponed' });
    assert.equal(r.status, 'paid');
    assert.equal(r.cancel_reason, 'Event postponed');
    assert.ok(r.cancel_requested_at);
    const logged = (await db.query("select action from petty_cash_activity where request_id=$1 order by created_at desc limit 1", [r.id])).rows[0];
    assert.equal(logged.action, 'cancel_requested');
    await assert.rejects(act(db, 11, r, 'cancel', { remark: 'Again' }), /already requested/);
    await assert.rejects(expense(db, r, { amount: 10 }), /Cancellation requested; no new expenses/);
    await assert.rejects(act(db, 11, r, 'settle'), /Cancellation pending/);
    r = await act(db, 14, r, 'return', { amount_returned: 400, remark: 'First part back' });
    assert.equal(r.status, 'paid'); // still ₹600 out
    r = await act(db, 14, r, 'return', { amount_returned: 600, remark: 'Rest back' });
    assert.equal(r.status, 'cancelled');
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), r.id])), 0);
    assert.equal(await call(db, 'pc_can_read', [id(14), r.id]), true); // accounts still see what they paid out
    assert.equal(Number((await db.query("select count(*) n from event_outbox where event_type='PETTY_CASH_CANCELLED'")).rows[0].n), 0);
    assert.equal((await create(db, { amount_requested: 100 })).status, 'submitted');
}));

test('RULE: cancel after payout is refused once anything is spent; allowed again after the spend is withdrawn', () => run(async db => {
    let r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 100 });
    await assert.rejects(act(db, 11, await reload(db, r), 'cancel', { remark: 'Not needed' }), /already spent/);
    await call(db, 'pc_review_expense', [id(14), e.id, 'rejected', 'Wrong request']);
    await call(db, 'pc_withdraw_expense', [id(11), e.id, 'Logged on the wrong request']);
    r = await act(db, 11, await reload(db, r), 'cancel', { remark: 'Not needed after all' });
    r = await act(db, 14, r, 'return', { amount_returned: 1000, remark: 'All back' });
    assert.equal(r.status, 'cancelled');
}));

test('RULE: cancel before payout is still immediate; after settlement it is refused', () => run(async db => {
    let r = await create(db, { amount_requested: 500 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 500 });
    r = await act(db, 13, r, 'approve');
    assert.equal((await act(db, 11, r, 'cancel')).status, 'cancelled');
    let s = await funded(db, 300);
    await expense(db, s, { amount: 300 });
    s = await act(db, 11, await reload(db, s), 'settle');
    await assert.rejects(act(db, 11, s, 'cancel', { remark: 'Too late' }), /Cannot cancel funded request/);
}));

// The real bulk route, the real actions.ts and the real SQL; only Supabase transport is replaced.
function bulkRoute(db, user, { canDisburse = false } = {}) {
    const asResult = async fn => { try { return { data: await fn(), error: null }; } catch (error) { return { data: null, error }; } };
    const supabaseAdmin = {
        from: () => ({ insert: async row => asResult(() => db.query('insert into petty_cash_uploads(id,organization_id,uploaded_by,storage_path,file_name,file_type) values ($1,$2,$3,$4,$5,$6)', [row.id, row.organization_id, row.uploaded_by, row.storage_path, row.file_name, row.file_type])) }),
        rpc: async (_fn, args) => asResult(() => call(db, 'pc_action', [args.actor, args.rid, args.action, args.body])),
    };
    const access = { user: { id: id(user) }, organizationId: id(1), canDisburse };
    const actions = loadTs('backend/lib/pettyCash/actions.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin } });
    const { POST } = loadTs('app/api/petty-cash/bulk/route.ts', {
        '@/backend/lib/pettyCash/access': { resolvePettyCashAccess: async () => access, isPettyCashAccessError: () => false, readOrgId: () => id(1) },
        '@/backend/lib/pettyCash/api': { isUuid: x => typeof x === 'string' && x.length === 36, pcRequest: async (_a, rid) => (await call(db, 'pc_can_read', [id(user), rid])) ? { id: rid } : null },
        '@/backend/lib/pettyCash/actions': actions,
    });
    return async body => { const response = await POST(new Request('http://fixture/api/petty-cash/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { status: response.status, data: await response.json() }; };
}
async function approved(db, amount, purpose) {
    let r = await create(db, { amount_requested: amount, purpose });
    r = await act(db, 12, r, 'allocate', { allocated_amount: amount });
    return act(db, 13, r, 'approve');
}

test('BULK: allocate and approve several requests with one remark saved on each', () => run(async db => {
    const a = await create(db, { amount_requested: 1000, purpose: 'Pantry' });
    const b = await create(db, { amount_requested: 2000, purpose: 'Repairs' });
    let res = await bulkRoute(db, 12)({ action: 'allocate', remark: 'Within monthly norm', items: [{ id: a.id, expected_version: a.version, allocated_amount: 800 }, { id: b.id, expected_version: b.version, allocated_amount: 2000 }] });
    assert.deepEqual(res.data.results.map(x => x.ok), [true, true]);
    const [ra, rb] = [await reload(db, a), await reload(db, b)];
    assert.equal(Number(ra.allocated_amount), 800);
    assert.match(ra.allocation_remarks, /^Within monthly norm \[Batch /);
    res = await bulkRoute(db, 13)({ action: 'approve', remark: 'OK', items: [ra, rb].map(r => ({ id: r.id, expected_version: r.version })) });
    assert.deepEqual(res.data.results.map(x => x.ok), [true, true]);
    assert.equal((await reload(db, a)).status, 'approved');
}));

test('BULK: pay several requests by UPI with a UTR per row; a row without a UTR fails alone; no proof needed', () => run(async db => {
    await db.query(`insert into organization_memberships(user_id,organization_id,role) values($1,$2,'accounts')`, [id(17), id(1)]);
    const rows = [await approved(db, 100, 'One'), await approved(db, 200, 'Two'), await approved(db, 300, 'Three')];
    const res = await bulkRoute(db, 17, { canDisburse: true })({ action: 'pay', paid_mode: 'UPI', payment_date: TODAY, remark: 'Month-end payout', items: [
        { id: rows[0].id, expected_version: rows[0].version, payment_ref: 'UTR1001' },
        { id: rows[1].id, expected_version: rows[1].version, payment_ref: '' },
        { id: rows[2].id, expected_version: rows[2].version, payment_ref: 'UTR1003' },
    ] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.results.map(x => x.ok), [true, false, true]);
    assert.match(res.data.results[1].error, /Payment reference required/);
    const paid = await reload(db, rows[2]);
    assert.equal(paid.status, 'paid'); assert.equal(paid.paid_mode, 'UPI'); assert.equal(paid.payment_ref, 'UTR1003');
    assert.equal((await reload(db, rows[1])).status, 'approved');
    // One voucher attached per successful payout. (The failed row leaves an unattached voucher upload behind:
    // actions.ts creates it before the database validates the payment.)
    assert.equal(Number((await db.query("select count(*) n from petty_cash_documents where stage='payment_proof' and storage_path like '%disbursement_voucher_%'")).rows[0].n), 2);
}));

test('BULK: pay is refused for non-accounts users, and per row for a request the accountant approved', () => run(async db => {
    const r = await approved(db, 100, 'Pantry');
    assert.equal((await bulkRoute(db, 16)({ action: 'pay', paid_mode: 'Cash', items: [{ id: r.id, expected_version: r.version }] })).status, 403);
    await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(14), [], [], null]);
    let own = await create(db, { amount_requested: 50 });
    own = await act(db, 12, own, 'allocate', { allocated_amount: 50 });
    own = await act(db, 14, own, 'approve');
    const other = await reload(db, r);
    const res = await bulkRoute(db, 14, { canDisburse: true })({ action: 'pay', paid_mode: 'Cash', items: [{ id: own.id, expected_version: own.version }, { id: other.id, expected_version: other.version }] });
    assert.equal(res.data.results[0].ok, false);
    assert.match(res.data.results[0].error, /cannot also disburse/);
    assert.equal(res.data.results[1].ok, true);
}));

test('BULK: reject and send back are not bulk actions; each needs its own reason', () => run(async db => {
    const r = await create(db, { amount_requested: 100 });
    for (const action of ['reject', 'send_back', 'close']) assert.equal((await bulkRoute(db, 12)({ action, remark: 'x', items: [{ id: r.id, expected_version: 0 }] })).status, 400);
}));

// ---------------------------------------------------------------- bug fixes

test('BUG-1 fixed: expenses save and notify with the exact expense identity', () => run(async db => {
    const r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 100 });
    const event = (await db.query("select payload from event_outbox where event_type='PETTY_CASH_EXPENSE_RECORDED'")).rows[0];
    assert.equal(event.payload.expense_id, e.id);
}));

test('BUG-2 fixed: one accountant can disburse many times without uploading proof', () => run(async db => {
    const supabaseAdmin = {
        from: () => ({ insert: async row => { try { await db.query('insert into petty_cash_uploads(id,organization_id,uploaded_by,storage_path,file_name,file_type) values ($1,$2,$3,$4,$5,$6)', [row.id, row.organization_id, row.uploaded_by, row.storage_path, row.file_name, row.file_type]); return { error: null }; } catch (error) { return { error }; } } }),
        rpc: async (_fn, args) => { try { return { data: await call(db, 'pc_action', [args.actor, args.rid, args.action, args.body]), error: null }; } catch (error) { return { data: null, error }; } },
    };
    const { applyPettyCashAction } = loadTs('backend/lib/pettyCash/actions.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin } });
    const access = { user: { id: id(14) }, organizationId: id(1) };
    for (let i = 0; i < 3; i++) {
        let r = await call(db, 'pc_create_request', [id(11), id(1), { amount_requested: 100, purpose: 'Payout ' + i, property_id: id(3) }]);
        r = await act(db, 12, r, 'allocate', { allocated_amount: 100 });
        r = await act(db, 13, r, 'approve');
        // WorkflowRequestDetail always sends documents: proofs (empty array when nothing attached).
        const { error } = await applyPettyCashAction(access, r.id, 'pay', { expected_version: r.version, paid_mode: 'Cash', documents: [] });
        assert.equal(error, null, `payout ${i + 1}: ${error?.message}`);
    }
}));

test('BUG-2 fixed: a failed voucher insert stops the payout instead of pointing at a missing file', async () => {
    let rpcCalled = false;
    const supabaseAdmin = { from: () => ({ insert: async () => ({ error: { message: 'storage down' } }) }), rpc: async () => { rpcCalled = true; return { data: null, error: null }; } };
    const { applyPettyCashAction } = loadTs('backend/lib/pettyCash/actions.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin } });
    const { error } = await applyPettyCashAction({ user: { id: id(14) }, organizationId: id(1) }, id(50), 'pay', { paid_mode: 'Cash' });
    assert.equal(error.message, 'storage down');
    assert.equal(rpcCalled, false);
});

test('BUG-3 fixed: an old read-only reimbursement does not block new requests', () => run(async db => {
    await db.query(`insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,paid_amount,paid_at,workflow_version) values($1,$2,$3,'reimbursement',800,'Old reimbursement','paid',800,now()-interval '60 days',1)`, [id(1), id(3), id(11)]);
    assert.equal((await create(db)).status, 'submitted');
}));

test('BUG-3 guard: an unreconciled old ADVANCE still blocks new requests', () => run(async db => {
    await db.query(`insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,paid_amount,paid_at,workflow_version) values($1,$2,$3,'advance',800,'Old advance','paid',800,now()-interval '60 days',1)`, [id(1), id(3), id(11)]);
    await assert.rejects(create(db), /Reconcile existing advance balance/);
}));

test('BUG-4 fixed: a rejected expense is withdrawn, cash recovered, request closed and new requests allowed', () => run(async db => {
    let r = await funded(db, 1000);
    const good = await expense(db, r, { amount: 200 });
    const bad = await expense(db, r, { amount: 300, vendor: 'Mall' });
    await call(db, 'pc_review_expense', [id(14), bad.id, 'rejected', 'Personal purchase, not claimable']);
    await assert.rejects(create(db, { amount_requested: 100 }), /Resolve rejected expense proofs/);
    await assert.rejects(call(db, 'pc_withdraw_expense', [id(11), bad.id, '  ']), /reason is required/);
    const withdrawn = await call(db, 'pc_withdraw_expense', [id(11), bad.id, 'Agreed, will pay back']);
    assert.equal(withdrawn.review_status, 'withdrawn');
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), r.id])), 800);
    assert.equal(Number((await reload(db, r)).actual_spent), 200);
    const wallet = await call(db, 'pc_wallet', [id(11), id(1)]);
    assert.equal(Number(wallet.spent), 200);
    assert.equal(wallet.can_request, true);
    await act(db, 14, await reload(db, r), 'return', { amount_returned: 800, remark: 'Unspent 500 + recovered 300' });
    r = await act(db, 11, await reload(db, r), 'settle');
    await call(db, 'pc_review_expense', [id(14), good.id, 'accepted', '']);
    r = await act(db, 14, await reload(db, r), 'close', { remark: 'Reconciled' });
    assert.equal(r.status, 'closed');
    assert.equal((await create(db, { amount_requested: 100 })).status, 'submitted');
    const report = await call(db, 'pc_report', [id(10), id(1)]);
    assert.equal(Number(report.rows.find(x => x.id === r.id).spent), 200);
}));

test('BUG-4 guards: only rejected expenses, only the requester or accounts, never reviewed again, once only', () => run(async db => {
    const r = await funded(db, 1000);
    const pending = await expense(db, r, { amount: 100 });
    await assert.rejects(call(db, 'pc_withdraw_expense', [id(11), pending.id, 'Changed my mind']), /Only a rejected expense/);
    await call(db, 'pc_review_expense', [id(14), pending.id, 'rejected', 'No purpose given']);
    await assert.rejects(call(db, 'pc_withdraw_expense', [id(16), pending.id, 'Coworker tries']), /Forbidden/);
    await assert.rejects(call(db, 'pc_withdraw_expense', [id(12), pending.id, 'Allocator tries']), /Forbidden/);
    await call(db, 'pc_withdraw_expense', [id(14), pending.id, 'Accounts recovering on behalf']);
    await assert.rejects(call(db, 'pc_withdraw_expense', [id(14), pending.id, 'Again']), /Only a rejected expense/);
    await assert.rejects(call(db, 'pc_review_expense', [id(14), pending.id, 'accepted', '']), /withdrawn expense cannot be reviewed/);
    await assert.rejects(call(db, 'pc_correct_expense', [id(11), pending.id, { documents: [{ upload_id: await upload(db, 11) }] }]), /needs replacement proof/);
}));

test('BUG-5 fixed: duplicate UPI reference gets a clear message', () => run(async db => {
    const r = await funded(db, 1000);
    await billed(db, r, { amount: 20, payment_mode: 'UPI', payment_ref: 'X123456' });
    await assert.rejects(billed(db, r, { amount: 21, payment_mode: 'UPI', payment_ref: 'x123456 ' }), /Duplicate payment reference: x123456 was already claimed/);
}));

test('BUG-5 fixed: a reference freed by a withdrawn expense can be claimed again', () => run(async db => {
    const r = await funded(db, 1000);
    const e = await billed(db, r, { amount: 20, payment_mode: 'UPI', payment_ref: 'X123456' });
    await call(db, 'pc_review_expense', [id(14), e.id, 'rejected', 'Wrong request']);
    await call(db, 'pc_withdraw_expense', [id(11), e.id, 'Logged on the wrong request']);
    await billed(db, r, { amount: 20, payment_mode: 'UPI', payment_ref: 'X123456' });
}));

test('BUG-5b fixed: cash expenses with a placeholder reference ("NA") are not duplicates', () => run(async db => {
    const r = await funded(db, 1000);
    await expense(db, r, { amount: 30, payment_ref: 'NA' });
    await expense(db, r, { amount: 31, payment_ref: 'NA', vendor: 'Auto' });
}));

test('BUG-6 fixed: whoever approved a request cannot also disburse it; another accountant can', () => run(async db => {
    await db.query(`insert into organization_memberships(user_id,organization_id,role) values($1,$2,'accounts')`, [id(17), id(1)]);
    await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(14), [], [], null]);
    let r = await create(db, { amount_requested: 2000 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 2000 });
    r = await act(db, 14, r, 'approve');
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash' }), /cannot also disburse/);
    assert.equal((await act(db, 17, r, 'pay', { paid_mode: 'Cash' })).status, 'paid');
}));

test('BUG-7 fixed: routing refuses a primary listed as its own backup, duplicates and over 25 backups; records backups', () => run(async db => {
    await assert.rejects(call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(12)], [], null]), /distinct eligible primary and backup/);
    await assert.rejects(call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(16), id(16)], [], null]), /distinct eligible primary and backup/);
    await assert.rejects(call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), Array.from({ length: 26 }, (_, i) => id(100 + i)), [], null]), /At most 25/);
    await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(16)], [], 750]);
    assert.equal((await create(db)).assigned_allocator_id, id(12));
    const history = (await db.query('select allocator_backups from petty_cash_configuration_activity order by created_at desc limit 1')).rows[0];
    assert.deepEqual(history.allocator_backups, [id(16)]);
    assert.equal(Number((await db.query('select petty_cash_proof_threshold t from properties where id=$1', [id(3)])).rows[0].t), 750);
}));

const fraudGuard = rows => {
    const builder = () => { const b = { select: () => b, eq: () => b, neq: () => b, not: () => b, order: () => b, limit: async () => ({ data: rows, error: null }) }; return b; };
    return loadTs('backend/lib/pettyCash/fraudDetection.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin: { from: builder } } }).detectDuplicateExpense;
};
const row = extra => ({ id: 'e1', request_id: 'r1', expense_date: '2026-10-20', payment_mode: 'Cash', payment_ref: null, request: { request_no: 'PC-1' }, ...extra });

test('BUG-8 fixed: same fare twice, same shop by two employees and near UPI refs only warn', async () => {
    let result = await fraudGuard([row({ amount: 50, vendor: 'Auto rickshaw' })])({ organizationId: 'o', requestId: 'r1', amount: 50, vendor: 'Auto rickshaw', expenseDate: '2026-10-20', paymentMode: 'Cash' });
    assert.equal(result.isDuplicate, false); assert.match(result.warning, /Possible duplicate/);
    result = await fraudGuard([row({ request_id: 'rX', amount: 200, vendor: 'Chai Point' })])({ organizationId: 'o', requestId: 'r1', amount: 200, vendor: 'Chai Point', expenseDate: '2026-10-20', paymentMode: 'Cash' });
    assert.equal(result.isDuplicate, false); assert.match(result.warning, /Possible duplicate/);
    result = await fraudGuard([row({ request_id: 'rX', amount: 120, vendor: 'Zepto', payment_mode: 'UPI', payment_ref: '428910289418' })])({ organizationId: 'o', requestId: 'r1', amount: 340, vendor: 'Blinkit', expenseDate: '2026-10-21', paymentMode: 'UPI', paymentRef: '428910289419' });
    assert.equal(result.isDuplicate, false); assert.match(result.warning, /nearly identical/);
});

test('BUG-8 guard: an exact UTR still blocks, even when a near match appears earlier in the list', async () => {
    const detect = fraudGuard([
        row({ id: 'near', payment_mode: 'UPI', payment_ref: '428910289419', amount: 10 }),
        row({ id: 'exact', payment_mode: 'UPI', payment_ref: '428910289418', amount: 20 }),
    ]);
    const result = await detect({ organizationId: 'o', requestId: 'r9', amount: 99, vendor: 'X', expenseDate: '2026-10-22', paymentMode: 'UPI', paymentRef: '4289 1028 9418' });
    assert.equal(result.isDuplicate, true);
    assert.equal(result.matchedExpenseId, 'exact');
});

test('BUG-8 guard: a cash placeholder reference never matches a UPI reference', async () => {
    const detect = fraudGuard([row({ payment_mode: 'Cash', payment_ref: '428910289418', amount: 20 })]);
    const result = await detect({ organizationId: 'o', requestId: 'r9', amount: 99, vendor: 'X', expenseDate: '2026-10-22', paymentMode: 'UPI', paymentRef: '428910289418' });
    assert.equal(result.isDuplicate, false);
});

test('BUG-9 fixed: phone JPEGs with data after the end marker are accepted; non-images are not', () => {
    const { evidenceType } = loadTs('backend/lib/pettyCash/evidence.ts');
    const jpeg = [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 255, 217];
    assert.equal(evidenceType(new Uint8Array(jpeg)), 'image/jpeg');
    assert.equal(evidenceType(new Uint8Array([...jpeg, 83, 69, 70, 84, 0, 0])), 'image/jpeg');
    assert.equal(evidenceType(new TextEncoder().encode('not an image at all')), null);
});

test('wallet totals net out a withdrawn expense', () => {
    const { requestWalletTotals } = loadTs('backend/lib/pettyCash/wallet.ts');
    assert.deepEqual({ ...requestWalletTotals([{ kind: 'credit', amount: '1000' }, { kind: 'debit', amount: '200' }, { kind: 'debit', amount: '300.10' }, { kind: 'reversal', amount: '300.10' }, { kind: 'return', amount: '800' }]) },
        { received: 1000, spent: 200, returned: 800, balance: 0 });
});

// ---------------------------------------------------------------- current policy (intended today, flagged in report)

test('POLICY: no monetary ceiling on a petty cash request (999,999,999,999.99 accepted)', () => run(async db => {
    assert.equal((await create(db, { amount_requested: 999999999999.99 })).status, 'submitted');
}));

test('POLICY: proof threshold is per line, so a ₹900 bill split into 2 × ₹450 needs no bill (reason still required)', () => run(async db => {
    const r = await funded(db, 2000);
    await expense(db, r, { amount: 450, vendor: 'Hardware Store', description: 'Pipe fittings (1/2)' });
    await expense(db, r, { amount: 450, vendor: 'Hardware Store', description: 'Pipe fittings (2/2)' });
}));

test('POLICY: out-of-pocket overspend cannot be recorded (no extra claim path)', () => run(async db => {
    const r = await funded(db, 1000);
    await billed(db, r, { amount: 1000 });
    await assert.rejects(expense(db, r, { amount: 150 }), /insufficient balance/);
}));

test('POLICY: super admin cannot cancel a stuck request; only the requester can', () => run(async db => {
    const r = await create(db, { amount_requested: 1000 });
    await assert.rejects(act(db, 10, r, 'cancel', { remark: 'Duplicate' }), /Forbidden/);
}));

test('POLICY: if the primary allocator leaves, nobody at that property can raise requests until routing is reset', () => run(async db => {
    await db.exec(`update property_memberships set is_active=false where user_id='${id(12)}'`);
    await assert.rejects(create(db, {}, 16), /Property routing is not configured or inactive/);
}));
