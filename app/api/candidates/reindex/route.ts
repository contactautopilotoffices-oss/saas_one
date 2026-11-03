import { NextResponse } from "next/server";

import { REINDEX_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";

import { rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Compute meaning-search embeddings for records that have none yet (the "Index now" button). */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("reindex", auth.user.id, REINDEX_RATE_LIMIT);
  if (limited) return limited;

  const result = await indexPending(auth.admin, auth.orgId);
  if (result.error) {
    return NextResponse.json({ error: result.error, indexed: result.indexed, remaining: result.remaining }, { status: 503 });
  }
  return NextResponse.json({ indexed: result.indexed, remaining: result.remaining });
}
