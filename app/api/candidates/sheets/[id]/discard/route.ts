import { NextResponse } from "next/server";

import { discardRows } from "@/backend/lib/candidates/ai-fix";
import { DANGER_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 200;

/**
 * "Delete rows" in View issues (owner 2026-11-12). Body { orgId, rowNumbers } (1 to MAX_ROWS rows of the sheet's
 * latest upload). The records those rows became move to Deleted (restorable from the Candidates tab) and the rows
 * leave "Needs review". Same login check and the same limit as every other delete in this module.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("danger", auth.user.id, DANGER_RATE_LIMIT);
  if (limited) return limited;

  const rows = body.rowNumbers;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS || !rows.every((n) => Number.isInteger(n) && n > 0)) {
    return NextResponse.json({ error: `rowNumbers must be 1-${MAX_ROWS} row numbers` }, { status: 400 });
  }
  try {
    return NextResponse.json(await discardRows(auth.admin, { orgId: auth.orgId, userId: auth.user.id, sheetId: id, rowNumbers: rows as number[] }));
  } catch (error) {
    return errorResponse(error, "Couldn't delete the rows");
  }
}
