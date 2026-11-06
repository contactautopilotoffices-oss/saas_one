import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

function load(db) {
    return loadTs('backend/lib/accounts/poApproval.ts', {
        '@/backend/lib/supabase/admin': { supabaseAdmin: db }, '@/backend/services/AiSensyService': { AiSensyService: {} },
        '@/backend/lib/invoices/storage': { ensureInvoiceBucket: async () => undefined, INVOICE_BUCKET: 'invoice-docs' }, './activity': { logPoActivity: async () => undefined },
    });
}
const { formatPoValue, formatPoDate, buildNoticeParams, normalisePhone } = load({});

test('the template values come out exactly as the approved sample shows them', () => {
    assert.equal(formatPoValue(41200), '41,200');
    assert.equal(formatPoValue(147500), '1,47,500', 'Indian grouping');
    assert.equal(formatPoValue(48960.04), '48,960', 'no decimals');
    assert.equal(formatPoValue(393530), '3,93,530');
    assert.equal(formatPoDate('2026-10-22'), '22-10-2026');
    assert.equal(formatPoDate(null), '');
    assert.equal(JSON.stringify(buildNoticeParams({ vendorName: ' RESPECT CHAIRS ', poNumber: 'MH-PO-26/27-0882', poDate: '2026-10-08', poTotal: 147500 })),
        JSON.stringify(['RESPECT CHAIRS', 'MH-PO-26/27-0882', '08-10-2026', '1,47,500']));
});

test('the rupee sign stays in the template, never in the value', () => {
    for (const total of [41200, 99.5, 1234567]) assert.ok(!buildNoticeParams({ vendorName: 'V', poNumber: 'P', poDate: null, poTotal: total })[3].includes('₹'));
});

test('test-number input: 10 digits get 91, spaces and + are ignored, junk is refused', () => {
    assert.equal(normalisePhone('98123 45678'), '919812345678');
    assert.equal(normalisePhone('+91 98123 45678'), '919812345678');
    assert.equal(normalisePhone('919812345678'), '919812345678');
    for (const bad of ['', '12345', 'abc', '98123']) assert.equal(normalisePhone(bad), null, bad);
});

function dbWith(rows) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows }) };
    return { from: () => chain };
}

test('a simulated approval turns "pending" into "approved" and nothing else', async () => {
    const withSim = load(dbWith({ id: 's1' }));
    const noSim = load(dbWith(null));
    assert.equal(await withSim.effectivePoStatus('o', 'p', 'pending_approval'), 'approved');
    assert.equal(await withSim.effectivePoStatus('o', 'p', 'submitted'), 'approved');
    assert.equal(await noSim.effectivePoStatus('o', 'p', 'pending_approval'), 'pending_approval');
    for (const s of ['cancelled', 'draft', 'billed', 'approved', 'rejected']) assert.equal(await withSim.effectivePoStatus('o', 'p', s), s, `a simulation never overrides "${s}"`);
});

test('if the simulation table does not exist yet, the status is left alone', async () => {
    const broken = load({ from: () => { throw new Error('relation does not exist'); } });
    assert.equal(await broken.effectivePoStatus('o', 'p', 'pending_approval'), 'pending_approval');
});

test('only a manual resend while the switch is Live can reach a vendor; simulating never can', () => {
    const { noticeModeFor } = load({});
    assert.equal(noticeModeFor('simulation', 'live'), 'test', 'simulating an approval always goes to the test number');
    assert.equal(noticeModeFor('simulation', 'off'), 'test');
    assert.equal(noticeModeFor('manual', 'live'), 'live');
    assert.equal(noticeModeFor('manual', 'test'), 'test');
    assert.equal(noticeModeFor('manual', 'off'), 'test');
    assert.equal(noticeModeFor('manual', undefined), 'test', 'no setting means test, never live');
});

test('the vendor phone is only ever looked up on the live path', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../backend/lib/accounts/poApproval.ts', import.meta.url), 'utf8');
    const live = src.slice(src.indexOf("if (opts.mode === 'test') {"), src.indexOf('const last4 = phone'));
    assert.match(live, /resolveVendorPhone/);
    assert.ok(live.indexOf('test_phone') < live.indexOf('resolveVendorPhone'), 'test mode reads only the test number');
    assert.equal((src.match(/resolveVendorPhone\(/g) ?? []).length, 2, 'defined once, called once');
});
