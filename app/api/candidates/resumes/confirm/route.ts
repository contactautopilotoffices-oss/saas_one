import { after, NextResponse } from "next/server";

import { RESUME_EXTRACT_BUDGET_MS, RESUME_RATE_LIMIT, RESUME_TEXT_BUDGET_MS } from "@/backend/lib/candidates/config";
import { processResumeExtraction } from "@/backend/lib/candidates/resume-extract";
import { processResumeText } from "@/backend/lib/candidates/resume-text";
import { confirmResumeUploads, resumeStorage } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
// The reply is quick; reading the new files' text and details runs afterwards (after()), bounded by the same limit.
export const maxDuration = 60;

/**
 * The browser finished sending these files: { orgId, ids }. Each object is checked in storage before it counts. Then,
 * in the background, the new files' text is read and matched to candidates (phase 2) and their details read (phase 4);
 * the cron finishes what is left.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    const storage = resumeStorage(auth.admin);
    const result = await confirmResumeUploads(auth.admin, storage, auth.orgId, body.ids);
    if (result.ready.length) {
      after(async () => {
        await processResumeText(auth.admin, storage, auth.orgId, { budgetMs: RESUME_TEXT_BUDGET_MS.afterUpload - RESUME_EXTRACT_BUDGET_MS.afterUpload + 10_000 });
        await processResumeExtraction(auth.admin, auth.orgId, { budgetMs: RESUME_EXTRACT_BUDGET_MS.afterUpload });
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't finish the upload");
  }
}
