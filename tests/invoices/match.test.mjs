import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

const { matchInvoice, summariseMatch } = loadTs('backend/lib/invoices/match.ts');

const settings = { amount_tolerance: 1, rate_tolerance_pct: 0, qty_tolerance_pct: 0, min_confidence: 70 };

const poLines = [
    { id: 'L1', item_id: 'SKU-A', name: 'Floor cleaner 5L can', description: 'Floor cleaner 5 litre can', hsn_or_sac: '3402', unit: 'nos', quantity: 10, rate: 800, tax_percentage: 18 },
    { id: 'L2', item_id: null, name: 'Mop head microfibre', description: null, hsn_or_sac: null, unit: 'nos', quantity: 20, rate: 150, tax_percentage: 18 },
];

// 10 x 800 + 20 x 150 = 11,000 taxable, 18% = 1,980, total 12,980
function base(over = {}) {
    return {
        po: { status: 'approved', amount: 12980, vendor_name: 'Clean Co Pvt Ltd' },
        poLines,
        vendorGstin: '27AAAAA0000A1Z5',
        invoice: {
            invoice_number: 'INV/2026/81', invoice_date: '2026-10-10', vendor_name_read: 'Clean Co Private Limited',
            vendor_gstin_read: '27AAAAA0000A1Z5', taxable_amount: 11000, tax_amount: 1980, other_charges: null,
            discount_amount: null, invoice_total: 12980,
            field_confidence: { invoice_number: 95, invoice_date: 95, taxable_amount: 90, invoice_total: 95, vendor: 95 },
            extraction_ok: true,
        },
        lines: [
            { line_no: 1, description: 'Floor cleaner 5L can', item_code: null, hsn_or_sac: '3402', quantity: 10, unit: 'nos', unit_rate: 800, taxable_amount: 8000, tax_rate: 18, tax_amount: 1440, line_total: 9440 },
            { line_no: 2, description: 'Mop head microfibre', item_code: null, hsn_or_sac: null, quantity: 20, unit: 'nos', unit_rate: 150, taxable_amount: 3000, tax_rate: 18, tax_amount: 540, line_total: 3540 },
        ],
        priorInvoices: [], priorLineQty: {}, duplicates: [], settings, today: '2026-10-20',
        ...over,
    };
}

const find = (out, rule, outcome) => out.results.filter((r) => r.rule_code === rule && (!outcome || r.outcome === outcome));

test('AT-013: a clean invoice matches', () => {
    const out = matchInvoice(base());
    assert.equal(out.status, 'matched');
    assert.equal(JSON.stringify(out.lineMapping), JSON.stringify({ 1: 'L1', 2: 'L2' }));
    assert.equal(out.results.filter((r) => r.outcome !== 'pass').length, 0);
});

test('AT-014: invoice above the remaining PO value is mismatched with the variance', () => {
    const out = matchInvoice(base({ po: { status: 'approved', amount: 10000, vendor_name: 'Clean Co' } }));
    const r = find(out, 'PO_BALANCE_CHECK', 'fail')[0];
    assert.ok(r);
    assert.equal(r.difference, 2980);
    assert.equal(out.status, 'mismatched');
});

test('AT-015: rate differing from the PO is a line-level blocking mismatch', () => {
    const b = base();
    b.lines[0] = { ...b.lines[0], unit_rate: 850, taxable_amount: 8500, tax_amount: 1530, line_total: 10030 };
    const out = matchInvoice(b);
    const r = find(out, 'UNIT_RATE_CHECK', 'fail');
    assert.equal(r.length, 1);
    assert.equal(r[0].invoice_line_no, 1);
    assert.equal(r[0].difference, 500);
    assert.equal(out.status, 'mismatched');
});

test('AT-016: quantity above the PO is blocking', () => {
    const b = base();
    b.lines[1] = { ...b.lines[1], quantity: 25 };
    const out = matchInvoice(b);
    assert.equal(find(out, 'QUANTITY_CHECK', 'fail').length, 1);
    assert.equal(out.status, 'mismatched');
});

test('AT-017: unsupported freight needs review', () => {
    const out = matchInvoice(base({ invoice: { ...base().invoice, other_charges: 500, invoice_total: 13480 }, po: { status: 'approved', amount: 20000, vendor_name: 'Clean Co' } }));
    assert.equal(find(out, 'EXTRA_CHARGES_CHECK', 'fail').length, 1);
    assert.equal(out.status, 'needs_review');
});

test('AT-018: tax that does not reconcile is recorded', () => {
    const b = base();
    b.lines[0] = { ...b.lines[0], tax_amount: 1000 };
    const out = matchInvoice(b);
    assert.ok(find(out, 'TAX_CHECK', 'fail').length >= 1);
    assert.notEqual(out.status, 'matched');
});

test('AT-019: low confidence or a failed read never auto-matches', () => {
    const low = base();
    low.invoice.field_confidence.invoice_total = 40;
    assert.equal(matchInvoice(low).status, 'needs_review');
    const failed = base();
    failed.invoice.extraction_ok = false;
    assert.equal(matchInvoice(failed).status, 'needs_review');
});

test('a part-read document never auto-matches, even when what WAS read adds up', () => {
    // The dangerous case: pages 5-12 were never seen, so their line items are missing
    // rather than absent, yet every number on pages 1-4 agrees with the PO.
    const clean = matchInvoice(base());
    assert.equal(clean.status, 'matched');
    assert.equal(find(clean, 'DOCUMENT_TRUNCATED').length, 0);

    const short = base();
    short.invoice.pages_truncated = true;
    short.invoice.pages_read = 4;
    short.invoice.total_pages = 12;
    const out = matchInvoice(short);
    const rule = find(out, 'DOCUMENT_TRUNCATED')[0];
    assert.equal(rule.severity, 'blocking');
    assert.equal(rule.outcome, 'unknown');
    assert.match(rule.explanation, /4 of the 12 pages/);
    assert.notEqual(out.status, 'matched');
});

test('missing values are UNKNOWN, never zero or a pass', () => {
    const b = base();
    b.invoice.invoice_total = null;
    const out = matchInvoice(b);
    assert.equal(find(out, 'TOTAL_CHECK')[0].outcome, 'unknown');
    assert.equal(find(out, 'PO_BALANCE_CHECK')[0].outcome, 'unknown');
    assert.equal(out.status, 'needs_review');
});

test('AT-020: a duplicate is flagged and wins over everything else', () => {
    const out = matchInvoice(base({ duplicates: [{ id: 'X', reason: 'same_number', invoice_number: 'INV/2026/81', invoice_total: 12980 }] }));
    assert.equal(out.status, 'duplicate_suspected');
});

test('AT-021: partial invoices are checked against what is left, not the PO total', () => {
    // 7 of 10 cans were already billed (5,600 + 18% = 6,608 of the 12,980 PO).
    const b = base({
        priorInvoices: [{ id: 'P1', invoice_total: 6608 }],
        priorLineQty: { L1: 7 },
    });
    const out = matchInvoice(b);
    // 7 earlier + 10 now = 17 against 10 ordered, and 12,980 against 6,372 left.
    assert.equal(find(out, 'QUANTITY_CHECK', 'fail').length, 1);
    assert.equal(find(out, 'PO_BALANCE_CHECK', 'fail')[0].expected, 6372);
    assert.equal(out.status, 'mismatched');
});

test('a first partial invoice that fits passes; the next one that overshoots a line fails', () => {
    // First half: 5 cans + 10 mops = 4,000 + 1,500 = 5,500 taxable, 6,490 with 18% tax.
    const half = base({ po: { status: 'approved', amount: 12980, vendor_name: 'Clean Co' } });
    half.lines = [
        { ...half.lines[0], quantity: 5, taxable_amount: 4000, tax_amount: 720, line_total: 4720 },
        { ...half.lines[1], quantity: 10, taxable_amount: 1500, tax_amount: 270, line_total: 1770 },
    ];
    half.invoice = { ...half.invoice, taxable_amount: 5500, tax_amount: 990, invoice_total: 6490 };
    assert.equal(matchInvoice(half).status, 'matched');

    // Second invoice bills 6 cans: 5 earlier + 6 = 11 against 10 ordered.
    const next = base({
        po: { status: 'approved', amount: 12980, vendor_name: 'Clean Co' },
        priorInvoices: [{ id: 'P1', invoice_total: 6490 }],
        priorLineQty: { L1: 5, L2: 10 },
    });
    next.lines = [{ ...next.lines[0], quantity: 6, taxable_amount: 4800, tax_amount: 864, line_total: 5664 }];
    next.invoice = { ...next.invoice, taxable_amount: 4800, tax_amount: 864, invoice_total: 5664 };
    const out = matchInvoice(next);
    assert.equal(find(out, 'QUANTITY_CHECK', 'fail').length, 1);
    assert.equal(out.status, 'mismatched');
});

test('a line that cannot be mapped is unknown, not matched', () => {
    const b = base();
    b.lines[1] = { ...b.lines[1], description: 'Window blinds installation' };
    const out = matchInvoice(b);
    assert.equal(out.lineMapping[2], null);
    assert.equal(find(out, 'LINE_ITEM_MAPPING', 'unknown').length, 1);
    assert.equal(out.status, 'needs_review');
});

test('vendor GSTIN mismatch is blocking', () => {
    const b = base();
    b.invoice.vendor_gstin_read = '29BBBBB1111B1Z9';
    const out = matchInvoice(b);
    assert.equal(find(out, 'VENDOR_MATCH', 'fail').length, 1);
    assert.equal(out.status, 'mismatched');
});

test('an ineligible PO status blocks', () => {
    const out = matchInvoice(base({ po: { status: 'cancelled', amount: 12980, vendor_name: 'Clean Co' } }));
    assert.equal(find(out, 'PO_ELIGIBLE', 'fail').length, 1);
    assert.equal(out.status, 'mismatched');
});

test('header total that does not add up is blocking, with the difference', () => {
    const b = base();
    b.invoice.invoice_total = 13480;
    const out = matchInvoice(b);
    const r = find(out, 'TOTAL_CHECK', 'fail')[0];
    assert.equal(r.difference, 500);
    assert.equal(out.status, 'mismatched');
});

test('resolving an issue drops it from the status but never rewrites the outcome', () => {
    const b = base();
    b.invoice.invoice_total = 13480;
    const out = matchInvoice(b);
    const stored = out.results.map((r) => ({ ...r, resolved: r.rule_code === 'TOTAL_CHECK' || r.rule_code === 'PO_BALANCE_CHECK' }));
    assert.equal(summariseMatch(stored), 'matched');
    assert.ok(out.results.some((r) => r.rule_code === 'TOTAL_CHECK' && r.outcome === 'fail'));
});

test('money comparison is integer-safe at the tolerance edge', () => {
    const b = base();
    b.invoice.invoice_total = 12981.0; // exactly the 1.00 tolerance
    assert.equal(find(matchInvoice(b), 'TOTAL_CHECK', 'pass').length, 1);
    b.invoice.invoice_total = 12981.01;
    assert.equal(find(matchInvoice(b), 'TOTAL_CHECK', 'fail').length, 1);
});

// --- found by dry-running a real PO (MH-PO-26/27-0882) with a synthetic invoice -----------------
const chairPo = [
    { id: 'C1', item_id: null, name: 'Chair', description: null, hsn_or_sac: '9403', unit: 'nos', quantity: 4, rate: 12250, tax_percentage: 18 },
    { id: 'C2', item_id: null, name: 'Chair', description: null, hsn_or_sac: '9403', unit: 'nos', quantity: 1, rate: 21500, tax_percentage: 18 },
    { id: 'S1', item_id: null, name: 'Sofa', description: null, hsn_or_sac: '9403', unit: 'nos', quantity: 5, rate: 10900, tax_percentage: 18 },
];
const chairInv = (rate2) => {
    const taxable = 49000 + rate2 + 54500;
    return base({
        po: { status: 'approved', amount: 147500, vendor_name: 'RESPECT CHAIRS' }, poLines: chairPo,
        invoice: { ...base().invoice, taxable_amount: taxable, tax_amount: taxable * 0.18, invoice_total: taxable * 1.18 },
        lines: [
            { line_no: 1, description: 'Chair', item_code: null, hsn_or_sac: '9403', quantity: 4, unit: 'nos', unit_rate: 12250, taxable_amount: null, tax_rate: null, tax_amount: null, line_total: null },
            { line_no: 2, description: 'Chair', item_code: null, hsn_or_sac: '9403', quantity: 1, unit: 'nos', unit_rate: rate2, taxable_amount: null, tax_rate: null, tax_amount: null, line_total: null },
            { line_no: 3, description: 'Sofa', item_code: null, hsn_or_sac: '9403', quantity: 5, unit: 'nos', unit_rate: 10900, taxable_amount: null, tax_rate: null, tax_amount: null, line_total: null },
        ],
    });
};

test('two PO lines with the same name are told apart by rate, so each invoice line maps to its own', () => {
    const out = matchInvoice(chairInv(21500));
    assert.equal(JSON.stringify(out.lineMapping), JSON.stringify({ 1: 'C1', 2: 'C2', 3: 'S1' }));
    assert.equal(out.status, 'matched');
});

test('a changed rate on a duplicate-named line still lands on the nearest PO line and is caught', () => {
    const out = matchInvoice(chairInv(22000));
    assert.equal(out.lineMapping[2], 'C2', 'nearest rate, not the first Chair');
    const r = find(out, 'UNIT_RATE_CHECK', 'fail');
    assert.equal(r.length, 1);
    assert.equal(r[0].invoice_line_no, 2);
    assert.equal(r[0].difference, 500);
    assert.equal(find(out, 'QUANTITY_CHECK', 'fail').length, 0, 'no false over-quantity from mapping two lines to one');
    assert.equal(out.status, 'mismatched');
});

test('two lines the invoice describes identically with nothing to tell them apart stay unmapped, not guessed', () => {
    const b = chairInv(21500);
    b.lines[0] = { ...b.lines[0], unit_rate: null, quantity: null };
    b.lines[1] = { ...b.lines[1], unit_rate: null, quantity: null };
    const out = matchInvoice(b);
    assert.equal(out.lineMapping[1], null);
    assert.equal(out.lineMapping[2], null);
    assert.equal(out.status, 'needs_review');
});

test('tax shown only at the foot is checked against the PO tax rate', () => {
    assert.equal(find(matchInvoice(chairInv(21500)), 'TAX_CHECK', 'pass').length, 1);
    const wrong = chairInv(21500);
    wrong.invoice.tax_amount = 15000; // 18% of 125,000 is 22,500
    wrong.invoice.invoice_total = wrong.invoice.taxable_amount + 15000;
    const out = matchInvoice(wrong);
    assert.equal(find(out, 'TAX_CHECK', 'fail').length, 1);
    assert.notEqual(out.status, 'matched');
});
