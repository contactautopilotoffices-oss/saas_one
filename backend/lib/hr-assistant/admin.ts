/** Server-only: the service-role client and who may use / manage the HR assistant. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/frontend/utils/supabase/admin";

import { EXTERNAL_ROLES, HR_ADMIN_ROLES } from "./config";

let admin: SupabaseClient | undefined;

/** Service-role client: bypasses RLS. Only ever use it after an access check. */
export function getSupabaseAdmin(): SupabaseClient {
  return (admin ??= createAdminClient());
}

export interface HrAccess {
  /** Can chat with the assistant (employees and staff). */
  canUse: boolean;
  /** Can upload, restore and delete policy documents. */
  isAdmin: boolean;
}

export interface HrRoleFacts {
  isMasterAdmin: boolean;
  /** Roles from the user's active organization_memberships. */
  orgRoles: string[];
  /** Roles from the user's active property_memberships. */
  propertyRoles: string[];
}

function isExternalRole(role: string): boolean {
  return role.startsWith("tenant") || EXTERNAL_ROLES.includes(role);
}

/** Pure decision, so it can be unit-tested. HR admin rights come from org-level roles only. */
export function resolveHrAccess({ isMasterAdmin, orgRoles, propertyRoles }: HrRoleFacts): HrAccess {
  const isAdmin = isMasterAdmin || orgRoles.some((role) => HR_ADMIN_ROLES.includes(role));
  const canUse = isAdmin || [...orgRoles, ...propertyRoles].some((role) => !isExternalRole(role));
  return { canUse, isAdmin };
}

/** Is this the HR admin set? Kept as a named helper for callers that only need the admin bit. */
export function isHrAdmin(facts: HrRoleFacts): boolean {
  return resolveHrAccess(facts).isAdmin;
}

/**
 * Read a user's roles from the database (never from user_metadata, which users can edit)
 * and decide their access. Fails closed: any read error means no access.
 */
export async function getHrAccess(userId: string, client: SupabaseClient = getSupabaseAdmin()): Promise<HrAccess> {
  const [userRow, orgRows, propertyRows] = await Promise.all([
    client.from("users").select("is_master_admin").eq("id", userId).maybeSingle(),
    client.from("organization_memberships").select("role").eq("user_id", userId).eq("is_active", true),
    client.from("property_memberships").select("role").eq("user_id", userId).eq("is_active", true),
  ]);
  const error = userRow.error ?? orgRows.error ?? propertyRows.error;
  if (error) {
    console.error("[hr-assistant] failed to read roles", error);
    return { canUse: false, isAdmin: false };
  }
  const roles = (rows: { role: string | null }[] | null) =>
    (rows ?? []).map((row) => row.role).filter((role): role is string => Boolean(role));

  return resolveHrAccess({
    isMasterAdmin: Boolean(userRow.data?.is_master_admin),
    orgRoles: roles(orgRows.data),
    propertyRoles: roles(propertyRows.data),
  });
}
