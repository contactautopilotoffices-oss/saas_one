import { NextResponse } from "next/server";

import { FILTER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { previewOutreach } from "@/backend/lib/candidates/outreach";

import { errorResponse, rateLimited, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/** What the Send panel shows: the message, the number, the checks. Never sends. Query: orgId, applicationId, positionId?, kind. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("filter", auth.user.id, FILTER_RATE_LIMIT);
  if (limited) return limited;
  try {
    const { phone: _phone, fullName: _fullName, text: _text, ...preview } = await previewOutreach(auth.admin, auth.orgId, {
      applicationId: params.get("applicationId"),
      positionId: params.get("positionId") || null,
      kind: params.get("kind"),
      expectedStage: params.get("expectedStage"),
    });
    void _phone; void _fullName; void _text;
    return NextResponse.json({ preview });
  } catch (error) {
    return errorResponse(error, "Couldn't prepare the message");
  }
}
