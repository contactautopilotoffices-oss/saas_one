import { NextResponse } from "next/server";

import { sheetIssues } from "@/backend/lib/candidates/sheets";

import { errorResponse, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

/** Rows with data-quality problems from the sheet's latest upload. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ rows: await sheetIssues(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the issues");
  }
}
