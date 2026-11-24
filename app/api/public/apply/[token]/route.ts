import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { FormError, MAX_RESUME_BYTES, publicForm, submitApplication } from "@/backend/lib/candidates/applications";
import { CandidateActionError } from "@/backend/lib/candidates/records";

import { rateLimited } from "../../../candidates/_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The job application form's public side (owner 2026-11-24): /apply/<token>, no sign-in. The token in the link is the
 * only key: GET returns the questions (and the role, and a personal link's first name), POST accepts one application
 * (multipart form: "answers" as JSON, "consent", and the "resume" file). Limited per address so the form cannot be
 * flooded.
 */

const ipOf = (request: NextRequest) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimited("apply-open", ipOf(request), { maxRequests: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  try {
    const form = await publicForm(getCandidatesAdmin(), token);
    if (!form) return NextResponse.json({ error: "This application link is no longer open." }, { status: 404, headers: noStore });
    return NextResponse.json(form, { headers: noStore });
  } catch (error) {
    console.error("[apply] open failed", error);
    return NextResponse.json({ error: error instanceof CandidateActionError ? error.message : "The form could not be opened. Please try again." }, { status: error instanceof CandidateActionError ? error.status : 500, headers: noStore });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = ipOf(request);
  const limited = rateLimited("apply-submit", ip, { maxRequests: 6, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const { token } = await params;
  let answers: Record<string, unknown> = {};
  let consent = false;
  let resume: { name: string; type: string; bytes: Uint8Array } | null = null;
  try {
    const form = await request.formData();
    answers = JSON.parse(String(form.get("answers") ?? "{}")) as Record<string, unknown>;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) answers = {};
    consent = form.get("consent") === "true";
    const file = form.get("resume");
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      if (f.size > MAX_RESUME_BYTES) return NextResponse.json({ error: "The file is over 4 MB. Attach a smaller one.", field: "resume" }, { status: 400 });
      resume = { name: f.name || "resume", type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
    }
  } catch {
    return NextResponse.json({ error: "The form could not be read. Please try again." }, { status: 400 });
  }
  try {
    const result = await submitApplication(getCandidatesAdmin(), token, { answers, consent, resume, ip, userAgent: request.headers.get("user-agent") });
    return NextResponse.json({ thanks: result.thanks }, { headers: noStore });
  } catch (error) {
    if (error instanceof FormError) return NextResponse.json({ error: error.message, field: error.fieldId }, { status: 400 });
    if (error instanceof CandidateActionError) return NextResponse.json({ error: error.status >= 500 ? "Your application could not be saved. Please try again in a moment." : error.message }, { status: error.status });
    console.error("[apply] submit failed", error);
    return NextResponse.json({ error: "Your application could not be saved. Please try again in a moment." }, { status: 500 });
  }
}
