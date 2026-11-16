import { NextResponse } from "next/server";

import { listMemberships } from "@/backend/lib/candidates/positions";
import { getRecord } from "@/backend/lib/candidates/records";

import { errorResponse, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** The positions this record's person is in, with the stage in each (owner 2026-11-15). Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const record = await getRecord(auth.admin, auth.orgId, id);
    return NextResponse.json({ memberships: await listMemberships(auth.admin, auth.orgId, record.candidateId) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the positions");
  }
}
