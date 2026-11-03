import { NextResponse } from "next/server";

import { DANGER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { deleteSheet, purgeSheet } from "@/backend/lib/candidates/sheets";

import { errorResponse, rateLimited, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

/**
 * Delete a sheet.
 *   default        : soft delete. Its records are hidden (restorable). People with records elsewhere keep those.
 *   ?permanent=1   : delete for good (owner 2026-11-03): the sheet, its records and uploaded rows, and every person left
 *                    with no record anywhere. Works on a live or an already-deleted sheet. Replies with the counts.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const search = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(search.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    if (search.get("permanent") === "1") {
      const limited = rateLimited("danger", auth.user.id, DANGER_RATE_LIMIT);
      if (limited) return limited;
      const result = await purgeSheet(auth.admin, auth.orgId, id);
      console.info(`[candidates] sheet ${id} deleted permanently by ${auth.user.id}`, result);
      return NextResponse.json(result);
    }
    await deleteSheet(auth.admin, auth.orgId, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the sheet");
  }
}
