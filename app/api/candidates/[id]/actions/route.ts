import { NextResponse } from "next/server";

import { addPositionNote, addRemark, listActions } from "@/backend/lib/candidates/actions";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { getRecord } from "@/backend/lib/candidates/records";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** The candidate's history (owner 2026-11-15), newest first: every record of the person. Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    const record = await getRecord(auth.admin, auth.orgId, id);
    return NextResponse.json({ actions: await listActions(auth.admin, auth.orgId, record.candidateId) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the history");
  }
}

/**
 * Add a remark: { orgId, remark, positionId? } (positionId: filed under that position, from the pipeline). Or, from the
 * pipeline (owner 2026-11-17), an interview or a round's feedback: { orgId, note: { kind, positionId, ... } }.
 */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const by = await actorFor(auth.admin, auth.user);
    if (body.note !== undefined) await addPositionNote(auth.admin, auth.orgId, by, id, body.note);
    else await addRemark(auth.admin, auth.orgId, by, id, body.remark, body.positionId);
    const record = await getRecord(auth.admin, auth.orgId, id);
    return NextResponse.json({ actions: await listActions(auth.admin, auth.orgId, record.candidateId) });
  } catch (error) {
    return errorResponse(error, "Couldn't add the remark");
  }
}
