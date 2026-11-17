import { NextResponse } from "next/server";

import { proposeFixes } from "@/backend/lib/candidates/ai-fix";
import { AI_FIX_BATCH, AI_FIX_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI fix suggestions for flagged rows of a sheet's latest upload. Body { orgId, rowNumbers } (1 to AI_FIX_BATCH rows).
 * Nothing is saved: the portal shows the suggestions and HR approves them through ./apply.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("ai-fix", auth.user.id, AI_FIX_RATE_LIMIT);
  if (limited) return limited;

  const rows = body.rowNumbers;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > AI_FIX_BATCH || !rows.every((n) => Number.isInteger(n) && n > 0)) {
    return NextResponse.json({ error: `rowNumbers must be 1-${AI_FIX_BATCH} row numbers` }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await proposeFixes(auth.admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        sheetId: id,
        rowNumbers: [...new Set(rows as number[])],
        today: new Date().toISOString().slice(0, 10),
      }),
    );
  } catch (error) {
    return errorResponse(error, "Couldn't get AI suggestions");
  }
}
