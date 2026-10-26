import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

// A small in-memory stand-in for the database: enough of the query builder for the watcher.
function fakeDb(seed) {
    const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
    class Q {
        constructor(name) { this.name = name; this.fs = []; this.mode = 'select'; this.patch = null; this.opts = {}; this.lim = null; }
        select(_c, opts) { this.opts = opts ?? this.opts; return this; }
        eq(k, v) { this.fs.push((r) => r[k] === v); return this; }
        neq(k, v) { this.fs.push((r) => r[k] !== v); return this; }
        in(k, arr) { this.fs.push((r) => arr.includes(r[k])); return this; }
        lt(k, v) { this.fs.push((r) => r[k] < v); return this; }
        limit(n) { this.lim = n; return this; }
        insert(row) { this.mode = 'insert'; this.patch = row; return this; }
        update(p) { this.mode = 'update'; this.patch = p; return this; }
        upsert(rows, o) { this.mode = 'upsert'; this.patch = rows; this.o = o; return this; }
        rows() { return (tables[this.name] ??= []).filter((r) => this.fs.every((f) => f(r))); }
        run() {
            const t = (tables[this.name] ??= []);
            if (this.mode === 'insert') {
                const dup = this.name === 'po_approval_watch' && t.some((r) => r.organization_id === this.patch.organization_id && r.zoho_po_id === this.patch.zoho_po_id);
                if (dup) return { error: { code: '23505' } };
                t.push({ ...this.patch }); return { error: null };
            }
            if (this.mode === 'upsert') {
                for (const row of this.patch) if (!t.some((r) => r.organization_id === row.organization_id && r.zoho_po_id === row.zoho_po_id)) t.push({ attempts: 0, ...row });
                return { error: null };
            }
            if (this.mode === 'update') { const hit = this.rows(); hit.forEach((r) => Object.assign(r, this.patch)); this.updated = hit; return { error: null, data: hit.map((r) => ({ id: r.id ?? 1 })) }; }
            const rows = this.rows().slice(0, this.lim ?? undefined);
            return { data: rows, count: this.opts.count ? rows.length : undefined, error: null };
        }
        async maybeSingle() { const r = this.run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: null }; }
        then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    }
    return { tables, from: (n) => new Q(n) };
}

function setup({ tables = {}, zoho = {}, sendResult = { ok: true, status: 'sent' } } = {}) {
    const db = fakeDb({ po_notify_settings: [], po_approval_watch: [], po_vendor_notifications: [], zoho_purchase_orders: [], ...tables });
    const sent = [];
    const zohoCalls = [];
    const mod = loadTs('backend/lib/accounts/poApprovalWatch.ts', {
        '@/backend/lib/supabase/admin': { supabaseAdmin: db },
        './poApproval': {
            INVOICE_DUE_HOURS: 48,
            zohoContext: async () => ({ apiDomain: 'x', token: 't', zohoOrgId: 'z' }),
            zohoGet: async (_z, path, params = {}) => {
                zohoCalls.push([path, params]);
                const body = zoho(path, params);
                return { ok: true, status: 200, json: async () => body };
            },
            sendNotice: async (po, opts) => { sent.push({ po, opts }); return typeof sendResult === 'function' ? sendResult(po, opts) : sendResult; },
        },
    });
    return { db, mod, sent, zohoCalls };
}

const ORG = 'org1';
const po = (id, over = {}) => ({ purchaseorder_id: id, purchaseorder_number: `PO-${id}`, status: 'approved', vendor_id: 'v1', vendor_name: 'Vendor', date: '2026-10-23', total: 1000, created_time: '2026-10-10T10:00:00+0530', ...over });
const detailOf = (map) => (path) => {
    const id = decodeURIComponent(path.split('/')[1] ?? '');
    return map[id] ? { purchaseorder: map[id] } : {};
};

test('an approved PO the watcher NEVER saw waiting (and created before the switch) is not messaged', async () => {
    const t = setup({ zoho: detailOf({ A: po('A') }) });
    const r = await t.mod.handleApprovedPo(ORG, {}, 'A', 'live', '2026-10-22T00:00:00Z');
    assert.equal(r, 'skipped');
    assert.equal(t.sent.length, 0, 'the 3,455 old approved POs are safe');
});

test('a PO seen waiting for approval is messaged once when it turns approved, and never twice', async () => {
    const t = setup({ tables: { po_approval_watch: [{ organization_id: ORG, zoho_po_id: 'A', state: 'pending', attempts: 0 }] }, zoho: detailOf({ A: po('A') }) });
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'A', 'live', '2026-10-22T00:00:00Z'), 'notified');
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].opts.mode, 'live');
    assert.equal(t.sent[0].opts.trigger, 'auto');
    const row = t.db.tables.po_approval_watch[0];
    assert.equal(row.state, 'notified');
    assert.ok(row.invoice_due_at && new Date(row.invoice_due_at) > new Date(row.approved_detected_at), 'the 48-hour clock started');
    assert.equal(Math.round((new Date(row.invoice_due_at) - new Date(row.approved_detected_at)) / 3_600_000), 48);
    // The next run, and a webhook arriving a moment later, find it already done.
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'A', 'live', null), 'already');
    assert.equal(t.sent.length, 1);
});

test('a PO created AFTER the switch was turned on is caught even if it was approved before it was ever seen waiting', async () => {
    const t = setup({ zoho: detailOf({ B: po('B', { created_time: '2026-10-23T09:00:00+0000' }) }) });
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'B', 'test', '2026-10-23T08:00:00Z'), 'notified');
    assert.equal(t.sent[0].opts.mode, 'test');
});

test('a PO that is not approved (still pending, cancelled) is never messaged', async () => {
    for (const status of ['pending_approval', 'cancelled', 'rejected', 'draft']) {
        const t = setup({ tables: { po_approval_watch: [{ organization_id: ORG, zoho_po_id: 'C', state: 'pending', attempts: 0 }] }, zoho: detailOf({ C: po('C', { status }) }) });
        assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'C', 'live', null), 'skipped', status);
        assert.equal(t.sent.length, 0);
    }
});

test('two overlapping runs cannot both send: a PO that is being sent is left alone', async () => {
    const t = setup({ tables: { po_approval_watch: [{ organization_id: ORG, zoho_po_id: 'D', state: 'sending', attempts: 1 }] }, zoho: detailOf({ D: po('D') }) });
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'D', 'live', null), 'already');
    assert.equal(t.sent.length, 0);
});

test('a vendor with no WhatsApp number is flagged, not guessed, and not retried automatically', async () => {
    const t = setup({
        tables: { po_approval_watch: [{ organization_id: ORG, zoho_po_id: 'E', state: 'pending', attempts: 0 }] },
        zoho: detailOf({ E: po('E') }), sendResult: { ok: false, status: 'no_phone', error: 'This vendor has no WhatsApp number on file.' },
    });
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'E', 'live', null), 'no_phone');
    const row = t.db.tables.po_approval_watch[0];
    assert.equal(row.state, 'no_phone');
    assert.match(row.note, /no WhatsApp number/);
});

test('a provider failure is retried, but only a few times', async () => {
    const t = setup({ tables: { po_approval_watch: [{ organization_id: ORG, zoho_po_id: 'F', state: 'pending', attempts: 0 }] }, zoho: detailOf({ F: po('F') }), sendResult: { ok: false, status: 'failed', error: 'Campaign does not exist.' } });
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'F', 'live', null), 'failed');
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'F', 'live', null), 'failed');
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'F', 'live', null), 'failed');
    assert.equal(t.sent.length, 3);
    assert.equal(await t.mod.handleApprovedPo(ORG, {}, 'F', 'live', null), 'already', 'after three attempts it stops and waits for a person');
    assert.equal(t.sent.length, 3);
});

test('the run does nothing at all while the switch is Off', async () => {
    const t = setup({ tables: { po_notify_settings: [{ organization_id: ORG, auto_mode: 'off' }] }, zoho: () => { throw new Error('Zoho must not be called'); } });
    const r = await t.mod.runPoApprovalWatch(ORG);
    assert.equal(r.mode, 'off');
    assert.equal(t.zohoCalls.length, 0);
    assert.equal(t.sent.length, 0);
});

test('a run records what is waiting, and an old approved PO in the approved list is still not messaged', async () => {
    const zoho = (path, params) => {
        if (path === 'purchaseorders' && params.status === 'pending_approval') return { purchaseorders: [po('P1', { status: 'pending_approval' })], page_context: { has_more_page: false } };
        if (path === 'purchaseorders' && params.status === 'approved') return { purchaseorders: [po('OLD')], page_context: { has_more_page: false } };
        return detailOf({ OLD: po('OLD'), P1: po('P1', { status: 'pending_approval' }) })(path);
    };
    const t = setup({ tables: { po_notify_settings: [{ organization_id: ORG, auto_mode: 'live', auto_since: '2026-10-23T08:00:00Z', last_run_at: null }] }, zoho });
    const r = await t.mod.runPoApprovalWatch(ORG);
    assert.equal(r.pendingSeen, 1);
    assert.equal(r.notified, 0);
    assert.equal(t.sent.length, 0, 'OLD was approved long ago and was never seen waiting');
    const watch = t.db.tables.po_approval_watch;
    assert.equal(watch.length, 1);
    assert.equal(watch[0].zoho_po_id, 'P1');
    assert.equal(watch[0].state, 'pending');
    assert.ok(t.db.tables.po_notify_settings[0].last_run_at, 'the run is recorded so the screen can show it');
});

test('end to end: the next run notices a watched PO has been approved and messages the vendor', async () => {
    let approved = false;
    const zoho = (path, params) => {
        if (path === 'purchaseorders' && params.status === 'pending_approval') return { purchaseorders: approved ? [] : [po('P1', { status: 'pending_approval' })], page_context: {} };
        if (path === 'purchaseorders' && params.status === 'approved') return { purchaseorders: approved ? [po('P1')] : [], page_context: {} };
        return detailOf({ P1: po('P1', { status: approved ? 'approved' : 'pending_approval' }) })(path);
    };
    const t = setup({ tables: { po_notify_settings: [{ organization_id: ORG, auto_mode: 'live', auto_since: '2026-10-23T08:00:00Z', last_run_at: null }] }, zoho });
    await t.mod.runPoApprovalWatch(ORG);
    assert.equal(t.sent.length, 0);
    approved = true; // the founder approves in Zoho
    const r = await t.mod.runPoApprovalWatch(ORG);
    assert.equal(r.notified, 1);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].po.zohoPoId, 'P1');
    const again = await t.mod.runPoApprovalWatch(ORG);
    assert.equal(again.notified, 0);
    assert.equal(t.sent.length, 1, 'ten minutes later it is not sent again');
});
