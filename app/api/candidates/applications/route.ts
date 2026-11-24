import { NextResponse } from "next/server";

import { applicationResumeUrl, listApplications, openLink } from "@/backend/lib/candidates/applications";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * The job application form, for HR (owner 2026-11-24): the applications received, a resume file, and a position's open
 * link for postings. The public form itself is /apply/<token> (app/api/public/apply/[token]).
 */

/** Query: orgId, positionId?, page? → { applications, total, form }; or resume=<id> → a one-time link to that file. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const resume = params.get("resume");
    if (resume) return NextResponse.json({ url: await applicationResumeUrl(auth.admin, auth.orgId, resume) });
    return NextResponse.json(await listApplications(auth.admin, auth.orgId, { positionId: params.get("positionId"), page: Number(params.get("page") || 1) }));
  } catch (error) {
    return errorResponse(error, "Couldn't load the applications");
  }
}

/** { orgId, action: "open-link", positionId | null } → the position's open link (made once). */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (body.action !== "open-link") return NextResponse.json({ error: "Choose open-link." }, { status: 400 });
    const positionId = typeof body.positionId === "string" && body.positionId ? body.positionId : null;
    return NextResponse.json({ link: await openLink(auth.admin, auth.orgId, positionId, auth.user.id) });
  } catch (error) {
    return errorResponse(error, "Couldn't make the link");
  }
}
