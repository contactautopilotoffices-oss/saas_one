import { NextResponse } from "next/server";

import { restoreSheet } from "@/backend/lib/candidates/sheets";

import { errorResponse, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ sheet: await restoreSheet(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't restore the sheet");
  }
}
