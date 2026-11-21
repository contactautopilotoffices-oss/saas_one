import { NextResponse } from "next/server";

import { requireOrgMember } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * Owner 2026-11-20: does this login get "Hiring requests" in its sidebar? Query: orgId. { canRaise, canOpen }: canOpen
 * is also true for a department head (owner 2026-11-21: they follow and endorse their departments' requests there).
 * Not a member of the organisation: 403 (the sidebar then shows nothing).
 */
export async function GET(request: Request) {
  const auth = await requireOrgMember(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const canRaise = auth.access.canRaise === true;
  return NextResponse.json({ canRaise, canOpen: canRaise || (auth.access.headOf?.length ?? 0) > 0 });
}
