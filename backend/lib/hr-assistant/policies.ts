/** Manage versioned HR policies: list, restore, delete, download. Service-role client only. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DOCUMENTS_BUCKET } from "./config";
import type { HrPolicyVersion } from "./ingest";

export interface HrPolicy {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Newest first. */
  versions: HrPolicyVersion[];
}

/** An expected problem with the request (shown to HR), with the HTTP status to use. */
export class PolicyActionError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/** All policies with their version history, most recently changed first. */
export async function listPolicies(admin: SupabaseClient): Promise<HrPolicy[]> {
  const { data, error } = await admin
    .from("hr_policies")
    .select("id, title, created_at, updated_at, versions:hr_documents(*)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as HrPolicy[]).map((policy) => ({
    ...policy,
    versions: [...policy.versions].sort((a, b) => b.version - a.version),
  }));
}

async function getVersion(admin: SupabaseClient, id: string): Promise<HrPolicyVersion> {
  const { data, error } = await admin.from("hr_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new PolicyActionError("That version no longer exists.", 404);
  return data as HrPolicyVersion;
}

async function removeFiles(admin: SupabaseClient, paths: (string | null)[]): Promise<void> {
  const existing = paths.filter((path): path is string => Boolean(path));
  if (!existing.length) return;
  const { error } = await admin.storage.from(DOCUMENTS_BUCKET).remove(existing);
  // The rows are already gone; an orphaned file is harmless, so just report it.
  if (error) console.error("[hr-assistant] failed to remove stored files", error);
}

/** Make an archived version live again (the current live version gets archived). */
export async function restoreVersion(admin: SupabaseClient, id: string): Promise<HrPolicyVersion> {
  const version = await getVersion(admin, id);
  if (version.status === "ready") return version;
  if (version.status !== "archived") {
    throw new PolicyActionError(
      version.status === "failed"
        ? "This version failed to index, so it can't be made live. Upload the file again instead."
        : "This version is still indexing.",
      409,
    );
  }
  const { data, error } = await admin.rpc("hr_set_live_version", { p_document_id: id });
  // The version can change between the check above and the RPC (deleted, or marked failed).
  if (error?.code === "P0002") throw new PolicyActionError("That version no longer exists.", 404);
  if (error?.code === "22023") {
    throw new PolicyActionError("This version failed to index, so it can't be made live.", 409);
  }
  if (error) throw error;
  return data as HrPolicyVersion;
}

/** Delete one old (archived or failed) version. The live version can't be deleted on its own. */
export async function deleteVersion(admin: SupabaseClient, id: string): Promise<void> {
  const version = await getVersion(admin, id);
  if (version.status === "ready") {
    throw new PolicyActionError(
      "This is the live version. Restore another version first, or delete the whole policy.",
      409,
    );
  }
  if (version.status === "processing") {
    throw new PolicyActionError("This version is still indexing. Try again in a moment.", 409);
  }
  const { error } = await admin.from("hr_documents").delete().eq("id", id);
  if (error) throw error;
  await removeFiles(admin, [version.storage_path]);
}

/** Delete a policy with all its versions, chunks and stored files. */
export async function deletePolicy(admin: SupabaseClient, id: string): Promise<void> {
  const { data: versions, error: listError } = await admin
    .from("hr_documents")
    .select("storage_path")
    .eq("policy_id", id);
  if (listError) throw listError;

  const { data: deleted, error } = await admin.from("hr_policies").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!deleted?.length) throw new PolicyActionError("That policy no longer exists.", 404);

  await removeFiles(
    admin,
    (versions ?? []).map((version) => version.storage_path as string | null),
  );
}

/** A short-lived link to download a version's original file. */
export async function getDownloadUrl(admin: SupabaseClient, id: string): Promise<string> {
  const version = await getVersion(admin, id);
  if (!version.storage_path) {
    throw new PolicyActionError("The original file isn't stored for this version.", 404);
  }
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(version.storage_path, 60, { download: version.name });
  if (error) throw error;
  return data.signedUrl;
}
