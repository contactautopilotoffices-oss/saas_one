import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { decideOffer, defaultFlowDeps, editBreakup, editLetter, logContact, recordJoining, recordResponse, releaseOffer } from "@/backend/lib/candidates/hiring";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

/**
 * One offer's next step: { orgId, action, ... }
 *   decide   : { decision: approve | reject | revise, reason? } (the HR Head, then the Director above the band)
 *   breakup  : { breakup: { row: rupees }, proposedCtc? } (until release; approval starts again; audited)
 *   letter   : { letter, joiningDate? } (before release)
 *   release  : emails the letter to the candidate (blocked until approved and with no blanks)
 *   response : { response: accepted | declined, reason?, joiningDate? }
 *   contact  : { note? } (a call with someone joining)
 *   joining  : { outcome: joined | dropped, reason? }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const deps = defaultFlowDeps();
    const a = body.action;
    const offer =
      a === "decide" ? await decideOffer(auth.admin, auth.orgId, by, id, { decision: body.decision, reason: body.reason }, deps)
      : a === "breakup" ? await editBreakup(auth.admin, auth.orgId, by, id, { breakup: body.breakup, proposedCtc: body.proposedCtc }, deps)
      : a === "letter" ? await editLetter(auth.admin, auth.orgId, by, id, { letter: body.letter, joiningDate: body.joiningDate })
      : a === "release" ? await releaseOffer(auth.admin, auth.orgId, by, id, deps)
      : a === "response" ? await recordResponse(auth.admin, auth.orgId, by, id, { response: body.response, reason: body.reason, joiningDate: body.joiningDate }, deps)
      : a === "contact" ? await logContact(auth.admin, auth.orgId, by, id, body.note)
      : a === "joining" ? await recordJoining(auth.admin, auth.orgId, by, id, { outcome: body.outcome, reason: body.reason }, deps)
      : null;
    if (!offer) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ offer });
  } catch (error) {
    return errorResponse(error, "Couldn't update the offer");
  }
}
