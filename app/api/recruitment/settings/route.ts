import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, saveRecruitmentConfig } from "@/backend/lib/candidates/requisitions";

import { errorResponse, rateLimited, readJson, requireOrgMember } from "../_lib/auth";

export const runtime = "nodejs";

/** The roles that may change who approves (the same people who may change the Omnichannel matrix). */
const SETTINGS_ROLES = new Set(["org_super_admin", "master_admin", "owner", "org_admin", "admin", "tech"]);

async function mayConfigure(admin: Parameters<typeof loadRecruitmentConfig>[0], userId: string, orgId: string): Promise<boolean> {
  const [{ data: user }, { data: rows }] = await Promise.all([
    admin.from("users").select("is_master_admin, is_super_admin").eq("id", userId).maybeSingle(),
    admin.from("organization_memberships").select("role").eq("user_id", userId).eq("organization_id", orgId),
  ]);
  const u = user as { is_master_admin?: boolean; is_super_admin?: boolean } | null;
  if (u?.is_master_admin || u?.is_super_admin) return true;
  return ((rows ?? []) as { role: string | null }[]).some((r) => SETTINGS_ROLES.has((r.role ?? "").toLowerCase()));
}

/** The approvers, the CTC level and the target days (Settings -> Notifications -> Recruitment). Query: orgId. */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ config: await loadRecruitmentConfig(auth.admin, auth.orgId), canConfigure: await mayConfigure(auth.admin, auth.user.id, auth.orgId) });
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
  if (!(await mayConfigure(auth.admin, auth.user.id, auth.orgId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    return NextResponse.json({ config: await saveRecruitmentConfig(auth.admin, auth.orgId, fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the recruitment settings");
  }
}
