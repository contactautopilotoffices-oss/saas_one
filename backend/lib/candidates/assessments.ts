import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AiSensyService, type AiSensySendResult, type AiSensyTemplateOptions } from '@/backend/services/AiSensyService';
import { loadBlacklist, recordAction, type Actor } from './actions';
import { saveEmailDraft, sendEmail } from './email';
import { parsePhone } from './normalize';
import { CandidateActionError, getRecord } from './records';

const TABLE = 'candidate_assessment_invites';
export const ASSESSMENT_CAMPAIGN = 'candidate_assessment_invite_v1';
export interface AssessmentChoice { id: string; title: string; duration: number; url: string }
export interface AssessmentInvite { id: string; test_id: string; channel: 'email' | 'whatsapp'; status: 'sending' | 'sent' | 'failed' | 'unknown'; recipient: string; error: string | null; mail_id: string | null }
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) throw new CandidateActionError(503, 'Assessment sending needs database migration 20261122000005_candidate_assessments.sql.');
  throw new CandidateActionError(500, 'Could not save the assessment invitation. Refresh before trying again.');
}
export function assessmentMessage(name: string, test: AssessmentChoice) {
  return `Hello ${name},\n\nPlease complete the ${test.title} assessment (${test.duration} minutes):\n${test.url}\n\nOpen the link and enter your name and email to begin.\n\nAutopilot Offices Recruitment Team`;
}
export async function assessmentChoices(db: SupabaseClient, orgId: string, appUrl: string): Promise<AssessmentChoice[]> {
  const { data, error } = await db.from('proctor_tests').select('id, title, duration_minutes, public_token').eq('organization_id', orgId).eq('is_active', true).order('created_at', { ascending: false });
  check(error);
  return (data ?? []).filter(t => t.public_token).map(t => ({ id: t.id, title: t.title, duration: t.duration_minutes, url: `${appUrl.replace(/\/$/, '')}/t/${encodeURIComponent(t.public_token)}` }));
}
export async function assessmentReceipts(db: SupabaseClient, orgId: string, applicationId: string) {
  const record = await getRecord(db, orgId, applicationId);
  const { data, error } = await db.from(TABLE).select('id, test_id, channel, status, recipient, error, mail_id').eq('organization_id', orgId).eq('candidate_id', record.candidateId);
  check(error);
  return (data ?? []) as AssessmentInvite[];
}
export interface AssessmentSendDeps {
  whatsapp: (input: AiSensyTemplateOptions) => Promise<AiSensySendResult>;
  email: (input: { id: string; connectionId: string; candidateId: string; subject: string; body: string }) => Promise<{ status: string; error?: string | null }>;
}
const Send = z.object({ applicationId: z.string().uuid(), testId: z.string().uuid(), channel: z.enum(['email', 'whatsapp']), connectionId: z.string().uuid().optional() });

export async function sendAssessment(db: SupabaseClient, orgId: string, by: Actor, input: unknown, appUrl: string, deps?: AssessmentSendDeps): Promise<AssessmentInvite> {
  const parsed = Send.safeParse(input);
  if (!parsed.success) throw new CandidateActionError(400, 'Choose a candidate, an assessment and how to send it.');
  const s = parsed.data;
  const record = await getRecord(db, orgId, s.applicationId);
  const test = (await assessmentChoices(db, orgId, appUrl)).find(t => t.id === s.testId);
  if (!test) throw new CandidateActionError(404, 'This assessment is unavailable. Choose an active assessment from your organisation.');
  if (await loadBlacklist(db, orgId, record.candidateId)) throw new CandidateActionError(409, 'This candidate is blacklisted. No invitation will be sent.');
  const phone = parsePhone(record.phone).key;
  const recipient = s.channel === 'email' ? record.email : phone ? `91${phone}` : null;
  if (!recipient || (s.channel === 'email' && !z.string().email().safeParse(recipient).success)) throw new CandidateActionError(400, s.channel === 'email' ? 'Add a valid candidate email first.' : 'Add a valid Indian mobile number first.');
  if (s.channel === 'email' && !s.connectionId) throw new CandidateActionError(400, 'Choose a connected recruitment mailbox.');
  const prior = await db.from(TABLE).select('*').eq('organization_id', orgId).eq('candidate_id', record.candidateId).eq('test_id', test.id).eq('channel', s.channel).maybeSingle();
  check(prior.error);
  // shortcut: one successful invitation per test/channel; add explicit resends if retake invitations are needed.
  if (prior.data && prior.data.status !== 'failed') return prior.data as AssessmentInvite;
  const id = prior.data?.id ?? randomUUID();
  const mailId = s.channel === 'email' ? randomUUID() : null;
  const values = { status: 'sending', recipient, error: null, mail_id: mailId, created_by: by.id, updated_at: new Date().toISOString() };
  const claim = prior.data
    ? await db.from(TABLE).update(values).eq('organization_id', orgId).eq('id', id).eq('status', 'failed').select('*').maybeSingle()
    : await db.from(TABLE).insert({ ...values, id, organization_id: orgId, candidate_id: record.candidateId, application_id: record.id, test_id: test.id, channel: s.channel }).select('*').single();
  if (claim.error?.code === '23505' || (!claim.error && !claim.data)) throw new CandidateActionError(409, 'This invitation is already being sent. Refresh to see its status.');
  check(claim.error);
  const senders: AssessmentSendDeps = deps ?? {
    whatsapp: o => AiSensyService.sendTemplate(o),
    email: async d => {
      const draft = await saveEmailDraft(db, orgId, by.id, d);
      const sent = await sendEmail(db, orgId, by.id, draft.message.id, draft.message.updated_at);
      return { status: sent.message.status, error: sent.message.last_error };
    },
  };
  let status: AssessmentInvite['status'] = 'unknown';
  let error: string | null = null;
  try {
    if (s.channel === 'email') {
      const result = await senders.email({ id: mailId!, connectionId: s.connectionId!, candidateId: record.candidateId, subject: `Assessment: ${test.title}`.replace(/[\r\n]+/g, ' ').slice(0, 250), body: assessmentMessage(record.fullName, test) });
      status = result.status === 'sent' ? 'sent' : result.status === 'failed' ? 'failed' : 'unknown';
      error = result.error ?? null;
    } else {
      const result = await senders.whatsapp({ phone: recipient, campaignName: process.env.AISENSY_CANDIDATE_ASSESSMENT_CAMPAIGN?.trim() || ASSESSMENT_CAMPAIGN, userName: record.fullName,
        templateParams: [record.fullName.trim().split(/\s+/)[0], test.title.replace(/\s+/g, ' ').trim(), String(test.duration), test.url] });
      status = result.success ? 'sent' : result.ambiguous ? 'unknown' : 'failed';
      error = result.success ? null : result.error ?? 'WhatsApp did not confirm sending.';
    }
  } catch (e) {
    status = e instanceof CandidateActionError && e.status < 500 ? 'failed' : 'unknown';
    error = status === 'failed' && e instanceof Error ? e.message : 'Sending was not confirmed. Check Zoho Sent or AiSensy delivery before sending another invitation.';
  }
  const saved = await db.from(TABLE).update({ status, error, updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', id).select('*').single();
  check(saved.error);
  if (status === 'sent') await recordAction(db, orgId, by, { candidateId: record.candidateId, applicationId: record.id, action: 'outreach_sent', remark: `Assessment "${test.title}" sent by ${s.channel}.`, meta: { kind: 'assessment_invite', testId: test.id, channel: s.channel, invitationId: id, mailId } });
  return saved.data as AssessmentInvite;
}
