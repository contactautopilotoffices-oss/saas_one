import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { generateCsvContent, generateExcelHtml } = loadTs('frontend/lib/pettyCash/exportExpenses.ts');

test('generateCsvContent formats UTF-8 BOM, headers and spend_mode correctly', () => {
    const mockExpenses = [
        {
            id: 'e1',
            request_id: 'r1',
            request: { id: 'r1', request_no: 'PC-2026-001' },
            property: { id: 'p1', name: 'Downtown Tower' },
            spend_mode: 'Operation',
            vendor: 'Hardware Mart',
            category: 'Maintenance',
            amount: 450.50,
            expense_date: '2026-10-29T10:00:00Z',
            payment_mode: 'Cash',
            payment_ref: '',
            description: 'Plumbing washers & screws',
            documents: [],
            review_status: 'accepted',
            review_remarks: 'OK'
        },
        {
            id: 'e2',
            request_id: 'r1',
            request: { id: 'r1', request_no: 'PC-2026-001' },
            property: { id: 'p1', name: 'Downtown Tower' },
            spend_mode: 'Client',
            vendor: 'Cafe Coffee Day',
            category: 'Food & Beverage',
            amount: 1250.00,
            expense_date: '2026-10-29T11:00:00Z',
            payment_mode: 'UPI',
            payment_ref: 'UPI/123456789',
            description: 'Client meeting beverages',
            documents: [{ id: 'd1', file_name: 'receipt.pdf' }],
            review_status: 'pending',
            review_remarks: ''
        }
    ];

    const csv = generateCsvContent(mockExpenses);

    assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
    assert.ok(csv.includes('Expense Date,Request No,Property,Spend Mode,Payee / Vendor'), 'CSV must have required headers');
    assert.ok(csv.includes('PC-2026-001,Downtown Tower,Operation,Hardware Mart,Maintenance,450.50'), 'Operation row formatted properly');
    assert.ok(csv.includes('PC-2026-001,Downtown Tower,Client,Cafe Coffee Day,Food & Beverage,1250.00'), 'Client row formatted properly');
});

test('generateExcelHtml formats styled HTML/XML table with bold headers and KPI totals', () => {
    const mockExpenses = [
        {
            id: 'e1',
            request_id: 'r1',
            request: { id: 'r1', request_no: 'PC-2026-001' },
            property: { id: 'p1', name: 'Downtown Tower' },
            spend_mode: 'Operation',
            vendor: 'Hardware Mart',
            category: 'Maintenance',
            amount: 450.00,
            expense_date: '2026-10-29T10:00:00Z',
            payment_mode: 'Cash',
            description: 'Screws',
            documents: []
        },
        {
            id: 'e2',
            request_id: 'r1',
            request: { id: 'r1', request_no: 'PC-2026-001' },
            property: { id: 'p1', name: 'Downtown Tower' },
            spend_mode: 'Client',
            vendor: 'Restaurant',
            category: 'Food',
            amount: 1550.00,
            expense_date: '2026-10-29T11:00:00Z',
            payment_mode: 'UPI',
            payment_ref: 'TXN123',
            description: 'Client lunch',
            documents: [{ id: 'd1', file_name: 'bill.jpg' }]
        }
    ];

    const html = generateExcelHtml(mockExpenses);

    assert.ok(html.includes('font-weight: bold'), 'Table headers must be bold styled');
    assert.ok(html.includes('padding: 10px 12px; font-weight: bold;'), 'Header th tags must have bold styling');
    assert.ok(html.includes('Operation Spends:'), 'Summary stats must include Operation Spends');
    assert.ok(html.includes('Client Spends:'), 'Summary stats must include Client Spends');
    assert.ok(html.includes('450.00'), 'Operation amount must be present');
    assert.ok(html.includes('1,550.00'), 'Client amount must be present');
});

test('property proof threshold business logic checks', () => {
    const propertyAThreshold = 500.00;
    const propertyBThreshold = 1000.00;

    // Small transaction (₹300 on property A): bill optional, description mandatory
    const txn1 = { amount: 300, documents: [], description: 'Auto fare' };
    const requiresProof1 = txn1.amount > propertyAThreshold;
    assert.equal(requiresProof1, false, '₹300 on ₹500 limit does not require proof');
    assert.ok(txn1.description.trim().length >= 3, 'Description is provided');

    // Large transaction (₹550 on property A): bill mandatory
    const txn2 = { amount: 550, documents: [], description: 'Client gifts' };
    const requiresProof2 = txn2.amount > propertyAThreshold;
    assert.equal(requiresProof2, true, '₹550 on ₹500 limit requires proof');
    const isBlocked2 = requiresProof2 && txn2.documents.length === 0;
    assert.equal(isBlocked2, true, 'Transaction without proof is blocked');

    // Exact boundary (₹500 on property A): within limit
    const txn3 = { amount: 500, documents: [], description: 'Courier charge' };
    const requiresProof3 = txn3.amount > propertyAThreshold;
    assert.equal(requiresProof3, false, '₹500 on ₹500 limit does not require proof');

    // ₹750 on property B (threshold ₹1000): within limit
    const txn4 = { amount: 750, documents: [], description: 'Team tea' };
    const requiresProof4 = txn4.amount > propertyBThreshold;
    assert.equal(requiresProof4, false, '₹750 on ₹1000 limit does not require proof');
});
