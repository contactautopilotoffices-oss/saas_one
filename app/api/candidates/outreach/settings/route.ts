import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { APPLICATION_TARGETS, PLACEHOLDERS } from "@/backend/lib/candidates/outreach-settings";
import { loadRecruitmentConfig, saveOutreachSettings } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/*
 * Recruitment → Outreach (owner 2026-11-24): the job application form's questions, the WhatsApp and email templates,
 * and automatic outreach on approval. HR's to change (the people with Recruitment access).
 */

/** Query: orgId. { settings, placeholders, targets } */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const config = await loadRecruitmentConfig(auth.admin, auth.orgId);
    return NextResponse.json({ settings: config.outreach, placeholders: PLACEHOLDERS, targets: APPLICATION_TARGETS });
  } catch (error) {
    return errorResponse(error, "Couldn't load the outreach settings");
  }
}

/** Save them: { orgId, settings }. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ settings: await saveOutreachSettings(auth.admin, auth.orgId, body.settings, await actorFor(auth.admin, auth.user)) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the outreach settings");
  }
}
