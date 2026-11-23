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

test('mail preview requires selection before import, retains errors for retry, and works on desktop and phone', { timeout: 120000 }, async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ResumeMail from './frontend/components/candidates/ResumeMail'; createRoot(document.getElementById('root')).render(<ResumeMail orgId="test-org" onImported={()=>{window.refreshed=true}}/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: resolve('tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' } });
  const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}</style><div id="root" style="padding:16px"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.requests = []; window.refreshed = false;
        const c = { id: 'connection', address: 'hr@example.com', addresses: ['hr@example.com'], connected: true, active: true, folder_id: null, folder_name: null, since_date: null, sourced_role: null, sync_every: 'manual', scan_start: 1, scan_complete: false, last_error: null };
        let item = null; let attempts = 0;
        window.fetch = async (input, init = {}) => {
          const url = new URL(String(input), location.origin); const body = init.body ? JSON.parse(init.body) : null;
          window.requests.push({ method: init.method ?? 'GET', body });
          let data;
          if (body) {
            if (body.action === 'settings') { c.folder_id = body.folderId; c.since_date = body.sinceDate; c.sourced_role = body.sourcedRole; c.sync_every = body.syncEvery; }
            if (body.action === 'preview') {
              c.scan_complete = true;
              item = { id: 'item', file_name: 'Asha_LinkedIn.pdf', file_size: 20000, sender: 'asha@example.com', subject: 'Application for Facility Manager', received_at: '2026-11-22T06:00:00Z', status: 'pending', possibleDuplicate: true };
              data = { complete: true };
            } else if (body.action === 'import') {
              attempts++;
              if (attempts === 1) { item.last_error = 'Could not store this attachment. Retry the import.'; data = { failed: 1 }; }
              else { item.status = 'imported'; item.file_id = 'stored'; item.last_error = null; data = { imported: 1 }; }
            } else if (body.action === 'pause') c.active = false;
            else if (body.action === 'resume') c.active = true;
            else if (body.action === 'disconnect') { c.connected = false; c.active = false; }
            data ??= { ok: true };
          } else if (url.searchParams.get('view') === 'folders') data = { folders: [{ folderId: '123', folderName: 'Recruitment' }] };
          else if (url.searchParams.get('view') === 'items') { const items = item && item.status === url.searchParams.get('status') ? [item] : []; data = { items, total: items.length }; }
          else data = { connections: [c] };
          return Response.json(data);
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByText('Zoho Mail — import resumes from email', { exact: true }).click();
      await page.getByLabel('Mail folder').selectOption('123');
      assert.equal(await page.getByLabel('Mail sync frequency').inputValue(), 'manual');
      await page.getByLabel('Emails from date').fill('2026-11-01');
      await page.getByLabel('Mail default designation').fill('Facility Manager');
      await page.getByRole('button', { name: 'Save mail settings' }).click();
      await page.getByRole('button', { name: 'Sync now — preview' }).click();
      await page.getByLabel('Import Asha_LinkedIn.pdf', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.body?.action === 'import').length), 0);
      assert.match(await page.locator('li').innerText(), /LinkedIn.*Possible duplicate/s);
      await page.getByLabel('Import Asha_LinkedIn.pdf', { exact: true }).check();
      await page.getByLabel('Designation for email imports').fill('Engineer');
      await mkdir('scratch/resume-stage2', { recursive: true });
      await page.screenshot({ path: `scratch/resume-stage2/preview-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Import selected (1/10)' }).click();
      await page.getByText('Could not store this attachment. Retry the import.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.requests.find(r => r.body?.action === 'import').body.sourcedRole), 'Engineer');
      await page.getByLabel('Import Asha_LinkedIn.pdf', { exact: true }).check();
      assert.equal(await page.getByLabel('Designation for email imports').inputValue(), 'Engineer', 'a failed import retains the chosen designation for retry');
      await page.getByRole('button', { name: 'Import selected (1/10)' }).click();
      await page.waitForFunction(() => window.requests.filter(r => r.body?.action === 'import').length === 2);
      await page.getByLabel('Mail attachment history').selectOption('imported');
      await page.getByRole('link', { name: 'Open stored resume' }).waitFor();
      await page.getByLabel('Mail sync frequency').selectOption('hourly');
      assert.equal(await page.getByRole('button', { name: 'Save mail settings' }).isDisabled(), true);
      await page.getByLabel('Allow automatic import').check();
      await page.getByRole('button', { name: 'Save mail settings' }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sync now — preview' }).isDisabled(), true);
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await page.getByText('Disconnected. Imported resumes and email details are kept.').waitFor();
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide overflow');
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
