import { NextResponse } from "next/server";

import { deleteSheet } from "@/backend/lib/candidates/sheets";

import { errorResponse, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

/** Soft-delete a sheet: its records are hidden (restorable). People with records elsewhere keep those. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await deleteSheet(auth.admin, auth.orgId, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the sheet");
  }
}
