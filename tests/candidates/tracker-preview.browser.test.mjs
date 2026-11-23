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

test('tracker setup and actual-row review work on desktop and phone without importing early', { timeout: 120000 }, async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import TrackerConnections from './frontend/components/candidates/TrackerConnections'; createRoot(document.getElementById('root')).render(<TrackerConnections orgId="org" onDataChanged={()=>{}}/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: resolve('tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' } });
  const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}</style><div id="root" style="padding:16px"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.requests = [];
        let tracker = null;
        const headers = ['Name', 'Email', 'Agency rating', 'Unused'];
        const preview = {
          token: 'review-token', headers, newCandidates: 1, existingCandidates: 1, changedRows: 2, duplicateRows: 1, invalidRows: 1,
          rows: [
            { rowNumber: 2, name: 'Asha', role: 'Engineer', key: 'asha|engineer', outcome: 'existing', selected: true, issues: [], changes: [{ field: 'Location', before: 'Delhi', after: 'Pune' }], stage: null, raw: { Name: 'Asha', Email: 'asha@example.com', 'Agency rating': 'Gold', Unused: '<script>window.untrusted=true</script>' } },
            { rowNumber: 3, name: 'New person', role: 'Engineer', key: 'new|engineer', outcome: 'new', selected: true, issues: [], changes: [], stage: null, raw: { Name: 'New person', Email: 'new@example.com', 'Agency rating': 'Silver' } },
            { rowNumber: 4, name: 'Duplicate', role: 'Engineer', key: 'asha|engineer', outcome: 'duplicate', selected: false, issues: [], changes: [], stage: null, raw: { Name: 'Duplicate' } },
            { rowNumber: 5, name: 'Missing name', role: null, key: null, outcome: 'invalid', selected: false, issues: ['Candidate name missing'], changes: [], stage: null, raw: {} },
          ],
        };
        window.fetch = async (input, init = {}) => {
          const url = new URL(String(input), location.origin); const body = init.body ? JSON.parse(init.body) : null;
          window.requests.push({ path: url.pathname, body });
          let data = {};
          if (url.pathname.endsWith('/stages')) data = { stages: [] };
          else if (url.pathname.endsWith('/preview')) data = { preview: { sourceKind: 'google_sheet', tabs: ['Tracker'], tab: 'Tracker', headerRow: 1, headers, guess: { Name: 'fullName', Email: 'email', 'Agency rating': null, Unused: null }, examples: { Name: 'Asha', Email: 'asha@example.com', 'Agency rating': 'Gold' }, rowCount: 4, blocks: 1, distinct: {}, statusColumnGuess: null } };
          else if (url.pathname.endsWith('/sync')) data = body.preview ? { preview } : { summary: { rowsRead: 4, rowsChanged: 1, rowsUnchanged: 0, rowsSkipped: 2, recordsAdded: 1, recordsUpdated: 0, stageMoves: 0, stagePending: 0, rolesWithoutPosition: [], notes: [] } };
          else if (body) {
            tracker = { id: 'tracker', name: body.name, sourceUrl: body.url, sourceKind: 'google_sheet', tabName: body.tab, headerRow: body.headerRow, columnMap: body.columnMap, statusColumn: null, statusMap: {}, syncEvery: body.syncEvery, active: true, sheetId: null, syncing: false, lastSyncedAt: null, lastOk: null, lastError: null, lastSummary: null, createdAt: '2026-11-22', reviewedAt: null, skippedKeys: [] };
            data = { tracker };
          } else data = { trackers: tracker ? [tracker] : [] };
          return Response.json(data);
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('button', { name: 'Connect a tracker', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByLabel('Share link').fill('https://docs.google.com/spreadsheets/d/1234567890123456789012345/edit');
      await dialog.getByRole('button', { name: 'Read the sheet', exact: true }).click();
      await dialog.getByText('2 columns need a decision before you continue.').waitFor();
      assert.equal(await dialog.getByLabel('Sync', { exact: true }).inputValue(), 'manual');
      assert.equal(await dialog.getByRole('button', { name: 'Connect and preview', exact: true }).isDisabled(), true);
      await dialog.getByLabel('Field for Agency rating').selectOption('extra');
      await dialog.getByLabel('Field for Unused').selectOption('ignore');
      await dialog.getByRole('button', { name: 'Connect and preview', exact: true }).click();
      await page.getByRole('heading', { name: 'Preview: Tracker' }).waitFor();
      dialog = page.getByRole('dialog');
      await dialog.getByText('1 new candidates · 1 existing matches', { exact: false }).waitFor();
      const importCount = () => page.evaluate(() => window.requests.filter(r => r.path.endsWith('/sync') && r.body?.preview !== true).length);
      assert.equal(await importCount(), 0);
      assert.equal(await dialog.getByRole('checkbox', { name: 'Import row 4: Duplicate' }).isDisabled(), true);
      assert.equal(await dialog.getByRole('checkbox', { name: 'Import row 5: Missing name' }).isDisabled(), true);
      await dialog.getByText('Proposed changes (1)').click();
      assert.match(await dialog.innerText(), /Delhi → Pune/);
      assert.equal(await page.evaluate(() => window.untrusted), undefined);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mkdir('scratch/recruitment-stage4', { recursive: true });
      await page.screenshot({ path: `scratch/recruitment-stage4/review-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await importCount(), 0);
      await page.getByRole('button', { name: 'Preview / sync', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('checkbox', { name: 'Import row 2: Asha' }).uncheck();
      await dialog.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
      await dialog.getByText('Import complete: 1 records added, 0 updated, 2 skipped.').waitFor();
      assert.equal(await importCount(), 1);
      assert.deepEqual(await page.evaluate(() => window.requests.find(r => r.path.endsWith('/sync') && r.body?.preview !== true).body), { orgId: 'org', reviewToken: 'review-token', selectedRows: [3] });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
