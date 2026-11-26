import { NextResponse } from "next/server";

import { AI_FIX_RATE_LIMIT, WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { positionScreening, savePositionQuestions, suggestScreeningQuestions } from "@/backend/lib/candidates/screening-questions";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/*
 * A position's own screening questions (owner 2026-11-25). HR only.
 *   GET  ?orgId                       → { standard, fallback, own, max, hasJd }
 *   POST { orgId, count, existing }   → { questions }: the AI's draft from the JD (nothing is saved)
 *   PUT  { orgId, fields }            → { own }: saves HR's list ([] = back to the standard list)
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    return NextResponse.json(await positionScreening(auth.admin, auth.orgId, id));
  } catch (error) {
    return errorResponse(error, "Couldn't load the screening questions");
  }
}

export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("screening-ai", auth.user.id, AI_FIX_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ questions: await suggestScreeningQuestions(auth.admin, auth.orgId, id, { count: body.count, existing: body.existing }) });
  } catch (error) {
    return errorResponse(error, "Couldn't draft the questions");
  }
}

export async function PUT(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ own: await savePositionQuestions(auth.admin, auth.orgId, id, body.fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the questions");
  }
}
