import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('hiring request form and Otto on desktop and mobile widths', { timeout: 60_000 }, async () => {
    const root = process.cwd();
    const bundle = await build({
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import HiringRequests from './frontend/components/recruitment/HiringRequestsPage';
import Otto from './frontend/components/hr-assistant/HrAssistantBot';
import RequisitionsView from './frontend/components/recruitment/RequisitionsView';
import {UiProvider} from './frontend/components/candidates/ui';
const ui = {notify(){},reportError(){}};
const tracker = location.search === '?tracker=1';
createRoot(document.getElementById('root')).render(<>{tracker ? <UiProvider value={ui}><RequisitionsView orgId="org" mode="hr"/></UiProvider> : <HiringRequests orgId="org"/>}<Otto/></>);`, resolveDir: root, loader: 'tsx' },
        bundle: true, write: false, format: 'iife', tsconfig: resolve('tsconfig.json'), define: { 'process.env': '{}' },
        plugins: [{ name: 'test-auth', setup(builder) {
            builder.onResolve({ filter: /^(next\/navigation|.*\/context\/AuthContext|\.\/HrAssistantChat)$/ }, args => ({ path: args.path, namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path.includes('AuthContext')
                ? `export const useAuth = () => ({user:{id:'tester',email:'tester@example.com'},membership:{org_id:'org'}});`
                : path.endsWith('HrAssistantChat')
                    ? `export const claimHrChat = () => {}; export const useHrChatPending = () => false; export const HrAssistantChat = () => null;`
                    : `export const usePathname = () => location.pathname; export const useParams = () => ({orgId:'org'});` }));
        } }],
    });
    const css = (await postcss([tailwind()]).process(`@import "tailwindcss" source(none);
@source "./frontend/components/recruitment";
@source "./frontend/components/hr-assistant/HrAssistantBot.tsx";
@source "./frontend/components/candidates/page-kit.tsx";
@source "./frontend/components/candidates/ui.tsx";`, { from: resolve('hiring-requests-test.css') })).css;
    const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync) });
        for (const width of [1440, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 820 }, reducedMotion: 'reduce' });
            page.setDefaultTimeout(6000);
            let submitted;
            await page.route('**/api/**', route => {
                const { pathname } = new URL(route.request().url());
                if (pathname === '/api/hr-assistant') return route.fulfill({ json: { canUse: true, isAdmin: false } });
                if (pathname.endsWith('/hiring-manager')) return route.fulfill({ json: { positions: [] } });
                if (route.request().method() === 'POST') {
                    submitted = route.request().postData();
                    return route.fulfill({ json: { requisition: { id: 'request', requisitionNo: 'REQ-001', status: 'submitted', currentLevel: 'hr_head' } } });
                }
                return route.fulfill({ json: { requisitions: [], access: { configured: true, userId: 'tester', approverLevels: [], canRaise: true }, requesterDepartment: 'Operations', hierarchy: { departments: [{ department: 'Operations', designations: ['Facility Executive'] }, { department: 'Tech', designations: ['Developer'] }] } } });
            });
            await page.goto(`http://127.0.0.1:${server.address().port}/hiring-requests`);
            const otto = page.getByRole('button', { name: 'Open Otto, the HR assistant' });
            await otto.waitFor();
            const start = await otto.boundingBox();
            assert.ok(start.x > width / 2);
            await page.mouse.move(start.x + 32, start.y + 32);
            await page.mouse.down();
            await page.mouse.move(30, 250, { steps: 5 });
            await page.mouse.up();
            const docked = await otto.boundingBox();
            assert.ok(docked.x < 50 && docked.y < 300, `Otto docks at the left edge at ${width}px`);
            assert.equal(await otto.getAttribute('aria-expanded'), 'false');
            await page.reload();
            await otto.waitFor();
            const restored = await otto.boundingBox();
            assert.ok(Math.abs(restored.x - docked.x) < 2 && Math.abs(restored.y - docked.y) < 2);

            const priorities = page.getByRole('group', { name: 'Request priorities' });
            assert.equal(await priorities.getByRole('button').count(), 3);
            assert.ok(await priorities.evaluate(el => el.scrollWidth <= el.clientWidth));
            await page.getByRole('button', { name: 'Raise a request' }).click();
            const form = page.getByRole('dialog', { name: 'Raise a hiring request' });
            assert.equal(await form.getByLabel(/^Department/).inputValue(), 'Operations');
            assert.equal(await form.getByLabel(/^Department/).getAttribute('readonly'), '');
            assert.deepEqual(await form.getByLabel('Role title').locator('option').evaluateAll(options => options.map(option => option.value)), ['', 'Facility Executive', '__other__']);
            await form.getByLabel('Role title').selectOption('Facility Executive');
            await form.getByLabel(/Budget band, maximum/).fill('6');
            await form.getByLabel('Minimum', { exact: true }).fill('0');
            await form.getByLabel('Maximum', { exact: true }).fill('1');
            await form.getByLabel(/^Justification/).fill('Training role');
            await form.getByLabel(/^Internal mobility/).selectOption('no');
            assert.equal(await form.getByRole('button', { name: 'Submit for approval' }).isEnabled(), false);
            await form.getByLabel(/^Headcount plan/).selectOption('no');
            await form.getByLabel('Job description PDF').setInputFiles({ name: 'training.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
            await form.getByRole('button', { name: 'Submit for approval' }).click();
            await form.waitFor({ state: 'hidden' });
            assert.match(submitted, /"minExperienceYears":0,"maxExperienceYears":1/);
            assert.match(submitted, /"requestedInPlan":false/);
            assert.match(submitted, /filename="training.pdf"/);
            await page.goto(`http://127.0.0.1:${server.address().port}/hiring-requests?tracker=1`);
            await page.getByRole('heading', { name: 'Requisitions', exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Raise a request' }).count(), 0);
            assert.ok(await page.getByRole('group', { name: 'Request priorities' }).evaluate(el => el.scrollWidth <= el.clientWidth));
            await page.close();
        }
    } finally {
        await browser?.close();
        await new Promise(done => server.close(done));
    }
});
