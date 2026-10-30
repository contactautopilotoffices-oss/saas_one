// Petty cash workflow audit, 2026-10-30.
//
// Unlike database.mjs alone, this suite applies EVERY petty cash migration in order
// (including 2026-10-07 omnichannel, 2026-10-13 UTR + no-proof payout, 2026-10-29
// enhancements), so it exercises the SQL that production actually runs.
//
// Conventions:
//   - plain tests       = controls that work today, or current policy recorded as-is
//   - { todo: 'BUG-n' } = asserts the CORRECT behaviour; currently fails. Reported as
//                         "# TODO" so CI stays green. When a bug is fixed, drop the todo.
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
];

// Fixture users (database.mjs): 10 org_super_admin, 11 mst (requester), 12 staff (allocator),
// 13 property_admin (approver), 14 accounts, 15 food_vendor, 16 staff. Property A = id(3), B = id(4).
async function current({ isolateFromBug1 = false } = {}) {
    const db = await setup();
    await db.exec(`ALTER TABLE users ADD COLUMN phone text;
     CREATE TABLE event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,entity_id uuid,payload jsonb,status text DEFAULT 'pending',retry_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
    for (const file of LATER_MIGRATIONS) await db.exec(await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
    // BUG-1 blocks every expense; tests about later stages drop the trigger so they can reach them.
    if (isolateFromBug1) await db.exec('DROP TRIGGER pc_activity_outbox ON petty_cash_activity');
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
const expense = (db, r, extra = {}) => call(db, 'pc_expense', [id(11), r.id, { idempotency_key: randomUUID(), amount: 100, description: 'Tea', category: 'Pantry', vendor: 'Chai Point', expense_date: '2026-10-20', payment_mode: 'Cash', ...extra }]);
async function funded(db, amount = 5000) {
    let r = await create(db, { amount_requested: amount });
    r = await act(db, 12, r, 'allocate', { allocated_amount: amount });
    r = await act(db, 13, r, 'approve');
    return act(db, 14, r, 'pay', { paid_mode: 'UPI', payment_ref: 'UTR' + randomUUID().slice(0, 8), documents: [{ upload_id: await upload(db, 14) }] });
}
const run = async (opts, fn) => { const db = await current(opts); try { await fn(db); } finally { await db.close(); } };

// ---------------------------------------------------------------- working controls

test('happy path: request, allocate (partial), approve, pay, spend, return, settle, accept, close', () => run({ isolateFromBug1: true }, async db => {
    let r = await create(db, { amount_requested: 5000 });
    assert.equal(r.status, 'submitted');
    r = await act(db, 12, r, 'allocate', { allocated_amount: 4000, remark: 'Trim to monthly norm' });
    assert.equal(r.status, 'pending_approval');
    r = await act(db, 13, r, 'approve');
    assert.equal(Number(r.approved_amount), 4000);
    r = await act(db, 14, r, 'pay', { paid_mode: 'Cash', documents: [] });
    assert.equal(r.status, 'paid');
    const e1 = await expense(db, r, { amount: 1200, documents: [{ upload_id: await upload(db, 11) }] });
    const e2 = await expense(db, r, { amount: 300, vendor: 'Stationery Mart' });
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), r.id])), 2500);
    r = await act(db, 14, await reload(db, r), 'return', { amount_returned: 2500, remark: 'Unused cash received at front desk' });
    r = await act(db, 11, await reload(db, r), 'settle', { remark: 'All spent or returned' });
    assert.equal(r.status, 'settlement_submitted');
    for (const e of [e1, e2]) await call(db, 'pc_review_expense', [id(14), e.id, 'accepted', '']);
    r = await act(db, 14, await reload(db, r), 'close', { remark: 'Reconciled' });
    assert.equal(r.status, 'closed');
}));

test('allocation limits: cannot exceed requested, be zero, negative or have 3 decimals', () => run({}, async db => {
    const r = await create(db, { amount_requested: 1000 });
    for (const bad of [1000.01, 1500, 0, -5, 10.005]) await assert.rejects(act(db, 12, r, 'allocate', { allocated_amount: bad }), /Invalid allocated amount/);
}));

test('approver cannot change the allocated amount; must send back', () => run({}, async db => {
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

test('wrong actor, stale screen and self action are blocked', () => run({}, async db => {
    const r = await create(db, { amount_requested: 1000 });
    await assert.rejects(act(db, 13, r, 'allocate', { allocated_amount: 500 }), /Forbidden/); // approver at allocation stage
    await assert.rejects(act(db, 11, r, 'allocate', { allocated_amount: 500 }), /self action/);
    await assert.rejects(act(db, 12, { ...r, version: r.version + 3 }, 'allocate', { allocated_amount: 500 }), /Request changed/);
    await assert.rejects(create(db, {}, 12), /Self allocation or approval is not allowed/);
    await assert.rejects(create(db, {}, 15), /Forbidden/); // food vendor
    await assert.rejects(act(db, 12, r, 'reject'), /Reason is required/);
}));

test('payment validations: accounts only, exact amount, reference for non-cash, no future date, no cancel after paid', () => run({}, async db => {
    let r = await create(db, { amount_requested: 1000 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 800 });
    r = await act(db, 13, r, 'approve');
    await assert.rejects(act(db, 16, r, 'pay', { paid_mode: 'Cash' }), /Forbidden/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash', paid_amount: 1000 }), /must equal approved/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'UPI' }), /Payment reference required/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cheque' }), /Payment mode required/);
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash', payment_date: '2027-01-01' }), /future/);
    r = await act(db, 14, r, 'pay', { paid_mode: 'Cash' });
    assert.equal(Number(r.paid_amount), 800);
    await assert.rejects(act(db, 11, r, 'cancel'), /Cannot cancel funded request/);
}));

test('expense validations: balance, future date, proof above threshold, spend mode', () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 2000);
    await assert.rejects(expense(db, r, { amount: 2000.01 }), /insufficient balance/);
    await assert.rejects(expense(db, r, { expense_date: '2027-01-01' }), /valid date/);
    await assert.rejects(expense(db, r, { amount: 501 }), /Proof \/ bill is required for expenses exceeding ₹500/);
    await expense(db, r, { amount: 500 }); // exactly at threshold: no bill needed
    await assert.rejects(expense(db, r, { spend_mode: 'Personal' }), /Invalid spend mode/);
    await assert.rejects(expense(db, r, { payment_mode: 'UPI', payment_ref: '' }), /Payment details required/);
}));

test('settle and close gates: zero balance to settle, every expense accepted to close, requester cannot close', () => run({ isolateFromBug1: true }, async db => {
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

// ---------------------------------------------------------------- current policy (works as coded, flagged in report)

test('POLICY: no monetary ceiling on a petty cash request (999,999,999,999.99 accepted)', () => run({}, async db => {
    const r = await create(db, { amount_requested: 999999999999.99 });
    assert.equal(r.status, 'submitted');
}));

test('POLICY: unlimited parallel advances; new request allowed while holding unspent cash', () => run({ isolateFromBug1: true }, async db => {
    const first = await funded(db, 5000);
    await expense(db, first, { amount: 100 });
    assert.equal(Number(await call(db, 'pc_balance', [id(1), id(11), first.id])), 4900);
    const second = await create(db, { amount_requested: 3000 });
    const third = await create(db, { amount_requested: 3000 });
    assert.equal(second.status, 'submitted');
    assert.equal(third.status, 'submitted');
}));

test('POLICY: proof threshold is per line, so a ₹900 bill split into 2 × ₹450 needs no proof', () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 2000);
    await expense(db, r, { amount: 450, vendor: 'Hardware Store', description: 'Pipe fittings (1/2)' });
    await expense(db, r, { amount: 450, vendor: 'Hardware Store', description: 'Pipe fittings (2/2)', expense_date: '2026-10-21' });
}));

test('POLICY: expense date has no lower bound (a 2019 bill is accepted on a 2026 advance)', () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 2000);
    const e = await expense(db, r, { amount: 10, expense_date: '2019-01-01' });
    assert.equal(e.expense_date, '2019-01-01');
}));

test('POLICY: out-of-pocket overspend cannot be recorded (no extra claim path)', () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 1000);
    await expense(db, r, { amount: 1000, documents: [{ upload_id: await upload(db, 11) }] });
    await assert.rejects(expense(db, r, { amount: 150 }), /insufficient balance/);
}));

test('POLICY: super admin cannot cancel a stuck request; only the requester can', () => run({}, async db => {
    const r = await create(db, { amount_requested: 1000 });
    await assert.rejects(act(db, 10, r, 'cancel', { remark: 'Duplicate' }), /Forbidden/);
}));

test('POLICY: if the primary allocator leaves, nobody at that property can raise requests until routing is reset', () => run({}, async db => {
    await db.exec(`update property_memberships set is_active=false where user_id='${id(12)}'`);
    await assert.rejects(create(db, {}, 16), /Property routing is not configured or inactive/);
}));

// ---------------------------------------------------------------- bugs and control gaps (todo = currently failing)

test('BUG-1: recording an expense works with all migrations applied', { todo: 'BUG-1 critical: 2026-10-29 pc_expense dropped metadata.expense_id; omnichannel trigger rejects every expense' }, () => run({}, async db => {
    const r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 100 });
    assert.equal(Number(e.amount), 100);
}));

test('BUG-1 (evidence): the exact failure message users see', () => run({}, async db => {
    const r = await funded(db, 1000);
    await assert.rejects(expense(db, r, { amount: 100 }), /Expense event requires exact expense identity/);
}));

test('BUG-2: one accountant can disburse twice without uploading proof', { todo: 'BUG-2 high: actions.ts voucher storage_path is fixed per user and UNIQUE; 2nd payout fails' }, () => run({}, async db => {
    const supabaseAdmin = {
        from: () => ({ insert: async row => { try { await db.query('insert into petty_cash_uploads(id,organization_id,uploaded_by,storage_path,file_name,file_type) values ($1,$2,$3,$4,$5,$6)', [row.id, row.organization_id, row.uploaded_by, row.storage_path, row.file_name, row.file_type]); return { error: null }; } catch (error) { return { error }; } } }),
        rpc: async (_fn, args) => { try { return { data: await call(db, 'pc_action', [args.actor, args.rid, args.action, args.body]), error: null }; } catch (error) { return { data: null, error }; } },
    };
    const { applyPettyCashAction } = loadTs('backend/lib/pettyCash/actions.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin } });
    const access = { user: { id: id(14) }, organizationId: id(1) };
    for (let i = 0; i < 2; i++) {
        let r = await call(db, 'pc_create_request', [id(11), id(1), { amount_requested: 100, purpose: 'Payout ' + i, property_id: id(3) }]);
        r = await act(db, 12, r, 'allocate', { allocated_amount: 100 });
        r = await act(db, 13, r, 'approve');
        // WorkflowRequestDetail always sends documents: proofs (empty array when nothing attached).
        const { error } = await applyPettyCashAction(access, r.id, 'pay', { expected_version: r.version, paid_mode: 'Cash', documents: [] });
        assert.equal(error, null, `payout ${i + 1}: ${error?.message}`);
    }
}));

test('BUG-3: an old read-only reimbursement does not block new requests', { todo: 'BUG-3 high: 2026-10-29 pc_gate dropped the request_type=advance filter' }, () => run({}, async db => {
    await db.query(`insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,paid_amount,paid_at,workflow_version) values($1,$2,$3,'reimbursement',800,'Old reimbursement','paid',800,now()-interval '60 days',1)`, [id(1), id(3), id(11)]);
    const r = await create(db);
    assert.equal(r.status, 'submitted');
}));

test('BUG-3 (evidence): the reimbursement cannot be closed either, so the block is permanent', () => run({}, async db => {
    await db.query(`insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,paid_amount,paid_at,workflow_version) values($1,$2,$3,'reimbursement',800,'Old reimbursement','paid',800,now()-interval '60 days',1)`, [id(1), id(3), id(11)]);
    await assert.rejects(create(db), /Reconcile existing advance balance/);
    const legacy = (await db.query("select * from petty_cash_requests where request_type='reimbursement'")).rows[0];
    await assert.rejects(act(db, 14, legacy, 'close', { remark: 'Clear it' }), /Historical reimbursements are read-only/);
}));

test('BUG-4: a rejected (non-claimable) expense can be resolved by recovering the cash', { todo: 'BUG-4 high: rejected expense keeps its wallet debit; only fix is new proof + finance accepting it' }, () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 300 });
    await call(db, 'pc_review_expense', [id(14), e.id, 'rejected', 'Personal purchase, not claimable']);
    // Accounts collects the ₹300 back from the employee and should be able to record it.
    await act(db, 14, await reload(db, r), 'return', { amount_returned: 1000, remark: 'Unspent 700 + recovered 300' });
}));

test('BUG-4 (evidence): rejected expense blocks settle, close and every future request', () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 1000);
    const e = await expense(db, r, { amount: 300 });
    await call(db, 'pc_review_expense', [id(14), e.id, 'rejected', 'Personal purchase']);
    await assert.rejects(call(db, 'pc_correct_expense', [id(11), e.id, { amount: 0 }]), /needs replacement proof/);
    await act(db, 14, await reload(db, r), 'return', { amount_returned: 700, remark: 'Unspent' });
    await assert.rejects(act(db, 11, await reload(db, r), 'settle'), /Correct rejected proof/);
    await assert.rejects(create(db, { amount_requested: 100 }), /Resolve rejected expense proofs/);
}));

test('BUG-5: duplicate UPI reference returns a clear message, not a raw constraint error', { todo: 'BUG-5 medium: 2026-10-29 pc_expense dropped the friendly duplicate-UTR check' }, () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 1000);
    await expense(db, r, { amount: 20, payment_mode: 'UPI', payment_ref: 'X123456' });
    await assert.rejects(expense(db, r, { amount: 21, payment_mode: 'UPI', payment_ref: 'x123456 ' }), /Duplicate payment reference/);
}));

test('BUG-5b: cash expenses with a placeholder reference ("NA") are not treated as duplicate UTRs', { todo: 'BUG-5b medium: unique index covers Cash rows too' }, () => run({ isolateFromBug1: true }, async db => {
    const r = await funded(db, 1000);
    await expense(db, r, { amount: 30, payment_ref: 'NA' });
    await expense(db, r, { amount: 31, payment_ref: 'NA', vendor: 'Auto' });
}));

test('BUG-6: separation of duties, the approver of a request cannot also disburse it', { todo: 'BUG-6 medium: an accounts user can be the routed approver and then pay' }, () => run({}, async db => {
    await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(14), [], [], null]);
    let r = await create(db, { amount_requested: 2000 });
    r = await act(db, 12, r, 'allocate', { allocated_amount: 2000 });
    r = await act(db, 14, r, 'approve');
    await assert.rejects(act(db, 14, r, 'pay', { paid_mode: 'Cash' }), /Forbidden/);
}));

test('BUG-7: saving routing with the primary allocator also ticked as a backup keeps the primary', { todo: 'BUG-7 low (API only today): 7-arg pc_set_routing demotes the primary; property stops accepting requests' }, () => run({}, async db => {
    await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(12)], [], null]);
    const r = await create(db);
    assert.equal(r.assigned_allocator_id, id(12));
}));

const fraudGuard = rows => {
    const builder = () => { const b = { select: () => b, eq: () => b, neq: () => b, order: () => b, limit: async () => ({ data: rows, error: null }) }; return b; };
    return loadTs('backend/lib/pettyCash/fraudDetection.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin: { from: builder } } }).detectDuplicateExpense;
};
const row = extra => ({ id: 'e1', request_id: 'r1', expense_date: '2026-10-20', payment_mode: 'Cash', payment_ref: null, request: { request_no: 'PC-1' }, ...extra });

test('BUG-8a: two auto rides at the same fare on the same day are both claimable', { todo: 'BUG-8 medium: fraud guard blocks same amount + date + vendor within a request' }, async () => {
    const detect = fraudGuard([row({ amount: 50, vendor: 'Auto rickshaw' })]);
    assert.equal((await detect({ organizationId: 'o', requestId: 'r1', amount: 50, vendor: 'Auto rickshaw', expenseDate: '2026-10-20', paymentMode: 'Cash' })).isDuplicate, false);
});

test('BUG-8b: two employees buying ₹200 tea at the same shop on the same day are both claimable', { todo: 'BUG-8 medium: fraud guard blocks same amount + date + vendor across the org' }, async () => {
    const detect = fraudGuard([row({ request_id: 'rX', amount: 200, vendor: 'Chai Point', request: { request_no: 'PC-9' } })]);
    assert.equal((await detect({ organizationId: 'o', requestId: 'r1', amount: 200, vendor: 'Chai Point', expenseDate: '2026-10-20', paymentMode: 'Cash' })).isDuplicate, false);
});

test('BUG-8c: a genuinely different UPI reference one digit apart is not flagged as a duplicate', { todo: 'BUG-8 medium: near-match rule (edit distance <= 2) blocks real sequential UPI refs' }, async () => {
    const detect = fraudGuard([row({ request_id: 'rX', amount: 120, vendor: 'Zepto', payment_mode: 'UPI', payment_ref: '428910289418' })]);
    assert.equal((await detect({ organizationId: 'o', requestId: 'r1', amount: 340, vendor: 'Blinkit', expenseDate: '2026-10-21', paymentMode: 'UPI', paymentRef: '428910289419' })).isDuplicate, false);
});

test('BUG-9: phone JPEGs with data after the end marker are accepted as evidence', { todo: 'BUG-9 low: evidenceType requires FFD9 as the very last bytes' }, () => {
    const { evidenceType } = loadTs('backend/lib/pettyCash/evidence.ts');
    const jpeg = [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 255, 217];
    assert.equal(evidenceType(new Uint8Array(jpeg)), 'image/jpeg');
    assert.equal(evidenceType(new Uint8Array([...jpeg, 83, 69, 70, 84, 0, 0])), 'image/jpeg');
});
