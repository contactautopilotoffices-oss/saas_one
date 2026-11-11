import { after, NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";
import { getFullRecord } from "@/backend/lib/candidates/filter-search";
import { deleteRecord, updateRecord } from "@/backend/lib/candidates/records";
import { linkUnmatched } from "@/backend/lib/candidates/resume-text";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    // With the resume fields and "has a resume" (owner 2026-11-11): the candidate's panel opens from any list.
    return NextResponse.json({ record: await getFullRecord(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the candidate");
  }
}

/** Edit a record. Person fields apply to every record of the same person. */
export async function PATCH(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;

  const fields = { ...body };
  delete fields.orgId;
  try {
    await updateRecord(auth.admin, auth.orgId, auth.user.id, id, fields);
    // The saved record as the panel shows it (resume fields included), so an edit does not blank them on screen.
    const record = await getFullRecord(auth.admin, auth.orgId, id);
    after(() => indexPending(auth.admin, auth.orgId));
    // Phase 2: a changed email or phone may now match a stored resume.
    after(() => linkUnmatched(auth.admin, auth.orgId));
    return NextResponse.json({ record });
  } catch (error) {
    return errorResponse(error, "Couldn't save the changes");
  }
}

/** Soft-delete a record (restorable). */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    await deleteRecord(auth.admin, auth.orgId, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the record");
  }
}
