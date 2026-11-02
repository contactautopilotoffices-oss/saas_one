import { NextResponse } from "next/server";

import { downloadVersionFile, getSupabaseAdmin } from "@/backend/lib/hr-assistant";

import { actionErrorResponse, requireHrAdmin, UUID } from "../../../_lib/admin-auth";

export const runtime = "nodejs";

/** Download the original uploaded file of a version directly. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { buffer, name, contentType } = await downloadVersionFile(getSupabaseAdmin(), id);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
        "Content-Length": buffer.byteLength.toString(),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return actionErrorResponse(error, "Couldn't prepare the download");
  }
}
