import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { requisitionNotifier } from "@/backend/lib/candidates/requisition-notify";
import { decideRequisition } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Stage 2, in the app: { orgId, decision: "approve" | "reject" | "send_back" | "hold" | "resume", reason?, inPlan? }.
 * Only the approver the request waits on (or their backup), never the person who raised it.
 */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const requisition = await decideRequisition(auth.admin, auth.orgId, by, id, body, { notify: requisitionNotifier(auth.admin, auth.orgId), via: "app" });
    return NextResponse.json({ requisition });
  } catch (error) {
    return errorResponse(error, "Couldn't record the decision");
  }
}
