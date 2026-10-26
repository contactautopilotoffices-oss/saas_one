import test from 'node:test';
import assert from 'node:assert/strict';
import { id, setup, call, create, action, evidence, paid } from './database.mjs';

test('requesting requires an active assigned property even for super admins', async () => {
    const db = await setup();
    try {
        await assert.rejects(call(db, 'pc_create_request', [id(10), id(1), { property_id: id(3), amount_requested: 100, purpose: 'Admin cash' }]), /assigned property|Forbidden property/i);
        await db.query('update property_memberships set is_active=false where user_id=$1', [id(11)]);
        await db.query('insert into organization_memberships(user_id,organization_id,role) values ($1,$2,$3)', [id(11), id(1), 'staff']);
        await assert.rejects(create(db, { property_id: id(3) }), /assigned property|Forbidden property/i);
    } finally { await db.close(); }
});

test('a snapshotted actor who loses property eligibility cannot read a coworkers request', async () => {
    const db = await setup();
    try {
        const r = await create(db);
        await db.query('update property_memberships set is_active=false where user_id=$1 and property_id=$2', [id(12), id(3)]);
        await db.query('insert into property_memberships(user_id,organization_id,property_id,role) values ($1,$2,$3,$4)', [id(12), id(1), id(4), 'staff']);
        assert.equal(await call(db, 'pc_can_read', [id(12), r.id]), false);
    } finally { await db.close(); }
});

test('legacy pending submissions need explicit reassignment before any approval', async () => {
    const db = await setup();
    try {
        const r = (await db.query("insert into petty_cash_requests(organization_id,property_id,requester_id,amount_requested,purpose,status,assigned_approver_id) values ($1,$2,$3,100,'Legacy pending','submitted',$4) returning *", [id(1), id(3), id(11), id(13)])).rows[0];
        await assert.rejects(action(db, 13, r, 'approve'), /reassign|allocation/i);
        const reassigned = await action(db, 10, r, 'reassign');
        assert.equal(reassigned.workflow_version, 2);
        assert.equal(reassigned.status, 'submitted');
    } finally { await db.close(); }
});

test('configured backups see no primary requests and can be explicitly assigned without changing primary routing', async () => {
    const db = await setup();
    try {
        await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(16)], []]);
        let r = await create(db);
        assert.equal(await call(db, 'pc_can_read', [id(16), r.id]), false);
        r = await action(db, 10, r, 'reassign', { reassign_allocator_id: id(16), reassign_approver_id: id(13) });
        assert.equal(r.assigned_allocator_id, id(16));
        assert.equal(await call(db, 'pc_can_read', [id(12), r.id]), false);
        r = await action(db, 16, r, 'allocate', { allocated_amount: 80 });
        assert.equal(r.status, 'pending_approval');
        assert.equal((await db.query("select user_id from petty_cash_property_assignments where property_id=$1 and kind='allocator' and is_active and is_primary", [id(3)])).rows[0].user_id, id(12));
        await assert.rejects(call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(15)], []]), /eligible/i);
        await assert.rejects(call(db, 'pc_set_routing', [id(13), id(3), id(12), id(13), [], []]), /Forbidden/i);
    } finally { await db.close(); }
});

test('sent-back property changes re-resolve primary actors and clear previous allocation', async () => {
    const db = await setup();
    try {
        await db.query('insert into property_memberships(user_id,organization_id,property_id,role) values ($1,$2,$3,$4)', [id(11), id(1), id(4), 'mst']);
        await db.query('insert into organization_memberships(user_id,organization_id,role) values ($1,$2,$3),($4,$2,$3)', [id(16), id(1), 'staff', id(13)]);
        await call(db, 'pc_configure', [id(10), id(4), id(16), id(13)]);
        let r = await create(db, { property_id: id(3) });
        r = await action(db, 12, r, 'allocate', { allocated_amount: 80, remark: 'Earlier allocation' });
        r = await action(db, 13, r, 'send_back', { remark: 'Wrong property' });
        r = await action(db, 11, r, 'resubmit', { property_id: id(4), amount_requested: 70, purpose: 'Corrected property' });
        assert.equal(r.property_id, id(4));
        assert.equal(r.assigned_allocator_id, id(16));
        assert.equal(r.status, 'submitted');
        assert.equal(r.allocated_amount, null);
        assert.equal(r.allocation_remarks, null);
        await assert.rejects(action(db, 12, r, 'allocate', { allocated_amount: 70 }), /Forbidden/i);
    } finally { await db.close(); }
});

test('drafts save without reserving a pipeline; submitting still checks the atomic gate', async () => {
    const db = await setup();
    try {
        const draft = await create(db, { save_draft: true });
        assert.equal(draft.status, 'draft');
        assert.equal((await call(db, 'pc_wallet', [id(11), id(1)])).can_request, true);
        const pending = await create(db);
        await assert.rejects(action(db, 11, draft, 'submit'), /pending request/i);
        await action(db, 11, pending, 'cancel');
        const submitted = await action(db, 11, draft, 'submit', { purpose: 'Updated draft', amount_requested: 60 });
        assert.equal(submitted.status, 'submitted');
        assert.equal(Number(submitted.amount_requested), 60);
        assert.equal(submitted.assigned_allocator_id, id(12));
    } finally { await db.close(); }
});

test('accounts records the external payment date separately from the audit timestamp', async () => {
    const db = await setup();
    try {
        let r = await create(db);
        r = await action(db, 12, r, 'allocate', { allocated_amount: 100 });
        r = await action(db, 13, r, 'approve');
        const proof = await evidence(db, 14);
        await assert.rejects(action(db, 14, r, 'pay', { paid_mode: 'Cash', payment_date: '2099-01-01', documents: [{ upload_id: proof }] }), /date/i);
        r = await action(db, 14, r, 'pay', { paid_mode: 'Cash', payment_date: '2026-10-02', documents: [{ upload_id: proof }] });
        assert.equal(r.payment_date, '2026-10-02');
        assert.ok(r.paid_at);
        assert.equal(Number((await call(db, 'pc_wallet', [id(11), id(1)])).balance), 100);
    } finally { await db.close(); }
});

test('inactive and deleted properties cannot be selected or used to submit a draft', async () => {
    const db = await setup();
    try {
        const draft = await create(db, { save_draft: true });
        await db.query('update properties set deleted_at=now() where id=$1', [id(3)]);
        await assert.rejects(create(db, { property_id: id(3) }), /Forbidden property/i);
        await assert.rejects(action(db, 11, draft, 'submit'), /assigned property/i);
    } finally { await db.close(); }
});

test('routing removal disables backups without changing the snapshots of existing requests', async () => {
    const db = await setup();
    try {
        await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [id(16)], []]);
        let r = await create(db);
        r = await action(db, 10, r, 'reassign', { reassign_allocator_id: id(16) });
        await call(db, 'pc_set_routing', [id(10), id(3), id(12), id(13), [], []]);
        assert.equal((await db.query('select is_active from petty_cash_property_assignments where user_id=$1', [id(16)])).rows[0].is_active, false);
        assert.equal(await call(db, 'pc_can_read', [id(16), r.id]), true);
        const allocated = await action(db, 16, r, 'allocate', { allocated_amount: 80 });
        assert.equal(allocated.status, 'pending_approval');
    } finally { await db.close(); }
});

test('a requester who is also accounts cannot confirm their own cash return', async () => {
    const db = await setup();
    try {
        const r = await paid(db);
        await db.query('insert into organization_memberships(user_id,organization_id,role) values ($1,$2,$3)', [id(11), id(1), 'accounts']);
        await assert.rejects(action(db, 11, r, 'return', { amount_returned: 100, remark: 'Own return' }), /Forbidden/i);
        assert.equal(Number((await call(db, 'pc_wallet', [id(11), id(1)])).balance), 100);
    } finally { await db.close(); }
});

test('historical reimbursements remain read-only and cannot be approved as a new advance', async () => {
    const db = await setup();
    try {
        const r = (await db.query("insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,assigned_approver_id) values ($1,$2,$3,'reimbursement',100,'Historical reimbursement','submitted',$4) returning *", [id(1), id(3), id(11), id(13)])).rows[0];
        await assert.rejects(action(db, 10, r, 'reassign'), /historical|read.only|reimbursement/i);
    } finally { await db.close(); }
});

test('actions reject a selected-organization mismatch even when the actor belongs to both organizations', async () => {
    const db = await setup();
    try {
        const r = await create(db);
        await assert.rejects(action(db, 12, r, 'allocate', { organization_id: id(2), allocated_amount: 100 }), /Forbidden/i);
    } finally { await db.close(); }
});

test('master support reads are logged against the explicitly selected organization', async () => {
    const db = await setup();
    try {
        await db.query('update users set is_master_admin=true where id=$1', [id(19)]);
        await call(db, 'pc_audit_support', [id(19), id(1)]);
        const rows = (await db.query('select actor_id,organization_id from petty_cash_support_access_activity')).rows;
        assert.deepEqual(rows, [{ actor_id: id(19), organization_id: id(1) }]);
        await assert.rejects(call(db, 'pc_audit_support', [id(16), id(1)]), /Forbidden/i);
        await db.exec('SET ROLE authenticated');
        await assert.rejects(call(db, 'pc_audit_support', [id(19), id(1)]), /permission denied/i);
    } finally { await db.close(); }
});

test('consolidated reports include more than 200 authorized requests with exact user identifiers', async () => {
    const db = await setup();
    try {
        await db.query("insert into petty_cash_requests(organization_id,property_id,requester_id,amount_requested,purpose,status) select $1,$2,case when n%2=0 then $3::uuid else $4::uuid end,0.1,'Archived fixture','cancelled' from generate_series(1,250)n", [id(1), id(3), id(11), id(16)]);
        const report = await call(db, 'pc_report', [id(10), id(1)]);
        assert.equal(report.rows.length, 250);
        assert.equal(Number(report.totals.requested), 25);
        assert.equal(new Set(report.rows.map(r => r.requester_id)).size, 2);
        const personal = await call(db, 'pc_report', [id(11), id(1)]);
        assert.equal(personal.rows.length, 125);
        assert.equal(Number(personal.totals.requested), 12.5);
    } finally { await db.close(); }
});

test('read-only historical reimbursements cannot permanently block a new advance', async () => {
    const db = await setup();
    try {
        await db.query("insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status) values ($1,$2,$3,'reimbursement',100,'Historical pending','submitted'),($1,$2,$3,'reimbursement',100,'Historical paid','paid')", [id(1), id(3), id(11)]);
        const wallet = await call(db, 'pc_wallet', [id(11), id(1)]);
        assert.equal(wallet.can_request, true, wallet.blocker);
        assert.equal((await create(db)).status, 'submitted');
    } finally { await db.close(); }
});

test('finance cannot alter historical reimbursement bills', async () => {
    const db = await setup();
    try {
        const r = (await db.query("insert into petty_cash_requests(organization_id,property_id,requester_id,request_type,amount_requested,purpose,status,paid_amount) values ($1,$2,$3,'reimbursement',100,'Historical paid','paid',100) returning *", [id(1), id(3), id(11)])).rows[0];
        const doc = (await db.query("insert into petty_cash_documents(request_id,organization_id,stage,file_url,amount) values ($1,$2,'settlement','historical-receipt.pdf',100) returning *", [r.id, id(1)])).rows[0];
        await assert.rejects(call(db, 'pc_review_bill', [id(14), doc.id, 'accepted', 'Review']), /Forbidden|read.only|reimbursement/i);
        assert.equal((await db.query('select review_status from petty_cash_documents where id=$1', [doc.id])).rows[0].review_status, 'pending');
    } finally { await db.close(); }
});

test('reassignment preserves prior allocation amounts and actors in structured audit history', async () => {
    const db = await setup();
    try {
        let r = await create(db);
        r = await action(db, 12, r, 'allocate', { allocated_amount: 80 });
        await call(db, 'pc_set_routing', [id(10), id(3), id(16), id(13), [], []]);
        r = await action(db, 10, r, 'reassign');
        const event = (await db.query("select * from petty_cash_activity where request_id=$1 and action='reassign'", [r.id])).rows[0];
        assert.equal(Number(event.metadata?.before?.allocated_amount), 80);
        assert.equal(event.metadata.before.allocated_by, id(12));
        assert.equal(event.metadata.after.allocated_amount, null);
        assert.equal(event.metadata.after.assigned_allocator_id, id(16));
        assert.match(event.remark, /Fixture 16/);
    } finally { await db.close(); }
});
