import { NextResponse } from 'next/server';
import { emailConnections, emailToRequisition, listEmails, readEmail, resolveEmailSend, saveEmailDraft, sendEmail, syncEmails } from '@/backend/lib/candidates/email';
import { connectRecruitmentMailbox } from '@/backend/lib/candidates/resume-mail-oauth';
import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from '../_lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(p.get('orgId'));
  if (auth.error) return auth.error;
  const limited = rateLimited('email-read', auth.user.id, { maxRequests: 90, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const result = p.get('view') === 'message' ? await readEmail(auth.admin, auth.orgId, p.get('id'))
      : p.get('view') === 'messages' ? await listEmails(auth.admin, auth.orgId, p.get('connectionId'), { page: p.get('page'), candidateId: p.get('candidateId'), direction: p.get('direction') })
      : await emailConnections(auth.admin, auth.orgId, auth.user.id);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'Could not read the email. Check the mailbox connection and retry.'); }
}
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited('email-write', auth.user.id, { maxRequests: 20, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const { admin, orgId, user } = auth;
    let result: unknown;
    switch (body.action) {
      case 'connect-send': result = await connectRecruitmentMailbox(admin, orgId, user.id, request.url, true, body.reconnect === true); break;
      case 'sync': result = await syncEmails(admin, orgId, body.connectionId); break;
      case 'draft': result = await saveEmailDraft(admin, orgId, user.id, body); break;
      case 'send': result = await sendEmail(admin, orgId, user.id, body.id, body.reviewedAt); break;
      case 'resolve': result = await resolveEmailSend(admin, orgId, user.id, body.id, body.resolution); break;
      case 'requisition': result = await emailToRequisition(admin, orgId, await actorFor(admin, user), body.id, body.fields); break;
      default: return NextResponse.json({ error: 'Choose an email action.' }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 'Could not complete the email action. Refresh before trying again.'); }
}
