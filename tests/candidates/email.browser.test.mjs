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

test('recruitment email previews before sending and creates reviewed hiring drafts on desktop and phone', { timeout: 120000 }, async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import EmailView from './frontend/components/candidates/EmailView'; createRoot(document.getElementById('root')).render(<EmailView orgId="test-org" onSettings={()=>{}} onRequisitions={()=>{}}/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: resolve('tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' } });
  const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}</style><div id="root" style="padding:16px"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.requests = [];
        const box = { id: 'box', address: 'hr@example.com', connected: true, active: true, can_send: true, folder_id: '123', folder_name: 'Recruitment', email_scan_start: 1 };
        const candidate = { id: 'record', candidateId: 'candidate', fullName: 'Asha', email: 'asha@example.com', phone: '9876543210' };
        let draft = null; let synced = false; let requestCreated = false;
        const incoming = { id: 'incoming', connection_id: 'box', direction: 'incoming', status: 'received', sender: 'manager@example.com', recipient: 'hr@example.com', subject: 'Need two supervisors', body: 'Please recruit two supervisors.\n<script>window.untrusted=true</script>', body_loaded: true, received_at: '2026-11-22T06:00:00Z' };
        window.fetch = async (input, init = {}) => {
          const url = new URL(String(input), location.origin); const body = init.body ? JSON.parse(init.body) : null;
          window.requests.push({ path: url.pathname, body });
          let data;
          if (body) {
            if (body.action === 'draft') {
              draft = { id: body.id, connection_id: 'box', candidate_id: body.candidateId ?? null, reply_to_id: body.replyToId ?? null, direction: 'outgoing', status: 'draft', sender: box.address, recipient: body.replyToId ? incoming.sender : candidate.email, subject: body.subject, body: body.body, received_at: '2026-11-22T06:00:00Z', updated_at: '2026-11-22T06:00:00.000Z' }; data = { message: draft };
            } else if (body.action === 'send') { draft.status = 'sent'; data = { message: draft }; }
            else if (body.action === 'sync') { synced = true; data = { complete: true, added: 1 }; }
            else if (body.action === 'requisition') { requestCreated = true; data = { requisition: { id: 'req', status: 'draft' } }; }
          } else if (url.pathname === '/api/candidates') data = { records: [candidate] };
          else if (url.searchParams.get('view') === 'message') data = { message: incoming, thread: [incoming], requisitionId: requestCreated ? 'req' : null };
          else if (url.searchParams.get('view') === 'messages') data = { messages: [...(synced && !url.searchParams.get('candidateId') ? [incoming] : []), ...(draft ? [draft] : [])], total: synced ? 1 : 0 };
          else data = { connections: [box], canRaise: true };
          return Response.json(data ?? {});
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByLabel('Find candidate for email').fill('Asha');
      await page.getByRole('button', { name: /Asha.*9876543210/ }).click();
      await page.getByRole('button', { name: 'Write to candidate' }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByLabel('Email subject').fill('Interview invitation');
      await dialog.getByLabel('Email message').fill('Please confirm your availability for an interview tomorrow.');
      await dialog.getByRole('button', { name: 'Save draft and review' }).click();
      await dialog.getByRole('button', { name: 'Send email', exact: true }).waitFor();
      assert.match(await dialog.innerText(), /To: asha@example.com/);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.body?.action === 'send').length), 0);
      await mkdir('scratch/recruitment-stage3', { recursive: true });
      await page.screenshot({ path: `scratch/recruitment-stage3/review-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Send email', exact: true }).click();
      await page.getByText('Email sent. It is listed in outgoing mail.').waitFor();
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.body?.action === 'send').length), 1);
      assert.equal(await page.evaluate(() => window.requests.find(r => r.body?.action === 'send').body.reviewedAt), '2026-11-22T06:00:00.000Z');
      await page.getByRole('button', { name: 'Clear candidate' }).click();
      await page.getByRole('button', { name: 'Check emails', exact: true }).click();
      await page.getByRole('list', { name: 'Emails', exact: true }).getByText('Zoho Mail', { exact: true }).waitFor();
      await page.getByRole('list', { name: 'Emails', exact: true }).getByRole('button').filter({ hasText: 'Need two supervisors' }).click();
      dialog = page.getByRole('dialog');
      assert.equal(await page.evaluate(() => window.untrusted), undefined);
      await page.getByRole('button', { name: 'Create hiring request draft' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Designation / role', { exact: true }).fill('Supervisor');
      await dialog.getByLabel('Number of openings').fill('2');
      await dialog.getByLabel('Maximum annual CTC (₹)').fill('600000');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.body?.action === 'requisition').length), 0);
      await page.screenshot({ path: `scratch/recruitment-stage3/request-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Create draft only' }).click();
      await page.getByText('Hiring request saved as a draft.', { exact: false }).waitFor();
      const sent = await page.evaluate(() => window.requests.find(r => r.body?.action === 'requisition').body);
      assert.equal(sent.fields.roleTitle, 'Supervisor'); assert.equal(sent.fields.positions, 2); assert.equal(sent.fields.submit, undefined);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal overflow');
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
