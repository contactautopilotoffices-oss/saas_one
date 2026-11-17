import { NextResponse } from "next/server";

import { REINDEX_RATE_LIMIT, RESUME_EXTRACT_BUDGET_MS, RESUME_ROUTE_BUDGET_MS, RESUME_SCAN_BUDGET_MS, RESUME_TEXT_BUDGET_MS } from "@/backend/lib/candidates/config";
import { processResumeExtraction } from "@/backend/lib/candidates/resume-extract";
import { processResumeScans } from "@/backend/lib/candidates/resume-scan";
import { processResumeText } from "@/backend/lib/candidates/resume-text";
import { resumeStorage } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The Resumes page's nudge (owner 2026-11-11): while files are still being read, the open page asks every 20 s for a
 * short run (text first, then scanned files, then details), so reading does not wait for the next cron minute and
 * progress shows live. Scans get the time the text step left over, less what the details step needs.
 * { orgId }. Runs claim their files first, so this never collides with the cron or an after-upload run; past the
 * in-flight cap it does nothing.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("reindex", auth.user.id, REINDEX_RATE_LIMIT);
  if (limited) return limited;
  try {
    const started = Date.now();
    const storage = resumeStorage(auth.admin);
    const text = await processResumeText(auth.admin, storage, auth.orgId, { budgetMs: RESUME_TEXT_BUDGET_MS.nudge });
    const forScans = RESUME_ROUTE_BUDGET_MS - (Date.now() - started) - RESUME_EXTRACT_BUDGET_MS.nudge;
    const scans = await processResumeScans(auth.admin, storage, auth.orgId, { budgetMs: Math.min(RESUME_SCAN_BUDGET_MS.nudge, forScans) });
    const details = await processResumeExtraction(auth.admin, auth.orgId, { budgetMs: RESUME_EXTRACT_BUDGET_MS.nudge });
    return NextResponse.json({ ...text, scans, details });
  } catch (error) {
    return errorResponse(error, "Couldn't read the resumes");
  }
}
