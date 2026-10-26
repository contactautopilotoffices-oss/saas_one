import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

const { plainReasons, invoiceStage } = loadTs('backend/lib/invoices/plainReasons.ts');

// The exact rows the engine stored for the three test invoices against DL-PO-26/27-0086.
const row = (o) => ({ severity: 'blocking', outcome: 'fail', ...o });

test('invoice 02 (extra lines): the message says what is wrong, in rupees and in names, not in rule codes', () => {
    const r = plainReasons([
        row({ rule_code: 'PO_ELIGIBLE', actual_value: 'pending_approval', explanation: 'PO status "pending_approval" cannot take an invoice.' }),
        row({ rule_code: 'PO_BALANCE_CHECK', expected_value: 393530, actual_value: 496780, difference_amount: 103250 }),
        row({ rule_code: 'LINE_ITEM_MAPPING', outcome: 'unknown', invoice_line_no: 2, actual_value: 'Floor surface grinding and preparation before IPS application (additional test line; not listed in referenced PO).' }),
        row({ rule_code: 'LINE_ITEM_MAPPING', outcome: 'unknown', invoice_line_no: 3, actual_value: 'Debris collection and disposal after flooring works (additional test line; not listed in referenced PO).' }),
        { rule_code: 'UNIT_RATE_CHECK', outcome: 'pass' },
    ], 'mismatched');
    assert.equal(r.headline, 'Does not match the PO');
    assert.equal(r.reasons.length, 3);
    assert.match(r.reasons[0], /has not been approved yet.*founder/, 'the most decisive reason leads');
    assert.ok(r.reasons.some((x) => x === 'The invoice total ₹4,96,780 is ₹1,03,250 more than what is left on the PO (₹3,93,530).'), r.reasons.join(' | '));
    const lines = r.reasons.find((x) => /lines on the invoice are not on the PO/.test(x));
    assert.match(lines, /2 lines on the invoice are not on the PO: "Floor surface grinding and preparation before IPS application", "Debris collection and disposal after flooring works"\./);
    for (const text of r.reasons) assert.ok(!/_|CHECK|po balance|line item mapping/i.test(text), `no jargon: ${text}`);
    assert.match(r.next, /corrected invoice/);
});

test('invoice 03 (rate): names the line, both rates, and nothing vague', () => {
    const r = plainReasons([
        row({ rule_code: 'UNIT_RATE_CHECK', invoice_line_no: 1, expected_value: 58, actual_value: 62, explanation: 'Line 1 "IPS / Self Leveling Flooring Work": invoiced at 62, PO rate is 58 (+4 per unit).' }),
        row({ rule_code: 'PO_BALANCE_CHECK', expected_value: 393530, actual_value: 409696, difference_amount: 16166 }),
    ], 'mismatched');
    assert.equal(r.reasons[0], 'The invoice total ₹4,09,696 is ₹16,166 more than what is left on the PO (₹3,93,530).');
    assert.equal(r.reasons[1], 'Line 1 (IPS / Self Leveling Flooring Work): the invoice charges ₹62 per unit, but the PO rate is ₹58.');
});

test('a misread GSTIN says it may have been misread, rather than accusing the vendor', () => {
    const r = plainReasons([row({ rule_code: 'VENDOR_MATCH', expected_value: '10AAQCP2643D1ZR', actual_value: '10AACQP2643D1ZR' })], 'mismatched');
    assert.match(r.reasons[0], /10AACQP2643D1ZR.*not this vendor's GSTIN on record \(10AAQCP2643D1ZR\).*misread/);
});

test('quantity, duplicate, total and unreadable-field wording', () => {
    assert.match(plainReasons([row({ rule_code: 'QUANTITY_CHECK', expected_value: 4, actual_value: 5, explanation: '"Chair": 5 billed in total (0 earlier + 5 here) against 4 ordered.' })]).reasons[0], /"Chair": 5 billed in total against 4 ordered on the PO\./);
    assert.match(plainReasons([row({ rule_code: 'DUPLICATE_CHECK', explanation: 'This exact file was already submitted. Hold for a person to decide.' })], 'duplicate_suspected').reasons[0], /exact file was already submitted/);
    assert.match(plainReasons([row({ rule_code: 'TOTAL_CHECK', expected_value: 12980, actual_value: 13480 })]).reasons[0], /should be ₹12,980, but the invoice says ₹13,480/);
    const weak = plainReasons([row({ rule_code: 'EXTRACTION_CONFIDENCE', outcome: 'unknown', actual_value: ['invoice_total (40%)', 'invoice_date (not read)'] })], 'needs_review');
    assert.equal(weak.reasons[0], 'Could not read the total, the date clearly. A sharper copy of the invoice may help.');
    assert.equal(weak.headline, 'Needs a person to check it');
});

test('a resolved issue is not a reason, and a clean invoice has none', () => {
    const r = plainReasons([row({ rule_code: 'PO_BALANCE_CHECK', expected_value: 100, actual_value: 200, difference_amount: 100, resolved_at: '2026-10-23' })], 'matched');
    assert.deepEqual([...r.reasons], []);
    assert.equal(r.headline, 'Matches the PO');
    assert.equal(r.next, null);
});

test('an unknown rule falls back to the engine\'s own sentence, so nothing is dropped', () => {
    assert.equal(plainReasons([row({ rule_code: 'SOMETHING_NEW', explanation: 'A new check failed in a new way.' })]).reasons[0], 'A new check failed in a new way.');
});

test('stages: received, reading, checking, done, and a read that failed is shown as failed until the verdict lands', () => {
    assert.equal(invoiceStage({ extraction_status: 'pending', match_status: 'pending' }), 'received');
    assert.equal(invoiceStage({ extraction_status: 'processing', match_status: 'pending' }), 'reading');
    assert.equal(invoiceStage({ extraction_status: 'completed', match_status: 'pending' }), 'checking');
    assert.equal(invoiceStage({ extraction_status: 'completed', match_status: 'matched' }), 'done');
    assert.equal(invoiceStage({ extraction_status: 'failed', match_status: 'pending' }), 'failed');
    assert.equal(invoiceStage({ extraction_status: 'failed', match_status: 'needs_review' }), 'done', 'a failed read still ends in a verdict a person can act on');
});

test('the Align guard returns the plain reasons, not rule codes, and waits while the invoice is being read', async () => {
    // A recording stand-in for the database.
    const invoice = { id: 'i1', invoice_number: 'PW/QA/26-27/002', match_status: 'mismatched', review_status: 'pending', extraction_status: 'completed', created_at: '2026-10-23' };
    const rules = [
        { rule_code: 'PO_BALANCE_CHECK', severity: 'blocking', outcome: 'fail', expected_value: 393530, actual_value: 496780, difference_amount: 103250, resolved_at: null },
        { rule_code: 'LINE_ITEM_MAPPING', severity: 'blocking', outcome: 'unknown', invoice_line_no: 2, actual_value: 'Debris collection', resolved_at: null },
    ];
    const make = (inv) => ({
        from: (t) => {
            const api = { select: () => api, eq: () => api, neq: () => api, order: () => api, then: (res) => Promise.resolve({ data: t === 'invoices' ? [inv] : rules, error: null }).then(res) };
            return api;
        },
    });
    const guard = (db) => loadTs('backend/lib/invoices/alignGuard.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin: db } });
    const done = await guard(make(invoice)).invoiceVerdictForPo('o1', 'po1');
    assert.equal(done.state, 'mismatched');
    assert.equal(done.headline, 'Does not match the PO');
    assert.equal(done.reasons[0], 'The invoice total ₹4,96,780 is ₹1,03,250 more than what is left on the PO (₹3,93,530).');
    assert.match(done.reasons[1], /1 line on the invoice is not on the PO: "Debris collection"\./);
    assert.ok(!done.reasons.some((r) => /_/.test(r)));
    // Still being read: no verdict yet, so no reasons, and the screen is told to wait.
    const reading = await guard(make({ ...invoice, extraction_status: 'processing', match_status: 'pending' })).invoiceVerdictForPo('o1', 'po1');
    assert.equal(reading.state, 'reading');
    assert.equal(reading.stage, 'reading');
    assert.equal(reading.reasons.length, 0);
    // Nothing uploaded: it says so, and says what to do.
    const none = await guard({ from: () => { const a = { select: () => a, eq: () => a, neq: () => a, order: () => a, then: (res) => Promise.resolve({ data: [], error: null }).then(res) }; return a; } }).invoiceVerdictForPo('o1', 'po1');
    assert.equal(none.state, 'none');
    assert.equal(none.headline, 'No invoice attached');
    assert.match(none.reasons[0], /Upload the tax invoice/);
});

test('a PO already used up by earlier invoices says so, instead of a negative balance', () => {
    const r = plainReasons([{ rule_code: 'PO_BALANCE_CHECK', outcome: 'fail', severity: 'blocking', expected_value: -16166, actual_value: 496780, difference_amount: 512946, explanation: 'Invoice 496780 exceeds the -16166 left on the PO (PO 393530, 409696 already invoiced).' }], 'mismatched');
    assert.equal(r.reasons[0], 'Nothing is left on this PO: earlier invoices (₹4,09,696) already use up its value. This invoice adds ₹4,96,780. If an earlier invoice was a mistake, reject it first.');
    assert.ok(!r.reasons[0].includes('-'));
});
