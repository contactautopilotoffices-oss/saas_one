// End-to-end check of "Replace Comparison File" in a real browser.
// The page is the real MonthlyRequisitionsTab; the fixture server runs the real
// reapproval / approve / bulk-approval route handlers against an in-memory database.
// Run: node --test --test-isolation=none tests/procurement-reapproval/browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
import * as approval from '../../backend/lib/procurement/requisition-approval.mjs';

const root = new URL('../..', import.meta.url).pathname;
const org = '11111111-1111-4111-8111-111111111111';
const buyer = '22222222-2222-4222-8222-222222222222';
const reviewer = '33333333-3333-4333-8333-333333333333';
const noida = '44444444-4444-4444-8444-444444444444';
const plaza = '55555555-5555-4555-8555-555555555555';
const tower = '77777777-7777-4777-8777-777777777777';
const batch = '66666666-6666-4666-8666-666666666666';
const now = '2026-10-09T00:00:00Z';

const scratch = await mkdtemp(join(tmpdir(), 'reapproval-browser-'));
execFileSync(join(root, 'node_modules/.bin/esbuild'), ['tests/procurement-reapproval/fixtures/app.tsx', '--bundle',
    '--outfile=' + join(scratch, 'app.js'), '--define:process.env.NODE_ENV="development"', '--loader:.mjs=js',
    '--alias:@/frontend/utils/supabase/client=./tests/procurement-reapproval/fixtures/supabase.ts'], { cwd: root, stdio: 'pipe' });
const bundle = await promisify(readFile)(join(scratch, 'app.js'), 'utf8');
// Real app styles only when screenshots are wanted; the checks do not depend on them.
let css = '';
if (process.env.REAPPROVAL_SCREENSHOTS) {
    const { default: postcss } = await import('postcss');
    const { default: tailwind } = await import('@tailwindcss/postcss');
    const source = join(root, 'app/globals.css');
    css = (await postcss([tailwind()]).process(await promisify(readFile)(source, 'utf8'), { from: source })).css;
}

/** Three sites sent together in one batch: Noida approved, Plaza pending, Tower already has a PO. */
function seed() {
    const site = (id, name, status, month, amount) => {
        const row = { id, organization_id: org, property_id: 'property-' + name, status, updated_at: now, created_at: now,
            requisition_month: month, requisition_year: 2026, uploaded_by: buyer, floor_tag: 'All Floors',
            property: { id: 'property-' + name, name }, uploader: { id: buyer, full_name: 'Site Admin', email: 'site@example.test' },
            notes: JSON.stringify({ total_estimated_amount: amount, items: [{ item_name: 'Soap', requested_qty: 1, unit_price: amount }] }) };
        const notes = JSON.parse(row.notes);
        notes.vendor_quotation = { ...approval.prepareBulkApproval([row], { batch_id: batch, vendor_name: 'Vendor Quote', notes: 'Rates from L1' })[0].vendor_quotation,
            file_url: 'https://files.test/old-comparison.xlsx', file_name: 'old-comparison.xlsx', uploaded_at: now };
        notes.approver_info = status === 'approved'
            ? { id: reviewer, name: 'Reviewer', status: 'approved', remarks: 'Fine', action_at: now }
            : { id: reviewer, name: 'Reviewer', status: 'pending' };
        notes.batch_id = batch;
        row.notes = JSON.stringify(notes);
        return row;
    };
    return {
        users: [{ id: buyer, full_name: 'Priya Procurement', email: 'buyer@example.test', is_master_admin: false },
            { id: reviewer, full_name: 'Reviewer', email: 'reviewer@example.test', is_master_admin: false }],
        organization_memberships: [
            { user_id: buyer, organization_id: org, role: 'procurement', is_active: true },
            { user_id: reviewer, organization_id: org, role: 'ops_super_admin', is_active: true }],
        property_monthly_requisitions: [site(noida, 'Noida', 'approved', 10, 16318), site(plaza, 'Plaza', 'pending_approval', 10, 73492),
            site(tower, 'Tower', 'ordered', 10, 5000)],
        requisition_deliveries: [], event_outbox: [], __sent: [], __emails: [], __uploads: []
    };
}

function database(records) {
    return { from(table) {
        let selected = records[table] || (records[table] = []);
        let patch;
        return {
            select() { return this; }, order() { return this; },
            insert(value) { selected.push(...(Array.isArray(value) ? value : [value])); return this; },
            eq(key, value) { selected = selected.filter(row => row[key] === value); return this; },
            in(key, values) { selected = selected.filter(row => values.includes(row[key])); return this; },
            like(key, pattern) { const part = pattern.replace(/^%|%$/g, ''); selected = selected.filter(row => String(row[key] || '').includes(part)); return this; },
            update(value) { patch = value; return this; },
            async single() { return this.maybeSingle(); },
            async maybeSingle() { if (patch) selected.forEach(row => Object.assign(row, patch)); return { data: selected[0] || null, error: null }; },
            then(resolve) { if (patch) selected.forEach(row => Object.assign(row, patch)); return Promise.resolve({ data: selected, error: null }).then(resolve); }
        };
    }, storage: { from: () => ({
        async upload(path, body, options) { records.__uploads.push({ path, bytes: body.length, options }); return { data: { path }, error: null }; },
        async remove() { return { data: null, error: null }; },
        getPublicUrl: path => ({ data: { publicUrl: 'https://files.test/' + path } })
    }) } };
}

/** The real route module, compiled and wired to the in-memory database. */
function route(path, records, actor) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(join(root, path), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, console, crypto: globalThis.crypto, Buffer, URL, require: name => {
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        if (name.endsWith('/server')) return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: actor ? {
            id: actor.id, user_metadata: { full_name: actor.full_name } } : null }, error: null }) } }) };
        if (name.endsWith('/admin')) return { createAdminClient: () => database(records) };
        if (name.endsWith('requisition-approval.mjs')) return approval;
        if (name.endsWith('WhatsAppEventProcessor')) return { WhatsAppEventProcessor: { dispatch: async message => { records.__sent.push(message); } } };
        if (name.endsWith('EmailRecipientResolver')) return { EmailRecipientResolver: { resolveRecipients: async ({ contextualEmails = [] }) =>
            ({ enabled: true, emails: contextualEmails.length ? contextualEmails : ['team@example.test'] }) } };
        if (name.endsWith('EmailService')) return { EmailService: { sendGenericNotificationEmail: async email => { records.__emails.push(email); } } };
        if (name.endsWith('catalogAccess')) return { isMissingSchemaError: () => false };
        throw new Error('Unexpected import ' + name);
    } });
    return exports;
}

/** Same shape as GET /api/procurement/requisitions. */
function listResponse(records, status) {
    return records.property_monthly_requisitions
        .filter(row => !status || status === 'all' || row.status === status)
        .map(row => {
            const notes = JSON.parse(row.notes);
            const delivered = records.requisition_deliveries.some(d => d.requisition_id === row.id && d.status === 'confirmed');
            return { ...row, items: notes.items, categories: [], total_estimated_amount: notes.total_estimated_amount,
                total_items_count: notes.items.length, site_notes: '', approver_info: notes.approver_info || null,
                vendor_quotation: approval.siteVendorQuotation({ ...row, vendor_quotation: notes.vendor_quotation }),
                is_over_budget: false, budget_limit: 0, over_budget_amount: 0, budget_breakdown: null,
                delivery: delivered ? { state: 'partial', items_ordered: 1, items_complete: 0, challans: 1 } : null };
        });
}

async function fixture(records) {
    const errors = [];
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://fixture');
            if (!url.pathname.startsWith('/api/')) {
                res.setHeader('content-type', 'text/html');
                res.end('<!doctype html><meta charset="utf-8"><style>' + css + '</style><div id="root"></div><script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script>');
                return;
            }
            const actor = records.users.find(user => user.id === req.headers['x-fixture-actor']) || null;
            const parts = []; for await (const part of req) parts.push(part);
            const request = new Request('http://fixture' + req.url, { method: req.method, headers: req.headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(parts) });
            let response;
            if (url.pathname === '/api/properties') response = Response.json([{ id: 'property-Noida', name: 'Noida' }]);
            else if (url.pathname === '/api/procurement/requisitions/approvers') response = Response.json({ approvers: [
                { id: reviewer, full_name: 'Reviewer', email: 'reviewer@example.test', role: 'ops_super_admin' }] });
            else if (url.pathname === '/api/procurement/requisitions') response = Response.json({ requisitions: listResponse(records, url.searchParams.get('status')) });
            else if (url.pathname === '/api/procurement/requisitions/reapproval') {
                const handler = route('app/api/procurement/requisitions/reapproval/route.ts', records, actor);
                response = await (req.method === 'GET' ? handler.GET(request) : handler.POST(request));
            } else if (url.pathname === '/api/procurement/requisitions/bulk-approval') {
                response = await route('app/api/procurement/requisitions/bulk-approval/route.ts', records, actor).POST(request);
            } else if (/\/api\/procurement\/requisitions\/[^/]+\/approve$/.test(url.pathname)) {
                const id = url.pathname.split('/').at(-2);
                response = await route('app/api/procurement/requisitions/[id]/approve/route.ts', records, actor).PATCH(request, { params: Promise.resolve({ id }) });
            } else response = Response.json({ error: 'Not in fixture: ' + url.pathname }, { status: 404 });
            if (response.status >= 500) errors.push(url.pathname + ' ' + response.status);
            res.statusCode = response.status;
            res.setHeader('content-type', 'application/json');
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
            errors.push(String(error)); res.statusCode = 500; res.end(JSON.stringify({ error: String(error) }));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, errors, url: 'http://127.0.0.1:' + server.address().port };
}

async function open(url, as) {
    // CHROMIUM_PATH points at a locally installed browser when Playwright's own download is absent.
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    if (process.env.REAPPROVAL_DEBUG) page.on('console', message => console.log('[page]', message.type(), message.text()));
    const pageErrors = [], dialogs = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
    await page.goto(url + '/?as=' + as);
    await page.getByText('Monthly Material Requisitions').waitFor();
    return { browser, page, pageErrors, dialogs };
}

const row = (page, name) => page.locator('tr', { hasText: name });
const notesOf = (records, id) => JSON.parse(records.property_monthly_requisitions.find(r => r.id === id).notes);
const shot = process.env.REAPPROVAL_SCREENSHOTS;

test('procurement replaces the comparison file for a sent batch, and the approver re-approves', { timeout: 120000 }, async () => {
    const records = seed();
    const { server, errors, url } = await fixture(records);
    let session = await open(url, 'procurement');
    try {
        const { page } = session;
        // Row buttons: approved and pending sites can be corrected, the PO-issued site cannot.
        await row(page, 'Plaza').getByRole('button', { name: 'Replace File' }).waitFor();
        assert.equal(await row(page, 'Noida').getByRole('button', { name: 'Replace File' }).count(), 1);
        assert.equal(await row(page, 'Tower').getByRole('button', { name: 'Replace File' }).count(), 0);

        // Multi-site upload no longer offers the pending site and says why.
        await page.getByRole('button', { name: 'Upload Quote (Multi-Site)' }).click();
        await page.getByText(/1 site is already sent for approval and not listed here/).waitFor();
        await page.getByRole('button', { name: 'Cancel' }).click();

        // Toolbar picker -> batch -> confirm screen.
        await page.getByRole('button', { name: 'Replace Comparison File' }).click();
        await page.getByRole('button', { name: /Multi-site upload · October 2026/ }).click();
        const dialog = page.locator('div.fixed', { hasText: 'Sites in this upload' });
        await dialog.getByText('Locked: PO already issued', { exact: true }).waitFor();
        await dialog.getByText('Will need approval again', { exact: true }).waitFor();
        await dialog.getByText('Gets the new file', { exact: true }).waitFor();
        await dialog.getByText(/2 sites will get the new file\. 1 of them was already approved/).waitFor();
        assert.equal(await dialog.getByLabel('Select approver *').inputValue(), reviewer, 'same approver by default');
        const submit = page.getByRole('button', { name: /Replace File & Send for Re-approval/ });
        assert.equal(await submit.isDisabled(), true, 'a new file is required');
        await dialog.getByLabel(/Corrected comparison file/).setInputFiles({ name: 'fixed comparison.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('rev2') });
        await dialog.getByText(/Ready to upload as Rev 2: fixed comparison\.xlsx/).waitFor();
        await dialog.getByLabel(/What was corrected/).fill('Fixed the Plaza rate');
        if (shot) await page.screenshot({ path: join(shot, '1-replace-modal.png') });
        await submit.click();
        await page.getByRole('button', { name: 'Replace Comparison File' }).waitFor();
        await page.locator('div.fixed', { hasText: 'Sites in this upload' }).waitFor({ state: 'detached' });

        assert.deepEqual(session.dialogs.map(d => d.type), ['confirm', 'alert']);
        assert.match(session.dialogs[0].message, /1 site\(s\) were already approved on the old file/);
        assert.match(session.dialogs[1].message, /Rev 2\)\. 2 requisition\(s\) sent for re-approval\. 1 approved site\(s\) need approval again\. 1 locked site\(s\) kept the old file\./);

        // Saved state and notifications.
        const statuses = Object.fromEntries(records.property_monthly_requisitions.map(r => [r.property.name, r.status]));
        assert.deepEqual(statuses, { Noida: 'pending_approval', Plaza: 'pending_approval', Tower: 'ordered' });
        assert.equal(notesOf(records, plaza).vendor_quotation.revision, 2);
        assert.equal(notesOf(records, plaza).vendor_quotation.reapproval_note, 'Fixed the Plaza rate');
        assert.equal(notesOf(records, tower).vendor_quotation.file_name, 'old-comparison.xlsx');
        assert.equal(records.__uploads.length, 1);
        assert.equal(records.__uploads[0].bytes, 4, 'the real file bytes reached the server');
        const toApprover = records.__sent.filter(m => m.featureKey === 'requisition_approval_requested');
        assert.equal(toApprover.length, 1, 'one WhatsApp summary to the approver');
        assert.doesNotMatch(toApprover[0].paramValues.property, /Tower/);
        assert.equal(records.__sent.filter(m => m.featureKey === 'requisition_status_updated').length, 1, 'on-hold notice for Noida only');
        assert.equal(records.__emails.length, 2);

        // List refreshed with the re-approval badge; Issue PO is gone for Noida.
        await row(page, 'Plaza').getByText('Re-approval · Rev 2').waitFor();
        await row(page, 'Noida').getByText('Re-approval · Rev 2').waitFor();
        assert.equal(await row(page, 'Noida').getByRole('button', { name: 'Issue PO' }).count(), 0);
        if (shot) await page.screenshot({ path: join(shot, '2-list-after.png') });
        assert.deepEqual(session.pageErrors, []);
        await session.browser.close();

        // Approver: sees the banner and old file, then approves on the new revision.
        session = await open(url, 'approver');
        await row(session.page, 'Noida').getByRole('button', { name: 'Review & Approve' }).click();
        const banner = session.page.getByRole('status').filter({ hasText: 'Re-approval request · Rev 2' });
        await banner.waitFor();
        await banner.getByText(/approved earlier by Reviewer on the old file and needs approval again/).waitFor();
        await banner.getByText('Fixed the Plaza rate').waitFor();
        assert.equal(await banner.getByRole('link', { name: /Rev 1: old-comparison\.xlsx/ }).getAttribute('href'), 'https://files.test/old-comparison.xlsx');
        if (shot) await session.page.screenshot({ path: join(shot, '3-approver-banner.png') });
        await session.page.getByRole('button', { name: 'Approve Requisition' }).click();
        await session.page.getByRole('status').filter({ hasText: 'Re-approval request' }).waitFor({ state: 'detached' });
        assert.match(session.dialogs.at(-1).message, /Approved successfully/);
        assert.equal(records.property_monthly_requisitions.find(r => r.id === noida).status, 'approved');
        assert.deepEqual(session.pageErrors, []);
        assert.deepEqual(errors, []);
    } finally {
        await session.browser.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});

test('an approver looking at an old file cannot approve after procurement replaces it again', { timeout: 120000 }, async () => {
    const records = seed();
    const { server, errors, url } = await fixture(records);
    const session = await open(url, 'approver');
    try {
        const { page } = session;
        await row(page, 'Plaza').getByRole('button', { name: 'Review & Approve' }).click();
        await page.getByText('Vendor Quotation Attached by Procurement').waitFor();

        // Procurement replaces the file while the approver still has Rev 1 open.
        const form = new FormData();
        form.set('organization_id', org); form.set('batch_id', batch); form.set('target_approver_id', reviewer);
        form.set('quote_file', new File(['rev2'], 'fixed.xlsx'));
        const replaced = await route('app/api/procurement/requisitions/reapproval/route.ts', records, records.users[0])
            .POST(new Request('http://fixture/api', { method: 'POST', body: form }));
        assert.equal(replaced.status, 200);

        await page.getByRole('button', { name: 'Approve Requisition' }).click();
        await page.getByText(/The comparison file was updated \(Rev 2\)\. Please review the new file before deciding\./).waitFor();
        assert.equal(records.property_monthly_requisitions.find(r => r.id === plaza).status, 'pending_approval');
        assert.deepEqual(session.pageErrors, []);
        assert.deepEqual(errors, []);
    } finally {
        await session.browser.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});

test('rejected sites are listed under their own tab and can be corrected; delivered sites cannot', { timeout: 120000 }, async () => {
    const records = seed();
    records.property_monthly_requisitions[1].status = 'rejected';
    records.requisition_deliveries.push({ requisition_id: noida, status: 'confirmed' });
    const { server, errors, url } = await fixture(records);
    const session = await open(url, 'procurement');
    try {
        const { page } = session;
        await row(page, 'Plaza').getByRole('button', { name: 'Replace File' }).waitFor();
        assert.equal(await row(page, 'Noida').getByRole('button', { name: 'Replace File' }).count(), 0, 'approved and delivered');
        await page.getByRole('button', { name: /^Rejected\s*1$/ }).click();
        await page.locator('tbody tr').filter({ hasText: 'Plaza' }).waitFor();
        assert.equal(await page.locator('tbody tr', { hasText: 'Noida' }).count(), 0);

        await row(page, 'Plaza').getByRole('button', { name: 'Replace File' }).click();
        const dialog = page.locator('div.fixed', { hasText: 'Sites in this upload' });
        await dialog.getByText('Locked: Delivery already received', { exact: true }).waitFor();
        await dialog.getByText('Locked: PO already issued', { exact: true }).waitFor();
        await dialog.getByLabel(/Corrected comparison file/).setInputFiles({ name: 'fixed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') });
        await page.getByRole('button', { name: /Replace File & Send for Re-approval \(1\)/ }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.deepEqual(session.dialogs.map(d => d.type), ['alert'], 'no confirm: nothing approved is reopened');
        assert.equal(records.property_monthly_requisitions.find(r => r.id === plaza).status, 'pending_approval');
        assert.equal(records.property_monthly_requisitions.find(r => r.id === noida).status, 'approved');
        assert.deepEqual(session.pageErrors, []);
        assert.deepEqual(errors, []);
    } finally {
        await session.browser.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
