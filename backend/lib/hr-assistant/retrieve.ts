/**
 * Find the policy chunks that best match a question (Supabase pgvector + full-text).
 *
 * Hybrid search: hybrid_match_hr_policy_chunks merges a vector (meaning) search and a
 * keyword search with Reciprocal Rank Fusion, so exact terms like "CL" or "LOP" are found
 * too. If that function isn't in the database yet (its migration not applied), falls back
 * to the vector-only match_hr_policy_chunks so the assistant keeps working.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { TOP_K_RESULTS } from "./config";
import { embedQuery } from "./embeddings";

export interface PolicyChunk {
  id: number;
  source: string;
  content: string;
  similarity: number;
}

export interface RetrieveDeps {
  embed?: (question: string) => Promise<number[]>;
}

// PostgREST "function not found" (schema cache) and Postgres "undefined function".
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

export async function retrievePolicyChunks(
  supabase: SupabaseClient,
  question: string,
  k: number = TOP_K_RESULTS,
  { embed = embedQuery }: RetrieveDeps = {},
): Promise<PolicyChunk[]> {
  const queryEmbedding = await embed(question);

  const hybrid = await supabase.rpc("hybrid_match_hr_policy_chunks", {
    query_text: question,
    query_embedding: queryEmbedding,
    match_count: k,
  });
  if (!hybrid.error) return (hybrid.data ?? []) as PolicyChunk[];
  if (!MISSING_FUNCTION_CODES.has(hybrid.error.code ?? "")) {
    throw new Error(`HR policy search failed: ${hybrid.error.message}`);
  }

  console.warn("[hr-assistant] hybrid search not installed; using vector-only search");
  const { data, error } = await supabase.rpc("match_hr_policy_chunks", {
    query_embedding: queryEmbedding,
    match_count: k,
  });
  if (error) throw new Error(`HR policy search failed: ${error.message}`);
  return (data ?? []) as PolicyChunk[];
}
