import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { deleteTracker, updateTracker } from "@/backend/lib/candidates/trackers";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Edit a connection ({ orgId, ...the form }), or pause / resume it ({ orgId, active }). */
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
    return NextResponse.json({ tracker: await updateTracker(auth.admin, auth.orgId, id, fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the connection");
  }
}

/** Disconnect it (it stops syncing; everything it brought in stays). Query: orgId. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    await deleteTracker(auth.admin, auth.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't disconnect the tracker");
  }
}
