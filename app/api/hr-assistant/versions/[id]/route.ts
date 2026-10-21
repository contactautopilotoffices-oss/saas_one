import { NextResponse } from "next/server";

import { deleteVersion, getSupabaseAdmin } from "@/backend/lib/hr-assistant";

import { actionErrorResponse, requireHrAdmin, UUID } from "../../_lib/admin-auth";

export const runtime = "nodejs";

/** Delete an old (archived or failed) version and its stored file. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await deleteVersion(getSupabaseAdmin(), id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return actionErrorResponse(error, "Couldn't delete the version");
  }
}
