import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

// --- types: PO eligibility ------------------------------------------------------
const { isPoEligible } = loadTs('backend/lib/invoices/types.ts');

test('INV-002: only POs that can take an invoice are eligible; blank is not', () => {
    for (const s of ['approved', 'open', 'billed', 'Issued']) assert.equal(isPoEligible(s), true, s);
    for (const s of ['draft', 'cancelled', 'void', 'rejected', 'pending_approval', '', null, undefined]) assert.equal(isPoEligible(s), false, String(s));
});

// --- links: tokens and the throttle ---------------------------------------------
const links = loadTs('backend/lib/invoices/links.ts');

test('link tokens: 256-bit, URL-safe, only the hash is derivable, malformed tokens rejected early', () => {
    const a = links.newLinkToken(), b = links.newLinkToken();
    assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.token, b.token);
    assert.equal(a.hash, links.hashToken(a.token));
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.ok(!a.hash.includes(a.token));
    assert.equal(links.looksLikeToken(a.token), true);
    for (const bad of ['', 'short', 'x'.repeat(44), `${a.token.slice(0, 42)}!`, null, 42]) assert.equal(links.looksLikeToken(bad), false);
});

test('the throttle slows a burst and does not leak between keys', () => {
    let blocked = 0;
    for (let i = 0; i < 12; i++) if (links.tooManyRequests('t:a', 10, 60_000)) blocked++;
    assert.equal(blocked, 2);
    assert.equal(links.tooManyRequests('t:b', 10, 60_000), false);
});

// --- extraction: the model's JSON is never trusted as-is -------------------------
const { normalise } = loadTs('backend/lib/invoices/extract.ts', {
    '@/backend/lib/documentBank/ocr': {}, '@/backend/lib/ocr/rasterize': {}, '@/backend/lib/ocr/vision': {}, '@/backend/lib/council/llm': {},
});

test('extraction: Indian number formats parse, bad values become null, unreadable fields carry no confidence', () => {
    const x = normalise({
        invoice: { invoice_number: ' INV-81 ', invoice_date: '2026-10-05', vendor_name: 'Clean Co', vendor_gstin: '27aaaaa0000a1z5', taxable_amount: '1,23,456.50', tax_amount: 22222.1, invoice_total: 'abc', currency: 'inr' },
        lines: [{ description: 'Floor cleaner', quantity: '10', unit_rate: 800, confidence: 140 }, { description: '' }, null],
        confidence: { invoice_number: 95, invoice_date: 90, taxable_amount: 85, invoice_total: 99, vendor: 80 },
    });
    assert.equal(x.invoice_number, 'INV-81');
    assert.equal(x.vendor_gstin, '27AAAAA0000A1Z5');
    assert.equal(x.taxable_amount, 123456.5);
    assert.equal(x.invoice_total, null, 'an unparseable total is unknown, never zero');
    assert.equal(x.field_confidence.invoice_total, 0, 'no value, no confidence, whatever the model claimed');
    assert.equal(x.field_confidence.invoice_number, 95);
    assert.equal(x.lines.length, 1);
    assert.equal(x.lines[0].confidence, 1, 'line confidence is clamped');
    assert.equal(x.lines[0].quantity, 10);
});

test('extraction: a GSTIN buried in a label is recovered, a malformed one is not', () => {
    assert.equal(normalise({ invoice: { vendor_gstin: 'GSTIN: 27ENKPS3864M1Z1' } }).vendor_gstin, '27ENKPS3864M1Z1');
    assert.equal(normalise({ invoice: { vendor_gstin: '27 ENKPS 3864 M 1 Z 1' } }).vendor_gstin, '27ENKPS3864M1Z1');
    assert.equal(normalise({ invoice: { vendor_gstin: 'GSTIN not printed' } }).vendor_gstin, null);
});

test('extraction: an invalid date or GSTIN is dropped rather than guessed', () => {
    const x = normalise({ invoice: { invoice_date: '05/10/2026', vendor_gstin: '123', invoice_number: null }, lines: 'nope' });
    assert.equal(x.invoice_date, null);
    assert.equal(x.vendor_gstin, null);
    assert.equal(x.lines.length, 0);
});

// --- who may do what ----------------------------------------------------------------
const settings = { approver_roles: ['org_super_admin', 'master_admin', 'accounts'], escalation_roles: ['org_super_admin', 'master_admin'], approval_limit: 100000 };
const { invoiceCaps } = loadTs('backend/lib/invoices/access.ts', {
    'next/server': { NextResponse: class {} }, '@/backend/lib/accounts/access': {}, './settings': {},
});

test('roles: Purchase asks, Accounts approves and aligns, super admins configure; ops is view-only', () => {
    const purchase = invoiceCaps(['purchase_executive'], false, settings);
    assert.equal(purchase.canRaiseFastTrack, true);
    assert.equal(purchase.canGenerateLink, true);
    assert.equal(purchase.canDecide, false, 'Purchase cannot approve exceptions');
    assert.equal(purchase.canAlign, false, 'Purchase cannot align its own request');
    assert.equal(purchase.canAccept, false);
    assert.equal(purchase.canResolveBlocking, false, 'an executive resolves soft issues only');
    assert.equal(invoiceCaps(['purchase_manager'], false, settings).canResolveBlocking, true);

    const accounts = invoiceCaps(['accounts'], false, settings);
    assert.deepEqual([accounts.canDecide, accounts.canAlign, accounts.canAccept, accounts.canDecideAboveLimit, accounts.canConfigure, accounts.canRaiseFastTrack], [true, true, true, false, false, false]);

    const admin = invoiceCaps(['org_super_admin'], false, settings);
    assert.deepEqual([admin.canDecide, admin.canDecideAboveLimit, admin.canConfigure], [true, true, true]);

    const ops = invoiceCaps(['ops_super_admin'], false, settings);
    assert.ok(Object.values(ops).every((v) => v === false), 'ops_super_admin is view-only');
    assert.equal(invoiceCaps([], true, settings).canConfigure, true, 'master admin');
});

test('roles: the approver list is configurable, not hardcoded', () => {
    const narrow = { ...settings, approver_roles: ['org_super_admin'] };
    assert.equal(invoiceCaps(['accounts'], false, narrow).canDecide, false);
});

// --- the fast-track rules the API enforces before the database does -----------------------
function fakeDb({ request, rpc = { outcome: 'ok', status: 'approved' } }) {
    const calls = { rpc: [] };
    const chain = { select: () => chain, eq: () => chain, in: () => chain, maybeSingle: async () => ({ data: request }) };
    return { calls, db: { from: () => chain, rpc: async (name, args) => { calls.rpc.push([name, args]); return { data: rpc, error: null }; } } };
}
function fastTrack(db) {
    const nothing = async () => undefined;
    return loadTs('backend/lib/invoices/fasttrack.ts', {
        '@/backend/lib/supabase/admin': { supabaseAdmin: db }, '@/backend/lib/accounts/transitions': {}, '@/backend/lib/accounts/activity': { logPoActivity: nothing },
        './audit': { logInvoiceEvent: nothing }, './docState': { syncDocumentationState: nothing }, './submission': {}, './storage': {},
    });
}
const approver = (over = {}) => ({ userId: 'u-approver', orgId: 'o1', roles: ['accounts'], canDecide: true, canDecideAboveLimit: false, settings: { ...settings, policy_version: 4 }, ...over });
const asked = (over = {}) => ({ id: 'r1', requested_by: 'u-purchase', requested_amount: 150000, status: 'pending_approval', ...over });

test('AT-027: someone who is not an approver cannot decide', async () => {
    const { db, calls } = fakeDb({ request: asked() });
    const r = await fastTrack(db).decideFastTrack(approver({ canDecide: false }), 'r1', { decision: 'approved', reason: 'fine' });
    assert.equal(r.status, 403);
    assert.equal(calls.rpc.length, 0);
});

test('AT-026: nobody decides their own request', async () => {
    const { db, calls } = fakeDb({ request: asked({ requested_by: 'u-approver' }) });
    const r = await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'approved', reason: 'fine' });
    assert.equal(r.status, 403);
    assert.equal(calls.rpc.length, 0);
});

test('AT-036: approving more than was asked is refused before the database is touched', async () => {
    const { db, calls } = fakeDb({ request: asked({ requested_amount: 50000 }) });
    const r = await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'approved', approved_amount: 60000, reason: 'fine' });
    assert.equal(r.status, 422);
    assert.equal(calls.rpc.length, 0);
});

test('AT-037: an amount above the approval limit needs an escalation role', async () => {
    const { db, calls } = fakeDb({ request: asked({ requested_amount: 150000 }) });
    const blocked = await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'approved', approved_amount: 150000, reason: 'urgent' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.escalate, true);
    assert.equal(calls.rpc.length, 0);

    // Approving a smaller amount within the limit is fine; so is rejecting any request.
    assert.equal((await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'approved', approved_amount: 90000, reason: 'part now' })).status, 200);
    assert.equal((await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'rejected', reason: 'not justified' })).status, 200);

    const senior = await fastTrack(db).decideFastTrack(approver({ canDecideAboveLimit: true, roles: ['org_super_admin'] }), 'r1', { decision: 'approved', approved_amount: 150000, reason: 'authorised' });
    assert.equal(senior.status, 200);
    const [name, args] = calls.rpc.at(-1);
    assert.equal(name, 'invoice_fast_track_decide');
    assert.equal(args.p_policy_version, 4, 'the decision records the policy version it was made under');
});

test('the database outcomes map to honest HTTP answers', async () => {
    for (const [outcome, status] of [['invalid_state', 409], ['self_approval', 403], ['not_found', 404], ['invalid_amount', 422]]) {
        const { db } = fakeDb({ request: asked({ requested_amount: 1000 }), rpc: { outcome, status: 'approved' } });
        assert.equal((await fastTrack(db).decideFastTrack(approver(), 'r1', { decision: 'approved', approved_amount: 500, reason: 'ok fine' })).status, status, outcome);
    }
});

test('payment_recorded is read from the tracker, never stored', () => {
    const { effectiveStatus } = fastTrack(fakeDb({ request: null }).db);
    assert.equal(effectiveStatus('aligned', { status: 'completed', utr_no: 'UTR1' }), 'payment_recorded');
    assert.equal(effectiveStatus('aligned', { status: 'completed', utr_no: null }), 'aligned');
    assert.equal(effectiveStatus('aligned', { status: 'aligned' }), 'aligned');
    assert.equal(effectiveStatus('approved', { status: 'completed', utr_no: 'X' }), 'approved');
});

// --- documentation: overdue is derived ----------------------------------------------------
const { isDocOverdue } = loadTs('backend/lib/invoices/docState.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin: {} } });

test('AT-038: a missed deadline reads as overdue without touching any status; a settled one never does', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(isDocOverdue('pending', past), true);
    assert.equal(isDocOverdue('link_sent', past), true);
    assert.equal(isDocOverdue('pending', future), false);
    for (const s of ['reconciled', 'closed', 'waived_by_policy']) assert.equal(isDocOverdue(s, past), false, s);
});
