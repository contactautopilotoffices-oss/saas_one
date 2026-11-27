import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as approval from '../backend/lib/procurement/requisition-approval.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const propId = '22222222-2222-4222-8222-222222222222';
const siteUser = '33333333-3333-4333-8333-333333333333';
const otherSiteUser = '44444444-4444-4444-8444-444444444444';
const outsider = '55555555-5555-4555-8555-555555555555';
const reqId = '66666666-6666-4666-8666-666666666666';

function createDb(records) {
    return {
        from(table) {
            let rows = records[table] || [];
            let patch = null;
            const query = {
                select() { return query; },
                eq(k, v) { rows = rows.filter(r => r[k] === v); return query; },
                is(k, v) { rows = rows.filter(r => r[k] === v); return query; },
                in(k, vals) { rows = rows.filter(r => vals.includes(r[k])); return query; },
                order() { return query; },
                insert(val) {
                    (records[table] ||= []).push(...(Array.isArray(val) ? val : [val]));
                    return query;
                },
                update(val) { patch = val; return query; },
                async single() { return query.maybeSingle(); },
                async maybeSingle() {
                    if (patch) rows.forEach(r => Object.assign(r, patch));
                    return { data: rows[0] || null, error: null };
                },
                then(resolve) {
                    if (patch) rows.forEach(r => Object.assign(r, patch));
                    return Promise.resolve({ data: rows, error: null }).then(resolve);
                },
            };
            return query;
        },
        storage: {
            from: () => ({
                async upload(path) { return { data: { path }, error: null }; },
            }),
        },
    };
}

function loadPatchRoute(records, actor, actorProps = [propId], artifactsCalls = []) {
    const exports = {};
    const admin = createDb(records);
    const source = readFileSync(new URL('../app/api/procurement/requisitions/[id]/route.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    vm.runInNewContext(compiled, {
        exports,
        console,
        Buffer,
        URL,
        Headers,
        Response,
        require: name => {
            if (name === 'next/server') return { NextResponse: { json: Response.json } };
            if (name.endsWith('/server')) {
                return {
                    createClient: async () => ({
                        auth: {
                            getUser: async () => ({
                                data: { user: actor ? { id: actor, email: `${actor}@test.local` } : null },
                                error: null,
                            }),
                        },
                    }),
                };
            }
            if (name.endsWith('/admin')) return { createAdminClient: () => admin };
            if (name.endsWith('requisition-approval.mjs')) return approval;
            if (name.endsWith('requisitionSubmission')) {
                return {
                    prepareRequisitionArtifacts: async (_admin, params) => {
                        artifactsCalls.push(params);
                        const total = (params.items || []).reduce(
                            (sum, i) => sum + ((Number(i.requested_qty) || 0) * (Number(i.unit_price) || 0)),
                            0,
                        );
                        return {
                            publicUrl: `/api/storage/procurement_requisitions/${params.propertyId}/updated_${Date.now()}.xlsx`,
                            uploadedFileName: `Updated_${params.floorTag.replace(/\s+/g, '_')}.xlsx`,
                            fileSizeBytes: 2048,
                            totalEstimatedAmount: total,
                            requestedItemsCount: (params.items || []).filter(i => (i.requested_qty || 0) > 0).length,
                            isOverBudget: false,
                            allocatedBudgetLimit: 50000,
                            overBudgetAmount: 0,
                            baseNotesObj: {
                                floor_tag: params.floorTag,
                                site_notes: params.siteNotes,
                                total_estimated_amount: total,
                                total_items_count: (params.items || []).length,
                                categories: ['HK'],
                                items: params.items,
                                budget_limit: 50000,
                                is_over_budget: false,
                                over_budget_amount: 0,
                            },
                        };
                    },
                };
            }
            if (name.endsWith('WhatsAppEventProcessor')) return { WhatsAppEventProcessor: { dispatch: async () => {} } };
            if (name.endsWith('EmailRecipientResolver')) return { EmailRecipientResolver: { resolveRecipients: async () => ({ enabled: false, emails: [] }) } };
            if (name.endsWith('EmailService')) return { EmailService: { sendGenericNotificationEmail: async () => {} } };
            if (name.endsWith('/auth/callerAccess')) {
                return {
                    resolveCaller: async () => actor
                        ? {
                            userId: actor,
                            email: `${actor}@test.local`,
                            isMasterAdmin: false,
                            orgMemberships: [],
                            propertyMemberships: actorProps.map(pid => ({ property_id: pid, organization_id: org, role: 'property_admin' })),
                        }
                        : Response.json({ error: 'Unauthorized' }, { status: 401 }),
                    isCallerError: value => value instanceof Response,
                    forbidden: (message = 'Forbidden') => Response.json({ error: message }, { status: 403 }),
                    guardOrg: async () => null,
                    propertyOrgId: async () => org,
                    canUseProperty: (caller, pid) => caller.propertyMemberships.some(m => m.property_id === pid),
                    belongsToOrg: async () => false,
                };
            }
            throw new Error(`Unexpected import: ${name}`);
        },
    });
    return exports;
}

function makeFixture(status = 'submitted') {
    return {
        properties: [{ id: propId, name: 'Plaza One', address: 'MG Road', city: 'Bengaluru' }],
        users: [
            { id: siteUser, full_name: 'Asha Site', email: 'asha@site.test', phone: '9000000001', is_master_admin: false, deleted_at: null },
            { id: otherSiteUser, full_name: 'Ravi Manager', email: 'ravi@site.test', phone: '9000000002', is_master_admin: false, deleted_at: null },
            { id: outsider, full_name: 'Outsider', email: 'out@site.test', phone: '9000000003', is_master_admin: false, deleted_at: null },
        ],
        organization_memberships: [],
        event_outbox: [],
        property_monthly_requisitions: [
            {
                id: reqId,
                organization_id: org,
                property_id: propId,
                floor_tag: 'All Floors',
                requisition_month: 11,
                requisition_year: 2026,
                file_url: '/api/storage/procurement_requisitions/initial.xlsx',
                file_name: 'initial.xlsx',
                file_size_bytes: 1024,
                status,
                uploaded_by: siteUser,
                updated_at: '2026-11-20T09:00:00.000Z',
                notes: JSON.stringify({
                    floor_tag: 'All Floors',
                    site_notes: 'Initial order',
                    total_estimated_amount: 500,
                    items: [{ id: 'cat-1', name: 'Hand Wash', category: 'HK', requested_qty: 5, available_stock_qty: 2, unit_price: 100 }],
                    status_history: [{ status: 'submitted', by_id: siteUser, by_name: 'Asha Site', timestamp: '2026-11-20T09:00:00.000Z' }],
                }),
            },
        ],
    };
}

test('canSiteEditRequisition allows pre-approval/rejected statuses and locks sent/approved/ordered', () => {
    for (const status of approval.EDITABLE_SITE_STATUSES) {
        assert.equal(approval.canSiteEditRequisition({ status }), true, `Expected ${status} to be editable`);
    }
    for (const lockedStatus of ['pending_approval', 'approved', 'ordered', '', null]) {
        assert.equal(approval.canSiteEditRequisition({ status: lockedStatus }), false, `Expected ${lockedStatus} to be locked`);
    }
});

test('prepareRequisitionEdit records editor name, date/time, edit count, and preserves prior history', () => {
    const existing = makeFixture('submitted').property_monthly_requisitions[0];
    const firstEditAt = '2026-11-21T10:15:00.000Z';
    const notes1 = approval.prepareRequisitionEdit(existing, {
        baseNotes: { total_estimated_amount: 900, items: [{ name: 'Hand Wash', requested_qty: 9, unit_price: 100 }] },
        editorId: otherSiteUser,
        editorName: 'Ravi Manager',
        editedAt: firstEditAt,
        nextStatus: 'submitted',
    });

    assert.equal(notes1.edit_info.is_edited, true);
    assert.equal(notes1.edit_info.edit_count, 1);
    assert.equal(notes1.edit_info.edited_by_name, 'Ravi Manager');
    assert.equal(notes1.edit_info.edited_at, firstEditAt);
    assert.equal(notes1.edit_history.length, 1);
    assert.equal(notes1.status_history.length, 2);
    assert.equal(notes1.status_history.at(-1).action, 'edited');

    const secondEditAt = '2026-11-22T14:30:00.000Z';
    const notes2 = approval.prepareRequisitionEdit(
        { status: 'submitted', notes: JSON.stringify(notes1) },
        {
            baseNotes: { total_estimated_amount: 1200, items: [{ name: 'Hand Wash', requested_qty: 12, unit_price: 100 }] },
            editorId: siteUser,
            editorName: 'Asha Site',
            editedAt: secondEditAt,
            nextStatus: 'submitted',
        },
    );

    assert.equal(notes2.edit_info.edit_count, 2);
    assert.equal(notes2.edit_info.edited_by_name, 'Asha Site');
    assert.equal(notes2.edit_info.edited_at, secondEditAt);
    assert.equal(notes2.edit_history.length, 2);
    assert.equal(notes2.edit_history[0].edited_by_name, 'Ravi Manager');
    assert.equal(notes2.edit_history[1].edited_by_name, 'Asha Site');
    assert.match(approval.formatEditDateTime(secondEditAt), /2026/);
    assert.equal(approval.formatEditDateTime(''), '');
});

test('PATCH edit_requisition lets site team edit and re-upload, marks Edited with name and timestamp', async () => {
    const records = makeFixture('submitted');
    const calls = [];
    const req = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
            action: 'edit_requisition',
            floor_tag: '2nd Floor',
            site_notes: 'Updated qty after stock recount',
            items: [{ id: 'cat-1', name: 'Hand Wash', category: 'HK', requested_qty: 8, available_stock_qty: 1, unit_price: 100 }],
        }),
    };

    const res = await loadPatchRoute(records, otherSiteUser, [propId], calls).PATCH(req, { params: Promise.resolve({ id: reqId }) });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(calls.length, 1);
    assert.equal(body.success, true);
    assert.equal(body.requisition.floor_tag, '2nd Floor');
    assert.equal(body.requisition.status, 'submitted');
    assert.equal(body.requisition.uploaded_by, siteUser);
    assert.equal(body.requisition.edit_info.is_edited, true);
    assert.equal(body.requisition.edit_info.edit_count, 1);
    assert.equal(body.requisition.edit_info.edited_by_name, 'Ravi Manager');
    assert.ok(body.requisition.edit_info.edited_at);
    assert.equal(body.requisition.edit_history.length, 1);
    assert.equal(records.event_outbox.length, 1);
    assert.equal(records.event_outbox[0].event_type, 'REQUISITION_EDITED');
});

test('PATCH edit_requisition resets rejected status back to submitted and clears stale quote while keeping rejection history', async () => {
    const records = makeFixture('rejected');
    const row = records.property_monthly_requisitions[0];
    row.notes = JSON.stringify({
        ...JSON.parse(row.notes),
        vendor_quotation: { vendor_name: 'Old Quote', total_quoted_amount: 500 },
        approver_info: { id: outsider, name: 'Approver', status: 'rejected', remarks: 'Reduce qty' },
        status_history: [
            { status: 'submitted', by_id: siteUser, by_name: 'Asha Site', timestamp: '2026-11-20T09:00:00.000Z' },
            { status: 'rejected', by_id: outsider, by_name: 'Approver', remarks: 'Reduce qty', timestamp: '2026-11-21T09:00:00.000Z' },
        ],
    });

    const req = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
            action: 'edit_requisition',
            floor_tag: 'All Floors',
            site_notes: 'Reduced quantities per feedback',
            items: [{ id: 'cat-1', name: 'Hand Wash', category: 'HK', requested_qty: 3, available_stock_qty: 2, unit_price: 100 }],
        }),
    };

    const res = await loadPatchRoute(records, siteUser, [propId]).PATCH(req, { params: Promise.resolve({ id: reqId }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.requisition.status, 'submitted');
    assert.equal(body.requisition.approver_info, null);
    assert.equal(body.requisition.edit_info.edited_by_name, 'Asha Site');
    assert.equal(body.requisition.edit_info.previous_status, 'rejected');
    const savedNotes = JSON.parse(records.property_monthly_requisitions[0].notes);
    assert.equal(savedNotes.status_history.length, 3);
    assert.equal(savedNotes.status_history[1].status, 'rejected');
});

test('PATCH edit_requisition blocks unauthorized users and locked statuses', async () => {
    const reqPayload = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ action: 'edit_requisition', items: [] }),
    };

    const anonRes = await loadPatchRoute(makeFixture('submitted'), null, []).PATCH(reqPayload, { params: Promise.resolve({ id: reqId }) });
    assert.equal(anonRes.status, 401);

    const forbiddenRes = await loadPatchRoute(makeFixture('submitted'), outsider, []).PATCH(reqPayload, { params: Promise.resolve({ id: reqId }) });
    assert.equal(forbiddenRes.status, 403);

    for (const status of ['pending_approval', 'approved', 'ordered']) {
        const lockedRes = await loadPatchRoute(makeFixture(status), siteUser, [propId]).PATCH(reqPayload, { params: Promise.resolve({ id: reqId }) });
        assert.equal(lockedRes.status, 409, `Expected ${status} edit to return 409`);
    }
});

test('POST updates recent editable requisition with Edited metadata when items change instead of silently debouncing', async () => {
    const records = makeFixture('submitted');
    records.property_monthly_requisitions[0].created_at = new Date().toISOString();
    const admin = createDb(records);
    const exports = {};
    const source = readFileSync(new URL('../app/api/procurement/requisitions/route.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    vm.runInNewContext(compiled, {
        exports,
        console,
        Buffer,
        URL,
        Headers,
        Response,
        require: name => {
            if (name === 'next/server') return { NextResponse: { json: Response.json } };
            if (name.endsWith('/admin')) return { createAdminClient: () => admin };
            if (name.endsWith('requisition-approval.mjs')) return approval;
            if (name.endsWith('requisitionDelivery')) return { deliverySummaries: async () => new Map() };
            if (name.endsWith('requisitionSubmission')) {
                return {
                    prepareRequisitionArtifacts: async (_a, params) => ({
                        publicUrl: '/api/storage/procurement_requisitions/reupload.xlsx',
                        uploadedFileName: 'reupload.xlsx',
                        fileSizeBytes: 3072,
                        totalEstimatedAmount: 1000,
                        requestedItemsCount: 1,
                        isOverBudget: false,
                        allocatedBudgetLimit: 50000,
                        overBudgetAmount: 0,
                        rawItems: params.items,
                        baseNotesObj: {
                            floor_tag: params.floorTag,
                            site_notes: params.siteNotes,
                            total_estimated_amount: 1000,
                            total_items_count: params.items.length,
                            items: params.items,
                        },
                    }),
                };
            }
            if (name.endsWith('/auth/callerAccess')) {
                return {
                    resolveCaller: async () => ({
                        userId: otherSiteUser,
                        email: 'ravi@site.test',
                        isMasterAdmin: false,
                        orgMemberships: [],
                        propertyMemberships: [{ property_id: propId, organization_id: org, role: 'property_admin' }],
                    }),
                    isCallerError: () => false,
                    forbidden: (m = 'Forbidden') => Response.json({ error: m }, { status: 403 }),
                    canUseProperty: () => true,
                    propertyOrgId: async () => org,
                    internalOrgIds: () => [],
                    internalPropertyIds: () => [propId],
                };
            }
            throw new Error(`Unexpected import: ${name}`);
        },
    });

    const unchangedReq = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
            organization_id: org,
            property_id: propId,
            floor_tag: 'All Floors',
            requisition_month: 11,
            requisition_year: 2026,
            user_id: siteUser,
            site_notes: 'Initial order',
            items: [{ id: 'cat-1', name: 'Hand Wash', category: 'HK', requested_qty: 5, available_stock_qty: 2, unit_price: 100 }],
        }),
    };
    const sameUserRecords = makeFixture('submitted');
    sameUserRecords.property_monthly_requisitions[0].created_at = new Date().toISOString();
    // Same user & identical payload within 45s still debounces
    const exportsSame = {};
    vm.runInNewContext(compiled, {
        exports: exportsSame, console, Buffer, URL, Headers, Response,
        require: name => {
            if (name === 'next/server') return { NextResponse: { json: Response.json } };
            if (name.endsWith('/admin')) return { createAdminClient: () => createDb(sameUserRecords) };
            if (name.endsWith('requisition-approval.mjs')) return approval;
            if (name.endsWith('requisitionDelivery')) return { deliverySummaries: async () => new Map() };
            if (name.endsWith('requisitionSubmission')) return {
                prepareRequisitionArtifacts: async (_a, p) => ({
                    publicUrl: '/u.xlsx', uploadedFileName: 'u.xlsx', fileSizeBytes: 100,
                    totalEstimatedAmount: 500, requestedItemsCount: 1, isOverBudget: false,
                    allocatedBudgetLimit: 50000, overBudgetAmount: 0, rawItems: p.items,
                    baseNotesObj: { floor_tag: p.floorTag, site_notes: p.siteNotes, items: p.items },
                }),
            };
            if (name.endsWith('/auth/callerAccess')) return {
                resolveCaller: async () => ({ userId: siteUser, email: 'asha@site.test', isMasterAdmin: false, orgMemberships: [], propertyMemberships: [] }),
                isCallerError: () => false, forbidden: m => Response.json({ error: m }, { status: 403 }),
                canUseProperty: () => true, propertyOrgId: async () => org, internalOrgIds: () => [], internalPropertyIds: () => [propId],
            };
            throw new Error(`Unexpected import: ${name}`);
        },
    });
    const debouncedRes = await exportsSame.POST(unchangedReq);
    assert.equal((await debouncedRes.json()).debounced, true);

    // Changed items within 45s updates existing record and marks Edited
    const changedReq = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
            organization_id: org,
            property_id: propId,
            floor_tag: 'All Floors',
            requisition_month: 11,
            requisition_year: 2026,
            user_id: otherSiteUser,
            site_notes: 'Edited via Create Requisition re-submit',
            items: [{ id: 'cat-1', name: 'Hand Wash', category: 'HK', requested_qty: 10, available_stock_qty: 1, unit_price: 100 }],
        }),
    };
    const editRes = await exports.POST(changedReq);
    assert.equal(editRes.status, 200);
    const editBody = await editRes.json();
    assert.equal(editBody.debounced, undefined);
    assert.equal(editBody.requisition.edit_info.is_edited, true);
    assert.equal(editBody.requisition.edit_info.edited_by_name, 'Ravi Manager');
    assert.equal(records.event_outbox[0].event_type, 'REQUISITION_EDITED');
});
