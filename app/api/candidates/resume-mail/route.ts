import { NextResponse } from 'next/server';
import { disconnectResumeMail, importResumeMail, listResumeMail, listResumeMailItems, pauseResumeMail, previewResumeMail, resumeMailFolders, saveResumeMailSettings } from '@/backend/lib/candidates/resume-mail';
import { startResumeMailOAuth } from '@/backend/lib/candidates/resume-mail-oauth';
import { errorResponse, rateLimited, readJson, requireCandidateAccess } from '../_lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get('orgId'));
  if (auth.error) return auth.error;
  const limited = rateLimited('resume-mail-read', auth.user.id, { maxRequests: 90, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const id = params.get('id');
    const result = params.get('view') === 'folders' ? await resumeMailFolders(auth.admin, auth.orgId, id)
      : params.get('view') === 'items' ? await listResumeMailItems(auth.admin, auth.orgId, id, params.get('status') || 'pending', Number(params.get('page') || 1))
      : await listResumeMail(auth.admin, auth.orgId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'Could not read the mailbox. Check the connection and retry.'); }
}
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited('resume-mail-write', auth.user.id, { maxRequests: 30, windowMs: 60_000 });
  if (limited) return limited;
  try {
    let result: unknown;
    const { admin, orgId, user } = auth;
    switch (body.action) {
      case 'connect': result = await startResumeMailOAuth(admin, orgId, user.id, request.url); break;
      case 'settings': result = await saveResumeMailSettings(admin, orgId, body.id, body); break;
      case 'preview': result = await previewResumeMail(admin, orgId, body.id); break;
      case 'import': result = await importResumeMail(admin, orgId, body.id, { id: user.id, email: user.email ?? null }, body); break;
      case 'pause': result = await pauseResumeMail(admin, orgId, body.id, true); break;
      case 'resume': result = await pauseResumeMail(admin, orgId, body.id, false); break;
      case 'disconnect': result = await disconnectResumeMail(admin, orgId, body.id); break;
      default: return NextResponse.json({ error: 'Choose a mail action.' }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 'Could not complete the mail action. Check the connection and retry.'); }
}
