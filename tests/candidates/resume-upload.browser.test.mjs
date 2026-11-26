import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('resume preview and library work on desktop and phone without uploading before confirmation', { timeout: 120000 }, async () => {
    const root = process.cwd();
    const bundle = await build({
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ResumesView from './frontend/components/candidates/ResumesView'; createRoot(document.getElementById('root')).render(<ResumesView orgId="test-org"/>);`, loader: 'tsx', resolveDir: root },
        bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: resolve(root, 'tsconfig.json'),
        define: { 'process.env.NODE_ENV': '"development"' },
    });
    const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
    const server = createServer((_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(`<style>${css}</style><div id="root" style="padding:16px"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [
        'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
    ].find(path => existsSync(path));
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        for (const width of [1440, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => {
                window.requests = [];
                window.fetch = async (input, init = {}) => {
                    const path = String(input);
                    const method = init.method || 'GET';
                    const body = init.body ? JSON.parse(init.body) : null;
                    window.requests.push({ path, method, body });
                    let data;
                    if (method === 'PATCH') data = { ok: true };
                    else if (method === 'POST') data = { files: body.files.map(f => ({ index: f.index, outcome: 'duplicate' })) };
                    else if (path.includes('/positions')) data = { positions: [{ title: 'Facility Manager' }] };
                    else if (path.includes('/summary')) data = { total: 1, totalBytes: 1000, devices: [{ label: 'HR User', count: 1, bytes: 1000, oldest: null, newest: null, lastUploadedAt: null }], linked: 1, unlinked: 0, textPending: 0, extractPending: 0, unreadable: 0, rejected: 0, other: 0, scanPending: 0, uploader: 'HR User' };
                    else if (path.includes('/repeats')) data = { repeats: [], total: 0 };
                    else if (path.includes('link=')) data = { files: [], total: 0, page: 1, pageSize: 50 };
                    else data = { files: [{ id: 'test-file', fileName: 'Existing_Naukri.pdf', fileSize: 1000, createdAt: new Date().toISOString(), downloadedAt: null, sourceKind: 'naukri', sourceName: null, sourcedRole: 'Facility Manager', deviceLabel: 'HR User', candidateName: 'Asha', textStatus: 'ready', extractStatus: 'done', matchReason: 'email', removed: false, other: false }], total: 1, page: 1, pageSize: 50 };
                    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
                };
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.getByRole('combobox', { name: 'Uploaded by', exact: true }).waitFor();
            assert.match(await page.getByRole('combobox', { name: 'Uploaded by', exact: true }).innerText(), /All users/);
            await page.getByRole('button', { name: 'Import & sources', exact: true }).click();
            await page.getByLabel('Designation / role sourced for', { exact: true }).fill('Facility Manager');
            await page.locator('input[type=file][accept]').setInputFiles([
                { name: 'Asha_Naukri.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test CV one') },
                { name: 'Bilal_LinkedIn.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test CV two') },
                { name: 'Unclear_Naukri_LinkedIn.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test CV three') },
            ]);
            assert.equal(await page.getByLabel('Source for Asha_Naukri.pdf', { exact: true }).inputValue(), 'naukri');
            assert.equal(await page.getByLabel('Source for Bilal_LinkedIn.pdf', { exact: true }).inputValue(), 'linkedin');
            assert.equal(await page.getByLabel('Source for Unclear_Naukri_LinkedIn.pdf', { exact: true }).inputValue(), 'unknown');
            assert.equal(await page.getByLabel('Designation for Bilal_LinkedIn.pdf').inputValue(), 'Facility Manager');
            await page.getByLabel('Designation for Bilal_LinkedIn.pdf').fill('Engineer');
            await page.getByLabel('Source for Asha_Naukri.pdf', { exact: true }).selectOption('unknown');
            assert.equal(await page.evaluate(() => window.requests.filter(r => r.method !== 'GET').length), 0);
            await mkdir('scratch/resume-stage1', { recursive: true });
            await page.screenshot({ path: `scratch/resume-stage1/preview-${width}.png`, fullPage: true });
            await page.getByRole('button', { name: /^Upload \d/ }).click();
            await page.waitForFunction(() => window.requests.some(r => r.method === 'POST'));
            const sent = await page.evaluate(() => window.requests.find(r => r.method === 'POST').body.files);
            assert.deepEqual(sent.map(f => [f.source.kind, f.source.name, f.sourcedRole]), [[null, null, 'Facility Manager'], ['portal', 'LinkedIn', 'Engineer'], [null, null, 'Facility Manager']]);
            await page.getByRole('button', { name: 'Resume library', exact: true }).click();
            await page.getByRole('button', { name: /Edit details|Edit source and designation/ }).filter({ visible: true }).first().click();
            const dialog = page.getByRole('dialog');
            await dialog.getByLabel('Designation / role sourced for', { exact: true }).fill('Supervisor');
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForFunction(() => window.requests.some(r => r.method === 'PATCH'));
            assert.equal(await page.evaluate(() => window.requests.find(r => r.method === 'PATCH').body.metadata.sourcedRole), 'Supervisor');
            assert.deepEqual(errors, []);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal overflow');
            await page.close();
        }
    } finally {
        await browser?.close();
        await new Promise(done => server.close(done));
    }
});
