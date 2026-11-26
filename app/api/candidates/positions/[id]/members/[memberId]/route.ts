import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { moveMember, removeMember } from "@/backend/lib/candidates/positions";
import { loadRecruitmentConfig } from "@/backend/lib/candidates/requisitions";
import { loadStages } from "@/backend/lib/candidates/stages";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; memberId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Move one person: { orgId, stage, remark? } ("Others" needs the remark). */
export async function PATCH(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id, memberId } = await params;
  if (!UUID.test(id) || !UUID.test(memberId)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const member = await moveMember(auth.admin, auth.orgId, by, id, memberId, body.stage, body.remark);
    let rejectionEmail: { templateId: string } | null = null;
    try {
      const [{ stages }, config] = await Promise.all([loadStages(auth.admin, auth.orgId), loadRecruitmentConfig(auth.admin, auth.orgId)]);
      const templateId = config.outreach.rejectionEmailTemplateId;
      if (templateId && stages.find((s) => s.key === member.stage)?.kind === "rejected") rejectionEmail = { templateId };
    } catch { /* the offer is a convenience */ }
    return NextResponse.json({ member, rejectionEmail });
  } catch (error) {
    return errorResponse(error, "Couldn't move the candidate");
  }
}

/** Take one person out of the position: { orgId, remark? }. */
export async function DELETE(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id, memberId } = await params;
  if (!UUID.test(id) || !UUID.test(memberId)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    await removeMember(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), id, memberId, body.remark);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't remove from the position");
  }
}
