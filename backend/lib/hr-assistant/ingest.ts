/**
 * Ingest a policy version: chunk -> embed -> store -> make it live.
 * Shared by the upload routes and the CLI script.
 *
 * Two steps, so the upload routes can answer immediately and index in the background:
 *   1. createVersion  - fast: records the next version of a policy as 'processing'.
 *   2. processVersion - slow: chunks, embeds and stores, then makes it the live
 *                       version (archiving the previous one) or marks it 'failed'.
 *                       Never throws.
 *
 * A version only becomes searchable once all its chunks are stored, and the switch
 * from old to new live version happens in one database transaction
 * (hr_set_live_version), so the assistant never sees a half-indexed or missing policy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { STALE_PROCESSING_MINUTES } from "./config";
import { embedDocuments } from "./embeddings";
import { DocumentError, fileExtension } from "./extract-text";
import { friendlyError } from "./friendly-errors";
import { splitIntoChunks } from "./splitter";

const INSERT_BATCH_SIZE = 200;

export const INTERRUPTED_MESSAGE = "Indexing was interrupted. Please upload the file again.";

export type VersionStatus = "processing" | "ready" | "archived" | "failed";

/** One uploaded file = one version of a policy (an hr_documents row). */
export interface HrPolicyVersion {
  id: string;
  policy_id: string;
  version: number;
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: VersionStatus;
  error: string | null;
  chunk_count: number;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVersionInput {
  /** The uploaded file's name. */
  name: string;
  /** Add a version to this policy ("Replace"). Without it, the policy is matched by title. */
  policyId?: string | null;
  /** Defaults to the file name without its extension. */
  title?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedBy?: string | null;
  uploadedByEmail?: string | null;
}

export interface IngestDeps {
  embed?: (chunks: string[]) => Promise<number[][]>;
}

/** "Leave_Policy.pdf" -> "Leave_Policy" */
export function policyTitleFromFileName(fileName: string): string {
  const extension = fileExtension(fileName);
  const title = (extension ? fileName.slice(0, -extension.length) : fileName).trim();
  return title || fileName;
}

/** Step 1: record the next version as 'processing'. `admin` must be a service-role client. */
export async function createVersion(
  admin: SupabaseClient,
  input: CreateVersionInput,
): Promise<HrPolicyVersion> {
  const { data, error } = await admin.rpc("hr_create_policy_version", {
    p_name: input.name,
    p_title: input.title ?? policyTitleFromFileName(input.name),
    p_policy_id: input.policyId ?? null,
    p_storage_path: input.storagePath ?? null,
    p_mime_type: input.mimeType ?? null,
    p_size_bytes: input.sizeBytes ?? null,
    p_uploaded_by: input.uploadedBy ?? null,
    p_uploaded_by_email: input.uploadedByEmail ?? null,
  });
  if (error) throw error;
  return data as HrPolicyVersion;
}

/**
 * Step 2: chunk, embed and store the text, then make this version live (unless a
 * newer version went live meanwhile, in which case it's archived). On any error,
 * removes partial chunks and marks the version 'failed'; the previous live version
 * keeps serving. Safe to run in the background: it never throws.
 */
export async function processVersion(
  admin: SupabaseClient,
  version: HrPolicyVersion,
  text: string,
  { embed = embedDocuments }: IngestDeps = {},
): Promise<HrPolicyVersion> {
  try {
    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) throw new DocumentError("The document has no text to index.");

    const embeddings = await embed(chunks);
    for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
      const { error } = await admin.from("hr_policy_chunks").insert(
        chunks.slice(i, i + INSERT_BATCH_SIZE).map((content, offset) => ({
          document_id: version.id,
          chunk_index: i + offset,
          content,
          embedding: embeddings[i + offset],
        })),
      );
      if (error) throw error;
    }

    const { data, error } = await admin.rpc("hr_set_live_version", {
      p_document_id: version.id,
      p_chunk_count: chunks.length,
      p_only_if_newer: true,
    });
    if (error) throw error;
    return data as HrPolicyVersion;
  } catch (error) {
    console.error(`[hr-assistant] indexing failed for "${version.name}" v${version.version}`, error);
    // HR sees a plain message; the technical one is in the log line above.
    const message = friendlyError(error instanceof Error ? error.message : null);
    try {
      await admin.from("hr_policy_chunks").delete().eq("document_id", version.id);
      await admin
        .from("hr_documents")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", version.id);
    } catch (cleanupError) {
      // Worst case the row stays 'processing'; failStaleDocuments will catch it.
      console.error("[hr-assistant] failed to record indexing failure", cleanupError);
    }
    return { ...version, status: "failed", error: message };
  }
}

/** Both steps in one go (used by the CLI script). Throws if indexing fails. */
export async function ingestDocument(
  admin: SupabaseClient,
  input: CreateVersionInput & { text: string },
  deps: IngestDeps = {},
): Promise<HrPolicyVersion> {
  const version = await createVersion(admin, input);
  const result = await processVersion(admin, version, input.text, deps);
  if (result.status === "failed") throw new Error(result.error ?? "Indexing failed");
  return result;
}

/**
 * Safety net: a version stuck in 'processing' for too long (e.g. the server
 * restarted mid-index) is marked 'failed' so HR can re-upload it.
 */
export async function failStaleDocuments(admin: SupabaseClient, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { error } = await admin
    .from("hr_documents")
    .update({ status: "failed", error: INTERRUPTED_MESSAGE, updated_at: now.toISOString() })
    .eq("status", "processing")
    .lt("updated_at", cutoff);
  if (error) console.error("[hr-assistant] failed to mark stale documents", error);
}
