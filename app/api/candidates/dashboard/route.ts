import { NextResponse } from "next/server";

import { recruitmentDashboard } from "@/backend/lib/candidates/recruitment-dashboard";

import { errorResponse, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** The recruitment dashboard (owner 2026-11-21; spec: Today, Roles, Funnel). Query: orgId. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await recruitmentDashboard(auth.admin, auth.orgId, new Date(), params.get("hub") === "1"));
  } catch (error) {
    return errorResponse(error, "Couldn't load the dashboard");
  }
}
