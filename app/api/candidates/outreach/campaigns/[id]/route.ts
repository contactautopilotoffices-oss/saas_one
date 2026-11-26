import { NextResponse } from "next/server";

import { campaignSends, cancelCampaign, defaultCampaignSenders, getCampaign, processCampaign } from "@/backend/lib/candidates/outreach-campaigns";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Query: orgId. { campaign, sends }: one send and each person's message, problems first. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const [campaign, sends] = await Promise.all([getCampaign(auth.admin, auth.orgId, id), campaignSends(auth.admin, auth.orgId, id)]);
    return NextResponse.json({ campaign, sends });
  } catch (error) {
    return errorResponse(error, "Couldn't load the send");
  }
}

/** { orgId, action: "continue" } sends the next batch; { orgId, action: "cancel" } stops what is still queued. */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("outreach-batch", auth.user.id, { maxRequests: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { id } = await params;
  try {
    if (body.action === "cancel") return NextResponse.json({ campaign: await cancelCampaign(auth.admin, auth.orgId, id) });
    if (body.action !== "continue") return NextResponse.json({ error: "Choose continue or cancel." }, { status: 400 });
    const result = await processCampaign(auth.admin, auth.orgId, id, defaultCampaignSenders(auth.admin, auth.orgId));
    return NextResponse.json({ campaign: await getCampaign(auth.admin, auth.orgId, id), ...result });
  } catch (error) {
    return errorResponse(error, "Couldn't send the next messages");
  }
}
