import { NextResponse } from "next/server";

import { audit, listAudit } from "@/backend/lib/candidates/audit";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * The recruitment audit log (owner 2026-11-24, product safety). GET ?orgId&page&action → { entries, total }.
 * POST { orgId, action: "export", count, what }: the browser builds CSV exports itself, so it reports each one here.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await listAudit(auth.admin, auth.orgId, { page: Number(params.get("page")) || 1, action: params.get("action") }));
  } catch (error) {
    return errorResponse(error, "Couldn't load the audit log");
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  if (body.action !== "export") return NextResponse.json({ error: "Only exports are reported here." }, { status: 400 });
  const count = Math.max(0, Math.min(1_000_000, Math.round(Number(body.count) || 0)));
  const what = typeof body.what === "string" ? body.what.slice(0, 200) : "candidates";
  await audit(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), { action: "export", entityType: "candidates", detail: `Exported ${count} ${what} to CSV`, after: { count } });
  return NextResponse.json({ ok: true });
}
