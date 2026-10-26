import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Bundle the real component with fixture authentication/Supabase and inert ancillary dialogs.
// Deferred list responses intentionally ignore AbortSignal to verify stale-response protection.
// Uses the repository's existing webpack/TypeScript packages; no package download is required.
// Run: node --test tests/users/directory-loading.test.mjs
const root = new URL('../..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
let browser, server, url;
before(async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'user-directory-browser-'));
    await writeFile(join(scratch, 'auth.ts'), `export const useAuth = () => ({ membership: { org_role: 'staff' } });`);
    await writeFile(join(scratch, 'supabase.ts'), `export const createClient = () => ({ from() { throw new Error('Unexpected database access in directory fixture'); } });`);
    const app = `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import UserDirectory from '${root}/frontend/components/dashboard/UserDirectory';
        const root = createRoot(document.getElementById('root'));
        window.directoryRequests = [];
        window.fetch = (url, options) => new Promise((resolve, reject) => {
            window.directoryRequests.push({url: String(url), options, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}})), reject});
        });
        window.renderDirectory = props => root.render(<React.StrictMode><UserDirectory {...props} /></React.StrictMode>);
        window.renderDirectory({});
    `;
    await writeFile(join(scratch, 'app.tsx'), app);
    await writeFile(join(scratch, 'empty.tsx'), 'export default function FixtureBoundary() { return null; }');
    await writeFile(join(scratch, 'loader.cjs'), `const ts = require(${JSON.stringify(require.resolve('typescript'))}); module.exports = function(source) { return ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, esModuleInterop: true}}).outputText; };`);
    await new Promise((resolve, reject) => webpack({
        mode: 'development', devtool: false, entry: join(scratch, 'app.tsx'),
        output: {path: scratch, filename: 'app.js'},
        resolve: {extensions: ['.tsx', '.ts', '.js'], modules: [join(root, 'node_modules')], alias: {
            '@/frontend/context/AuthContext': join(scratch, 'auth.ts'),
            '@/frontend/utils/supabase/client': join(scratch, 'supabase.ts'),
            [join(root, 'frontend/components/dashboard/InviteMemberModal.tsx')]: join(scratch, 'empty.tsx'),
            [join(root, 'frontend/components/dashboard/ReliabilityBadge.tsx')]: join(scratch, 'empty.tsx'),
            [join(root, 'frontend/components/vms/ClientQRGeneratorModal.tsx')]: join(scratch, 'empty.tsx'),
        }},
        module: {rules: [{test: /\.tsx?$/, use: join(scratch, 'loader.cjs')}]},
    }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({all: false, errors: true}))) : resolve()));
    const bundle = await readFile(join(scratch, 'app.js'), 'utf8');
    server = createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<div id="root"></div><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
});
after(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});
async function fixture(t, preserveInitial = false) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(url);
    await page.getByRole('heading', { name: 'User Management' }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (!preserveInitial) await page.evaluate(() => { window.directoryRequests = []; });
    return page;
}
async function render(page, props, count) {
    await page.evaluate(props => window.renderDirectory(props), props);
    await page.waitForFunction(count => window.directoryRequests.length >= count, count);
}
async function resolve(page, index, body, status = 200) {
    await page.evaluate(({ index, body, status }) => window.directoryRequests[index].resolve(body, status), { index, body, status });
}
const user = (name, overrides = {}) => ({ id: name, full_name: name, email: `${name}@fixture.invalid`, propertyRole: 'staff', is_active: true, joined_at: '2026-10-01', is_approved: true, approval_status: 'approved', ...overrides });

test('waits for organization or property scope and never shows a premature empty state', async t => {
    const page = await fixture(t, true);
    assert.equal(await page.evaluate(() => window.directoryRequests.length), 0);
    assert.equal(await page.getByText('No users found.', { exact: true }).count(), 0);
    await render(page, { orgId: 'org-a' }, 1);
    assert.equal(await page.evaluate(() => window.directoryRequests.at(-1).url), '/api/users/list?orgId=org-a');
    await resolve(page, 0, { users: [] });
    await page.getByText('No users found.', { exact: true }).waitFor();
});

test('shows API failure with Retry and successful empty response only after retry', async t => {
    const page = await fixture(t);
    await render(page, { orgId: 'org-a' }, 1);
    await resolve(page, 0, { error: 'Directory access denied' }, 403);
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 3000 });
    await page.getByText('Directory access denied', { exact: true }).waitFor();
    assert.equal(await page.getByText('No users found.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.directoryRequests.length === 2);
    await resolve(page, 1, { users: [] });
    await page.getByText('No users found.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
});

test('shows transport and invalid response failures instead of an empty list', async t => {
    const page = await fixture(t);
    await render(page, { propertyId: 'property-a' }, 1);
    await page.evaluate(() => window.directoryRequests[0].reject(new Error('Network unavailable')));
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 3000 });
    assert.equal(await page.getByText('No users found.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.directoryRequests.length === 2);
    await resolve(page, 1, {});
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    assert.equal(await page.getByText('No users found.', { exact: true }).count(), 0);
});

test('ignores a stale organization success after the new scope succeeds', async t => {
    const page = await fixture(t);
    await render(page, { orgId: 'org-a' }, 1);
    await render(page, { orgId: 'org-b' }, 2);
    await resolve(page, 1, { users: [user('Current user')] });
    await page.getByText('Current user', { exact: true }).waitFor();
    await resolve(page, 0, { users: [user('Stale user')] });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByText('Stale user', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Current user', { exact: true }).count(), 1);
});

test('ignores stale property failures without ending the current loading state', async t => {
    const page = await fixture(t);
    await render(page, { orgId: 'org-a', propertyId: 'property-a' }, 1);
    await render(page, { orgId: 'org-a', propertyId: 'property-b' }, 2);
    await resolve(page, 0, { error: 'Stale failure' }, 500);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByText('Loading users...', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
    await resolve(page, 1, { users: [] });
    await page.getByText('No users found.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.directoryRequests[1].url), '/api/users/list?propertyId=property-b&orgId=org-a');
});

test('clears previous users and profile when scope disappears', async t => {
    const page = await fixture(t);
    await render(page, { orgId: 'org-a' }, 1);
    await resolve(page, 0, { users: [user('Previous user')] });
    await page.getByText('Previous user', { exact: true }).click();
    await page.getByText('Designation', { exact: true }).waitFor();
    await page.evaluate(() => window.renderDirectory({}));
    await page.getByText('Designation', { exact: true }).waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await page.getByText('Previous user', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Designation', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.directoryRequests.length), 1);
    assert.equal(await page.getByText('No users found.', { exact: true }).count(), 0);
});

for (const action of ['approve', 'reject']) {
    for (const scope of [
        { name: 'organization-only', props: { orgId: 'org-a' }, organizationId: 'org-a', propertyId: undefined },
        { name: 'organization and property', props: { orgId: 'org-a', propertyId: 'selected-property' }, organizationId: 'org-a', propertyId: 'selected-property' },
        { name: 'property-only', props: { propertyId: 'selected-property' }, organizationId: 'row-org', propertyId: 'selected-property' },
    ]) test(`passes ${scope.name} scope for ${action} actions without using an arbitrary row property`, async t => {
        const page = await fixture(t);
        await render(page, scope.props, 1);
        await resolve(page, 0, { users: [user('Pending user', { is_active: false, is_approved: false, approval_status: 'pending', organizationId: 'row-org', propertyId: 'arbitrary-row-property' })] });
        await page.getByText('Pending user', { exact: true }).waitFor();
        if (action === 'reject') page.once('dialog', dialog => dialog.accept('Fixture rejection'));
        await page.getByTitle(`${action === 'approve' ? 'Approve' : 'Reject'} user registration`).click();
        await page.waitForFunction(() => window.directoryRequests.length === 2);
        const request = await page.evaluate(() => ({url: window.directoryRequests[1].url, body: JSON.parse(window.directoryRequests[1].options.body)}));
        assert.equal(request.url, '/api/users/approve');
        assert.equal(request.body.organizationId, scope.organizationId);
        assert.equal(request.body.propertyId, scope.propertyId);
        assert.equal(request.body.action, action);
        await resolve(page, 1, {});
    });
}
