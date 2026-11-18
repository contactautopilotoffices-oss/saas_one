import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { duplicateJd } from "@/backend/lib/candidates/jd-library";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** A copy of the JD's current text as a new JD, for a similar role: { orgId, title? }. */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ jd: await duplicateJd(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), id, body.title) });
  } catch (error) {
    return errorResponse(error, "Couldn't copy the JD");
  }
}
