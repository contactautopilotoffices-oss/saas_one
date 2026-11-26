import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { createOffer, defaultFlowDeps, listHandovers, listOffers, markHandoverTaken } from "@/backend/lib/candidates/hiring";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";

/** Offers (owner 2026-11-21; spec Stages 7-9). Query: orgId, candidateId? -> { offers }, newest first. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const candidateId = params.get("candidateId");
  try {
    // Owner 2026-11-24: accepted offers handed to onboarding.
    if (params.get("handovers") === "1") return NextResponse.json({ handovers: await listHandovers(auth.admin, auth.orgId) });
    return NextResponse.json({ offers: await listOffers(auth.admin, auth.orgId, { userId: auth.user.id }, candidateId && UUID.test(candidateId) ? { candidateId } : {}) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the offers");
  }
}

/** Select with an offer: { orgId, applicationId, positionId, proposedCtc (rupees per year), joiningDate?, breakup?, note? }. */
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
    return NextResponse.json({ offer: await createOffer(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), fields, defaultFlowDeps()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Couldn't make the offer");
  }
}

/** Owner 2026-11-24: onboarding took a handover: { orgId, handoverId }. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  if (typeof body.handoverId !== "string" || !UUID.test(body.handoverId)) return NextResponse.json({ error: "Pick the handover." }, { status: 400 });
  try {
    await markHandoverTaken(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body.handoverId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't update the handover");
  }
}
