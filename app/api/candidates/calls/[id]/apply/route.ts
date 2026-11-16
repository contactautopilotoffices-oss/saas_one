import { after, NextResponse } from "next/server";

import { applyCallFacts } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { getFullRecord } from "@/backend/lib/candidates/filter-search";
import { indexPending } from "@/backend/lib/candidates/indexing";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Put facts heard on the call onto the record: { orgId, keys: ["currentInhand", ...] }. One click per fact; nothing is applied by itself. */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    const { call, record } = await applyCallFacts(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), id, body);
    // The record as the panel shows it (resume fields included), so an applied fact does not blank them on screen.
    const full = record ? await getFullRecord(auth.admin, auth.orgId, record.id) : null;
    if (record) after(() => indexPending(auth.admin, auth.orgId));
    return NextResponse.json({ call, record: full });
  } catch (error) {
    return errorResponse(error, "Couldn't apply the facts");
  }
}
