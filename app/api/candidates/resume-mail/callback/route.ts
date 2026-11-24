import { getCandidatesAdmin } from '@/backend/lib/candidates/access';
import { finishResumeMailOAuth, resumeMailOAuthState } from '@/backend/lib/candidates/resume-mail-oauth';
import { CandidateActionError } from '@/backend/lib/candidates/records';
import { requireCandidateAccess } from '../../_lib/auth';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const reply = (message: string, status = 200) => new Response(message, { status, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
  if (params.has('error')) return reply('Zoho connection cancelled. Nothing was imported. Close this tab and return to Recruitment.', 400);
  try {
    const state = params.get('state') ?? '';
    const st = await resumeMailOAuthState(getCandidatesAdmin(), state);
    const auth = await requireCandidateAccess(st.organization_id);
    if (auth.error) return auth.error;
    await finishResumeMailOAuth(auth.admin, state, { id: auth.user.id, email: auth.user.email ?? null }, params.get('code') ?? '', params.get('accounts-server') ?? undefined);
    return reply('Zoho Mail connected. No emails were sent and no resumes were imported. Close this tab and refresh connections in Recruitment → Email or Recruitment → Resumes → Zoho Mail. Choose the folder and starting date under Resumes → Zoho Mail.');
  } catch (error) {
    return reply(error instanceof CandidateActionError ? error.message : 'Could not connect Zoho Mail. Return to Recruitment and start again.', error instanceof CandidateActionError ? error.status : 502);
  }
}
