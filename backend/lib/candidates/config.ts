/** All Candidate Search settings, in one place. */
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/backend/lib/hr-assistant/config";

import type { CriterionKey } from "./types";

/**
 * Who may use Candidate Search: these active organization_memberships roles in THAT organisation, or a master admin.
 * Owner 2026-11-02: every HR login can search, add, edit and delete; the tab lives in the Tech console for now.
 */
export const CANDIDATE_ACCESS_ROLES = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin", "tech"] as const;

// Same embedding model and size as the HR Policy Assistant (768-dim Gemini), so no new key or migration type.
// (Claude has no embeddings endpoint, so meaning search keeps Gemini embeddings.)
export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL };

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

/** Embeddings computed per background run (the upload's after() and each "Index now" click). */
export const INDEX_BATCH_LIMIT = 600;

// Requests per user per minute.
export const SEARCH_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
export const UPLOAD_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };
export const REINDEX_RATE_LIMIT = { maxRequests: 12, windowMs: 60_000 };
// Add / edit (each one triggers a small background embedding run).
export const WRITE_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 };
