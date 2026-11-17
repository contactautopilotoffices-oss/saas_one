import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { requisitionNotifier } from "@/backend/lib/candidates/requisition-notify";
import { canDecide, getRequisition, submitRequisition, updateRequisition, withdrawRequisition } from "@/backend/lib/candidates/requisitions";
import type { RequisitionResponse } from "@/backend/lib/candidates/types";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** One request with its history and what the caller may do with it. Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    const { requisition, approvals } = await getRequisition(auth.admin, auth.orgId, id);
    const { config: _config, member: _member, ...access } = auth.access;
    void _config; void _member;
    const mine = requisition.raisedBy === auth.user.id;
    if (!access.seesAll && !mine && requisition.currentApproverId !== auth.user.id && !canDecide(requisition, auth.user.id, access)) return notFound();
    const body: RequisitionResponse = {
      requisition, approvals, access,
      canDecide: canDecide(requisition, auth.user.id, access),
      canEdit: mine && (requisition.status === "draft" || requisition.status === "sent_back"),
    };
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "Couldn't load the hiring request");
  }
}

/**
 * Edit a draft or a request sent back ({ orgId, ...fields, submit?: true }), submit it ({ orgId, action: "submit" }),
 * or withdraw it ({ orgId, action: "withdraw", reason? }). The person who raised it only.
 */
export async function PATCH(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const deps = { notify: requisitionNotifier(auth.admin, auth.orgId) };
    if (fields.action === "submit") return NextResponse.json({ requisition: await submitRequisition(auth.admin, auth.orgId, by, id, deps) });
    if (fields.action === "withdraw") return NextResponse.json({ requisition: await withdrawRequisition(auth.admin, auth.orgId, by, id, fields.reason) });
    delete fields.action;
    return NextResponse.json({ requisition: await updateRequisition(auth.admin, auth.orgId, by, id, fields, deps) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the hiring request");
  }
}
