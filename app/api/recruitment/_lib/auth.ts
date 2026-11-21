import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { requisitionAccess } from "@/backend/lib/candidates/requisitions";
import type { RequisitionAccess, RecruitmentConfig } from "@/backend/lib/candidates/types";
import { createClient } from "@/frontend/utils/supabase/server";

import { actorFor, errorResponse, rateLimited, readJson, UUID } from "../../candidates/_lib/auth";

export { actorFor, errorResponse, rateLimited, readJson, UUID };

type Access = RequisitionAccess & { config: RecruitmentConfig; member: boolean };
type AuthResult =
  | { user: User; orgId: string; admin: SupabaseClient; access: Access; error?: never }
  | { error: NextResponse };

/**
 * Hiring requests (owner 2026-11-17) are for every active member of the organisation: a manager raises one, HR
 * follows all of them, the configured approvers decide. So the check is membership, not the HR-only Candidate Search
 * check; what the person may then do comes back as `access` (requisitions.ts decides the rest).
 */
export async function requireOrgMember(orgId: unknown): Promise<AuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (typeof orgId !== "string" || !UUID.test(orgId)) return { error: NextResponse.json({ error: "orgId is required" }, { status: 400 }) };
  const admin = getCandidatesAdmin();
  const access = await requisitionAccess(admin, user.id, orgId);
  if (!access.member) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user, orgId, admin, access };
}
