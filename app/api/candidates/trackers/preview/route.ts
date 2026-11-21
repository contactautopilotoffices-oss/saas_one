import { NextResponse } from "next/server";

import { UPLOAD_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { previewTracker } from "@/backend/lib/candidates/trackers";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Read a share link before connecting it: { orgId, url, tab?, headerRow? } -> its tabs, and the chosen tab's columns
 * with the app's guess for each, a few rows, and each column's values (to match statuses to stages). Saves nothing.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  // It downloads a file from Google or Microsoft: limited like an upload.
  const limited = rateLimited("upload", auth.user.id, UPLOAD_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ preview: await previewTracker({ url: body.url, tab: body.tab, headerRow: body.headerRow }) });
  } catch (error) {
    return errorResponse(error, "Couldn't read the sheet");
  }
}
