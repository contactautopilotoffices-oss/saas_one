import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { defaultFlowDeps, offerPdfDownload, publicOffer, publicOfferPdf, respondOnPage } from "@/backend/lib/candidates/hiring";
import { CandidateActionError } from "@/backend/lib/candidates/records";

import { rateLimited } from "../../../candidates/_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The letter of intent's public side (owner 2026-11-24): /offer/<token>, no sign-in. GET: the letter and the salary
 * breakup. POST { response: "accepted" | "declined", reason? }: the candidate's answer, once. An acceptance is handed
 * to onboarding and the HR team is told.
 */

const ipOf = (request: NextRequest) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimited("offer-page", ipOf(request), { maxRequests: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  try {
    const admin = getCandidatesAdmin();
    if (request.nextUrl.searchParams.get("download") === "letter") {
      const file = await publicOfferPdf(admin, token);
      return file ? offerPdfDownload(file) : NextResponse.json({ error: "This offer has no PDF available." }, { status: 404, headers: noStore });
    }
    const page = await publicOffer(admin, token);
    if (!page) return NextResponse.json({ error: "This letter is not open." }, { status: 404, headers: noStore });
    return NextResponse.json(page, { headers: noStore });
  } catch (error) {
    console.error("[offer] open failed", error);
    return NextResponse.json({ error: "The letter could not be opened. Please try again." }, { status: 500, headers: noStore });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimited("offer-answer", ipOf(request), { maxRequests: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const { token } = await params;
  const body = await request.json().catch(() => ({})) as { response?: unknown; reason?: unknown };
  try {
    const result = await respondOnPage(getCandidatesAdmin(), token, { response: body.response, reason: body.reason }, defaultFlowDeps());
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof CandidateActionError) return NextResponse.json({ error: error.status >= 500 ? "Your answer could not be saved. Please try again." : error.message }, { status: error.status });
    console.error("[offer] answer failed", error);
    return NextResponse.json({ error: "Your answer could not be saved. Please try again." }, { status: 500 });
  }
}
