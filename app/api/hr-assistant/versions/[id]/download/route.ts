import { NextResponse } from "next/server";

import { getDownloadUrl, getSupabaseAdmin } from "@/backend/lib/hr-assistant";

import { actionErrorResponse, requireHrAdmin, UUID } from "../../../_lib/admin-auth";

export const runtime = "nodejs";

/** Download the original uploaded file of a version (via a 60-second signed link). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return NextResponse.redirect(await getDownloadUrl(getSupabaseAdmin(), id));
  } catch (error) {
    return actionErrorResponse(error, "Couldn't prepare the download");
  }
}
