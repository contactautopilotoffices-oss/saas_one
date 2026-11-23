import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { requisitionNotifier } from "@/backend/lib/candidates/requisition-notify";
import {
  canDecide, canEndorse, confirmStillNeeded, endorseRequisition, getRequisition, hasEndorsed, maySee, submitRequisition, updateRequisition, withdrawRequisition,
} from "@/backend/lib/candidates/requisitions";
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
    if (!maySee(requisition, { userId: auth.user.id, seesAll: access.seesAll, headOf: access.headOf }) && !canDecide(requisition, auth.user.id, access)) return notFound();
    const endorsed = access.headOf?.length ? await hasEndorsed(auth.admin, auth.orgId, requisition.id, auth.user.id) : false;
    const body: RequisitionResponse = {
      requisition, approvals, access,
      canDecide: canDecide(requisition, auth.user.id, access),
      canEdit: mine && (requisition.status === "draft" || requisition.status === "sent_back"),
      canWithdraw: mine && ["draft", "submitted", "sent_back", "on_hold"].includes(requisition.status),
      // Owner 2026-11-21: the department head endorses; the raiser confirms a request on hold is still needed (spec A24).
      canEndorse: canEndorse(requisition, auth.user.id, access, endorsed),
      canConfirmNeeded: mine && requisition.status === "on_hold",
    };
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "Couldn't load the hiring request");
  }
}

/**
 * Edit a draft or a request sent back ({ orgId, ...fields, submit?: true }), submit it ({ orgId, action: "submit" }),
 * or withdraw it ({ orgId, action: "withdraw", reason? }). The person who raised it only.
 * Owner 2026-11-21: { orgId, action: "still_needed", note? } (the raiser, while on hold) and { orgId, action: "endorse",
 * note? } (the head of the request's department). Each function checks who may.
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
    if (fields.action === "still_needed") return NextResponse.json({ requisition: await confirmStillNeeded(auth.admin, auth.orgId, by, id, fields.note, deps) });
    if (fields.action === "endorse") return NextResponse.json({ requisition: await endorseRequisition(auth.admin, auth.orgId, by, id, fields.note) });
    delete fields.action;
    return NextResponse.json({ requisition: await updateRequisition(auth.admin, auth.orgId, by, id, fields, deps) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the hiring request");
  }
}
