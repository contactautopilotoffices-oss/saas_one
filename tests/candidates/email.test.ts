import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken } from '../../backend/lib/mail/token-crypto';
import { htmlToText } from '../../backend/lib/mail/text';
import { ZohoMailSendError, type ZohoMailListItem } from '../../backend/services/zohoMailService';
import { emailConnections, emailToRequisition, listEmails, readEmail, resolveEmailSend, saveEmailDraft, sendEmail, syncEmails } from '../../backend/lib/candidates/email';
import { connectRecruitmentMailbox, finishResumeMailOAuth, startResumeMailOAuth } from '../../backend/lib/candidates/resume-mail-oauth';
import { saveRaisers } from '../../backend/lib/candidates/requisitions';
import { freshDb } from './db-stub';
import { pgliteSupabase } from './pglite-supabase';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const COLLEAGUE = '00000000-0000-4000-8000-000000000004';
const CONN = '00000000-0000-4000-8000-000000000005';
const CANDIDATE = '00000000-0000-4000-8000-000000000006';
const FOREIGN = '00000000-0000-4000-8000-000000000007';
const migration = readFileSync('supabase/migrations/20261122000003_recruitment_email.sql', 'utf8');
let sendMode = 'ok';
const sends: Array<{ from: string; to: string; subject: string; body: string; replyMessageId?: string }> = [];
const message = (id: string, sender: string, extra = {}): ZohoMailListItem => ({ messageId: id, threadId: 'thread-1', folderId: '123',
  fromAddress: sender, fromName: null, toAddress: ['hr@example.test'], ccAddress: [], subject: 'Application', summary: 'Preview',
  sentAt: '2026-11-22T06:00:00Z', hasAttachment: false, rfcMessageId: null, sentHeaderMs: null, sizeBytes: 100, ...extra });
const mail = {
  listFolders: async () => [{ folderId: '123', folderName: 'Recruitment' }],
  listPage: async (_g: unknown, opts: { folderId?: string; address?: string }) => {
    assert.equal(opts.folderId, '123'); assert.equal(opts.address, 'hr@example.test');
    const items = [message('101', 'asha@example.test'), message('102', 'manager@example.test', { subject: 'Need a supervisor', threadId: 'request-1' }),
      message('103', 'outside@example.test', { folderId: '456' }), message('104', 'old@example.test', { sentAt: '2026-10-01T00:00:00Z' })];
    return { items, fetched: items.length };
  },
  getMessageContentWithGrant: async () => ({ subject: 'Need a supervisor', content: '<script>evil()</script><p>Two supervisors needed.</p><img src="https://tracking.test/x"><p>Budget 600000</p>', fromAddress: 'manager@example.test', rfcMessageId: null }),
  sendMessageWithGrant: async (_g: unknown, input: typeof sends[number]) => {
    sends.push(input);
    if (sendMode === 'timeout') throw new ZohoMailSendError('timeout', false);
    if (sendMode === 'reject') throw new ZohoMailSendError('rejected', true);
    return { messageId: `sent-${sends.length}`, threadId: 'thread-1' };
  },
};
describe('Recruitment email sending, replies and hiring drafts', () => {
  let db: PGlite; let client: SupabaseClient;
  const env = { ...process.env };
  const send = async (id: string, userId = USER) => {
    const detail = await readEmail(client, ORG, id, mail);
    return sendEmail(client, ORG, userId, id, new Date(detail.message.updated_at).toISOString().replace('Z', '+00:00'), mail);
  };
  const draft = (extra = {}) => ({ id: randomUUID(), connectionId: CONN, candidateId: CANDIDATE, subject: 'Interview invitation', body: 'Please confirm your availability.', ...extra });
  before(async () => {
    process.env.MAIL_TOKEN_KEY = 'email-test-key'; process.env.ZOHO_MAIL_APP_CLIENT_ID = 'test'; process.env.ZOHO_MAIL_APP_CLIENT_SECRET = 'test'; process.env.ZOHO_MAIL_APP_DC = 'in';
    db = await freshDb(); client = pgliteSupabase(db);
    await db.exec(readFileSync('supabase/migrations/20261122000002_recruitment_mail.sql', 'utf8')); await db.exec(migration);
    await db.exec(readFileSync("supabase/migrations/20261126000003_shared_zoho_mail.sql","utf8"));
    await db.query('insert into organizations(id) values($1),($2)', [ORG, OTHER]);
    for (const id of [USER, COLLEAGUE]) {
      await db.query('insert into auth.users(id) values($1)', [id]);
      await db.query("insert into users(id,full_name) values($1,'HR User')", [id]);
      await db.query("insert into organization_memberships(user_id,organization_id,role) values($1,$2,'hr')", [id, ORG]);
    }
    await db.query("insert into candidates(id,organization_id,full_name,email) values($1,$2,'Asha','asha@example.test'),($3,$4,'Foreign','foreign@example.test')", [CANDIDATE, ORG, FOREIGN, OTHER]);
    await db.query(`insert into candidate_resume_mail_connections(id,organization_id,address,addresses,refresh_token_enc,dc,connected_by,folder_id,folder_name,since_date,can_send)
      values($1,$2,'hr@example.test',array['hr@example.test'],$3,'in',$4,'123','Recruitment','2026-11-01',true)`, [CONN, ORG, encryptToken('fake-email-grant'), USER]);
  });
  after(async () => {
    await db.close();
    for (const key of ['MAIL_TOKEN_KEY', 'ZOHO_MAIL_APP_CLIENT_ID', 'ZOHO_MAIL_APP_CLIENT_SECRET', 'ZOHO_MAIL_APP_DC']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
  });
  it('loads selected-folder messages once, links exact candidate addresses, renders email as text and exposes no credentials', async () => {
    const first = await syncEmails(client, ORG, CONN, mail); assert.equal(first.added, 2);
    assert.equal((await syncEmails(client, ORG, CONN, mail)).added, 0);
    const all = await listEmails(client, ORG, CONN, {}); assert.equal(all.total, 2);
    assert.equal(all.messages.find(m => m.sender === 'asha@example.test')?.candidate_id, CANDIDATE);
    assert.equal((await listEmails(client, ORG, CONN, { candidateId: CANDIDATE })).total, 1);
    const m = all.messages.find(m => m.sender === 'manager@example.test')!;
    const detail = await readEmail(client, ORG, m.id, mail);
    assert.equal(detail.message.body, 'Two supervisors needed.\nBudget 600000');
    assert.equal(detail.message.body_loaded, true);
    assert.equal(JSON.stringify(await emailConnections(client, ORG, USER)).includes('refresh_token'), false);
    assert.equal(htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>', 'decoded markup is text only, never rendered as HTML');
    await assert.rejects(readEmail(client, OTHER, m.id, mail), /no longer here/);
  });
  it('lets another HR login reuse the organization mailbox without starting another Zoho authorization', async () => {
    const shared = await connectRecruitmentMailbox(client, ORG, COLLEAGUE, 'https://app.test', true, false);
    assert.deepEqual(shared, { connected: true, address: 'hr@example.test' });
    assert.equal((await db.query('select state from candidate_resume_mail_oauth')).rows.length, 0);
    assert.equal((await emailConnections(client, ORG, COLLEAGUE)).connections[0].id, CONN);
    assert.equal((await emailConnections(client, OTHER, COLLEAGUE)).connections.length, 0);
  });
  it('saving and editing a draft sends nothing; the reviewed recipient comes from the candidate, not client fields', async () => {
    const d = draft({ to: 'attacker@example.test', from: 'spoof@example.test' });
    const saved = await saveEmailDraft(client, ORG, USER, d);
    assert.equal(saved.message.recipient, 'asha@example.test'); assert.equal(saved.message.sender, 'hr@example.test');
    await saveEmailDraft(client, ORG, USER, { ...d, body: 'Updated before review' });
    await assert.rejects(sendEmail(client, ORG, USER, d.id, '2000-01-01T00:00:00.000Z', mail), /changed after your preview/);
    assert.equal(sends.length, 0);
    await assert.rejects(send(d.id, COLLEAGUE), /person who wrote/);
    assert.equal((await send(d.id)).message.status, 'sent');
    assert.equal(sends[0].body, 'Updated before review');
    await send(d.id); assert.equal(sends.length, 1);
    await assert.rejects(saveEmailDraft(client, ORG, USER, d), /cannot be edited/);
    await assert.rejects(saveEmailDraft(client, ORG, USER, draft({ candidateId: FOREIGN })), /valid email/);
  });
  it('rechecks blacklist, changed recipient and sending permission immediately before sending', async () => {
    const d = draft(); await saveEmailDraft(client, ORG, USER, d);
    await db.query("update candidates set blacklisted_at=now() where id=$1", [CANDIDATE]);
    await assert.rejects(send(d.id), /blacklisted/);
    await db.query("update candidates set blacklisted_at=null,email='changed@example.test' where id=$1", [CANDIDATE]);
    await assert.rejects(send(d.id), /address changed/);
    await db.query("update candidates set email='asha@example.test' where id=$1", [CANDIDATE]);
    await db.query('update candidate_resume_mail_connections set can_send=false where id=$1', [CONN]);
    await assert.rejects(send(d.id), /for sending/);
    assert.equal(sends.length, 1);
    await db.query('update candidate_resume_mail_connections set can_send=true where id=$1', [CONN]);
  });
  it('handles uncertain and rejected sends without automatic retries; only the sender can resolve them', async () => {
    const d = draft(); await saveEmailDraft(client, ORG, USER, d); sendMode = 'timeout';
    assert.equal((await send(d.id)).message.status, 'unknown');
    const count = sends.length;
    await assert.rejects(send(d.id), /already attempted/); assert.equal(sends.length, count);
    await assert.rejects(resolveEmailSend(client, ORG, COLLEAGUE, d.id, 'not_sent'), /Only the sender/);
    await resolveEmailSend(client, ORG, USER, d.id, 'not_sent'); sendMode = 'reject';
    assert.equal((await send(d.id)).message.status, 'failed');
    await resolveEmailSend(client, ORG, USER, d.id, 'not_sent'); sendMode = 'ok';
    assert.equal((await send(d.id)).message.status, 'sent');
  });
  it('replies through the original provider message and keeps the correspondence together', async () => {
    const incoming = (await listEmails(client, ORG, CONN, { direction: 'incoming', candidateId: CANDIDATE })).messages[0];
    const d = { id: randomUUID(), connectionId: CONN, replyToId: incoming.id, subject: 'Re: Application', body: 'Thank you. Please confirm tomorrow.' };
    await saveEmailDraft(client, ORG, USER, d);
    await send(d.id);
    assert.equal(sends.at(-1)?.replyMessageId, incoming.message_id);
    assert.equal(sends.at(-1)?.to, incoming.sender);
    assert.ok((await readEmail(client, ORG, incoming.id, mail)).thread.some(m => m.id === d.id));
  });
  it('does not repeat a send left in progress after a server interruption', async () => {
    const d = draft(); await saveEmailDraft(client, ORG, USER, d);
    await db.query("update recruitment_mail_messages set status='sending',attempted_at=now() where id=$1", [d.id]);
    const count = sends.length;
    await assert.rejects(send(d.id), /already attempted/);
    await assert.rejects(resolveEmailSend(client, ORG, USER, d.id, 'not_sent'), /Wait/);
    await db.query("update recruitment_mail_messages set attempted_at=now()-interval '15 minutes' where id=$1", [d.id]);
    assert.equal((await resolveEmailSend(client, ORG, USER, d.id, 'sent')).message.status, 'sent');
    assert.equal(sends.length, count);
  });
  it('requires hiring-request permission; creates a single draft under HR’s login and never submits from an email', async () => {
    const incoming = (await listEmails(client, ORG, CONN, { direction: 'incoming' })).messages.find(m => m.sender === 'manager@example.test')!;
    const fields = { roleTitle: 'Supervisor', positions: 2, budgetMaxCtc: 600000, justification: 'Two sites opening', submit: true, raised_by: COLLEAGUE, status: 'approved' };
    await assert.rejects(emailToRequisition(client, ORG, { id: USER, name: 'HR User' }, incoming.id, fields), /permission/);
    await saveRaisers(client, ORG, { roles: [], userIds: [USER] });
    const result = await emailToRequisition(client, ORG, { id: USER, name: 'HR User' }, incoming.id, fields);
    assert.equal(result.requisition.status, 'draft'); assert.equal(result.requisition.raisedBy, USER);
    const retry = await emailToRequisition(client, ORG, { id: USER, name: 'HR User' }, incoming.id, fields);
    assert.equal(retry.requisition.id, result.requisition.id);
    assert.equal((await db.query('select * from recruitment_requisitions')).rows.length, 1);
    assert.equal((await db.query('select * from recruitment_requisition_approvals')).rows.length, 0);
    assert.equal((await readEmail(client, ORG, incoming.id, mail)).requisitionId, result.requisition.id);
  });
  it('asks for CREATE only on an explicit sending connection; normal reconnects restore read-only access', async () => {
    const io = { fetch: (async () => Response.json({ refresh_token: 'new-fake-grant', scope: 'ZohoMail.messages.READ,ZohoMail.messages.CREATE' })) as typeof fetch,
      addresses: async () => ['hr@example.test'] };
    const send = await startResumeMailOAuth(client, ORG, USER, 'https://app.test', true);
    const url = new URL(send.url); assert.match(url.searchParams.get('scope')!, /messages.CREATE/);
    await finishResumeMailOAuth(client, url.searchParams.get('state')!, { id: USER, email: 'hr@example.test' }, 'code', undefined, io);
    assert.equal((await emailConnections(client, ORG, USER)).connections[0].can_send, true);
    const read = new URL((await startResumeMailOAuth(client, ORG, USER, 'https://app.test')).url);
    assert.equal(read.searchParams.get('scope')!.includes('CREATE'), false);
    await finishResumeMailOAuth(client, read.searchParams.get('state')!, { id: USER, email: 'hr@example.test' }, 'code', undefined, io);
    assert.equal((await emailConnections(client, ORG, USER)).connections[0].can_send, false);
  });
  it('keeps correspondence private from direct browser database access and safely reruns the migration', async () => {
    await db.exec(migration);
    await db.exec('set role authenticated');
    try { await assert.rejects(db.query('select * from recruitment_mail_messages'), /permission denied/); }
    finally { await db.exec('reset role'); }
  });
});
