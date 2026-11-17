import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { listOutreach, sendOutreach } from "@/backend/lib/candidates/outreach";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";

/** The WhatsApp updates sent to a candidate, newest first (owner 2026-11-16). Query: orgId, candidateId. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const candidateId = params.get("candidateId") ?? "";
  if (!UUID.test(candidateId)) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  try {
    return NextResponse.json({ outreach: await listOutreach(auth.admin, auth.orgId, candidateId.toLowerCase()) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the messages sent");
  }
}

/**
 * Send the update on WhatsApp: { orgId, applicationId, positionId?, kind: "shortlisted" | "not_shortlisted" }. The
 * checks run again here; a person's click is the only way a message goes out.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const outreach = await sendOutreach(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body);
    return NextResponse.json({ outreach });
  } catch (error) {
    return errorResponse(error, "Couldn't send the message");
  }
}
