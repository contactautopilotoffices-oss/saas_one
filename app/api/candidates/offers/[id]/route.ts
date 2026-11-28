import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { attachOfferPdf, decideOffer, defaultFlowDeps, editBreakup, editLetter, logContact, offerPdfDownload, recordJoining, recordResponse, releaseOffer, staffOfferPdf } from "@/backend/lib/candidates/hiring";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const missing = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return missing();
  try {
    const file = await staffOfferPdf(auth.admin, auth.orgId, id);
    return file ? offerPdfDownload(file) : missing();
  } catch (error) {
    return errorResponse(error, "Couldn't open the offer letter");
  }
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return missing();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Choose an offer letter PDF up to 4 MB." }, { status: 400 });
  }
  try {
    const offer = await attachOfferPdf(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), id, file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ offer });
  } catch (error) {
    return errorResponse(error, "Couldn't attach the offer letter");
  }
}

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
export async function PATCH(request: Request, { params }: Params) {
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
      a === "decide" ? await decideOffer(auth.admin, auth.orgId, by, id, { decision: body.decision, reason: body.reason, approvalRevision: body.approvalRevision, expectedLevel: body.expectedLevel }, deps)
      : a === "breakup" || a === "revise_offer" ? await editBreakup(auth.admin, auth.orgId, by, id, {
        breakup: body.breakup, proposedCtc: body.proposedCtc, joiningDate: body.joiningDate, note: body.note, approvalRevision: body.approvalRevision,
      }, deps, a === "revise_offer")
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
