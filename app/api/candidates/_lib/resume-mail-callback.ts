import { getCandidatesAdmin } from '@/backend/lib/candidates/access';
import { CandidateActionError } from '@/backend/lib/candidates/records';
import { finishResumeMailOAuth, resumeMailOAuthState } from '@/backend/lib/candidates/resume-mail-oauth';
import { requireCandidateAccess } from './auth';

export type ResumeMailCallbackResult =
  | { ok: true; status: 200; message: string }
  | { ok: false; status: number; message: string };

/** Completes Recruitment Zoho Mail OAuth for `/api/task-manager/zoho/callback` and `/api/candidates/resume-mail/callback`. */
export async function completeResumeMailCallback(params: URLSearchParams): Promise<ResumeMailCallbackResult> {
  if (params.has('error')) {
    return { ok: false, status: 400, message: 'Zoho connection cancelled. Nothing was imported. Close this tab and return to Recruitment.' };
  }
  try {
    const state = params.get('state') ?? '';
    const st = await resumeMailOAuthState(getCandidatesAdmin(), state);
    const auth = await requireCandidateAccess(st.organization_id);
    if (auth.error) {
      return {
        ok: false,
        status: auth.error.status,
        message: auth.error.status === 401
          ? 'Sign in to Recruitment using the account that started this connection, then start again.'
          : 'Your account does not have Recruitment access for this organization.',
      };
    }
    await finishResumeMailOAuth(
      auth.admin,
      state,
      { id: auth.user.id, email: auth.user.email ?? null },
      params.get('code') ?? '',
      params.get('accounts-server') ?? undefined,
    );
    return {
      ok: true,
      status: 200,
      message: 'Zoho Mail connected. No emails were sent and no resumes were imported. Close this tab and refresh connections in Recruitment → Email or Recruitment → Resumes → Zoho Mail. Choose the folder and starting date under Resumes → Zoho Mail.',
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof CandidateActionError ? error.status : 502,
      message: error instanceof CandidateActionError ? error.message : 'Could not connect Zoho Mail. Return to Recruitment and start again.',
    };
  }
}


export async function recruitmentMailboxCallback(request: Request) {
  const result = await completeResumeMailCallback(new URL(request.url).searchParams);
  return new Response(result.message, {
    status: result.status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
