/**
 * Prepares records for meaning search in the background (owner 2026-11-03: HR uploads and sees a progress bar; the
 * system does the rest, and HR never sees an embedding error).
 *
 * Who runs it: the cron /api/cron/candidate-indexing every minute (all organisations), right after an upload or edit
 * (after()), and the Sheets page's quiet nudge while records are still being prepared. A per-organisation lease
 * (candidate_index_claim) keeps two runs from embedding the same records.
 *
 * Per run, until its time budget is used:
 *   take up to EMBED_BATCH waiting records -> embed (EMBEDDING_PROVIDER: Gemini or Jina) -> store (candidate_set_embeddings)
 *   service busy / down / not configured -> stop, pause the organisation (1, 2, 5, then 10 min), try again later
 *   service rejects the text             -> retry those records one by one; a record rejected EMBED_MAX_ATTEMPTS times
 *                                           is set aside (still found by filters and keywords)
 * Records without an embedding are still found by filters and keywords, so nothing here ever fails a request.
 * Needs migration 20261103000002 (until then a run does nothing and logs why).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { EMBED_BATCH, EMBED_CALL_GAP_MS, EMBED_MAX_ATTEMPTS, EMBEDDING_MODEL, INDEX_BACKOFF_SECONDS, INDEX_BUDGET_MS } from "./config";
import { EmbedError, embedDocuments } from "./embeddings";

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface IndexResult {
  indexed: number;
  /** Records still waiting (counted up to 500; -1 when unknown). */
  remaining: number;
  /** The run did not embed because the organisation is paused or another run holds it. */
  waiting: boolean;
}

export interface IndexOptions {
  budgetMs?: number;
  embed?: Embedder;
  /** Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Stop starting new calls this close to the end of the budget. */
const SAFETY_MS = 8_000;
const REMAINING_CAP = 500;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  const m = (error as { message?: unknown })?.message;
  return typeof m === "string" ? m : String(error);
}

function migrationMissing(error: { code?: string } | null | undefined): boolean {
  return ["PGRST202", "PGRST205", "42883", "42P01", "42703"].includes(error?.code ?? "");
}

let warnedMissing = false;
function warnMissing(error: unknown) {
  if (warnedMissing) return;
  warnedMissing = true;
  console.error("[candidates] indexing needs migration 20261103000002_candidate_search_auto_indexing.sql", message(error));
}

async function pending(client: SupabaseClient, orgId: string, limit: number): Promise<{ id: string; search_text: string }[]> {
  const { data, error } = await client.rpc("candidate_pending_embeddings", { p_organization_id: orgId, p_model: EMBEDDING_MODEL, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as { id: string; search_text: string }[];
}

async function store(client: SupabaseClient, rows: { id: string; search_text: string }[], vectors: number[][]): Promise<number> {
  const items = rows.map((row, i) => ({ id: row.id, search_text: row.search_text, embedding: `[${vectors[i].join(",")}]` }));
  const { data, error } = await client.rpc("candidate_set_embeddings", { p_items: items, p_model: EMBEDDING_MODEL });
  if (error) throw error;
  return Number(data ?? 0);
}

async function remainingCount(client: SupabaseClient, orgId: string): Promise<number> {
  try {
    return (await pending(client, orgId, REMAINING_CAP)).length;
  } catch {
    return -1;
  }
}

/** One organisation, within the time budget. Never throws. */
export async function indexOrganisation(client: SupabaseClient, orgId: string, options: IndexOptions = {}): Promise<IndexResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const embed = options.embed ?? embedDocuments;
  const budgetMs = options.budgetMs ?? INDEX_BUDGET_MS.afterWrite;
  const deadline = now() + budgetMs;

  const claim = await client.rpc("candidate_index_claim", { p_organization_id: orgId, p_seconds: Math.ceil(budgetMs / 1000) + 15 });
  if (claim.error) {
    if (migrationMissing(claim.error)) warnMissing(claim.error);
    else console.error("[candidates] indexing: claim failed", message(claim.error));
    return { indexed: 0, remaining: -1, waiting: true };
  }
  if (claim.data !== true) return { indexed: 0, remaining: await remainingCount(client, orgId), waiting: true };

  let indexed = 0;
  let busy: string | null = null;
  // Records rejected in this run are not tried again until the next run (one try per run, EMBED_MAX_ATTEMPTS in all).
  const rejectedThisRun = new Set<string>();
  try {
    while (deadline - now() > SAFETY_MS) {
      const fetched = await pending(client, orgId, Math.min(EMBED_BATCH + rejectedThisRun.size, REMAINING_CAP));
      const rows = fetched.filter((row) => !rejectedThisRun.has(row.id)).slice(0, EMBED_BATCH);
      if (!rows.length) break;
      try {
        indexed += await store(client, rows, await embed(rows.map((r) => r.search_text)));
      } catch (error) {
        if (!(error instanceof EmbedError) || error.retryable) throw error;
        // The service rejected something in this batch: find which record, one at a time.
        const rejected: string[] = [];
        for (const row of rows) {
          if (deadline - now() <= SAFETY_MS) break;
          try {
            indexed += await store(client, [row], await embed([row.search_text]));
          } catch (single) {
            if (!(single instanceof EmbedError) || single.retryable) throw single;
            rejected.push(row.id);
          }
          await sleep(EMBED_CALL_GAP_MS);
        }
        if (rejected.length) {
          rejected.forEach((id) => rejectedThisRun.add(id));
          const { error: markError } = await client.rpc("candidate_mark_embed_failed", {
            p_organization_id: orgId,
            p_ids: rejected,
            p_error: message(error),
            p_max_attempts: EMBED_MAX_ATTEMPTS,
          });
          if (markError) throw markError;
          console.warn(`[candidates] indexing: ${rejected.length} record(s) rejected by the embedding service`, message(error).slice(0, 200));
        }
      }
      await sleep(EMBED_CALL_GAP_MS);
    }
  } catch (error) {
    busy = message(error).slice(0, 500);
    console.warn(`[candidates] indexing paused for ${orgId}: ${busy}`);
  } finally {
    const { error } = await client.rpc("candidate_index_release", {
      p_organization_id: orgId,
      p_ok: busy === null,
      p_error: busy,
      p_backoff_seconds: [...INDEX_BACKOFF_SECONDS],
    });
    if (error) console.error("[candidates] indexing: release failed", message(error));
  }
  return { indexed, remaining: await remainingCount(client, orgId), waiting: false };
}

/** Right after an upload / edit (after()), and the Sheets page's nudge. Never throws. */
export function indexPending(client: SupabaseClient, orgId: string, options: IndexOptions = {}): Promise<IndexResult> {
  return indexOrganisation(client, orgId, options);
}

/** The cron: every organisation with waiting records that is not paused, until the budget is used. Never throws. */
export async function indexAllOrganisations(
  client: SupabaseClient,
  options: IndexOptions = {},
): Promise<{ organisations: number; indexed: number }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? INDEX_BUDGET_MS.cron);
  const { data, error } = await client.rpc("candidate_orgs_to_index", { p_model: EMBEDDING_MODEL });
  if (error) {
    if (migrationMissing(error)) warnMissing(error);
    else console.error("[candidates] indexing: listing organisations failed", message(error));
    return { organisations: 0, indexed: 0 };
  }
  // A set-returning function comes back as a list; accept a single value or row objects too.
  const list: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
  const orgs = list
    .map((row) => (typeof row === "string" ? row : (row as { candidate_orgs_to_index?: string })?.candidate_orgs_to_index))
    .filter((id): id is string => Boolean(id));
  let organisations = 0;
  let indexed = 0;
  for (const orgId of orgs) {
    const left = deadline - now();
    if (left <= SAFETY_MS * 2) break;
    const result = await indexOrganisation(client, orgId, { ...options, budgetMs: left });
    organisations += 1;
    indexed += result.indexed;
  }
  return { organisations, indexed };
}
