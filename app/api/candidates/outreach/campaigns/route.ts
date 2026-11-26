import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { createCampaign, defaultCampaignSenders, listCampaigns, previewCampaign, processCampaign, sendingMailboxes } from "@/backend/lib/candidates/outreach-campaigns";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * Bulk outreach (owner 2026-11-24): HR picks candidates in Search and sends a WhatsApp and/or email template to all of
 * them. The send is queued, then sent in batches (the page asks for the next batch; the hourly job finishes anything
 * left).
 */

/** Query: orgId. { campaigns, mailboxes }: the latest sends, and the mailboxes connected for sending. */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    const [campaigns, mailboxes] = await Promise.all([listCampaigns(auth.admin, auth.orgId), sendingMailboxes(auth.admin, auth.orgId)]);
    return NextResponse.json({ campaigns, mailboxes });
  } catch (error) {
    return errorResponse(error, "Couldn't load the sends");
  }
}

/**
 * { orgId, action: "preview", applicationIds, positionId?, whatsappTemplateId?, emailTemplateId? } → the first person's messages.
 * { orgId, action: "send", …same, mailConnectionId? } → queues it and sends the first batch.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("outreach-campaign", auth.user.id, body.action === "preview" ? { maxRequests: 60, windowMs: 60_000 } : WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (body.action === "preview") return NextResponse.json(await previewCampaign(auth.admin, auth.orgId, body));
    if (body.action !== "send") return NextResponse.json({ error: "Choose preview or send." }, { status: 400 });
    const campaign = await createCampaign(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body);
    const first = await processCampaign(auth.admin, auth.orgId, campaign.id, defaultCampaignSenders(auth.admin, auth.orgId));
    return NextResponse.json({ campaign, ...first });
  } catch (error) {
    return errorResponse(error, "Couldn't send the messages");
  }
}
