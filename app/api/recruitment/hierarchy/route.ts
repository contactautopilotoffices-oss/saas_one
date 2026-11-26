import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, mayConfigureRaisers, saveHierarchy } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";
import { employeeMasterHierarchy } from "../_lib/people";

export const runtime = "nodejs";

/*
 * The company hierarchy for the hiring request form (owner 2026-11-24, from the 23 Nov HR meeting: "role title and
 * department will be dropdowns following the company hierarchy; new designations go through Others"). Kept in the Tech
 * dashboard's HR Configs tab by the Tech team and admins (the same people who set the department heads). Empty, the form
 * uses the employee master: the departments and designations of the active employee profiles.
 */

/** Query: orgId. { departments, canConfigure, employeeMaster }: the saved list, and the employee master to start from. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const [config, canConfigure] = await Promise.all([loadRecruitmentConfig(auth.admin, auth.orgId), mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId)]);
    const employeeMaster = canConfigure ? await employeeMasterHierarchy(auth.admin, auth.orgId).catch((error) => { console.error("[recruitment] employee master hierarchy failed", error); return []; }) : [];
    return NextResponse.json({ departments: config.hierarchy, canConfigure, employeeMaster });
  } catch (error) {
    return errorResponse(error, "Couldn't load the departments and designations");
  }
}

/** Set it: { orgId, departments: [{ department, designations: string[] }] }. An empty list goes back to the employee master. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  if (!(await mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId))) {
    return NextResponse.json({ error: "Only the Tech team or an admin can change the departments and designations." }, { status: 403 });
  }
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ departments: await saveHierarchy(auth.admin, auth.orgId, { departments: body.departments }, await actorFor(auth.admin, auth.user)) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the departments and designations");
  }
}
