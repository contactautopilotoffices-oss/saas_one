import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, mayConfigureRaisers, roleChoices, saveRaisers } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";
import { taskManagerPeople } from "../_lib/people";

export const runtime = "nodejs";

/*
 * Who may raise a hiring request (owner 2026-11-20: "make it configurable somewhere in the tech login on who can have
 * that option in their sidebars"). Set in the Tech dashboard's HR Configs tab, by the Tech team and admins (requisitions.ts, mayConfigureRaisers). Those picked get "Hiring requests" in their sidebar.
 */

/** Query: orgId. { raisers, canConfigure, roles, people }: the roles and people to pick from, for those who may set it. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const [config, canConfigure] = await Promise.all([loadRecruitmentConfig(auth.admin, auth.orgId), mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId)]);
    if (!canConfigure) return NextResponse.json({ raisers: config.raisers, canConfigure, roles: [], people: [] });
    // Owner 2026-11-20: the people are the Task Manager's list (the same names and departments)
    const [roles, people] = await Promise.all([roleChoices(auth.admin, auth.orgId), taskManagerPeople()]);
    return NextResponse.json({ raisers: config.raisers, canConfigure, roles, people });
  } catch (error) {
    return errorResponse(error, "Couldn't load who can raise hiring requests");
  }
}

/** Set it: { orgId, roles: string[], userIds: string[] }. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  if (!(await mayConfigureRaisers(auth.admin, auth.user.id, auth.orgId))) {
    return NextResponse.json({ error: "Only the Tech team or an admin can change who raises hiring requests." }, { status: 403 });
  }
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ raisers: await saveRaisers(auth.admin, auth.orgId, { roles: body.roles, userIds: body.userIds }, await actorFor(auth.admin, auth.user)) });
  } catch (error) {
    return errorResponse(error, "Couldn't save who can raise hiring requests");
  }
}
