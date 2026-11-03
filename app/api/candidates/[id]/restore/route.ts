import { NextResponse } from "next/server";

import { restoreRecord } from "@/backend/lib/candidates/records";

import { errorResponse, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ record: await restoreRecord(auth.admin, auth.orgId, auth.user.id, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't restore the record");
  }
}
