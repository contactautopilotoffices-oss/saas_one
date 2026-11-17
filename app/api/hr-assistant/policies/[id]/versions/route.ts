import { NextResponse } from "next/server";

import { requireHrAdmin, UUID } from "../../../_lib/admin-auth";
import { handlePolicyUpload } from "../../../_lib/upload";

export const runtime = "nodejs";
// Also bounds the background indexing scheduled with after().
export const maxDuration = 60;

/** "Replace": upload a file as the next version of this policy, whatever its name. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return handlePolicyUpload(request, auth.user, id);
}
