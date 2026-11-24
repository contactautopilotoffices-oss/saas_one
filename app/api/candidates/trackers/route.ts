import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { createTracker, listTrackers } from "@/backend/lib/candidates/trackers";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * Connected trackers (owner 2026-11-21; HRMS meeting item 5): a Google Sheet or Excel file, by its share link, synced
 * one way into the app (backend/lib/candidates/trackers.ts). For the people who upload sheets (candidate access).
 */

/** Query: orgId. { trackers }. */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ trackers: await listTrackers(auth.admin, auth.orgId) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the connected trackers");
  }
}

/** Connect one: { orgId, name, url, tab, headerRow, columnMap, statusColumn?, statusMap?, syncEvery }. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ tracker: await createTracker(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Couldn't connect the tracker");
  }
}
