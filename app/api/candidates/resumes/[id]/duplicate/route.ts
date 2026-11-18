import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { resolveDuplicate, resumeStorage } from "@/backend/lib/candidates/resumes";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * A second CV for a person who already had one (owner 2026-11-16): { orgId, action: "update" } makes it the CV from
 * now on (the earlier one is kept as an older version); { orgId, action: "delete" } removes this copy.
 */
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
    await resolveDuplicate(auth.admin, resumeStorage(auth.admin), auth.orgId, await actorFor(auth.admin, auth.user), id, body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't change the file");
  }
}
