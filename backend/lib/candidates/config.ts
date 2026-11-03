/** All Candidate Search settings, in one place. */
import type { CriterionKey } from "./types";

/**
 * Who may use Candidate Search: these active organization_memberships roles in THAT organisation, or a master admin.
 * Owner 2026-11-02: every HR login can search, add, edit and delete; the tab lives in the Tech console for now.
 */
export const CANDIDATE_ACCESS_ROLES = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin", "tech"] as const;

/**
 * Meaning-search embeddings (owner 2026-11-03): Jina jina-embeddings-v3 at 768 dimensions (key JINA_API_KEY), the same
 * size as the column, so no migration of the vector type. One model for records and queries (see embeddings.ts).
 * Changing the model is safe: records embedded with another model count as waiting and are re-embedded in the
 * background, and search only compares vectors of this model meanwhile.
 */
export const EMBEDDING_MODEL = "jina-embeddings-v3";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * The background worker (indexing.ts): a cron every minute (/api/cron/candidate-indexing), right after an upload or
 * edit, and while HR has the Sheets page open. HR never sees its errors; they pause the organisation and retry.
 *   pauses after a "busy" answer: 1, 2, 5, then 10 minutes (and 10 from then on)
 *   a record whose text the service rejects is tried EMBED_MAX_ATTEMPTS times, then set aside (still found by
 *   filters and keywords)
 *   EMBED_CALL_GAP_MS between calls keeps one worker under ~100 calls a minute
 */
export const INDEX_BACKOFF_SECONDS = [60, 120, 300, 600] as const;
export const EMBED_MAX_ATTEMPTS = 3;
export const EMBED_CALL_GAP_MS = 600;
/** Time one run may spend: the cron route allows 60 s; the page's nudge and the after-upload run less. */
export const INDEX_BUDGET_MS = { cron: 50_000, afterWrite: 40_000, nudge: 20_000 } as const;

/**
 * Which models read the search and rank candidates is set in the Control Center ("AI models": jobs 'candidate_parse' and
 * 'candidate_rank'; default Claude Opus 5.5, owner 2026-11-02). These are the per-step call settings:
 *   effort / maxTokens   Claude only (thinking is always on for Claude 5.x; effort sets how much)
 *   otherMaxTokens       other providers (answer only)
 *   timeoutMs per model, budgetMs for the whole chain (main + backups). Both steps together stay under the
 *   search route's 120 s limit.
 */
export const PARSE_CALL = { effort: "low", maxTokens: 8000, otherMaxTokens: 1500, timeoutMs: 20_000, budgetMs: 35_000 } as const;
export const RERANK_CALL = { effort: "medium", maxTokens: 16_000, otherMaxTokens: 8000, timeoutMs: 45_000, budgetMs: 60_000 } as const;

/**
 * AI fix for flagged sheet rows (Control Center job 'candidate_fix'; HR approves every change before it is saved).
 * AI_FIX_BATCH rows per call keeps one prompt small; the portal sends the rows of a sheet in batches.
 */
export const AI_FIX_CALL = { effort: "low", maxTokens: 12_000, otherMaxTokens: 4000, timeoutMs: 40_000, budgetMs: 50_000 } as const;
export const AI_FIX_BATCH = 15;

export const MAX_QUERY_LENGTH = 4000;

/** Records the search hands to the ranker: about 3 x N, at least 20, at most 45 (one prompt stays small and fast). */
export function comparePoolSize(topN: number): number {
  return Math.min(45, Math.max(20, topN * 3));
}

/**
 * Starting weights for the overall match (percent). Criteria the search did not ask about are left out and the rest
 * are scaled back up to 100, so a search that never mentions salary is not scored on salary.
 * Role / experience / domain come from the AI (evidence only); location / notice / salary are computed in code.
 * There is no "skills" criterion yet: the Excel data has no skills column (it arrives with resume parsing).
 */
export const CRITERION_WEIGHTS: Record<CriterionKey, number> = {
  role: 35,
  experience: 25,
  domain: 15,
  location: 10,
  notice: 10,
  salary: 5,
};

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  role: "Role fit",
  experience: "Experience",
  domain: "Domain / background",
  location: "Location",
  notice: "Notice period",
  salary: "Salary",
};

// Uploads. 4 MB stays under Vercel's 4.5 MB request body limit (same as the HR assistant).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const SUPPORTED_SHEET_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;
export const MAX_SHEET_ROWS = 10_000;


// Requests per user per minute.
export const SEARCH_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
export const UPLOAD_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };
// The Sheets page nudges the background worker about every 20 s while records are being prepared.
export const REINDEX_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };
// Add / edit (each one triggers a small background embedding run).
export const WRITE_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 };
// AI fix: each request is one model call of up to AI_FIX_BATCH rows.
export const AI_FIX_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };
// Bulk delete, permanent delete and clear all.
export const DANGER_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };

/** "Delete all matching" moves at most this many records in one request (an organisation has ~3,000). */
export const MAX_BULK_RECORDS = 20_000;
/** Typed by the user to confirm "Clear all candidate data"; the server checks it too. */
export const CLEAR_ALL_CONFIRMATION = "DELETE ALL";
