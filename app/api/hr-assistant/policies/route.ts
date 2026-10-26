import { NextResponse } from "next/server";

import { failStaleDocuments, getSupabaseAdmin, listPolicies } from "@/backend/lib/hr-assistant";

import { requireHrAdmin } from "../_lib/admin-auth";
import { handlePolicyUpload } from "../_lib/upload";

export const runtime = "nodejs";
// Also bounds the background indexing scheduled with after().
export const maxDuration = 60;

/** All policies with their version history. */
export async function GET() {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;

  const admin = getSupabaseAdmin();
  await failStaleDocuments(admin);
  try {
    return NextResponse.json({ policies: await listPolicies(admin) });
  } catch (error) {
    console.error("[hr-assistant] failed to list policies", error);
    return NextResponse.json({ error: "Couldn't load policies" }, { status: 500 });
  }
}

/**
 * Upload a file as a policy. If a policy with the same name exists (ignoring the
 * extension and case), this becomes its next version; otherwise a new policy is created.
 */
export async function POST(request: Request) {
  const auth = await requireHrAdmin();
  if (auth.error) return auth.error;
  return handlePolicyUpload(request, auth.user, null);
}
