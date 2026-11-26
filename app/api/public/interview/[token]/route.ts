import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { defaultFlowDeps } from "@/backend/lib/candidates/hiring";
import { consentFromInvite, publicInterview, rsvpInterview } from "@/backend/lib/candidates/interview-page";
import { CandidateActionError } from "@/backend/lib/candidates/records";

import { rateLimited } from "../../../candidates/_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The interview page's public side (owner 2026-11-24): /interview/<token>, no sign-in. GET: the interview (the job, the
 * company profile, the guidelines, how to join). POST { answer: "yes" | "no", note? }: will they attend.
 */

const ipOf = (request: NextRequest) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimited("interview-page", ipOf(request), { maxRequests: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  try {
    const page = await publicInterview(getCandidatesAdmin(), token);
    if (!page) return NextResponse.json({ error: "This interview link is not valid." }, { status: 404, headers: noStore });
    return NextResponse.json(page, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CandidateActionError ? error.message : "The page could not be opened. Please try again." }, { status: error instanceof CandidateActionError ? error.status : 500, headers: noStore });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimited("interview-rsvp", ipOf(request), { maxRequests: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const { token } = await params;
  const body = await request.json().catch(() => ({})) as { answer?: unknown; note?: unknown; analysisConsent?: unknown };
  try {
    if (body.analysisConsent === true) {
      await consentFromInvite(getCandidatesAdmin(), token);
      return NextResponse.json({ analysisConsent: true }, { headers: noStore });
    }
    const answer = await rsvpInterview(getCandidatesAdmin(), token, { answer: body.answer, note: body.note }, { sendEmail: defaultFlowDeps().sendEmail });
    return NextResponse.json({ rsvp: answer }, { headers: noStore });
  } catch (error) {
    if (error instanceof CandidateActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[interview] rsvp failed", error);
    return NextResponse.json({ error: "Your answer could not be saved. Please try again." }, { status: 500 });
  }
}
