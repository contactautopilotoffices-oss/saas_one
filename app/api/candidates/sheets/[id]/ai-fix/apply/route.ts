import { after, NextResponse } from "next/server";

import { applyFixes } from "@/backend/lib/candidates/ai-fix";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { indexPending } from "@/backend/lib/candidates/indexing";
import type { AiFixApproval } from "@/backend/lib/candidates/types";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_APPROVALS = 200;

/**
 * Save the changes HR approved. Body { orgId, logId?, approvals: [{ rowNumber, changes }] }; `changes: {}` marks the
 * row as reviewed without changing it. Each row is saved like a hand edit (same validation), then its issues are
 * marked resolved and the sheet's flagged count is recounted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;

  const approvals = body.approvals;
  const valid =
    Array.isArray(approvals) &&
    approvals.length > 0 &&
    approvals.length <= MAX_APPROVALS &&
    approvals.every(
      (a) =>
        a && typeof a === "object" && Number.isInteger((a as AiFixApproval).rowNumber) &&
        (a as AiFixApproval).changes && typeof (a as AiFixApproval).changes === "object" && !Array.isArray((a as AiFixApproval).changes),
    );
  if (!valid) return NextResponse.json({ error: `approvals must be 1-${MAX_APPROVALS} rows with their changes` }, { status: 400 });
  const logId = typeof body.logId === "string" && UUID.test(body.logId) ? body.logId : null;

  try {
    const result = await applyFixes(auth.admin, { orgId: auth.orgId, userId: auth.user.id, sheetId: id, logId, approvals: approvals as AiFixApproval[] });
    after(() => indexPending(auth.admin, auth.orgId));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't save the fixes");
  }
}
