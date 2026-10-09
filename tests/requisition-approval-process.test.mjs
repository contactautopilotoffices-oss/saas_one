import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as approval from '../backend/lib/procurement/requisition-approval.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const buyer = '22222222-2222-4222-8222-222222222222';
const reviewer = '33333333-3333-4333-8333-333333333333';
const noida = '44444444-4444-4444-8444-444444444444';
const plaza = '55555555-5555-4555-8555-555555555555';
const now = '2026-10-09T00:00:00Z';

function fixture() {
    return {
        users: [{ id: buyer, is_master_admin: false }, { id: reviewer, full_name: 'Reviewer', email: '', is_master_admin: false }],
        organization_memberships: [
            { user_id: buyer, organization_id: org, role: 'procurement', is_active: true },
            { user_id: reviewer, organization_id: org, role: 'ops_super_admin', is_active: true }
        ],
        property_monthly_requisitions: [
            { id: noida, organization_id: org, property_id: 'property-a', status: 'submitted', updated_at: now,
                requisition_month: 10, requisition_year: 2026, property: { name: 'Noida' },
                notes: JSON.stringify({ total_estimated_amount: 16318, items: [{ requested_qty: 2, unit_price: 8159 }] }) },
            { id: plaza, organization_id: org, property_id: 'property-b', status: 'submitted', updated_at: now,
                requisition_month: 11, requisition_year: 2026, property: { name: 'Plaza' },
                notes: JSON.stringify({ total_estimated_amount: 73492, items: [{ requested_qty: 1, unit_price: 73492 }] }) }
        ]
    };
}

function database(records, failId = '') {
    return { from(table) {
        let selected = records[table] || (records[table] = []);
        let patch;
        const query = {
            select() { return this; },
            gte() { return this; },
            insert(value) {
                if (table === 'event_outbox' && failId === 'outbox') { this.insertError = new Error('Outbox unavailable'); return this; }
                selected.push(...(Array.isArray(value) ? value : [value])); return this;
            },
            eq(key, value) { selected = selected.filter(row => row[key] === value); return this; },
            in(key, values) { selected = selected.filter(row => values.includes(row[key])); return this; },
            update(value) { patch = value; return this; },
            async single() { return this.maybeSingle(); },
            async maybeSingle() {
                if (patch && selected[0]?.id === failId) return { data: null, error: new Error('Write failed') };
                if (patch) selected.forEach(row => Object.assign(row, patch));
                return { data: selected[0] || null, error: null };
            },
            then(resolve) {
                if (patch) selected.forEach(row => Object.assign(row, patch));
                return Promise.resolve({ data: selected, error: this.insertError || null }).then(resolve);
            }
        };
        return query;
    } };
}

function loadRoute(path, records, actor, sent = [], failId = '') {
    const exports = {};
    const admin = database(records, failId);
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    vm.runInNewContext(compiled, { exports, console, crypto: { randomUUID: () => '66666666-6666-4666-8666-666666666666' }, Buffer,
        require: name => {
            if (name === 'next/server') return { NextResponse: { json: Response.json } };
            if (name.endsWith('/server')) return { createClient: async () => ({ auth: { getUser: async () =>
                ({ data: { user: actor ? { id: actor, user_metadata: { full_name: 'Logged-in actor' } } : null }, error: null }) } }) };
            if (name.endsWith('/admin')) return { createAdminClient: () => admin };
            if (name.endsWith('requisition-approval.mjs')) return approval;
            if (name.endsWith('WhatsAppEventProcessor')) return { WhatsAppEventProcessor: { dispatch: async message => { if (failId === 'dispatch') throw new Error('Queue unavailable'); sent.push(message); } } };
            if (name.endsWith('EmailRecipientResolver')) return { EmailRecipientResolver: { resolveRecipients: async () => ({ enabled: false, emails: [] }) } };
            if (name.endsWith('EmailService')) return { EmailService: { sendGenericNotificationEmail: async () => {} } };
            throw new Error('Unexpected import ' + name);
        }
    });
    return exports;
}

function upload(ids = [noida, plaza], organization = org) {
    const values = { organization_id: organization, requisition_ids: JSON.stringify(ids),
        target_approver_id: reviewer, total_quoted_amount: '726337.33' };
    return { formData: async () => ({ get: key => values[key] ?? null }) };
}

test('bulk upload keeps each site estimate and sends exactly one summary for the selected records', async () => {
    const records = fixture(), sent = [];
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer, sent).POST(upload());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.updated_count, 2);
    assert.deepEqual(records.property_monthly_requisitions.map(row => JSON.parse(row.notes).vendor_quotation.total_quoted_amount), [16318, 73492]);
    assert.ok(records.property_monthly_requisitions.every(row => JSON.parse(row.notes).vendor_quotation.batch_total_amount === undefined));
    assert.equal(sent.length, 1);
    assert.equal(records.event_outbox.length, 1);
    assert.equal(records.event_outbox[0].status, 'completed');
    assert.equal(records.event_outbox[0].event_type, 'REQUISITION_APPROVAL_BATCH_REQUESTED');
    assert.equal(sent[0].durableBatch, true);
    assert.equal(sent[0].paramValues.total_amount, '89,810');
    assert.equal(sent[0].paramValues.month, 'October, November');
    assert.match(sent[0].paramValues.property, /Noida.*16,318.*Plaza.*73,492/);
    assert.equal(approval.usesBulkApprovalSummary(records.property_monthly_requisitions[0]), true);
    assert.deepEqual(JSON.parse(records.property_monthly_requisitions[0].notes).items, [{ requested_qty: 2, unit_price: 8159 }]);
});

test('failed writes are reported and excluded from the one summary', async () => {
    const records = fixture(), sent = [];
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer, sent, plaza).POST(upload());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.updated_count, 1);
    assert.deepEqual(result.failed_ids, [plaza]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].paramValues.total_amount, '16,318');
    assert.equal(sent[0].paramValues.month, 'October');
    assert.equal(records.property_monthly_requisitions[1].status, 'submitted');
});

test('bulk upload rejects anonymous users, other organizations, missing selections and already-approved records', async () => {
    const anonymous = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', fixture(), null).POST(upload());
    assert.equal(anonymous.status, 401);
    const foreign = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', fixture(), buyer).POST(upload([noida], '77777777-7777-4777-8777-777777777777'));
    assert.equal(foreign.status, 403);
    const missing = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', fixture(), buyer).POST(upload([noida, '88888888-8888-4888-8888-888888888888']));
    assert.equal(missing.status, 409);
    const records = fixture(); records.property_monthly_requisitions[0].status = 'approved';
    const locked = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer).POST(upload());
    assert.equal(locked.status, 409);
    assert.equal(records.property_monthly_requisitions[1].status, 'submitted');
});

test('duplicate selections produce one stored update per requisition', async () => {
    const records = fixture(), sent = [];
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer, sent).POST(upload([noida, noida]));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updated_count, 1);
    assert.equal(JSON.parse(records.property_monthly_requisitions[0].notes).status_history.length, 1);
    assert.equal(sent.length, 1);
});

test('legacy copied batch totals resolve to each site estimate without changing the stored record', () => {
    const record = fixture().property_monthly_requisitions[0];
    const notes = JSON.parse(record.notes);
    notes.vendor_quotation = { is_bulk: true, total_quoted_amount: 726337.33, file_url: 'quote.xlsx' };
    record.notes = JSON.stringify(notes);
    const before = record.notes;
    const quote = approval.siteVendorQuotation(record);
    assert.equal(quote.total_quoted_amount, 16318);
    assert.equal(quote.batch_total_amount, 726337.33);
    assert.equal(quote.file_url, 'quote.xlsx');
    assert.equal(quote.amount_source, 'site_estimate');
    assert.equal(record.notes, before);
    assert.equal(approval.usesBulkApprovalSummary(record), false);
});

test('zero estimates and decimal amounts are preserved; invalid estimates are rejected', () => {
    assert.equal(approval.siteEstimatedAmount({ total_estimated_amount: 100, notes: { total_estimated_amount: 0 } }), 0);
    assert.equal(approval.siteEstimatedAmount({ notes: { total_estimated_amount: '16318.33' } }), 16318.33);
    for (const value of [-1, 'not-a-number', Infinity]) {
        assert.throws(() => approval.siteEstimatedAmount({ total_estimated_amount: value }), /Invalid/);
    }
    const single = { notes: { vendor_quotation: { total_quoted_amount: 0 } } };
    assert.equal(approval.siteVendorQuotation(single).total_quoted_amount, 0);
});

test('approving one requisition affects only that record and uses the logged-in approver', async () => {
    const records = fixture();
    records.property_monthly_requisitions.forEach(record => {
        record.status = 'pending_approval';
        const notes = JSON.parse(record.notes);
        notes.approver_info = { id: reviewer };
        notes.vendor_quotation = { is_bulk: true, total_quoted_amount: 726337.33, batch_id: 'batch' };
        record.notes = JSON.stringify(notes);
    });
    const request = { json: async () => ({ action: 'approve', approver_id: buyer, approver_name: 'Spoofed identity' }) };
    const response = await loadRoute('app/api/procurement/requisitions/[id]/approve/route.ts', records, reviewer).PATCH(request, { params: Promise.resolve({ id: noida }) });
    assert.equal(response.status, 200);
    assert.equal(records.property_monthly_requisitions[0].status, 'approved');
    assert.equal(records.property_monthly_requisitions[1].status, 'pending_approval');
    const notes = JSON.parse(records.property_monthly_requisitions[0].notes);
    assert.equal(notes.approver_info.id, reviewer);
    assert.equal(notes.approver_info.name, 'Logged-in actor');
    assert.equal(notes.vendor_quotation.total_quoted_amount, 16318);
});

test('individual approval rejects forged identities, invalid actions, empty rejections and repeat decisions', async () => {
    const records = fixture(), record = records.property_monthly_requisitions[0];
    record.status = 'pending_approval';
    const notes = JSON.parse(record.notes); notes.approver_info = { id: reviewer }; record.notes = JSON.stringify(notes);
    const request = action => ({ json: async () => ({ action, approver_id: reviewer }) });
    const params = { params: Promise.resolve({ id: noida }) };
    const denied = await loadRoute('app/api/procurement/requisitions/[id]/approve/route.ts', records, buyer).PATCH(request('approve'), params);
    assert.equal(denied.status, 403);
    const anonymous = await loadRoute('app/api/procurement/requisitions/[id]/approve/route.ts', records, null).PATCH(request('approve'), params);
    assert.equal(anonymous.status, 401);
    for (const action of ['anything', 'reject']) {
        const bad = await loadRoute('app/api/procurement/requisitions/[id]/approve/route.ts', records, reviewer).PATCH(request(action), params);
        assert.equal(bad.status, 400);
    }
    record.status = 'approved';
    const repeated = await loadRoute('app/api/procurement/requisitions/[id]/approve/route.ts', records, reviewer).PATCH(request('approve'), params);
    assert.equal(repeated.status, 409);
});

test('the retired bulk decision endpoint cannot update any requisition', async () => {
    const records = fixture();
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approve-action/route.ts', records, reviewer).POST();
    assert.equal(response.status, 410);
    assert.deepEqual(records.property_monthly_requisitions.map(record => record.status), ['submitted', 'submitted']);
});

function approvalNotifier(record, sent, databaseError = null) {
    const source = readFileSync(new URL('../backend/services/WhatsAppEventProcessor.ts', import.meta.url), 'utf8');
    const start = source.indexOf('    async handleRequisitionApprovalRequested(');
    const end = source.indexOf('    async handleRequisitionStatusUpdated(', start);
    const method = source.slice(start, end).trim().replace('async handleRequisitionApprovalRequested', 'async function handler').replace(/,\s*$/, '');
    const compiled = ts.transpileModule(method + '\nexports.handler = handler;', { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, console, ...approval, supabaseAdmin: {
        from() { return { select() { return this; }, eq() { return this; },
            maybeSingle: async () => ({ data: record, error: databaseError }) }; }
    } });
    return payload => exports.handler.call({
        getPropertyName: async () => record?.property?.name || 'Property',
        getUserDetails: async () => ({ name: 'Reviewer' }),
        dispatch: async message => { sent.push(message); }
    }, payload);
}

test('outbox approval requests for a new bulk upload do not send per-site WhatsApp messages', async () => {
    const record = fixture().property_monthly_requisitions[0];
    const notes = JSON.parse(record.notes);
    notes.vendor_quotation = approval.prepareBulkApproval([record], { batch_id: 'b' })[0].vendor_quotation;
    record.notes = JSON.stringify(notes);
    const sent = [];
    await approvalNotifier(record, sent)({ requisition_id: noida });
    await approvalNotifier(null, sent)({ requisition_id: noida, notes: record.notes });
    assert.equal(sent.length, 0);
});

test('legacy individual outbox requests use the site amount, not the copied batch total', async () => {
    const record = fixture().property_monthly_requisitions[0];
    const notes = JSON.parse(record.notes);
    notes.vendor_quotation = { is_bulk: true, total_quoted_amount: 726337.33 };
    record.notes = JSON.stringify(notes);
    const sent = [];
    await approvalNotifier(record, sent)({ requisition_id: noida, total_final_amount: 726337.33 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].paramValues.total_amount, '16,318');
});

test('a failed outbox lookup cannot fall through and send a duplicate individual request', async () => {
    const sent = [];
    await assert.rejects(() => approvalNotifier(null, sent, new Error('Lookup unavailable'))({ requisition_id: noida }), /Lookup/);
    assert.equal(sent.length, 0);
});

test('the general update endpoint cannot bypass individual approval or create a PO before approval', async () => {
    const params = { params: Promise.resolve({ id: noida }) };
    const json = { headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ status: 'approved' }) };
    for (const [actor, expected] of [[null, 401], [buyer, 400]]) {
        const records = fixture();
        const response = await loadRoute('app/api/procurement/requisitions/[id]/route.ts', records, actor).PATCH(json, params);
        assert.equal(response.status, expected);
        assert.equal(records.property_monthly_requisitions[0].status, 'submitted');
    }
    const records = fixture();
    records.organization_memberships[0].organization_id = 'other-org';
    const foreign = await loadRoute('app/api/procurement/requisitions/[id]/route.ts', records, buyer).PATCH(json, params);
    assert.equal(foreign.status, 403);
    const po = { headers: new Headers({ 'content-type': 'multipart/form-data' }), formData: async () => ({ get: key => key === 'action' ? 'issue_po' : null }) };
    const premature = await loadRoute('app/api/procurement/requisitions/[id]/route.ts', fixture(), buyer).PATCH(po, params);
    assert.equal(premature.status, 409);
});

test('a durable recovery event is required before any bulk record is changed', async () => {
    const records = fixture(), sent = [];
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer, sent, 'outbox').POST(upload());
    assert.equal(response.status, 500);
    assert.deepEqual(records.property_monthly_requisitions.map(row => row.status), ['submitted', 'submitted']);
    assert.equal(sent.length, 0);
});

function serviceMethod(path, startName, endName, globals, context) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const start = source.indexOf('    async ' + startName + '(');
    const end = source.indexOf('    async ' + endName + '(', start);
    const method = source.slice(start, end).trim().replace('async ' + startName, 'async function handler').replace(/,\s*$/, '');
    const compiled = ts.transpileModule(method + '\nexports.handler = handler;', { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, console, ...globals });
    return payload => exports.handler.call(context, payload);
}

test('batch recovery only summarizes successfully saved records from its own upload', async () => {
    const records = fixture(), sent = [];
    const batch = '66666666-6666-4666-8666-666666666666';
    const row = records.property_monthly_requisitions[0], notes = JSON.parse(row.notes);
    notes.vendor_quotation = approval.prepareBulkApproval([row], { batch_id: batch })[0].vendor_quotation;
    row.notes = JSON.stringify(notes);
    const handler = serviceMethod('backend/services/WhatsAppEventProcessor.ts', 'handleRequisitionApprovalBatchRequested',
        'handleRequisitionApprovalRequested', { ...approval, supabaseAdmin: database(records) },
        { dispatch: async value => sent.push(value) });
    await handler({ batch_id: batch, organization_id: org, requisition_ids: [noida, plaza], approver_id: reviewer });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].paramValues.total_amount, '16,318');
    assert.doesNotMatch(sent[0].paramValues.property, /Plaza/);
    assert.equal(sent[0].entityId, batch);
});

test('a failed durable queue insert rejects rather than falsely reporting success', async () => {
    const source = readFileSync(new URL('../backend/services/WhatsAppQueueService.ts', import.meta.url), 'utf8');
    const exports = {};
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    const admin = { from(table) {
        return { select() { return this; }, in() { return this; }, eq() { return this; },
            insert() { this.inserting = true; return this; },
            then(resolve) {
                return Promise.resolve({
                    data: table === 'users' ? [{ id: reviewer, phone: '9876543210' }] : [],
                    error: table === 'whatsapp_queue' && this.inserting ? new Error('Queue unavailable') : null
                }).then(resolve);
            }
        };
    } };
    vm.runInNewContext(compiled, { exports, console, require: name => name.endsWith('/admin') ? { supabaseAdmin: admin } : {} });
    await assert.rejects(() => exports.WhatsAppQueueService.enqueue({
        userIds: [reviewer], message: 'Batch', eventType: 'REQUISITION_APPROVAL_REQUESTED',
        entityId: 'batch-id', templateName: 'requisition_approval_requested_v1', durableBatch: true
    }), /Queue unavailable/);
});

test('bulk queue failures surface a warning and leave a failed recovery event', async () => {
    const records = fixture(), sent = [];
    const response = await loadRoute('app/api/procurement/requisitions/bulk-approval/route.ts', records, buyer, sent, 'dispatch').POST(upload());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).notification_warning, true);
    assert.equal(records.event_outbox[0].status, 'failed');
    assert.deepEqual(records.property_monthly_requisitions.map(row => row.status), ['pending_approval', 'pending_approval']);
});

test('durable recipient resolution propagates failed settings, memberships and user reads', async () => {
    const source = readFileSync(new URL('../backend/services/WhatsAppRecipientResolver.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    for (const failingTable of ['organization_settings', 'organization_memberships', 'users']) {
        const exports = {};
        const admin = { from(table) {
            return { select() { return this; }, eq() { return this; }, in() { return this; },
                maybeSingle() { return Promise.resolve({ data: null, error: table === failingTable ? new Error('Read unavailable') : null }); },
                then(resolve) { return Promise.resolve({ data: [], error: table === failingTable ? new Error('Read unavailable') : null }).then(resolve); }
            };
        } };
        vm.runInNewContext(compiled, { exports, console, require: () => ({ supabaseAdmin: admin }) });
        await assert.rejects(() => exports.WhatsAppRecipientResolver.resolveRecipients({
            organizationId: org, featureKey: 'requisition_approval_requested', strictReads: true,
            contextualUsers: { approverId: reviewer }
        }), /Read unavailable/);
    }
});
