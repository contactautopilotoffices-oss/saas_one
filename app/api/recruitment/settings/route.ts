import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, mayConfigureApprovals, saveRecruitmentConfig } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";
import { loadApproverPools } from "../_lib/people";

export const runtime = "nodejs";

/*
 * Who approves hiring requests, the CTC level and the target days. Owner 2026-11-20: in the Tech dashboard's HR Configs
 * tab ("move this Hiring request approvals section to the tech login"), changed by the Tech team and admins
 * (requisitions.ts, mayConfigureApprovals). The HR Head is picked from the HR team, the Director from the org super
 * admins ("these dropdowns … must only have hr team members, and directors must have org super admins").
 */

/** Query: orgId. { config, canConfigure, pools: { hr, directors } }; for those who may not change it, only the people set. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const [config, canConfigure, pools] = await Promise.all([loadRecruitmentConfig(auth.admin, auth.orgId), mayConfigureApprovals(auth.admin, auth.user.id, auth.orgId), loadApproverPools(auth.admin, auth.orgId)]);
    const set = new Set([config.hrHead.userId, config.hrHead.backupUserId, config.director.userId, config.director.backupUserId].filter(Boolean));
    const only = (list: typeof pools.hr) => (canConfigure ? list : list.filter((p) => set.has(p.id)));
    return NextResponse.json({ config, canConfigure, pools: { hr: only(pools.hr), directors: only(pools.directors) } });
  } catch (error) {
    return errorResponse(error, "Couldn't load the recruitment settings");
  }
}

/** Change them: { orgId, hrHead?: { userId, backupUserId }, director?: { userId, backupUserId }, directorCtcLevel?, targetDays? }. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireOrgMember(body.orgId);
  if (auth.error) return auth.error;
  if (!(await mayConfigureApprovals(auth.admin, auth.user.id, auth.orgId))) {
    return NextResponse.json({ error: "Only the Tech team or an admin can change who approves hiring requests." }, { status: 403 });
  }
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    const pools = await loadApproverPools(auth.admin, auth.orgId);
    return NextResponse.json({ config: await saveRecruitmentConfig(auth.admin, auth.orgId, fields, await actorFor(auth.admin, auth.user), pools) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the recruitment settings");
  }
}
