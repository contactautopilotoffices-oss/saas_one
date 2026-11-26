import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ZohoMailService, ZohoMailSendError } from '@/backend/services/zohoMailService';
import { htmlToText } from '@/backend/lib/mail/text';
import type { Actor } from './actions';
import { CandidateActionError } from './records';
import { connection, grant, locked, MAIL_CONNECTIONS, mailId } from './resume-mail';
import { createRequisition, getRequisition, requisitionAccess } from './requisitions';

const TABLE = 'recruitment_mail_messages';
const COLUMNS = 'id, connection_id, candidate_id, message_id, thread_id, folder_id, direction, status, sender, recipient, subject, body, body_loaded, reply_to_id, created_by, received_at, attempted_at, last_error, updated_at';
type Mail = Pick<typeof ZohoMailService, 'listFolders' | 'listPage' | 'getMessageContentWithGrant' | 'sendMessageWithGrant'>;
export interface RecruitmentEmail {
  id: string; connection_id: string; candidate_id: string | null; message_id: string | null; thread_id: string | null; folder_id: string | null;
  direction: 'incoming' | 'outgoing'; status: 'received' | 'draft' | 'sending' | 'sent' | 'failed' | 'unknown';
  sender: string; recipient: string; subject: string; body: string; body_loaded: boolean; reply_to_id: string | null;
  created_by: string | null; received_at: string; attempted_at: string | null; last_error: string | null; updated_at: string;
}
export function emailDb(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw new CandidateActionError(503, 'Recruitment Email needs a database update: run 20261122000003_recruitment_email.sql after Stage 2.');
  }
  throw new CandidateActionError(500, 'Could not save or load the email. Refresh before retrying.');
}
export async function emailConnections(db: SupabaseClient, orgId: string, userId: string) {
  const result = await db.from(MAIL_CONNECTIONS).select('id, address, folder_id, folder_name, since_date, active, can_send, email_scan_start, refresh_token_enc').eq('organization_id', orgId).order('created_at');
  emailDb(result.error);
  const access = await requisitionAccess(db, userId, orgId);
  return { connections: (result.data ?? []).map(({ refresh_token_enc, ...c }) => ({ ...c, connected: Boolean(refresh_token_enc) })), canRaise: access.canRaise };
}
async function row(db: SupabaseClient, orgId: string, id: unknown): Promise<RecruitmentEmail> {
  const result = await db.from(TABLE).select(COLUMNS).eq('organization_id', orgId).eq('id', mailId(id)).maybeSingle();
  emailDb(result.error);
  if (!result.data) throw new CandidateActionError(404, 'That email is no longer here.');
  return result.data as RecruitmentEmail;
}
export async function listEmails(db: SupabaseClient, orgId: string, connectionId: unknown, input: { page?: string | null; candidateId?: string | null; direction?: string | null }) {
  await connection(db, orgId, connectionId);
  const page = Number(input.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new CandidateActionError(400, 'Choose a valid page.');
  let query = db.from(TABLE).select(COLUMNS, { count: 'exact' }).eq('organization_id', orgId).eq('connection_id', connectionId);
  if (input.candidateId) query = query.eq('candidate_id', mailId(input.candidateId));
  if (input.direction) {
    if (!['incoming', 'outgoing'].includes(input.direction)) throw new CandidateActionError(400, 'Choose incoming or outgoing mail.');
    query = query.eq('direction', input.direction);
  }
  const result = await query.order('received_at', { ascending: false }).order('id').range((page - 1) * 30, page * 30 - 1);
  emailDb(result.error);
  return { messages: (result.data ?? []) as RecruitmentEmail[], total: result.count ?? 0 };
}
async function matchingCandidate(db: SupabaseClient, orgId: string, email: string): Promise<string | null> {
  // Exact address only; shared addresses must be reviewed rather than assigned to an arbitrary person.
  const result = await db.from('candidates').select('id').eq('organization_id', orgId).ilike('email', email.replace(/[\\%_]/g, '\\$&')).limit(2);
  emailDb(result.error);
  return result.data?.length === 1 ? result.data[0].id : null;
}
export async function syncEmails(db: SupabaseClient, orgId: string, id: unknown, mail: Mail = ZohoMailService) {
  return locked(db, orgId, id, async c => {
    if (!c.active || !c.folder_id || !c.since_date) throw new CandidateActionError(409, 'Choose a folder and starting date in Resumes → Zoho Mail, and resume the connection.');
    if (c.email_scan_start === undefined) throw new CandidateActionError(503, 'Apply the Stage 3 recruitment email migration first.');
    const g = grant(c, db);
    const folders = await mail.listFolders({ grant: g }, c.address);
    if (!folders.some(f => f.folderId === c.folder_id)) throw new CandidateActionError(409, 'The selected folder is no longer available. Choose it again.');
    const page = await mail.listPage({ grant: g }, { address: c.address, folderId: c.folder_id, start: c.email_scan_start, limit: 30 });
    let added = 0;
    for (const m of page.items) {
      if (m.folderId !== c.folder_id || new Date(m.sentAt) < new Date(c.since_date) || !z.string().email().safeParse(m.fromAddress).success) continue;
      const own = c.addresses.map(a => a.toLowerCase()).includes(m.fromAddress.toLowerCase());
      if (own) continue;
      const result = await db.from(TABLE).insert({ organization_id: orgId, connection_id: c.id,
        candidate_id: await matchingCandidate(db, orgId, m.fromAddress), message_id: m.messageId, thread_id: m.threadId,
        folder_id: m.folderId, direction: 'incoming', status: 'received', sender: m.fromAddress, recipient: c.address,
        subject: m.subject.slice(0, 500), body: htmlToText(m.summary, 2000), received_at: m.sentAt });
      if (result.error?.code === '23505') continue;
      emailDb(result.error); added++;
    }
    const complete = page.fetched < 30 || page.items.some(m => new Date(m.sentAt) < new Date(c.since_date!));
    // shortcut: Zoho offers offset pages; a completed pass restarts from the newest mail to catch folder changes.
    const saved = await db.from(MAIL_CONNECTIONS).update({ email_scan_start: complete ? 1 : c.email_scan_start + page.fetched }).eq('organization_id', orgId).eq('id', c.id);
    emailDb(saved.error);
    return { added, complete };
  });
}
export async function readEmail(db: SupabaseClient, orgId: string, id: unknown, mail: Mail = ZohoMailService) {
  const m = await row(db, orgId, id);
  if (!m.body_loaded && m.direction === 'incoming') {
    const c = await connection(db, orgId, m.connection_id);
    if (!c.active) throw new CandidateActionError(409, 'Resume the mail connection before reading new content.');
    const body = await mail.getMessageContentWithGrant(m.message_id!, m.folder_id, grant(c, db), c.address);
    const updated = await db.from(TABLE).update({ body: htmlToText(body.content, 50_000), body_loaded: true, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId).eq('id', m.id).select(COLUMNS).single();
    emailDb(updated.error);
    Object.assign(m, updated.data);
  }
  const related = await db.from(TABLE).select(COLUMNS).eq('organization_id', orgId).eq('connection_id', m.connection_id)
    .eq('thread_id', m.thread_id || m.message_id || m.id).order('received_at').limit(100);
  emailDb(related.error);
  const req = await db.from('recruitment_requisitions').select('id').eq('organization_id', orgId).eq('source_mail_id', m.id).maybeSingle();
  emailDb(req.error);
  return { message: m, thread: (related.data ?? []) as RecruitmentEmail[], requisitionId: req.data?.id ?? null };
}
const Draft = z.object({ id: z.string().uuid(), connectionId: z.string().uuid(), candidateId: z.string().uuid().optional(), replyToId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(250).regex(/^[^\r\n]+$/), body: z.string().trim().min(1).max(20_000) });
async function candidateRecipient(db: SupabaseClient, orgId: string, candidateId: string) {
  const result = await db.from('candidates').select('id, email, blacklisted_at').eq('organization_id', orgId).eq('id', candidateId).maybeSingle();
  emailDb(result.error);
  if (!result.data || !z.string().email().safeParse(result.data.email).success) throw new CandidateActionError(400, 'This candidate needs a valid email address on their record.');
  if (result.data.blacklisted_at) throw new CandidateActionError(409, 'This candidate is blacklisted. No email will be sent.');
  return String(result.data.email).trim().toLowerCase();
}
export async function saveEmailDraft(db: SupabaseClient, orgId: string, userId: string, input: unknown) {
  const parsed = Draft.safeParse(input);
  if (!parsed.success || Boolean(parsed.data.candidateId) === Boolean(parsed.data.replyToId)) throw new CandidateActionError(400, 'Choose a candidate or an email to reply to, and enter a subject and message.');
  const d = parsed.data;
  return locked(db, orgId, d.connectionId, async c => {
    if (!c.active || !c.can_send) throw new CandidateActionError(409, 'Connect this mailbox for sending and resume it first.');
    grant(c, db);
    let recipient: string; let candidateId = d.candidateId ?? null; let threadId: string | null = null;
    if (d.replyToId) {
      const incoming = await row(db, orgId, d.replyToId);
      if (incoming.connection_id !== c.id || incoming.direction !== 'incoming') throw new CandidateActionError(400, 'Choose an incoming email from this mailbox.');
      recipient = incoming.sender; candidateId = incoming.candidate_id;
      threadId = incoming.thread_id || incoming.message_id;
      if (candidateId) await candidateRecipient(db, orgId, candidateId);
    } else recipient = await candidateRecipient(db, orgId, d.candidateId!);
    if (!z.string().email().safeParse(recipient).success) throw new CandidateActionError(400, 'The recipient address is not valid.');
    const existing = await db.from(TABLE).select(COLUMNS).eq('organization_id', orgId).eq('id', d.id).maybeSingle();
    emailDb(existing.error);
    if (existing.data && (existing.data.status !== 'draft' || existing.data.created_by !== userId || existing.data.connection_id !== c.id)) throw new CandidateActionError(409, 'This draft cannot be edited. Refresh the email list.');
    const values = { candidate_id: candidateId, sender: c.address, recipient, subject: d.subject, body: d.body, body_loaded: true,
      reply_to_id: d.replyToId ?? null, thread_id: threadId, updated_at: new Date().toISOString() };
    const saved = existing.data
      ? await db.from(TABLE).update(values).eq('organization_id', orgId).eq('id', d.id).eq('status', 'draft').select(COLUMNS).single()
      : await db.from(TABLE).insert({ ...values, id: d.id, organization_id: orgId, connection_id: c.id, direction: 'outgoing', status: 'draft', created_by: userId }).select(COLUMNS).single();
    emailDb(saved.error);
    return { message: saved.data as RecruitmentEmail };
  });
}
export async function sendEmail(db: SupabaseClient, orgId: string, userId: string, id: unknown, reviewedAt: unknown, mail: Mail = ZohoMailService) {
  const initial = await row(db, orgId, id);
  return locked(db, orgId, initial.connection_id, async c => {
    const m = await row(db, orgId, id);
    if (m.created_by !== userId || m.direction !== 'outgoing') throw new CandidateActionError(403, 'Only the person who wrote this draft can send it.');
    if (m.status === 'sent') return { message: m };
    if (m.status !== 'draft') throw new CandidateActionError(409, 'This email was already attempted. Check its status before retrying.');
    if (typeof reviewedAt !== 'string' || !Number.isFinite(Date.parse(reviewedAt)) || Date.parse(reviewedAt) !== new Date(m.updated_at).getTime()) throw new CandidateActionError(409, 'This draft changed after your preview. Open it and review it again.');
    if (!c.active || !c.can_send || !c.refresh_token_enc) throw new CandidateActionError(409, 'Connect this mailbox for sending and resume it first.');
    if (m.candidate_id) {
      const currentEmail = await candidateRecipient(db, orgId, m.candidate_id);
      if (!m.reply_to_id && currentEmail !== m.recipient) throw new CandidateActionError(409, 'The candidate email address changed. Create a fresh draft and review the recipient.');
    }
    const blocked = await db.from('candidates').select('id').eq('organization_id', orgId).ilike('email', m.recipient.replace(/[\\%_]/g, '\\$&')).not('blacklisted_at', 'is', null).limit(1);
    emailDb(blocked.error);
    if (blocked.data?.length) throw new CandidateActionError(409, 'This email address belongs to a blacklisted candidate. No email will be sent.');
    const reply = m.reply_to_id ? await row(db, orgId, m.reply_to_id) : null;
    if (reply && (reply.connection_id !== c.id || reply.direction !== 'incoming' || reply.sender !== m.recipient)) throw new CandidateActionError(409, 'The reply destination changed. Create a fresh draft.');
    const g = grant(c, db);
    const now = new Date().toISOString();
    const claimed = await db.from(TABLE).update({ status: 'sending', attempted_at: now, updated_at: now, last_error: null })
      .eq('organization_id', orgId).eq('id', m.id).eq('status', 'draft').select('id');
    emailDb(claimed.error);
    if (!claimed.data?.length) throw new CandidateActionError(409, 'This email is already being sent.');
    let sent: { messageId: string | null; threadId: string | null };
    try {
      sent = await mail.sendMessageWithGrant(g, { from: c.address, to: m.recipient, subject: m.subject, body: m.body, ...(reply ? { replyMessageId: reply.message_id! } : {}) });
    } catch (error) {
      const rejected = error instanceof ZohoMailSendError && error.rejected;
      const result = await db.from(TABLE).update({ status: rejected ? 'failed' : 'unknown', last_error: rejected ? 'Zoho refused the email. Check the address and sending permissions.' : 'Sending was not confirmed. Check Sent in Zoho before retrying.', updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', m.id).select(COLUMNS).single();
      emailDb(result.error); return { message: result.data as RecruitmentEmail };
    }
    const saved = await db.from(TABLE).update({ status: 'sent', message_id: sent.messageId, thread_id: sent.threadId || m.thread_id || sent.messageId,
      last_error: null, received_at: now, updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', m.id).select(COLUMNS).single();
    // A storage failure leaves "sending"; a repeated Send must never repeat the external POST.
    emailDb(saved.error);
    return { message: saved.data as RecruitmentEmail };
  });
}
export async function resolveEmailSend(db: SupabaseClient, orgId: string, userId: string, id: unknown, resolution: unknown) {
  const m = await row(db, orgId, id);
  return locked(db, orgId, m.connection_id, async () => {
    const current = await row(db, orgId, id);
    if (current.created_by !== userId || current.direction !== 'outgoing') throw new CandidateActionError(403, 'Only the sender can resolve this email.');
    if (!['failed', 'unknown', 'sending'].includes(current.status) || (current.status === 'sending' && Date.now() - new Date(current.attempted_at!).getTime() < 5 * 60_000)) {
      throw new CandidateActionError(409, 'Wait for the send to finish, then refresh.');
    }
    if (!['sent', 'not_sent'].includes(String(resolution))) throw new CandidateActionError(400, 'Confirm whether this email is in Zoho Sent.');
    const result = await db.from(TABLE).update({ status: resolution === 'sent' ? 'sent' : 'draft', last_error: resolution === 'sent' ? 'Sender confirmed this email is in Zoho Sent.' : 'Sender confirmed this email was not sent; ready for review.', updated_at: new Date().toISOString() })
      .eq('organization_id', orgId).eq('id', current.id).select(COLUMNS).single();
    emailDb(result.error); return { message: result.data as RecruitmentEmail };
  });
}
export async function emailToRequisition(db: SupabaseClient, orgId: string, by: Actor, id: unknown, input: unknown) {
  const access = await requisitionAccess(db, by.id, orgId);
  if (!access.canRaise) throw new CandidateActionError(403, 'You do not have permission to raise hiring requests. The Tech team configures this access.');
  const m = await row(db, orgId, id);
  if (m.direction !== 'incoming') throw new CandidateActionError(400, 'Choose an incoming hiring request.');
  const existing = async () => {
    const result = await db.from('recruitment_requisitions').select('id').eq('organization_id', orgId).eq('source_mail_id', m.id).maybeSingle();
    emailDb(result.error); return result.data?.id as string | undefined;
  };
  const found = await existing();
  if (found) return getRequisition(db, orgId, found);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CandidateActionError(400, 'Review the hiring request details first.');
  try {
    const requisition = await createRequisition(db, orgId, by, { ...input, submit: false }, { sourceMailId: m.id });
    return { requisition };
  } catch (error) {
    const raced = await existing();
    if (raced) return getRequisition(db, orgId, raced);
    throw error;
  }
}
