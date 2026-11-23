import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { encryptToken } from '../../backend/lib/mail/token-crypto';
import { disconnectResumeMail, dueResumeMail, importResumeMail, listResumeMail, listResumeMailItems, pauseResumeMail, previewResumeMail, saveResumeMailSettings, syncResumeMail, type MailStorage } from '../../backend/lib/candidates/resume-mail';
import { finishResumeMailOAuth, recruitmentAccountsServer, resumeMailOAuthState, startResumeMailOAuth } from '../../backend/lib/candidates/resume-mail-oauth';
import type { ZohoMailListItem } from '../../backend/services/zohoMailService';
import { freshDb } from './db-stub';
import { pgliteSupabase } from './pglite-supabase';

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const USER = { id: '00000000-0000-0000-0000-000000000001', email: 'hr@example.test' };
const CONN = '00000000-0000-4000-8000-000000000091';
const migration = readFileSync('supabase/migrations/20261122000002_recruitment_mail.sql', 'utf8');
const savedEnv = { ...process.env };
const bytes = new Map<string, Buffer>();
let failStorage = false;
const storage = {
  createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}`, token: 'test', path }, error: null }),
  upload: async (path: string, data: Buffer) => { if (failStorage) return { error: { message: 'test storage outage' } }; bytes.set(path, data); return { error: null }; },
  list: async (org: string) => ({ data: [...bytes].filter(([p]) => p.startsWith(`${org}/`)).map(([path, data]) => ({ name: path.slice(org.length + 1), metadata: { size: data.length } })), error: null }),
} as unknown as MailStorage;
const message = (id: string, extra = {}): ZohoMailListItem => ({ messageId: id, threadId: id, folderId: '123', subject: 'Application',
  summary: '', fromAddress: 'candidate@example.test', fromName: null, toAddress: ['hr@example.test'], ccAddress: [],
  sentAt: '2026-11-22T06:00:00Z', hasAttachment: true, rfcMessageId: null, sentHeaderMs: null, sizeBytes: 100, ...extra });
let messages = [message('101')];
let failDownload = false;
let downloads = 0;
let lastStart = 0;
const mail = {
  listFolders: async () => [{ folderId: '123', folderName: 'Recruitment' }, { folderId: '456', folderName: 'Other' }],
  listPage: async (_source: unknown, opts: { start: number; folderId?: string; address?: string }) => {
    assert.equal(opts.folderId, '123'); assert.equal(opts.address, 'hr@example.test'); lastStart = opts.start;
    return { items: messages, fetched: messages.length };
  },
  listAttachmentsWithGrant: async (id: string, _g: unknown, _address?: string, folderId?: string) => {
    assert.equal(folderId, '123');
    return [{ attachmentId: `${id}1`, attachmentName: 'Asha_LinkedIn.pdf', attachmentSize: 100, mimeType: 'application/pdf' },
      { attachmentId: `${id}2`, attachmentName: 'logo.png', attachmentSize: 10, mimeType: 'image/png' },
      { attachmentId: `${id}3`, attachmentName: 'Huge.pdf', attachmentSize: 20 * 1024 * 1024, mimeType: 'application/pdf' }];
  },
  downloadAttachmentWithGrant: async (_id: string, _att: string, _g: unknown, _address?: string, options?: { folderId: string; maxBytes: number }) => {
    assert.equal(options?.folderId, '123'); assert.equal(options?.maxBytes, 15 * 1024 * 1024);
    downloads++; if (failDownload) throw new Error('provider failed'); return Buffer.from('%PDF-1.7 resume fixture');
  },
};

describe('Recruitment Zoho resume imports', () => {
  let db: PGlite; let client: SupabaseClient;
  before(async () => {
    process.env.MAIL_TOKEN_KEY = 'test-mail-key';
    process.env.ZOHO_MAIL_APP_CLIENT_ID = 'test-client'; process.env.ZOHO_MAIL_APP_CLIENT_SECRET = 'test-secret'; process.env.ZOHO_MAIL_APP_DC = 'in';
    db = await freshDb(); client = pgliteSupabase(db); await db.exec(migration);
    await db.query('insert into public.organizations(id) values ($1),($2)', [ORG, OTHER]);
    await db.query('insert into auth.users(id) values ($1)', [USER.id]);
    await db.query('insert into public.users(id,full_name,email) values ($1,$2,$3)', [USER.id, 'HR User', USER.email]);
    await db.query(`insert into candidate_resume_mail_connections(id,organization_id,address,addresses,refresh_token_enc,dc,connected_by,connected_email)
      values($1,$2,'hr@example.test',array['hr@example.test'],$3,'in',$4,$5)`, [CONN, ORG, encryptToken('fake-refresh'), USER.id, USER.email]);
  });
  after(async () => {
    await db.close();
    for (const key of ['MAIL_TOKEN_KEY', 'ZOHO_MAIL_APP_CLIENT_ID', 'ZOHO_MAIL_APP_CLIENT_SECRET', 'ZOHO_MAIL_APP_DC']) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  });
  const settings = (extra = {}) => ({ folderId: '123', sinceDate: '2026-11-01', sourcedRole: 'Manager', syncEvery: 'manual', active: true, ...extra });
  it('keeps grants out of responses, defaults to manual, isolates organizations and gates automatic import', async () => {
    const list = await listResumeMail(client, ORG);
    assert.equal(list.connections[0].sync_every, 'manual');
    assert.equal(JSON.stringify(list).includes('refresh'), false);
    assert.equal((await listResumeMail(client, OTHER)).connections.length, 0);
    await assert.rejects(previewResumeMail(client, OTHER, CONN, mail), /no longer here/);
    await assert.rejects(importResumeMail(client, OTHER, CONN, USER, { ids: [CONN] }, mail, storage), /no longer here/);
    await assert.rejects(saveResumeMailSettings(client, ORG, CONN, settings({ sinceDate: '2026-02-30' }), mail), /valid/);
    await assert.rejects(saveResumeMailSettings(client, ORG, CONN, settings({ folderId: '999' }), mail), /folder/);
    await assert.rejects(saveResumeMailSettings(client, ORG, CONN, settings({ syncEvery: 'hourly' }), mail), /first preview/);
    await saveResumeMailSettings(client, ORG, CONN, settings(), mail);
    assert.equal((await dueResumeMail(client)).length, 0);
  });
  it('previews only the selected folder/date without creating resumes or downloading bytes; repeated previews are idempotent', async () => {
    messages = [message('101'), message('102', { folderId: '456' }), message('103', { sentAt: '2026-10-01T00:00:00Z' })];
    await previewResumeMail(client, ORG, CONN, mail); await previewResumeMail(client, ORG, CONN, mail);
    assert.equal(downloads, 0);
    assert.equal((await db.query('select * from candidate_resume_files')).rows.length, 0);
    const preview = await listResumeMailItems(client, ORG, CONN, 'pending', 1);
    assert.equal(preview.total, 1); assert.equal(preview.items[0].file_name, 'Asha_LinkedIn.pdf');
    assert.equal(preview.items[0].sender, 'candidate@example.test');
  });
  it('retries failed imports, detects source, applies designation, saves origin and never reimports an attachment', async () => {
    const item = (await listResumeMailItems(client, ORG, CONN, 'pending', 1)).items[0];
    failDownload = true;
    assert.equal((await importResumeMail(client, ORG, CONN, USER, { ids: [item.id] }, mail, storage)).failed, 1);
    assert.ok((await listResumeMailItems(client, ORG, CONN, 'pending', 1)).items[0].last_error);
    failDownload = false;
    failStorage = true;
    assert.equal((await importResumeMail(client, ORG, CONN, USER, { ids: [item.id] }, mail, storage)).failed, 1);
    assert.equal((await db.query<{ status: string }>('select status from candidate_resume_files')).rows[0].status, 'uploading');
    failStorage = false;
    assert.equal((await importResumeMail(client, ORG, CONN, USER, { ids: [item.id], sourcedRole: 'Engineer' }, mail, storage)).imported, 1);
    const stored = await db.query<{ source_name: string; sourced_role: string; status: string }>('select * from candidate_resume_files');
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].source_name, 'LinkedIn');
    assert.equal(stored.rows[0].sourced_role, 'Engineer'); assert.equal(stored.rows[0].status, 'ready');
    const before = downloads;
    await importResumeMail(client, ORG, CONN, USER, { ids: [item.id], sourcedRole: 'Wrong' }, mail, storage);
    assert.equal(downloads, before);
    assert.ok((await listResumeMailItems(client, ORG, CONN, 'imported', 1)).items[0].file_id);
  });
  it('deduplicates identical bytes from another email, preserves first labels and respects pause/locks', async () => {
    messages = [message('104')]; await previewResumeMail(client, ORG, CONN, mail);
    const item = (await listResumeMailItems(client, ORG, CONN, 'pending', 1)).items[0];
    assert.equal(item.possibleDuplicate, true);
    await pauseResumeMail(client, ORG, CONN, true);
    await assert.rejects(importResumeMail(client, ORG, CONN, USER, { ids: [item.id] }, mail, storage), /paused/);
    await pauseResumeMail(client, ORG, CONN, false);
    await db.query("update candidate_resume_mail_connections set lock_until=now()+interval '10 minutes' where id=$1", [CONN]);
    await assert.rejects(previewResumeMail(client, ORG, CONN, mail), /busy/);
    await db.query('update candidate_resume_mail_connections set lock_until=null where id=$1', [CONN]);
    assert.equal((await importResumeMail(client, ORG, CONN, USER, { ids: [item.id], sourcedRole: 'Wrong' }, mail, storage)).duplicates, 1);
    assert.equal((await db.query('select * from candidate_resume_files')).rows.length, 1);
    assert.equal((await db.query<{ sourced_role: string }>('select sourced_role from candidate_resume_files')).rows[0].sourced_role, 'Engineer');
  });
  it('continues pagination, supports explicit skips and runs automatic imports only after opt-in', async () => {
    messages = Array.from({ length: 10 }, (_, i) => message(String(200 + i), { hasAttachment: false }));
    assert.equal((await previewResumeMail(client, ORG, CONN, mail)).complete, false);
    messages = [message('301')];
    assert.equal((await previewResumeMail(client, ORG, CONN, mail)).complete, true); assert.equal(lastStart, 11);
    const item = (await listResumeMailItems(client, ORG, CONN, 'pending', 1)).items[0];
    await importResumeMail(client, ORG, CONN, USER, { ids: [item.id], skip: true }, mail, storage);
    await saveResumeMailSettings(client, ORG, CONN, settings({ syncEvery: 'hourly' }), mail);
    await db.query('update candidate_resume_mail_connections set last_synced_at=null where id=$1', [CONN]);
    assert.equal((await dueResumeMail(client)).length, 1);
    messages = [message('302')];
    const synced = await syncResumeMail(client, ORG, CONN, mail, storage);
    assert.equal('duplicates' in synced ? synced.duplicates : 0, 1);
    assert.equal((await listResumeMailItems(client, ORG, CONN, 'skipped', 1)).total, 1);
  });
  it('disconnect clears the token and schedule while keeping resumes and origins', async () => {
    await disconnectResumeMail(client, ORG, CONN);
    assert.equal((await listResumeMail(client, ORG)).connections[0].connected, false);
    assert.equal((await dueResumeMail(client)).length, 0);
    assert.equal((await db.query('select * from candidate_resume_files')).rows.length, 1);
    assert.equal((await listResumeMailItems(client, ORG, CONN, 'imported', 1)).total, 1);
  });
  it('binds OAuth to the initiating user; rejects expired/replayed states and untrusted token endpoints', async () => {
    const start = await startResumeMailOAuth(client, ORG, USER.id, 'https://app.test/api/candidates/resume-mail');
    const url = new URL(start.url); const state = url.searchParams.get('state')!;
    assert.equal(url.hostname, 'accounts.zoho.in');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.test/api/candidates/resume-mail/callback');
    assert.equal(url.searchParams.get('scope')?.includes('WRITE'), false);
    assert.throws(() => recruitmentAccountsServer('https://accounts.zoho.in.evil.test'), /unsupported/);
    const io = { fetch: (async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(String(url), 'https://accounts.zoho.in/oauth/v2/token');
      assert.equal(String(url).includes('test-secret'), false);
      assert.equal(new URLSearchParams(String(options?.body)).get('redirect_uri'), 'https://app.test/api/candidates/resume-mail/callback');
      return Response.json({ refresh_token: 'new-test-refresh' });
    }) as typeof fetch, addresses: async () => ['hr@example.test'] };
    await assert.rejects(finishResumeMailOAuth(client, state, { ...USER, id: OTHER }, 'code', undefined, io), /account that started/);
    await assert.rejects(finishResumeMailOAuth(client, state, USER, 'code', 'https://evil.test', io), /unsupported/);
    await finishResumeMailOAuth(client, state, USER, 'code', undefined, io);
    await assert.rejects(finishResumeMailOAuth(client, state, USER, 'code', undefined, io), /expired or was already used/);
    const next = await startResumeMailOAuth(client, ORG, USER.id, 'https://app.test');
    const expired = new URL(next.url).searchParams.get('state')!;
    await db.query("update candidate_resume_mail_oauth set expires_at=now()-interval '1 minute' where state=$1", [expired]);
    await assert.rejects(resumeMailOAuthState(client, expired), /expired/);
    assert.equal((await listResumeMail(client, ORG)).connections[0].sync_every, 'manual');
  });
  it('keeps the encrypted credentials and email metadata inaccessible to browser database clients', async () => {
    await db.exec(migration);
    const tables = ['candidate_resume_mail_oauth', 'candidate_resume_mail_connections', 'candidate_resume_mail_items'];
    const security = await db.query<{ relrowsecurity: boolean }>('select relrowsecurity from pg_class where relname=any($1)', [tables]);
    assert.equal(security.rows.length, 3); assert.ok(security.rows.every(r => r.relrowsecurity));
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`set role ${role}`);
      try { for (const table of tables) await assert.rejects(db.query(`select * from ${table}`), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
  });
});
