import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { INDEX_BUDGET_MS } from "@/backend/lib/candidates/config";
import { indexAllOrganisations } from "@/backend/lib/candidates/indexing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/candidate-indexing — every minute (vercel.json). Prepares uploaded candidate records for meaning search
 * in the background, for every organisation with records waiting that is not paused (owner 2026-11-03: HR only
 * uploads; the system finishes the processing). Busy embedding service = that organisation pauses and is retried.
 * Auth: Bearer CRON_SECRET (refused when the secret is not set).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await indexAllOrganisations(getCandidatesAdmin(), { budgetMs: INDEX_BUDGET_MS.cron });
  return NextResponse.json(result);
}
