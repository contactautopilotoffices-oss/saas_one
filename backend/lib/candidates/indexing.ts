/**
 * Meaning-search embeddings for records, computed in the background (after an upload / edit, or "Index now").
 * Records without an embedding are still found by filters and keywords, so a failure here only delays meaning search.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { embedDocuments } from "@/backend/lib/hr-assistant/embeddings";

import { EMBEDDING_MODEL, INDEX_BATCH_LIMIT } from "./config";

const EMBED_BATCH = 100; // Gemini's max inputs per call

export interface IndexResult {
  indexed: number;
  remaining: number;
  error?: string;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

async function countPending(client: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await client
    .from("candidate_applications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .is("embedding", null)
    .neq("search_text", "");
  if (error) throw error;
  return count ?? 0;
}

/** Embed up to `limit` records of this organisation that have no embedding yet. Never throws. */
export async function indexPending(
  client: SupabaseClient,
  orgId: string,
  limit = INDEX_BATCH_LIMIT,
  embed: Embedder = embedDocuments,
): Promise<IndexResult> {
  let indexed = 0;
  try {
    const { data, error } = await client
      .from("candidate_applications")
      .select("id, search_text")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .is("embedding", null)
      .neq("search_text", "")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as { id: string; search_text: string }[];
    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      const batch = rows.slice(i, i + EMBED_BATCH);
      const vectors = await embed(batch.map((row) => row.search_text));
      const items = batch.map((row, j) => ({ id: row.id, search_text: row.search_text, embedding: `[${vectors[j].join(",")}]` }));
      const { data: updated, error: rpcError } = await client.rpc("candidate_set_embeddings", { p_items: items, p_model: EMBEDDING_MODEL });
      if (rpcError) throw rpcError;
      indexed += Number(updated ?? 0);
    }
    return { indexed, remaining: await countPending(client, orgId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    console.error("[candidates] indexing stopped", message.slice(0, 300));
    let remaining = -1;
    try {
      remaining = await countPending(client, orgId);
    } catch {
      /* keep -1 */
    }
    return { indexed, remaining, error: "Meaning-search indexing paused (the embedding service is busy). Try Index now in a minute." };
  }
}
