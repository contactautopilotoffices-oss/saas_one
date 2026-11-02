import { after, NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";
import { createRecord, listRecords } from "@/backend/lib/candidates/records";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "./_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Records, newest change first. Query: orgId, q, status, sheetId (an id or "manual"), deleted=1, page, pageSize. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;

  const sheetId = params.get("sheetId");
  if (sheetId && sheetId !== "manual" && !UUID.test(sheetId)) {
    return NextResponse.json({ error: "Invalid sheetId" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await listRecords(auth.admin, auth.orgId, {
        q: params.get("q"),
        status: params.get("status"),
        sheetId,
        deleted: params.get("deleted") === "1",
        page: Number(params.get("page")) || 1,
        pageSize: Number(params.get("pageSize")) || 50,
      }),
    );
  } catch (error) {
    return errorResponse(error, "Couldn't load candidates");
  }
}

/** Add a candidate record by hand. A person with the same email or phone gets the new record. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;

  const fields = { ...body };
  delete fields.orgId;
  try {
    const { record, matchedExisting } = await createRecord(auth.admin, auth.orgId, auth.user.id, fields);
    after(() => indexPending(auth.admin, auth.orgId, 50));
    return NextResponse.json({ record, matchedExisting }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Couldn't save the candidate");
  }
}
