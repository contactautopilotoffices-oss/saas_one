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

test('assessment buttons, meeting notes and hidden HR bot on desktop and phone', { timeout: 120000 }, async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import AssessmentSender from './frontend/components/candidates/AssessmentSender'; import HrAssistantBot from './frontend/components/hr-assistant/HrAssistantBot'; import MeetingReview from './frontend/components/task-manager/meetings/MeetingReview';
    import VideoCall from './frontend/components/task-manager/meetings/VideoCall';
    const record = {id:'record',candidateId:'candidate',fullName:'Asha Rao',email:'asha@example.test',phone:'9876543210',blacklisted:false};
    createRoot(document.getElementById('root')).render(<><HrAssistantBot/>{location.pathname === '/test-ended-call' ? <VideoCall meetingId="meeting"/> : location.pathname === '/test-notes' ? <div data-meeting-surface><MeetingReview space="hr" meetingId="meeting" onBack={()=>{}} onContinueRecording={()=>{}}/></div> : <AssessmentSender orgId="org" record={record} onSent={()=>{}} onClose={()=>{}}/>}</>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', platform: 'browser', tsconfig: resolve('tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, plugins: [{ name: 'auth-fixtures', setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, a => ({ path: a.path, namespace: 'mock' }));
      b.onResolve({ filter: /\/context\/AuthContext$/ }, a => ({ path: a.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ loader: 'js', contents: a.path.includes('AuthContext') ? `export const useAuth=()=>({user:{id:'hr',email:'hr@example.test'},membership:{org_id:'org',role:'hr'}});` : `export const usePathname=()=>location.pathname; export const useParams=()=>({}); export const useRouter=()=>({push:()=>{}}); export const useSearchParams=()=>new URLSearchParams(location.search);` }));
    } }] });
  const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}</style><div id="root" style="padding:16px"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync), headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
      await page.addInitScript(() => {
        window.sends = [];
        const receipts = [];
        window.fetch = async (input, init = {}) => {
          const url = new URL(String(input), location.origin), body = init.body ? JSON.parse(init.body) : null;
          if (url.pathname === '/api/hr-assistant') return Response.json({ canUse: true, isAdmin: false });
          if (url.pathname.endsWith('/meeting/join')) return Response.json({ success: true, meeting: { id: 'meeting', title: 'Interview: Asha', status: 'ready', purpose: 'interview', scheduledFor: null, confidential: false, hostName: 'HR', isHost: true, open: false, startedAt: null, problem: null }, setup: [] });
          if (url.pathname.includes('/task-manager/meetings/')) return Response.json({ success: true, meeting: {
            id: 'meeting', title: 'Interview: Asha', meetingDate: '2026-11-22', status: 'ready', error: null, confidential: false, durationSeconds: 600, mine: false, createdAt: '2026-11-22', attendees: [], extraNames: ['Asha'],
            transcript: [{ speaker: 'Asha', start: 10, end: 20, text: 'I can join in thirty days.' }],
            summary: { summary: 'The interview covered experience and availability.', notes: [{ topic: 'Availability', points: ['Thirty days notice.'] }], decisions: ['Proceed to the technical interview.'], openQuestions: ['Confirm interview date.'] },
            provider: 'test', canRetry: false, notesSentAt: null, voice: null, recording: null, online: null,
          }, tasks: [], people: [], me: { name: 'HR', department: 'HR' } });
          if (body) {
            window.sends.push(body);
            const invite = { id: body.channel, test_id: body.testId, channel: body.channel, status: 'sent', recipient: body.channel === 'email' ? 'asha@example.test' : '919876543210', error: null, mail_id: null };
            receipts.push(invite); return Response.json({ invite });
          }
          return Response.json({ tests: [{ id: 'test', title: 'Aptitude', duration: 20, url: 'https://app.example.test/t/public-token' }], connections: [{ id: 'mail', address: 'hr@example.test' }], receipts });
        };
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${base}/org/hr`);
      await page.getByLabel('Assessment', { exact: true }).selectOption('test');
      assert.equal(await page.evaluate(() => window.sends.length), 0);
      await page.getByRole('button', { name: 'Send by email', exact: true }).click();
      await page.getByText('Email: sent to asha@example.test', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send by email', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Send on WhatsApp', exact: true }).click();
      await page.getByText('WhatsApp: sent to 919876543210', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.sends.map(s => s.channel)), ['email', 'whatsapp']);
      await page.locator('[data-hr-policy-bot] button').last().waitFor({ state: 'visible' });
      await page.evaluate(() => { const call = document.createElement('div'); call.dataset.meetingSurface = ''; document.body.append(call); });
      await page.locator('[data-hr-policy-bot] button').last().waitFor({ state: 'hidden' });
      await mkdir('scratch/assessment-meeting', { recursive: true });
      await page.screenshot({ path: `scratch/assessment-meeting/assessment-${width}.png`, fullPage: true });
      for (const path of ['/guest/secret', '/meet/meeting', '/org/meetings/meeting']) {
        await page.goto(`${base}${path}`);
        await page.getByLabel('Assessment', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-hr-policy-bot]').count(), 0);
      }
      await page.goto(`${base}/test-notes`);
      await page.getByText('The interview covered experience and availability.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Transcript', exact: true }).click();
      await page.locator('p[id="t-10"]').filter({ hasText: 'I can join in thirty days.' }).waitFor();
      assert.equal(await page.locator('[data-hr-policy-bot]').isVisible(), false);
      await page.screenshot({ path: `scratch/assessment-meeting/notes-${width}.png`, fullPage: true });
      await page.goto(`${base}/test-ended-call`);
      await page.getByText('This meeting has ended. Its notes are in the candidate’s Interviews tab in Recruitment.', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-hr-policy-bot] button').last().isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
