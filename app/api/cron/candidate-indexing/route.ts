import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { INDEX_BUDGET_MS, RESUME_EXTRACT_BUDGET_MS, RESUME_ROUTE_BUDGET_MS, RESUME_SCAN_BUDGET_MS, RESUME_TEXT_BUDGET_MS } from "@/backend/lib/candidates/config";
import { indexAllOrganisations } from "@/backend/lib/candidates/indexing";
import { inferMissingDetails, processResumeExtractionAll } from "@/backend/lib/candidates/resume-extract";
import { processResumeScansAll } from "@/backend/lib/candidates/resume-scan";
import { processResumeTextAll } from "@/backend/lib/candidates/resume-text";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Indexing always gets at least this much of the minute. */
const INDEX_MIN_MS = 10_000;

/**
 * GET /api/cron/candidate-indexing — every minute (vercel.json). Four background jobs, one after the other, inside the
 * route's time limit:
 *   1. Resume text (owner 2026-11-10, phase 2): reads stored resumes' text and links them to candidates by email /
 *      phone, for every organisation with files waiting. No AI.
 *   2. Scanned resumes (owner 2026-11-11): a PDF with no text layer is typed out by the model, then treated like
 *      any other resume. It gets the time step 1 left over, less what steps 3 and 4 need; with too little left it
 *      waits for the next minute.
 *   3. Resume details (owner 2026-11-11, phase 4): one model call per read resume fills the candidate's empty fields
 *      or creates the candidate. A busy model pauses until the next minute.
 *   4. Prepares uploaded candidate records for meaning search, for every organisation with records waiting that is not
 *      paused (owner 2026-11-03: HR only uploads; the system finishes the processing). Busy embedding service = that
 *      organisation pauses and is retried.
 * Auth: Bearer CRON_SECRET (refused when the secret is not set).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getCandidatesAdmin();
  const started = Date.now();
  const resumes = await processResumeTextAll(admin, { budgetMs: RESUME_TEXT_BUDGET_MS.cron });
  const forScans = RESUME_ROUTE_BUDGET_MS - (Date.now() - started) - RESUME_EXTRACT_BUDGET_MS.cron - INDEX_MIN_MS;
  const scans = await processResumeScansAll(admin, { budgetMs: Math.min(RESUME_SCAN_BUDGET_MS.cron, forScans) });
  // The details step keeps its usual share, cut short only so that indexing still gets its minimum.
  const forDetails = Math.min(RESUME_EXTRACT_BUDGET_MS.cron, RESUME_ROUTE_BUDGET_MS - (Date.now() - started) - INDEX_MIN_MS);
  const details = await processResumeExtractionAll(admin, { budgetMs: forDetails });
  // Designation, company and total experience the reader left empty, worked out from the employers listed (no AI, one query).
  const workedOut = await inferMissingDetails(admin);
  const left = Math.max(INDEX_MIN_MS, INDEX_BUDGET_MS.cron - (Date.now() - started));
  const indexing = await indexAllOrganisations(admin, { budgetMs: left });
  return NextResponse.json({ ...indexing, resumes, scans, details, workedOut });
}
