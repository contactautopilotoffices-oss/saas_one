/**
 * Who may use Candidate Search in an organisation. New, module-only check: it does not change any existing role or
 * permission. Roles are read from the database (never from user_metadata, which users can edit). Fails closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/frontend/utils/supabase/admin";

import { CANDIDATE_ACCESS_ROLES } from "./config";

let admin: SupabaseClient | undefined;

/** Service-role client: bypasses RLS. Only ever use it after canUseCandidateSearch() said yes. */
export function getCandidatesAdmin(): SupabaseClient {
  return (admin ??= createAdminClient());
}

export interface CandidateRoleFacts {
  isMasterAdmin: boolean;
  /** Roles of the user's ACTIVE memberships in the organisation being accessed. */
  orgRoles: string[];
}

/** Pure decision, unit-tested. */
export function resolveCandidateAccess({ isMasterAdmin, orgRoles }: CandidateRoleFacts): boolean {
  return isMasterAdmin || orgRoles.some((role) => (CANDIDATE_ACCESS_ROLES as readonly string[]).includes(role.toLowerCase()));
}

export async function canUseCandidateSearch(
  userId: string,
  organizationId: string,
  client: SupabaseClient = getCandidatesAdmin(),
): Promise<boolean> {
  const [userRow, orgRows] = await Promise.all([
    client.from("users").select("is_master_admin").eq("id", userId).maybeSingle(),
    client
      .from("organization_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("is_active", true),
  ]);
  if (userRow.error || orgRows.error) {
    console.error("[candidates] failed to read roles", userRow.error ?? orgRows.error);
    return false;
  }
  return resolveCandidateAccess({
    isMasterAdmin: Boolean(userRow.data?.is_master_admin),
    orgRoles: (orgRows.data ?? []).map((row) => row.role).filter((role): role is string => Boolean(role)),
  });
}
