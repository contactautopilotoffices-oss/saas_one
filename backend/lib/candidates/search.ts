/**
 * Candidate search, a fixed workflow (doctrine L1; spec block in docs/features/candidate_search.md):
 *   1. understand  : LLM -> validated JSON spec (query-spec.ts)
 *   2. retrieve    : must-have filters in SQL, then structured + keyword + meaning lists merged by RRF
 *                    (hybrid_search_candidates); about 3 x N records come back
 *   3. rank        : evidence-only LLM scores + deterministic criteria -> top N (rerank.ts)
 *   4. log         : candidate_search_logs (spec, ids, timings, fallbacks)
 * Every step has a fallback, so a model or embedding outage degrades the answer instead of failing it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { JsonCaller } from "./models";
import { comparePoolSize, EMBEDDING_MODEL, MAX_QUERY_LENGTH, meaningIndexOn, RANK_POOL } from "./config";
import { embedQuery } from "./embeddings";
import { filterRecords } from "./filter-search";
import { describeFilters, specFromFilters, type SearchFilters } from "./filters";
import { compact, parseQuery, searchTextFor, specChips, type Preferences, type SearchSpec } from "./query-spec";
import { CandidateActionError, getRecordRows, toRecord } from "./records";
import { rerank } from "./rerank";
import { TOP_N_MAX, TOP_N_MIN, type SearchResponse } from "./types";

export interface SearchDeps {
  embed?: (text: string) => Promise<number[]>;
  caller?: JsonCaller;
  today?: string;
}

export function validateSearchBody(body: unknown): { query: string; topN: number } {
  const b = (body ?? {}) as { query?: unknown; topN?: unknown };
  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (!query) throw new CandidateActionError(400, "Type what you are looking for.");
  if (query.length > MAX_QUERY_LENGTH) throw new CandidateActionError(400, `Keep the search under ${MAX_QUERY_LENGTH} characters.`);
  const topN = typeof b.topN === "number" ? b.topN : Number(b.topN);
  if (!Number.isInteger(topN) || topN < TOP_N_MIN || topN > TOP_N_MAX) {
    throw new CandidateActionError(400, `Top N must be a whole number from ${TOP_N_MIN} to ${TOP_N_MAX}.`);
  }
  return { query, topN };
}

interface HybridRow {
  application_id: string;
  rrf_score: number;
  structured_rank: number | null;
  keyword_rank: number | null;
  semantic_rank: number | null;
  matching_count: number;
}

export async function searchCandidates(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  query: string,
  topN: number,
  deps: SearchDeps = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const notices: string[] = [];
  const today = deps.today ?? new Date().toISOString().slice(0, 10);

  // 1. Understand.
  const { spec, aiParsed, model: parseModel } = await parseQuery(query, today, deps.caller);
  if (!aiParsed) {
    notices.push("The AI couldn't read the filters in your search, so must-haves (experience, notice, salary, location) were NOT applied. Results are text matches only; please check them or try again.");
  }
  const parsedAt = Date.now();

  // 2. Retrieve.
  const text = searchTextFor(spec, query);
  let embedding: number[] | null = null;
  try {
    // With the index switched off (config.ts) the query is not embedded either: filters and words only.
    if (deps.embed || meaningIndexOn()) embedding = await (deps.embed ?? embedQuery)(spec.summary ? `${spec.summary}. ${text}` : text);
  } catch (error) {
    // Owner 2026-11-03: HR is not told about the embedding service; the search still uses filters and keywords.
    console.warn("[candidates] query embedding failed", error instanceof Error ? error.message : error);
  }
  const poolSize = comparePoolSize(topN);
  const args = {
    p_organization_id: orgId,
    p_filters: compact(spec.must),
    p_preferences: compact(spec.prefer),
    p_query_text: text,
    p_match_count: poolSize,
  };
  // Meaning search compares only vectors of the same model (records still waiting, or embedded by an older model,
  // are found by filters and keywords). Before migration 20261103000002 the function has no model argument: search
  // without the vector rather than compare vectors of different models.
  let { data, error } = await client.rpc("hybrid_search_candidates", {
    ...args,
    p_query_embedding: embedding ? `[${embedding.join(",")}]` : null,
    p_embedding_model: EMBEDDING_MODEL,
  });
  if (error?.code === "PGRST202") {
    console.warn("[candidates] hybrid search without meaning search: migration 20261103000002 not applied");
    ({ data, error } = await client.rpc("hybrid_search_candidates", { ...args, p_query_embedding: null }));
  }
  if (error) {
    console.error("[candidates] hybrid search failed", error);
    throw new CandidateActionError(500, "The search failed. Please try again.");
  }
  const hits = (data ?? []) as HybridRow[];
  const matchingCount = hits[0]?.matching_count ?? 0;
  const rows = await getRecordRows(client, orgId, hits.map((h) => h.application_id));
  const byId = new Map(rows.map((row) => [row.id, toRecord(row)]));
  const records = hits.map((h) => byId.get(h.application_id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const retrievedAt = Date.now();

  // 3. Rank.
  const { results, aiRanked, model: rankModel } = await rerank(query, spec, records, topN, deps.caller);
  if (records.length && !aiRanked) notices.push("These results are in search order this time, without a match %.");
  if (!matchingCount) notices.push("No records matched all the must-haves. Try loosening one (e.g. experience or notice period).");
  else if (matchingCount < topN) notices.push(`Only ${matchingCount} record${matchingCount === 1 ? "" : "s"} matched the must-haves.`);
  const done = Date.now();

  // 4. Log (never fails the search).
  const searchId = await logSearch(client, {
    organization_id: orgId,
    user_id: userId,
    query,
    top_n: topN,
    spec,
    matching_count: matchingCount,
    compared_count: records.length,
    result_ids: results.map((r) => r.record.id),
    ai_parsed: aiParsed,
    ai_ranked: aiRanked,
    notices,
    parse_ms: parsedAt - started,
    retrieve_ms: retrievedAt - parsedAt,
    rerank_ms: done - retrievedAt,
    total_ms: done - started,
    parse_model: parseModel,
    rank_model: rankModel,
  });

  return {
    results,
    understood: { summary: spec.summary || query.slice(0, 200), chips: specChips(spec) },
    topN,
    matchingCount,
    comparedCount: records.length,
    aiRanked,
    notices,
    searchId,
  };
}

/**
 * "Rank with AI" on the filter panel (owner 2026-11-06): the same ranking step as a plain-English search, on the records
 * the filters matched, in the order HR sees them. No parse call and no embedding: the filters already say what is wanted.
 */
export async function rankFiltered(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  filters: SearchFilters,
  prefer: Preferences,
  jobText: string,
  deps: SearchDeps = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const notices: string[] = [];
  const matched = await filterRecords(client, orgId, filters, 1, RANK_POOL, deps.today);
  const retrievedAt = Date.now();

  const spec = specFromFilters(filters, prefer);
  const query = jobText.trim() || spec.summary;
  const { results, aiRanked, model } = await rerank(query, spec, matched.records, TOP_N_MAX, deps.caller);
  if (matched.records.length && !aiRanked) notices.push("AI ranking is unavailable right now. Please try again in a moment.");
  if (matched.total > matched.records.length) notices.push(`AI compared the first ${matched.records.length} of ${matched.total} in the current order. Add a filter or change the sort to compare others.`);
  const done = Date.now();

  const searchId = await logSearch(client, {
    organization_id: orgId,
    user_id: userId,
    query: query.slice(0, MAX_QUERY_LENGTH),
    top_n: TOP_N_MAX,
    spec,
    matching_count: matched.total,
    compared_count: matched.records.length,
    result_ids: results.map((r) => r.record.id),
    ai_parsed: false,
    ai_ranked: aiRanked,
    notices,
    parse_ms: 0,
    retrieve_ms: retrievedAt - started,
    rerank_ms: done - retrievedAt,
    total_ms: done - started,
    parse_model: null,
    rank_model: model,
  });

  return {
    results,
    understood: { summary: describeFilters(filters), chips: [] },
    topN: TOP_N_MAX,
    matchingCount: matched.total,
    comparedCount: matched.records.length,
    aiRanked,
    notices,
    searchId,
  };
}

async function logSearch(
  client: SupabaseClient,
  row: Record<string, unknown> & { spec: SearchSpec },
): Promise<string | null> {
  try {
    let { data, error } = await client.from("candidate_search_logs").insert(row).select("id").single();
    // Before 20261102000004 is applied the two model columns don't exist: log without them.
    if (error && ["PGRST204", "42703"].includes(String(error.code ?? ""))) {
      const rest: Record<string, unknown> = { ...row };
      delete rest.parse_model;
      delete rest.rank_model;
      ({ data, error } = await client.from("candidate_search_logs").insert(rest).select("id").single());
    }
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (error) {
    console.error("[candidates] failed to log search", error);
    return null;
  }
}
