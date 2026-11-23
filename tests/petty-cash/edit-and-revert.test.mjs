import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, id, paid, call } from './database.mjs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const LATER_MIGRATIONS = [
    '20261007000001_petty_cash_omnichannel.sql',
    '20261007000002_petty_cash_push_notifications.sql',
    '20261013000001_petty_cash_duplicate_utr_prevention.sql',
    '20261013000002_petty_cash_disbursement_no_proof_required.sql',
    '20261029000001_petty_cash_enhancements.sql',
    '20261030000001_petty_cash_audit_fixes.sql',
    '20261030000002_petty_cash_cancel_after_payout.sql',
    '20261113000005_petty_cash_chat_proof_no_bill.sql',
    '20261116000001_petty_cash_edit_and_withdraw_pending.sql',
];

async function setupWithNewMigration() {
    const db = await setup();
    await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
     CREATE TABLE IF NOT EXISTS event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,entity_id uuid,payload jsonb,status text DEFAULT 'pending',retry_count int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
    for (const file of LATER_MIGRATIONS) {
        const sql = await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8');
        await db.exec(sql);
    }
    return db;
}

const expense = (db, r, extra = {}) => call(db, 'pc_expense', [id(11), r.id, {
    idempotency_key: randomUUID(),
    amount: 100,
    description: 'Tea',
    category: 'Pantry',
    vendor: 'Chai Point',
    expense_date: new Date().toISOString().slice(0, 10),
    payment_mode: 'Cash',
    no_bill_reason: 'Bill not provided for small tea vendor',
    ...extra
}]);

test('pc_update_expense updates description, category and vendor', async () => {
    const db = await setupWithNewMigration();
    const req = await paid(db);
    // Record an expense within the ₹100 float
    const exp = await expense(db, req, {
        amount: 50,
        description: 'Auto fare to client office',
        category: 'Travel',
        vendor: 'Uber',
        payment_mode: 'UPI',
        payment_ref: 'UPI12345678'
    });

    assert.equal(exp.description, 'Auto fare to client office');
    assert.equal(exp.category, 'Travel');

    // Requester (id 11) updates description and category
    const updated = await call(db, 'pc_update_expense', [id(11), exp.id, {
        description: 'Cab fare to client meeting in Nariman Point',
        category: 'Local Conveyance'
    }]);

    assert.equal(updated.description, 'Cab fare to client meeting in Nariman Point');
    assert.equal(updated.category, 'Local Conveyance');
    assert.equal(updated.vendor, 'Uber');

    // Verify activity record was inserted
    const act = (await db.query(`SELECT * FROM petty_cash_activity WHERE request_id = $1 AND action = 'expense_updated'`, [req.id])).rows;
    assert.equal(act.length, 1);
    assert.equal(act[0].remark, 'Updated description / category');
});

test('pc_withdraw_expense permits reverting a PENDING expense and restores funds', async () => {
    const db = await setupWithNewMigration();
    const req = await paid(db);

    // Record an expense within the ₹100 float
    const exp = await expense(db, req, {
        amount: 40,
        description: 'Wrong transaction',
        category: 'Travel',
        vendor: 'Harsh Patil',
        payment_mode: 'UPI',
        payment_ref: 'UPI87654321'
    });

    assert.equal(exp.review_status, 'pending');

    // Revert pending expense
    const reverted = await call(db, 'pc_withdraw_expense', [id(11), exp.id, 'Uploaded wrong bill by mistake']);
    assert.equal(reverted.review_status, 'withdrawn');

    // Verify wallet entry reversal
    const entries = (await db.query(`SELECT * FROM petty_cash_wallet_entries WHERE expense_id = $1 AND kind = 'reversal'`, [exp.id])).rows;
    assert.equal(entries.length, 1);
    assert.equal(Number(entries[0].amount), 40);

    // Verify actual_spent was recalculated
    const updatedReq = (await db.query(`SELECT * FROM petty_cash_requests WHERE id = $1`, [req.id])).rows[0];
    assert.equal(Number(updatedReq.actual_spent), 0);

    // Verify activity entry
    const act = (await db.query(`SELECT * FROM petty_cash_activity WHERE request_id = $1 AND action = 'expense_withdrawn'`, [req.id])).rows;
    assert.equal(act.length, 1);
    assert.equal(act[0].remark, 'Uploaded wrong bill by mistake');
});

test('pc_withdraw_expense and pc_update_expense enforce authorization and validation', async () => {
    const db = await setupWithNewMigration();
    const req = await paid(db);

    const exp = await expense(db, req, {
        amount: 30,
        description: 'Snacks',
        category: 'Food & Beverages'
    });

    // Coworker (id 16) cannot update or withdraw
    await assert.rejects(
        call(db, 'pc_update_expense', [id(16), exp.id, { description: 'Hacked' }]),
        /Forbidden/
    );
    await assert.rejects(
        call(db, 'pc_withdraw_expense', [id(16), exp.id, 'Unauthorized revert']),
        /Forbidden/
    );

    // Empty remark is rejected
    await assert.rejects(
        call(db, 'pc_withdraw_expense', [id(11), exp.id, '   ']),
        /reason is required/
    );
});
