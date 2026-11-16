import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { createPosition, listPositions } from "@/backend/lib/candidates/positions";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Positions (owner 2026-11-15). Query: orgId, status (open | closed | all; open by default). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const status = params.get("status");
  try {
    return NextResponse.json({ positions: await listPositions(auth.admin, auth.orgId, status === "closed" || status === "all" ? status : "open") });
  } catch (error) {
    return errorResponse(error, "Couldn't load the positions");
  }
}

/** Save a job description as a position: { orgId, title, location?, department?, jdText?, jdFileName?, filters?, prefer?, targetDays? }. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    return NextResponse.json({ position: await createPosition(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the position");
  }
}
