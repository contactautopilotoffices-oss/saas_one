import { after, NextResponse } from "next/server";

import { UPLOAD_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";
import { linkUnmatched } from "@/backend/lib/candidates/resume-text";
import { previewTrackerImport, syncTracker } from "@/backend/lib/candidates/trackers";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "Sync now": { orgId } -> the sync's summary. The new rows' search indexing runs afterwards, as for an upload. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("upload", auth.user.id, UPLOAD_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (body.preview === true) return NextResponse.json({ preview: await previewTrackerImport(auth.admin, auth.orgId, id) });
    const summary = await syncTracker(auth.admin, auth.orgId, id, { trigger: "manual", by: await actorFor(auth.admin, auth.user), reviewToken: body.reviewToken, selectedRows: body.selectedRows });
    after(async () => { await linkUnmatched(auth.admin, auth.orgId); await indexPending(auth.admin, auth.orgId); });
    return NextResponse.json({ summary });
  } catch (error) {
    return errorResponse(error, "Couldn't sync the tracker");
  }
}
