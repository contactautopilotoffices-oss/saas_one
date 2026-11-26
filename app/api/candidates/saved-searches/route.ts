import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { deleteSavedSearch, listSavedSearches, saveSearch } from "@/backend/lib/candidates/privacy";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Owner 2026-11-24: a recruiter's own named searches. GET ?orgId → { searches }; POST { orgId, name, filters }; DELETE { orgId, id }. */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  return NextResponse.json({ searches: await listSavedSearches(auth.admin, auth.orgId, auth.user.id) });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ search: await saveSearch(auth.admin, auth.orgId, auth.user.id, body.name, body.filters) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the search");
  }
}

export async function DELETE(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  try {
    await deleteSavedSearch(auth.admin, auth.orgId, auth.user.id, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't remove the search");
  }
}
