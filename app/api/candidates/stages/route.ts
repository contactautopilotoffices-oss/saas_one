import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadStages, saveStages } from "@/backend/lib/candidates/stages";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * The pipeline's stages (owner 2026-11-19; Recruitment -> Configurations). Query: orgId, detail=1 for the people in
 * each stage and the latest changes (Configurations), without it just the list (the board and the dropdowns).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await loadStages(auth.admin, auth.orgId, { detail: params.get("detail") === "1" }));
  } catch (error) {
    return errorResponse(error, "Couldn't load the stages");
  }
}

/**
 * Save the list: { orgId, stages: [...in order], version }. Anyone who may use Recruitment may change it (owner
 * 2026-11-19: "everyone"); every change is recorded with who made it.
 */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await saveStages(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), { stages: body.stages, version: body.version }));
  } catch (error) {
    return errorResponse(error, "Couldn't save the stages");
  }
}
