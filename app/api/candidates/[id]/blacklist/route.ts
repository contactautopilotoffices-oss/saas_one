import { NextResponse } from "next/server";

import { clearBlacklist, setBlacklist } from "@/backend/lib/candidates/actions";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { getFullRecord } from "@/backend/lib/candidates/filter-search";
import { getRecord } from "@/backend/lib/candidates/records";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * Blacklist the person this record belongs to (owner 2026-11-15): { orgId, reason, remark? }. Every record of theirs
 * leaves the searches. Any HR user of the organisation may do this; it is kept in the history.
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
    const record = await getRecord(auth.admin, auth.orgId, id);
    await setBlacklist(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), record.candidateId, { reason: body.reason, remark: body.remark });
    return NextResponse.json({ record: await getFullRecord(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't blacklist the candidate");
  }
}

/** Take the person off the blacklist: { orgId, remark? }. */
export async function DELETE(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const record = await getRecord(auth.admin, auth.orgId, id);
    await clearBlacklist(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), record.candidateId, body.remark);
    return NextResponse.json({ record: await getFullRecord(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't remove the blacklist");
  }
}
