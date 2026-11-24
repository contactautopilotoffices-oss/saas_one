import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { requisitionNotifier } from "@/backend/lib/candidates/requisition-notify";
import { createRequisition, listRequisitions } from "@/backend/lib/candidates/requisitions";
import type { RequisitionListResponse } from "@/backend/lib/candidates/types";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";
import { formHierarchy } from "../_lib/people";

export const runtime = "nodejs";

/**
 * Hiring requests (owner 2026-11-17): all of them for HR and admins, else the caller's own and those waiting on them,
 * and (owner 2026-11-21) the requests raised for the departments the caller heads. Query: orgId.
 */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const { config: _config, member: _member, ...access } = auth.access;
    void _config; void _member;
    const [requisitions, hierarchy] = await Promise.all([
      listRequisitions(auth.admin, auth.orgId, { userId: auth.user.id, seesAll: access.seesAll, headOf: access.headOf }),
      // Owner 2026-11-24: the form's department and role dropdowns (only those who may raise a request need them).
      access.canRaise ? formHierarchy(auth.admin, auth.orgId, auth.access.config) : Promise.resolve(undefined),
    ]);
    const body: RequisitionListResponse = {
      requisitions, access,
      departments: auth.access.config.departmentHeads.map((h) => h.department),
      ...(hierarchy ? { hierarchy } : {}),
    };
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "Couldn't load the hiring requests");
  }
}

/** Stage 1: raise a request: { orgId, ...the form, submit?: true }. A draft until submitted. Only for those who may raise (canRaise). */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  // Owner 2026-11-20: only the people the Tech team set may raise a request ("it must be only for the logins").
  if (!auth.access.canRaise) return NextResponse.json({ error: "You cannot raise hiring requests. The Tech team decides who can, in the Tech dashboard." }, { status: 403 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const hierarchy = fields.submit === true ? await formHierarchy(auth.admin, auth.orgId, auth.access.config) : undefined;
    return NextResponse.json({ requisition: await createRequisition(auth.admin, auth.orgId, by, fields, { notify: requisitionNotifier(auth.admin, auth.orgId), hierarchy }) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the hiring request");
  }
}
