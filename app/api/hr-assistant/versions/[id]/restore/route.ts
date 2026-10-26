import { NextResponse } from "next/server";

import { getSupabaseAdmin, restoreVersion } from "@/backend/lib/hr-assistant";

import { actionErrorResponse, requireHrAdmin, UUID } from "../../../_lib/admin-auth";

export const runtime = "nodejs";

/** Make an archived version live again. Instant: its chunks were kept. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const version = await restoreVersion(getSupabaseAdmin(), id);
    return NextResponse.json({ version });
  } catch (error) {
    return actionErrorResponse(error, "Couldn't restore the version");
  }
}
