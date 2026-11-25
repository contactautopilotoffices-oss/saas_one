import { NextResponse } from "next/server";

import { candidateMessages } from "@/backend/lib/candidates/messages";

import { errorResponse, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Owner 2026-11-24: the one message log of a candidate. Query: orgId, candidateId → { messages }, newest first. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ messages: await candidateMessages(auth.admin, auth.orgId, params.get("candidateId") ?? "") });
  } catch (error) {
    return errorResponse(error, "Couldn't load the messages");
  }
}
