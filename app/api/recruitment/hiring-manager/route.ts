import { NextResponse } from "next/server";

import { hiringManagerView } from "@/backend/lib/candidates/hiring-manager";

import { errorResponse, requireOrgMember } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * The hiring manager's view (owner 2026-11-24): the candidates for the roles this person asked for (or heads, as the
 * department head). Any member may ask; the answer only covers their own requests. No CTC, no AI score, no contact
 * details: see backend/lib/candidates/hiring-manager.ts.
 */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ positions: await hiringManagerView(auth.admin, auth.orgId, auth.user.id) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the candidates");
  }
}
