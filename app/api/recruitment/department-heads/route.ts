import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, mayConfigureRaisers, saveDepartmentHeads } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";
import { taskManagerPeople } from "../_lib/people";

export const runtime = "nodejs";

/*
 * The department heads (owner 2026-11-21, "go ahead with all"; the spec's "Department head: see own department's
 * requisitions and status; endorse requisitions"). Set in the Tech dashboard's HR Configs tab, by the Tech team and
 * admins (the same people who pick who may raise requests). A head gets "Hiring requests" in their sidebar, sees the
 * requests raised for their department, and may endorse them; endorsing approves nothing.
 */

/** Query: orgId. { heads, canConfigure, people, departments }: the Task Manager's people and departments, for those who may set it. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const [config, canConfigure] = await Promise.all([loadRecruitmentConfig(auth.admin, auth.orgId), mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId)]);
    if (!canConfigure) return NextResponse.json({ heads: config.departmentHeads, canConfigure, people: [], departments: [] });
    const people = await taskManagerPeople();
    const departments = [...new Set(people.map((p) => p.department?.trim()).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ heads: config.departmentHeads, canConfigure, people, departments });
  } catch (error) {
    return errorResponse(error, "Couldn't load the department heads");
  }
}

/** Set them: { orgId, heads: [{ department, userId }] }. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  if (!(await mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId))) {
    return NextResponse.json({ error: "Only the Tech team or an admin can change the department heads." }, { status: 403 });
  }
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const allowed = new Set((await taskManagerPeople()).map((p) => p.id));
    return NextResponse.json({ heads: await saveDepartmentHeads(auth.admin, auth.orgId, { heads: body.heads }, await actorFor(auth.admin, auth.user), allowed) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the department heads");
  }
}
