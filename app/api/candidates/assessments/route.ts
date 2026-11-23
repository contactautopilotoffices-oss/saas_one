import { NextResponse } from 'next/server';
import { assessmentChoices, assessmentReceipts, sendAssessment } from '@/backend/lib/candidates/assessments';
import { emailConnections } from '@/backend/lib/candidates/email';
import { isProctorAccessError, resolveProctorAccess } from '@/backend/lib/proctor/access';
import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from '../_lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
const appUrl = (request: Request) => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(p.get('orgId'));
  if (auth.error) return auth.error;
  const access = await resolveProctorAccess(auth.orgId);
  if (isProctorAccessError(access)) return access;
  if (!access.canAuthor) return NextResponse.json({ error: 'Assessment sharing requires HR assessment access.' }, { status: 403 });
  const applicationId = p.get('applicationId') ?? '';
  if (!UUID.test(applicationId)) return NextResponse.json({ error: 'Choose a candidate.' }, { status: 400 });
  try {
    const [tests, receipts, mail] = await Promise.all([
      assessmentChoices(auth.admin, auth.orgId, appUrl(request)), assessmentReceipts(auth.admin, auth.orgId, applicationId), emailConnections(auth.admin, auth.orgId, auth.user.id),
    ]);
    return NextResponse.json({ tests, receipts, connections: mail.connections.filter(c => c.connected && c.active && c.can_send).map(c => ({ id: c.id, address: c.address })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, 'Could not load assessments.'); }
}
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const access = await resolveProctorAccess(auth.orgId);
  if (isProctorAccessError(access)) return access;
  if (!access.canAuthor) return NextResponse.json({ error: 'Assessment sharing requires HR assessment access.' }, { status: 403 });
  const limited = rateLimited('assessment-send', auth.user.id, { maxRequests: 20, windowMs: 60_000 });
  if (limited) return limited;
  try {
    return NextResponse.json({ invite: await sendAssessment(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body, appUrl(request)) });
  } catch (e) { return errorResponse(e, 'Could not send the assessment. Refresh before trying again.'); }
}
