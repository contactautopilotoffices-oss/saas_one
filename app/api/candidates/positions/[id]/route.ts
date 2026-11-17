import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { deletePosition, getPosition, updatePosition } from "@/backend/lib/candidates/positions";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** One position with its job description. Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    return NextResponse.json({ position: await getPosition(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the position");
  }
}

/** Edit a position; { status: "closed" } closes it, { status: "open" } reopens it. */
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
    return NextResponse.json({ position: await updatePosition(auth.admin, auth.orgId, id, fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the position");
  }
}

/**
 * Delete a position (owner 2026-11-16): it leaves every list, and the people in its pipeline are taken out, each with
 * an entry in their history. Nothing is erased. Query: orgId.
 */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await deletePosition(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), id));
  } catch (error) {
    return errorResponse(error, "Couldn't delete the position");
  }
}
