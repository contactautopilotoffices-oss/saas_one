import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ZohoMailService, type ZohoMailGrant } from '@/backend/services/zohoMailService';
import { zohoApps } from '@/backend/lib/mail/oauth';
import { decryptToken } from '@/backend/lib/mail/token-crypto';
import { MAX_RESUME_BYTES, RESUME_BUCKET, RESUME_TYPES } from './config';
import { CandidateActionError } from './records';
import { fileExtension } from './resume-pick';
import { confirmResumeUploads, prepareResumeUploads, uploaderName, type ResumeStorage } from './resumes';

export const MAIL_CONNECTIONS = 'candidate_resume_mail_connections';
export const MAIL_ITEMS = 'candidate_resume_mail_items';
const SUMMARY = 'id, address, addresses, folder_id, folder_name, since_date, sourced_role, sync_every, active, scan_start, scan_complete, last_synced_at, last_error';
export interface ResumeMailConnection {
  id: string; address: string; addresses: string[]; folder_id: string | null; folder_name: string | null;
  since_date: string | null; sourced_role: string | null; sync_every: 'manual' | 'hourly'; active: boolean;
  scan_start: number; scan_complete: boolean; last_synced_at: string | null; last_error: string | null;
  connected?: boolean;
}
export interface Connection extends ResumeMailConnection {
  organization_id: string; refresh_token_enc: string | null; dc: string;
  connected_by: string | null; connected_email: string | null;
  oauth_client_id?: string | null; can_send?: boolean; email_scan_start?: number;
}
export interface ResumeMailItem {
  id: string; connection_id: string; message_id: string; attachment_id: string; folder_id: string;
  mailbox: string; sender: string; subject: string; received_at: string;
  file_name: string; file_size: number; status: 'pending' | 'imported' | 'duplicate' | 'skipped';
  file_id: string | null; last_error: string | null; possibleDuplicate?: boolean;
}
type Mail = Pick<typeof ZohoMailService, 'listFolders' | 'listPage' | 'listAttachmentsWithGrant' | 'downloadAttachmentWithGrant'>;
export type MailStorage = ResumeStorage & {
  upload(path: string, body: Buffer, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: { message: string } | null }>;
};

export function mailDb(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (/oauth_client_id/.test(error.message)) throw new CandidateActionError(503, 'Apply the shared Zoho mailbox migration 20261126000003 before connecting.');
  if (/42P01|42703|PGRST20[45]/.test(error.code ?? '') || /schema cache|does not exist/.test(error.message)) {
    throw new CandidateActionError(503, 'Zoho resume import needs a database update first: run 20261122000002_recruitment_mail.sql after the resume sourcing migration.');
  }
  throw new CandidateActionError(500, 'Could not save or load the mail import. Please retry.');
}
export function mailId(value: unknown): string {
  const id = z.string().uuid().safeParse(value);
  if (!id.success) throw new CandidateActionError(400, 'Choose a mail connection or attachment.');
  return id.data;
}
export function grant(c: Connection, db: SupabaseClient): ZohoMailGrant {
  if (!c.refresh_token_enc) throw new CandidateActionError(409, 'Connect this shared mailbox once in Recruitment.');
  const apps = zohoApps();
  const known = apps.find(a => a.clientId === c.oauth_client_id);
  if (c.oauth_client_id && !known) throw new CandidateActionError(503, 'Restore the credentials for the Zoho app that issued this mailbox connection, or reconnect the shared mailbox.');
  let refreshToken: string;
  try { refreshToken = decryptToken(c.refresh_token_enc); }
  catch { throw new CandidateActionError(409, 'This mailbox connection can no longer be read. Connect it again.'); }
  if (known) return { refreshToken, dc: c.dc, clientId: known.clientId, clientSecret: known.clientSecret };
  // Older grants carried no client ID. Try the historical mail app first and pin only a successful refresh.
  const legacy = [...apps.filter(a => a.prefix === 'ZOHO_MAIL_APP'), ...apps];
  return { refreshToken, dc: c.dc, legacyApps: legacy.filter((a, i) => legacy.findIndex(b => b.clientId === a.clientId) === i),
    rememberClient: async id => {
      const saved = await db.from(MAIL_CONNECTIONS).update({ oauth_client_id: id }).eq('organization_id', c.organization_id)
        .eq('id', c.id).eq('refresh_token_enc', c.refresh_token_enc!).is('oauth_client_id', null);
      mailDb(saved.error);
    } };
}
export async function connection(db: SupabaseClient, orgId: string, id: unknown): Promise<Connection> {
  const { data, error } = await db.from(MAIL_CONNECTIONS).select('*').eq('organization_id', orgId).eq('id', mailId(id)).maybeSingle();
  mailDb(error);
  if (!data) throw new CandidateActionError(404, 'That mailbox connection is no longer here.');
  return data as Connection;
}
export async function listResumeMail(db: SupabaseClient, orgId: string) {
  const { data, error } = await db.from(MAIL_CONNECTIONS).select(`${SUMMARY}, refresh_token_enc`).eq('organization_id', orgId).order('created_at');
  mailDb(error);
  return { connections: (data ?? []).map(({ refresh_token_enc, ...c }) => ({ ...c, connected: Boolean(refresh_token_enc) })) };
}
export async function resumeMailFolders(db: SupabaseClient, orgId: string, id: unknown, mail: Mail = ZohoMailService) {
  const c = await connection(db, orgId, id);
  return { folders: await mail.listFolders({ grant: grant(c, db) }, c.address) };
}

export async function locked<T>(db: SupabaseClient, orgId: string, id: unknown, run: (c: Connection) => Promise<T>): Promise<T> {
  const c = await connection(db, orgId, id);
  const token = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await db.from(MAIL_CONNECTIONS)
    .update({ lock_token: token, lock_until: new Date(Date.now() + 10 * 60_000).toISOString() })
    .eq('organization_id', orgId).eq('id', c.id).or(`lock_until.is.null,lock_until.lt.${now}`).select('id');
  mailDb(error);
  if (!data?.length) throw new CandidateActionError(409, 'This mailbox is busy. Wait for the current operation to finish and retry.');
  try {
    // Re-read after acquiring the lock: another request may have changed settings before our claim.
    return await run(await connection(db, orgId, c.id));
  } finally {
    const released = await db.from(MAIL_CONNECTIONS).update({ lock_token: null, lock_until: null }).eq('id', c.id).eq('organization_id', orgId).eq('lock_token', token);
    mailDb(released.error);
  }
}
const Settings = z.object({
  folderId: z.string().regex(/^\d+$/).max(80), sinceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourcedRole: z.string().trim().max(200).default(''), syncEvery: z.enum(['manual', 'hourly']), active: z.boolean(),
});
export async function saveResumeMailSettings(db: SupabaseClient, orgId: string, id: unknown, input: unknown, mail: Mail = ZohoMailService) {
  const parsed = Settings.safeParse(input);
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.sinceDate)) || new Date(parsed.data.sinceDate).toISOString().slice(0, 10) !== parsed.data.sinceDate) {
    throw new CandidateActionError(400, 'Choose a folder, a valid starting date, designation and sync frequency.');
  }
  return locked(db, orgId, id, async c => {
    const settings = parsed.data;
    const folders = await mail.listFolders({ grant: grant(c, db) }, c.address);
    const folder = folders.find(f => f.folderId === settings.folderId);
    if (!folder) throw new CandidateActionError(400, 'Choose a folder from this mailbox.');
    const changed = c.folder_id !== folder.folderId || !c.since_date || new Date(c.since_date).toISOString().slice(0, 10) !== settings.sinceDate;
    if (settings.syncEvery === 'hourly' && (changed || (c.sync_every !== 'hourly' && !c.scan_complete))) {
      throw new CandidateActionError(409, 'Save in manual mode and finish the first preview before enabling automatic imports.');
    }
    // Unimported previews from a previous folder/date must never enter the new automatic queue.
    if (changed) {
      const reset = await db.from(MAIL_ITEMS).delete().eq('organization_id', orgId).eq('connection_id', c.id).eq('status', 'pending');
      mailDb(reset.error);
    }
    const result = await db.from(MAIL_CONNECTIONS).update({
      folder_id: folder.folderId, folder_name: folder.folderName, since_date: settings.sinceDate,
      sourced_role: settings.sourcedRole || null, sync_every: settings.syncEvery, active: settings.active,
      ...(changed ? { scan_start: 1, scan_complete: false, ...(c.email_scan_start !== undefined ? { email_scan_start: 1 } : {}) } : {}), last_error: null,
    }).eq('organization_id', orgId).eq('id', c.id);
    mailDb(result.error);
    return { ok: true };
  });
}
export async function disconnectResumeMail(db: SupabaseClient, orgId: string, id: unknown) {
  return locked(db, orgId, id, async c => {
    const result = await db.from(MAIL_CONNECTIONS).update({ refresh_token_enc: null, active: false, sync_every: 'manual' }).eq('organization_id', orgId).eq('id', c.id);
    mailDb(result.error);
    return { ok: true };
  });
}
export async function pauseResumeMail(db: SupabaseClient, orgId: string, id: unknown, paused: boolean) {
  return locked(db, orgId, id, async c => {
    if (!paused) grant(c, db);
    const result = await db.from(MAIL_CONNECTIONS).update({ active: !paused }).eq('organization_id', orgId).eq('id', c.id);
    mailDb(result.error); return { ok: true };
  });
}
export async function listResumeMailItems(db: SupabaseClient, orgId: string, id: unknown, status: string, page: number) {
  await connection(db, orgId, id);
  if (!['pending', 'imported', 'duplicate', 'skipped'].includes(status) || !Number.isInteger(page) || page < 1 || page > 100_000) {
    throw new CandidateActionError(400, 'Choose a valid preview page.');
  }
  const { data, count, error } = await db.from(MAIL_ITEMS).select('*', { count: 'exact' })
    .eq('organization_id', orgId).eq('connection_id', id).eq('status', status)
    .order('received_at', { ascending: false }).order('id').range((page - 1) * 50, page * 50 - 1);
  mailDb(error);
  const items = (data ?? []) as ResumeMailItem[];
  const names = items.map(i => i.file_name);
  const existing = names.length ? await db.from('candidate_resume_files').select('file_name').eq('organization_id', orgId).in('file_name', names) : { data: [], error: null };
  mailDb(existing.error);
  const known = new Set((existing.data ?? []).map(f => f.file_name));
  return { items: items.map(i => ({ ...i, possibleDuplicate: known.has(i.file_name) })), total: count ?? 0 };
}
function ready(c: Connection) {
  if (!c.active) throw new CandidateActionError(409, 'This connection is paused. Resume it first.');
  if (!c.folder_id || !c.since_date) throw new CandidateActionError(409, 'Choose the folder and starting date first.');
}

async function scan(db: SupabaseClient, c: Connection, mail: Mail) {
  ready(c);
  const g = grant(c, db);
  const folders = await mail.listFolders({ grant: g }, c.address);
  if (!folders.some(f => f.folderId === c.folder_id)) throw new CandidateActionError(409, 'The selected mail folder is no longer available. Choose a folder again.');
  const page = await mail.listPage({ grant: g }, { address: c.address, folderId: c.folder_id!, start: c.scan_start, limit: 10 });
  // shortcut: Zoho supplies offsets, not snapshot cursors; every completed pass restarts at 1 to catch mailbox changes.
  for (const m of page.items) {
    if (m.folderId !== c.folder_id || new Date(m.sentAt) < new Date(c.since_date!) || !m.hasAttachment) continue;
    const attachments = await mail.listAttachmentsWithGrant(m.messageId, g, c.address, c.folder_id!);
    for (const a of attachments) {
      if (!RESUME_TYPES[fileExtension(a.attachmentName)] || a.attachmentName.length > 255 || a.attachmentSize > MAX_RESUME_BYTES) continue;
      const result = await db.from(MAIL_ITEMS).insert({ organization_id: c.organization_id, connection_id: c.id,
        message_id: m.messageId, attachment_id: a.attachmentId, folder_id: c.folder_id, mailbox: c.address,
        sender: m.fromAddress.slice(0, 500), subject: m.subject.slice(0, 1000), received_at: m.sentAt,
        file_name: a.attachmentName, file_size: Math.max(0, a.attachmentSize),
      });
      if (result.error?.code !== '23505') mailDb(result.error);
    }
  }
  const complete = page.fetched < 10 || page.items.some(m => new Date(m.sentAt) < new Date(c.since_date!));
  const result = await db.from(MAIL_CONNECTIONS).update({ scan_start: complete ? 1 : c.scan_start + page.fetched,
    scan_complete: complete, last_synced_at: new Date().toISOString(), last_error: null,
  }).eq('organization_id', c.organization_id).eq('id', c.id);
  mailDb(result.error);
  return { complete, scanned: page.fetched };
}
export async function previewResumeMail(db: SupabaseClient, orgId: string, id: unknown, mail: Mail = ZohoMailService) {
  return locked(db, orgId, id, async c => {
    try { return await scan(db, c, mail); }
    catch (error) { await recordError(db, c, error); throw mailError(error); }
  });
}
function mailError(error: unknown): CandidateActionError {
  return error instanceof CandidateActionError ? error : new CandidateActionError(502,
    'Could not read Zoho Mail. Check the connection and folder, then retry. Reconnect if access was revoked.');
}
async function recordError(db: SupabaseClient, c: Connection, error: unknown) {
  const result = await db.from(MAIL_CONNECTIONS).update({ last_error: mailError(error).message, last_synced_at: new Date().toISOString() }).eq('organization_id', c.organization_id).eq('id', c.id);
  mailDb(result.error);
}
const Import = z.object({ ids: z.array(z.string().uuid()).min(1).max(10), sourcedRole: z.string().trim().max(200).optional(), skip: z.boolean().optional() });
async function importItems(db: SupabaseClient, c: Connection, user: { id: string; email: string | null }, input: z.infer<typeof Import>, mail: Mail, storage: MailStorage) {
  ready(c);
  const g = grant(c, db);
  const { data, error } = await db.from(MAIL_ITEMS).select('*').eq('organization_id', c.organization_id).eq('connection_id', c.id).in('id', input.ids);
  mailDb(error);
  const rows = (data ?? []) as ResumeMailItem[];
  if (rows.length !== new Set(input.ids).size) throw new CandidateActionError(404, 'One of the selected attachments is no longer here.');
  const totals = { imported: 0, duplicates: 0, skipped: 0, failed: 0 };
  const device = await uploaderName(db, user);
  for (const item of rows) {
    if (item.status !== 'pending') continue;
    if (item.folder_id !== c.folder_id || new Date(item.received_at) < new Date(c.since_date!)) continue;
    const attempt = await db.from(MAIL_ITEMS).update({ last_attempt_at: new Date().toISOString() }).eq('id', item.id).eq('organization_id', c.organization_id);
    mailDb(attempt.error);
    try {
      if (input.skip) {
        const skipped = await db.from(MAIL_ITEMS).update({ status: 'skipped', last_error: null }).eq('id', item.id).eq('organization_id', c.organization_id);
        mailDb(skipped.error); totals.skipped++; continue;
      }
      const bytes = await mail.downloadAttachmentWithGrant(item.message_id, item.attachment_id, g, c.address, { folderId: item.folder_id, maxBytes: MAX_RESUME_BYTES });
      if (!bytes.length || bytes.length > MAX_RESUME_BYTES) throw new CandidateActionError(400, 'The attachment is empty or exceeds the 15 MB resume limit.');
      const prepared = await prepareResumeUploads(db, storage, c.organization_id, user, { device, sourcedRole: input.sourcedRole ?? c.sourced_role,
        files: [{ index: 0, name: item.file_name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
          modifiedAt: new Date(item.received_at).toISOString(), source: { kind: 'own', name: 'Zoho Mail' } }],
      });
      const slot = prepared.files[0];
      if (slot.outcome === 'rejected' || !slot.id) throw new CandidateActionError(400, slot.reason ?? 'This attachment cannot be imported.');
      if (slot.outcome === 'upload') {
        const file = await db.from('candidate_resume_files').select('storage_path').eq('organization_id', c.organization_id).eq('id', slot.id).single();
        mailDb(file.error);
        const result = await storage.upload(file.data!.storage_path, bytes, { contentType: slot.contentType!, upsert: true });
        if (result.error) throw new CandidateActionError(502, 'Could not store this attachment. Retry the import.');
        const confirmed = await confirmResumeUploads(db, storage, c.organization_id, [slot.id]);
        if (!confirmed.ready.includes(slot.id)) throw new CandidateActionError(502, 'The file has not finished saving. Retry the import.');
      }
      const saved = await db.from(MAIL_ITEMS).update({ status: slot.outcome === 'duplicate' ? 'duplicate' : 'imported', file_id: slot.id, last_error: null })
        .eq('organization_id', c.organization_id).eq('id', item.id);
      mailDb(saved.error);
      if (slot.outcome === 'duplicate') totals.duplicates++; else totals.imported++;
    } catch (error) {
      totals.failed++;
      const result = await db.from(MAIL_ITEMS).update({ last_error: mailError(error).message }).eq('organization_id', c.organization_id).eq('id', item.id);
      mailDb(result.error);
    }
  }
  return totals;
}
export async function importResumeMail(db: SupabaseClient, orgId: string, id: unknown, user: { id: string; email: string | null }, input: unknown,
  mail: Mail = ZohoMailService, storage: MailStorage = db.storage.from(RESUME_BUCKET)) {
  const parsed = Import.safeParse(input);
  if (!parsed.success) throw new CandidateActionError(400, 'Select 1 to 10 attachments and a designation of up to 200 characters.');
  return locked(db, orgId, id, c => importItems(db, c, user, parsed.data, mail, storage));
}
export async function dueResumeMail(db: SupabaseClient) {
  const { data, error } = await db.from(MAIL_CONNECTIONS).select('id, organization_id, connected_by')
    .eq('active', true).eq('sync_every', 'hourly').not('refresh_token_enc', 'is', null)
    .or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 55 * 60_000).toISOString()}`)
    .order('last_synced_at', { ascending: true }).limit(20);
  mailDb(error); return data ?? [];
}
export async function syncResumeMail(db: SupabaseClient, orgId: string, id: unknown, mail: Mail = ZohoMailService,
  storage: MailStorage = db.storage.from(RESUME_BUCKET)) {
  return locked(db, orgId, id, async c => {
    if (c.sync_every !== 'hourly' || !c.active || !c.connected_by) return { imported: 0 };
    try {
      await scan(db, c, mail);
      const pending = await db.from(MAIL_ITEMS).select('id').eq('organization_id', orgId).eq('connection_id', c.id).eq('status', 'pending')
        .order('last_attempt_at', { ascending: true, nullsFirst: true }).order('created_at').limit(3);
      mailDb(pending.error);
      if (!pending.data?.length) return { imported: 0 };
      const result = await importItems(db, c, { id: c.connected_by, email: c.connected_email }, { ids: pending.data.map(i => i.id) }, mail, storage);
      if (result.failed) await recordError(db, c, new CandidateActionError(502, 'Some attachments could not be imported. Open the preview for details and retry.'));
      return result;
    } catch (error) { await recordError(db, c, error); throw mailError(error); }
  });
}
