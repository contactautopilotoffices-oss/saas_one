import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

// A recording stand-in for the database: each table answers maybeSingle() with a preset row.
function harness({ doc, invoice = null, payment = null, access = {} }) {
    const log = { deleted: [], updated: [], removed: [], activity: [], events: [] };
    const rows = { po_documents: doc, invoices: invoice, po_payments: payment };
    const from = (table) => {
        const q = { mode: 'select', patch: null };
        const api = {
            select: () => api, eq: () => api, in: () => api,
            maybeSingle: async () => ({ data: rows[table] ?? null }),
            update: (p) => { q.mode = 'update'; q.patch = p; return api; },
            delete: () => { q.mode = 'delete'; return api; },
            then: (res) => { if (q.mode === 'delete') log.deleted.push(table); if (q.mode === 'update') log.updated.push([table, q.patch]); return Promise.resolve({ error: null }).then(res); },
        };
        return api;
    };
    const mod = loadTs('app/api/accounts/po/[id]/documents/[docId]/route.ts', {
        'next/server': { NextRequest: class {}, NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
        '@/backend/lib/supabase/admin': { supabaseAdmin: { from, storage: { from: (b) => ({ remove: async (p) => { log.removed.push([b, p]); } }) } } },
        '@/backend/lib/accounts/access': {
            resolveAccountsAccess: async () => ({ user: { id: 'u1' }, organizationId: 'o1', canAlign: true, canComplete: false, isAdmin: false, roles: ['purchase_executive'], ...access }),
            isAccountsAccessError: () => false, readOrgId: () => 'o1',
        },
        '@/backend/lib/accounts/activity': { logPoActivity: async (a) => { log.activity.push(a); } },
        '@/backend/lib/accounts/documents': { PO_DOCS_BUCKET: 'po_documents' },
        '@/backend/lib/invoices/audit': { logInvoiceEvent: async (e) => { log.events.push(e); } },
        '@/backend/lib/invoices/docState': { syncDocumentationState: async () => undefined },
    });
    const call = () => mod.DELETE({}, { params: Promise.resolve({ id: 'po1', docId: 'd1' }) });
    return { call, log };
}
const baseDoc = { id: 'd1', doc_type: 'tax_invoice', status: 'uploaded', file_url: 'o1/po1/1_inv.pdf', file_name: 'inv.pdf', uploaded_by: 'u9', payment_id: null };

test('a wrong upload can be cancelled: the file, the row and the invoice check made from it all go, and it is logged', async () => {
    const h = harness({ doc: baseDoc, invoice: { id: 'i1', review_status: 'needs_review', invoice_number: 'X1' } });
    const r = await h.call();
    assert.equal(r.status, 200);
    assert.equal(r.body.withdrawn_invoice_id, 'i1');
    assert.equal(JSON.stringify(h.log.deleted), JSON.stringify(['po_documents']));
    assert.equal(JSON.stringify(h.log.removed), JSON.stringify([['po_documents', ['o1/po1/1_inv.pdf']]]));
    const inv = h.log.updated.find(([t]) => t === 'invoices')[1];
    assert.equal(inv.review_status, 'rejected', 'the invoice is withdrawn, never erased: its history is an audit trail');
    assert.equal(h.log.events[0].eventType, 'invoice_withdrawn');
    assert.match(h.log.activity[0].note, /Removed tax invoice — inv\.pdf/);
});

test('an invoice Accounts has already accepted cannot be removed from here', async () => {
    const h = harness({ doc: baseDoc, invoice: { id: 'i1', review_status: 'accepted', invoice_number: 'X1' } });
    const r = await h.call();
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Accounts has already accepted/);
    assert.equal(h.log.deleted.length, 0);
    assert.equal(h.log.removed.length, 0);
});

test('a verified document needs accounts or an admin; they can', async () => {
    const verified = { ...baseDoc, status: 'verified' };
    assert.equal((await harness({ doc: verified }).call()).status, 403);
    assert.equal((await harness({ doc: verified, access: { canComplete: true } }).call()).status, 200);
    assert.equal((await harness({ doc: verified, access: { isAdmin: true } }).call()).status, 200);
});

test('the proof of a completed payment stays on record', async () => {
    const h = harness({ doc: { ...baseDoc, doc_type: 'payment_proof', payment_id: 'p1' }, payment: { status: 'completed' } });
    assert.equal((await h.call()).status, 409);
    assert.equal(h.log.deleted.length, 0);
});

test('a missing document, or one the caller cannot align on, is refused', async () => {
    assert.equal((await harness({ doc: null }).call()).status, 404);
    assert.equal((await harness({ doc: baseDoc, access: { canAlign: false } }).call()).status, 403);
});

test('a document with no invoice check behind it (not a tax invoice) is just removed', async () => {
    const h = harness({ doc: { ...baseDoc, doc_type: 'grn' } });
    const r = await h.call();
    assert.equal(r.status, 200);
    assert.equal(r.body.withdrawn_invoice_id, null);
    assert.equal(h.log.updated.length, 0);
});
