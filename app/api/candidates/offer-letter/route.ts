import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { DEFAULT_OFFER_LETTER } from "@/backend/lib/candidates/hiring";
import { loadRecruitmentConfig, saveOfferLetter } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** HR's offer letter template (owner 2026-11-21; spec: templates editable by HR). Query: orgId. { letter, fallback }. */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ letter: (await loadRecruitmentConfig(auth.admin, auth.orgId)).offerLetter, fallback: DEFAULT_OFFER_LETTER });
  } catch (error) {
    return errorResponse(error, "Couldn't load the offer letter");
  }
}

/** { orgId, letter } (empty restores the default). */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ letter: await saveOfferLetter(auth.admin, auth.orgId, { letter: body.letter }, await actorFor(auth.admin, auth.user)) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the offer letter");
  }
}
