import { NextResponse } from "next/server";

import { INDEX_BUDGET_MS, REINDEX_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";

import { rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A quiet nudge from the Sheets page while records are still being prepared for search (owner 2026-11-03: HR sees a
 * progress bar, never an error). It runs a short background batch and always answers 200 with the progress; a busy
 * embedding service only pauses the background work (see backend/lib/candidates/indexing.ts). The cron
 * /api/cron/candidate-indexing finishes the job when nobody has the page open.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("reindex", auth.user.id, REINDEX_RATE_LIMIT);
  if (limited) return NextResponse.json({ indexed: 0, remaining: -1, waiting: true });

  const { indexed, remaining, waiting } = await indexPending(auth.admin, auth.orgId, { budgetMs: INDEX_BUDGET_MS.nudge });
  return NextResponse.json({ indexed, remaining, waiting });
}
