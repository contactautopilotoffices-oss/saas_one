import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { requisitionNotifier } from "@/backend/lib/candidates/requisition-notify";
import { createRequisition, listRequisitions } from "@/backend/lib/candidates/requisitions";
import type { RequisitionListResponse } from "@/backend/lib/candidates/types";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";

export const runtime = "nodejs";

/** Hiring requests (owner 2026-11-17): all of them for HR and admins, else the caller's own and those waiting on them. Query: orgId. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const { config: _config, member: _member, ...access } = auth.access;
    void _config; void _member;
    const body: RequisitionListResponse = { requisitions: await listRequisitions(auth.admin, auth.orgId, { userId: auth.user.id, seesAll: access.seesAll }), access };
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "Couldn't load the hiring requests");
  }
}

/** Stage 1: raise a request: { orgId, ...the form, submit?: true }. A draft until submitted. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    const by = await actorFor(auth.admin, auth.user);
    return NextResponse.json({ requisition: await createRequisition(auth.admin, auth.orgId, by, fields, { notify: requisitionNotifier(auth.admin, auth.orgId) }) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the hiring request");
  }
}
