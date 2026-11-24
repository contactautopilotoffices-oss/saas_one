import { NextResponse } from "next/server";

import { loadApproverPools } from "../../recruitment/_lib/people";
import { errorResponse, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * Who can be a position's recruiter (owner 2026-11-21; spec A03 "assign a recruiter"): the HR team, as in the HR Head
 * dropdown (the Task Manager's Human Resources department, and anyone with an HR role). Query: orgId. { people }.
 */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const { hr } = await loadApproverPools(auth.admin, auth.orgId);
    return NextResponse.json({ people: hr.map((p) => ({ id: p.id, name: p.name, department: p.department })) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the HR team");
  }
}
