import { NextResponse } from "next/server";

import { DANGER_RATE_LIMIT, MAX_BULK_RECORDS } from "@/backend/lib/candidates/config";
import { deleteRecords, matchingRecordIds, purgeRecords } from "@/backend/lib/candidates/records";
import type { BulkResponse } from "@/backend/lib/candidates/types";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IDS = 1000;

/**
 * Many records at once (owner 2026-11-03).
 *   { orgId, action: "delete", ids }     : move these records to deleted (restorable).
 *   { orgId, action: "delete", filter }  : move every visible record matching the table's filters
 *                                          ({ q, status, sheetId }, all optional) to deleted ("Delete all matching").
 *   { orgId, action: "purge", ids }      : delete these already-deleted records for good, and people left with none.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("danger", auth.user.id, DANGER_RATE_LIMIT);
  if (limited) return limited;

  const action = body.action;
  if (action !== "delete" && action !== "purge") {
    return NextResponse.json({ error: "action must be delete or purge" }, { status: 400 });
  }
  const ids = body.ids;
  const hasIds = Array.isArray(ids);
  if (hasIds && (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id)))) {
    return NextResponse.json({ error: `ids must be 1-${MAX_IDS} record ids` }, { status: 400 });
  }

  try {
    if (action === "purge") {
      if (!hasIds) return NextResponse.json({ error: "Choose the records to delete permanently" }, { status: 400 });
      const result: BulkResponse = await purgeRecords(auth.admin, auth.orgId, ids as string[]);
      console.info(`[candidates] ${result.records} records deleted permanently by ${auth.user.id}`);
      return NextResponse.json(result);
    }

    let target = ids as string[] | undefined;
    if (!hasIds) {
      const filter = body.filter;
      if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
        return NextResponse.json({ error: "Send ids, or a filter for all matching records" }, { status: 400 });
      }
      const f = filter as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
      const sheetId = str(f.sheetId);
      if (sheetId && sheetId !== "manual" && !UUID.test(sheetId)) return NextResponse.json({ error: "Invalid sheetId" }, { status: 400 });
      target = await matchingRecordIds(auth.admin, auth.orgId, { q: str(f.q), status: str(f.status), sheetId }, MAX_BULK_RECORDS);
    }
    const records = target?.length ? await deleteRecords(auth.admin, auth.orgId, auth.user.id, target) : 0;
    const result: BulkResponse = { records, people: 0 };
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't delete the records");
  }
}
