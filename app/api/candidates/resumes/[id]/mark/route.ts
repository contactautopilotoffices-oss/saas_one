import { after, NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { processResumeExtraction } from "@/backend/lib/candidates/resume-extract";
import { allowReupload, markAsResume } from "@/backend/lib/candidates/resume-text";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/**
 * Owner 2026-11-15, Needs attention: { orgId, as: "resume" } marks a document kept aside as a resume (matched at once,
 * details read in the background); { orgId, as: "reupload" } lets a file removed as not a resume be uploaded again.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (body.as === "resume") {
      await markAsResume(auth.admin, auth.orgId, id);
      // The details reader runs in the background, as after an upload; the cron picks up anything left.
      after(() => processResumeExtraction(auth.admin, auth.orgId));
    } else if (body.as === "reupload") {
      await allowReupload(auth.admin, auth.orgId, id);
    } else {
      return NextResponse.json({ error: 'Say what to do: as "resume" or "reupload".' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't change the file");
  }
}
