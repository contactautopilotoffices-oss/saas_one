import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

const { parsePaymentTerms } = loadTs('backend/lib/accounts/paymentSchedule.ts');
const { reachedFor, validateMilestones } = loadTs('backend/lib/accounts/poSchedule.ts', {
    '@/backend/lib/supabase/admin': { supabaseAdmin: {} }, './poApproval': { effectivePoStatus: async (_o, _p, s) => s },
});

const view = (r) => r.milestones.map((m) => [m.basis, m.percent, m.amount, m.trigger, m.progress_pct]);

// The five POs of the MVP, terms as Zoho holds them (excerpted from the live records).
test('BLR-PO-26/27-0346: 50% advance, 50% on completion, GST only once it shows on the portal', () => {
    const r = parsePaymentTerms(`Payment Terms : (all milestone percentages are on the basic value of 86,000; GST payable separately at the end)
1. 50% Advance payment against purchase order (43,000)
2. 50% On completion of work (43,000)

Basic value - 100% (86,000)
100% GST Payment will be processed only after the GST invoice is reflected on the GST Portal (15,480)
Grand Total (1,01,480)

Delivery/Mobilisation : Immediately`, { basic: 86000, total: 101480 });
    assert.equal(r.status, 'ok');
    assert.equal(JSON.stringify(view(r)), JSON.stringify([['basic', 50, 43000, 'on_po', null], ['basic', 50, 43000, 'on_completion', null], ['gst', 100, 15480, 'gst_on_portal', null]]));
});

test('DL-PO-26/27-0086: four stages, with the completion percentages as triggers; the ambiguous line is flagged, not guessed', () => {
    const r = parsePaymentTerms(`Payment Terms:
30% Advance along with PO (1,00,050)
20% upon Material Delivery and 50% Work Completion (66,700)
20% upon 90% Work Completion (66,700)
30% upon 100% Work Completion, payable within 30 days (1,00,050)
GST @ 18% (IGST) payable separately: Rs 60,030

Note: Vendor GSTIN is Bihar and delivery is UP - this is an interstate supply. Tax applicable is IGST @ 18%, not CGST+SGST.

Delivery/Mobilisation : Immediately`, { basic: 333500, total: 393530 });
    assert.equal(r.milestones.length, 5);
    assert.equal(JSON.stringify(view(r)), JSON.stringify([
        ['basic', 30, 100050, 'on_po', null], ['basic', 20, 66700, 'on_progress', 50], ['basic', 20, 66700, 'on_progress', 90],
        ['basic', 30, 100050, 'on_completion', 100], ['gst', 100, 60030, 'on_invoice', null],
    ]));
    assert.equal(r.milestones[3].due_within_days, 30);
    assert.equal(r.status, 'check');
    assert.ok(r.warnings.some((w) => /delivery and 50% completion/.test(w)), 'the two-trigger line is called out for a person');
});

test('MH-PO-26/27-0882: 50% against PO, 50% on delivery, and the GST that rides on the second', () => {
    const r = parsePaymentTerms(`Payment Terms :
50% against purchase order (62500)
50% after delivery of material at site (62500) + 100% GST (22500)

Delivery/Mobilisation : Immediately`, { basic: 125000, total: 147500 });
    assert.equal(r.status, 'ok');
    assert.equal(JSON.stringify(view(r)), JSON.stringify([['basic', 50, 62500, 'on_po', null], ['basic', 50, 62500, 'on_delivery', null], ['gst', 100, 22500, 'on_delivery', null]]));
});

test('DL-PO-26/27-0104: 100% advance on basic, GST separately', () => {
    const r = parsePaymentTerms(`Payment Terms :
100% Advance payment against Purchase Order on basic value (33,345)
GST payable separately (6,002)

Delivery/Mobilisation : Immediately`, { basic: 33345, total: 39347.1 });
    assert.equal(r.status, 'ok');
    assert.equal(JSON.stringify(view(r)), JSON.stringify([['basic', 100, 33345, 'on_po', null], ['gst', 100, 6002, 'on_invoice', null]]));
});

test('DL-PO-26/27-0101: "100% Advance" with no mention of GST is a share of the WHOLE PO', () => {
    const r = parsePaymentTerms('100% Advance payment against Purchase Order\n\nDelivery/Mobilisation: Immediately', { basic: 41491.56, total: 48960.04 });
    assert.equal(r.status, 'ok');
    assert.equal(JSON.stringify(view(r)), JSON.stringify([['total', 100, 48960.04, 'on_po', null]]));
    assert.ok(r.notes.some((n) => /whole PO value including GST/.test(n)));
});

// Bugs found by running the parser over 400 live POs.
test('"(CGST + SGST)" inside brackets is not a second milestone', () => {
    const r = parsePaymentTerms('Payment Terms:\n100% Advance against Purchase Order - (38,325)\nGST @ 18% (CGST + SGST) payable separately (6,899)\n\nWarranty: N/A', { basic: 38325, total: 45224 });
    assert.equal(JSON.stringify(view(r)), JSON.stringify([['basic', 100, 38325, 'on_po', null], ['gst', 100, 6899, 'on_invoice', null]]));
});

test('a tax-rate statement is not a payment', () => {
    const r = parsePaymentTerms('Payment Terms: 100% Advance.\n2. Tax: 18% GST applicable.\n3. Transportation: Free of charge by vendor.', { basic: 1000, total: 1180 });
    assert.equal(r.milestones.filter((m) => m.basis !== 'gst').length, 1);
    assert.equal(r.milestones[0].percent, 100);
});

test('a penalty or retention clause elsewhere is never read as a milestone', () => {
    const r = parsePaymentTerms('100% Advance against Purchase Order\nLiquidated damages @ 0.5% per week of delay, capped at 5%\nRetention 5% held for 12 months', { basic: 1000, total: 1000 });
    assert.equal(r.milestones.length, 1);
});

test('credit terms with no percentage mean 100% against the invoice, on the stated days', () => {
    const r = parsePaymentTerms('Payment Terms:\n30 days against tax invoice submission.\nTerms and condition as per agreement\n\nDelivery/Mobilisation: Immediate', { basic: 1000, total: 1180 });
    assert.equal(r.milestones.length, 1);
    assert.equal(r.milestones[0].trigger, 'on_invoice');
    assert.equal(r.milestones[0].due_within_days, 30);
});

test('printed amounts that only fit the basic value make the percentages basic, and say so', () => {
    const r = parsePaymentTerms('Payment Terms:\n100% Advance against Purchase Order (3,000)', { basic: 3000, total: 3540 });
    assert.equal(r.milestones[0].basis, 'basic');
    assert.equal(r.milestones[0].amount, 3000);
    assert.ok(r.warnings.some((w) => /no GST payment is described/.test(w)), 'the missing GST payment is flagged');
});

test('what cannot be parsed stays unparsed: no terms, percentages that do not add up, amounts that disagree', () => {
    assert.equal(parsePaymentTerms('Delivery/Mobilisation: Immediately', { basic: 1, total: 1 }).status, 'none');
    assert.equal(parsePaymentTerms(null, { basic: 1, total: 1 }).status, 'none');
    const bad = parsePaymentTerms('Payment Terms:\n60% advance against PO\n60% on completion', { basic: 1000, total: 1000 });
    assert.equal(bad.status, 'check');
    assert.ok(bad.warnings.some((w) => /add to 120%/.test(w)));
    const off = parsePaymentTerms('Payment Terms:\n50% advance against PO (900)\n50% on completion (500)', { basic: 1000, total: 1000 });
    assert.ok(off.warnings.some((w) => /Milestone 1/.test(w)));
});

// --- when a trigger was reached ---------------------------------------------------------
const ctx = (over = {}) => ({
    po: { status: 'approved', po_date: '2026-10-08' }, firstInvoiceOn: null,
    log: [{ kind: 'progress', progress_pct: 25, recorded_on: '2026-10-12' }, { kind: 'progress', progress_pct: 60, recorded_on: '2026-10-20' }, { kind: 'delivery', progress_pct: null, recorded_on: '2026-10-10' }],
    ...over,
});

test('reached: each trigger reads its own evidence', () => {
    assert.equal(reachedFor({ trigger: 'on_po', progress_pct: null }, ctx()).date, '2026-10-08');
    assert.equal(reachedFor({ trigger: 'on_po', progress_pct: null }, ctx({ po: { status: 'pending_approval', po_date: '2026-10-08' } })).date, null, 'an unapproved PO has not reached "on PO"');
    assert.equal(reachedFor({ trigger: 'on_delivery', progress_pct: null }, ctx()).date, '2026-10-10');
    assert.equal(reachedFor({ trigger: 'on_progress', progress_pct: 25 }, ctx()).date, '2026-10-12', '25% was reached on the day 25% was recorded');
    assert.equal(reachedFor({ trigger: 'on_progress', progress_pct: 50 }, ctx()).date, '2026-10-20', '50% is reached by the 60% entry');
    assert.equal(reachedFor({ trigger: 'on_progress', progress_pct: 90 }, ctx()).date, null);
    assert.equal(reachedFor({ trigger: 'on_completion', progress_pct: null }, ctx()).date, null);
    assert.equal(reachedFor({ trigger: 'on_completion', progress_pct: null }, ctx({ log: [{ kind: 'progress', progress_pct: 100, recorded_on: '2026-11-01' }] })).date, '2026-11-01');
    assert.equal(reachedFor({ trigger: 'on_invoice', progress_pct: null }, ctx({ firstInvoiceOn: '2026-10-22' })).date, '2026-10-22');
});

test('reached: the GST portal and "other" are not tracked, and say so', () => {
    assert.deepEqual({ ...reachedFor({ trigger: 'gst_on_portal', progress_pct: null }, ctx()) }, { date: null, auto: false });
});

// --- a schedule a person edits -------------------------------------------------------------
const good = [
    { label: '50% advance', basis: 'basic', percent: 50, amount: 500, trigger: 'on_po' },
    { label: '25% at 25% done', basis: 'basic', percent: 25, amount: 250, trigger: 'on_progress', progress_pct: 25 },
    { label: '25% on completion', basis: 'basic', percent: 25, amount: 250, trigger: 'on_completion' },
    { label: 'GST', basis: 'gst', percent: 100, amount: 180, trigger: 'on_invoice' },
];

test('validate: a schedule must add to 100 on the payment rows, with GST rows kept out of the sum', () => {
    assert.equal(validateMilestones(good).ok, true);
    assert.match(validateMilestones(good.slice(0, 2)).error, /add to 75%/);
    assert.match(validateMilestones([]).error, /between 1 and 30/);
});

test('validate: bad input is refused with a reason a person can act on', () => {
    assert.match(validateMilestones([{ ...good[0], label: ' ' }]).error, /needs a name/);
    assert.match(validateMilestones([{ ...good[0], percent: 0 }]).error, /above 0/);
    assert.match(validateMilestones([{ ...good[0], amount: -5 }]).error, /amount/);
    assert.match(validateMilestones([{ ...good[0], trigger: 'whenever' }]).error, /trigger/);
    assert.match(validateMilestones([{ ...good[1], progress_pct: null }]).error, /% complete/);
    assert.match(validateMilestones([{ ...good[0], percent: 100, due_within_days: 4000 }]).error, /days/);
});
