import { NextResponse } from "next/server";

import { callAudioLink, callStorage } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Play the recording: sends the player to a short-lived private link. Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    const { url } = await callAudioLink(auth.admin, callStorage(auth.admin), auth.orgId, id);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Couldn't open the recording");
  }
}
