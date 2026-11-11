/** All Candidate Search settings, in one place. */
import { EMBEDDING_MODEL as GEMINI_EMBEDDING_MODEL } from "@/backend/lib/hr-assistant/config";

import type { CriterionKey } from "./types";

/**
 * Who may use Candidate Search: these active organization_memberships roles in THAT organisation, or a master admin.
 * Owner 2026-11-02: every HR login can search, add, edit and delete; the tab lives in the Tech console for now.
 */
export const CANDIDATE_ACCESS_ROLES = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin", "tech"] as const;

/**
 * Meaning-search embeddings: which provider is chosen by the environment variable EMBEDDING_PROVIDER (owner
 * 2026-11-03: Gemini's free tier by default; "jina" when the Jina account has credit).
 *   gemini : gemini-embedding-001 at 768 dims, key GEMINI_API_KEY (the HR Policy Assistant's key and model)
 *   jina   : jina-embeddings-v3 at 768 dims, key JINA_API_KEY
 * Both are 768 dims, the column's size, so switching needs no migration. One model for records and queries at a time
 * (see embeddings.ts): after a switch, records embedded with the other model count as waiting and are re-embedded in
 * the background, and search only compares vectors of the current model meanwhile.
 */
export type EmbeddingProvider = "gemini" | "jina";
export const EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  gemini: GEMINI_EMBEDDING_MODEL,
  jina: "jina-embeddings-v3",
};
export const EMBEDDING_PROVIDER: EmbeddingProvider =
  (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase() === "jina" ? "jina" : "gemini";
export const EMBEDDING_MODEL = EMBEDDING_MODELS[EMBEDDING_PROVIDER];
export const EMBEDDING_DIMENSIONS = 768;

/**
 * The background worker (indexing.ts): a cron every minute (/api/cron/candidate-indexing), right after an upload or
 * edit, and while HR has the Sheets page open. HR never sees its errors; they pause the organisation and retry.
 *   pauses after a "busy" answer: 1, 2, 5, then 10 minutes (and 10 from then on)
 *   a record whose text the service rejects is tried EMBED_MAX_ATTEMPTS times, then set aside (still found by
 *   filters and keywords)
 *   per provider: inputs per call and the gap between calls. Gemini's free tier is small (its limits are not
 *   published), so it goes in smaller, slower steps; a "busy" answer then pauses and the work simply continues later.
 */
export const INDEX_BACKOFF_SECONDS = [60, 120, 300, 600] as const;
export const EMBED_MAX_ATTEMPTS = 3;
export const EMBED_PACE: Record<EmbeddingProvider, { batch: number; gapMs: number }> = {
  gemini: { batch: 50, gapMs: 2_000 },
  jina: { batch: 100, gapMs: 600 },
};
export const EMBED_BATCH = EMBED_PACE[EMBEDDING_PROVIDER].batch;
export const EMBED_CALL_GAP_MS = EMBED_PACE[EMBEDDING_PROVIDER].gapMs;
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

/** AI keyword suggestions (job 'candidate_suggest'): shown beside the box as HR types, so they stay small and quick. */
export const SUGGEST_CALL = { effort: "low", maxTokens: 2000, otherMaxTokens: 400, timeoutMs: 8000, budgetMs: 12_000 } as const;
/** Terms shown under the keyword box: all the model offers (owner 2026-11-11: none is dropped any more). */
export const SUGGEST_MAX = 16;
/** Terms counted on the records per request, after they are on screen: each one is a count query. */
export const SUGGEST_COUNT_MAX = 20;
/** The AI ranking compares this many filtered records, in the order HR sees them (one prompt stays small and fast). */
export const RANK_POOL = 45;

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
// The filter panel answers every click and the dropdown every pause in typing (both debounced); neither calls a model.
export const FILTER_RATE_LIMIT = { maxRequests: 180, windowMs: 60_000 };
export const OPTIONS_RATE_LIMIT = { maxRequests: 120, windowMs: 60_000 };
// AI keyword suggestions: one small model call per new keyword set (asked for while the keyword is still being typed),
// then one request for the counts. Repeats are answered from memory without a model call.
export const SUGGEST_RATE_LIMIT = { maxRequests: 90, windowMs: 60_000 };
export const UPLOAD_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };
// The Sheets page nudges the background worker about every 20 s while records are being prepared.
export const REINDEX_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };
// Add / edit (each one triggers a small background embedding run).
export const WRITE_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 };
// AI fix: each request is one model call of up to AI_FIX_BATCH rows.
export const AI_FIX_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };
// Bulk delete, permanent delete and clear all.
export const DANGER_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };

/**
 * Resume files (owner 2026-11-07, phase 1: every resume into one private bucket, no AI yet). The browser sends each
 * file straight to storage with a one-time link; the server only hands out links, records rows and makes the Excel.
 * The limits the browser shares (size, batch sizes, types) live in resume-pick.ts and are re-exported here.
 */
export { MAX_RESUME_BYTES, RESUME_BATCH, RESUME_LINK_BATCH, RESUME_TYPES } from "./resume-pick";
export const RESUME_BUCKET = "candidate-resumes";
/** How long a download link works. */
export const RESUME_LINK_SECONDS = 10 * 60;
export const RESUME_LIST_PAGE_SIZE = 100;
/** Rows in the Excel and files in one ZIP run, at most. */
export const RESUME_EXPORT_MAX = 20_000;
// Resume uploads: a 5,000-file run is ~100 prepare + ~100 confirm calls spread over minutes; lists and links are small.
export const RESUME_RATE_LIMIT = { maxRequests: 120, windowMs: 60_000 };
export const RESUME_EXPORT_RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 };

/**
 * Resume text and matching (owner 2026-11-10, phase 2; resume-text.ts). The background worker (the candidate-indexing
 * cron every minute, and right after an upload) reads each stored file's text with the installed readers, keeps the
 * emails and phones found, and links the file to the candidate with the same email or phone. No AI.
 *   RESUME_TEXT_BATCH         files claimed per step
 *   RESUME_TEXT_MAX_CHARS     text kept per file (phase 4 reads it again)
 *   RESUME_TEXT_MAX_ATTEMPTS  a file whose read keeps failing (not an unreadable file) is given up after this many
 *   RESUME_TEXT_STALE_MINUTES a run that died mid-file leaves rows at 'working'; after this they are retried
 *   RESUME_LINK_PAGE          unlinked files matched per pass
 */
export const RESUME_TEXT_BATCH = 20;
export const RESUME_TEXT_MAX_CHARS = 60_000;
export const RESUME_TEXT_MAX_ATTEMPTS = 3;
export const RESUME_TEXT_STALE_MINUTES = 10;
export const RESUME_TEXT_BUDGET_MS = { cron: 20_000, afterUpload: 40_000, nudge: 20_000 } as const;
/**
 * Owner 2026-11-11: files read at the same time inside one run (reading is mostly waiting on storage), and how many
 * files may be mid-read across all runs of an organisation (the cron, after-upload bursts and the page's nudges run
 * side by side; each claims its own files first). Past the cap a run leaves the work to the others.
 */
export const RESUME_TEXT_PARALLEL = 4;
export const RESUME_TEXT_MAX_INFLIGHT = 80;
export const RESUME_LINK_PAGE = 500;
/** Files HR may delete in one click (the list shows at most 50 a page). */
export const RESUME_DELETE_BATCH = 200;

/**
 * Reading details from resumes (owner 2026-11-11, phase 4; resume-extract.ts, Control Center job 'candidate_extract',
 * default Claude Haiku 5.5). One structured call per resume; the text sent is capped at RESUME_EXTRACT_MAX_CHARS with
 * emails and phones masked. The worker runs like the text reader: claimed batches, RESUME_EXTRACT_PARALLEL calls at a
 * time, a busy model (429 / overloaded) pauses the run instead of counting as a failure.
 */
export const EXTRACT_CALL = { effort: "low", maxTokens: 6000, otherMaxTokens: 2500, timeoutMs: 40_000, budgetMs: 50_000 } as const;
export const RESUME_EXTRACT_MAX_CHARS = 12_000;
export const RESUME_EXTRACT_BATCH = 10;
/** Calls at a time per run: ~5 s each on the sample, so 3 lanes read ~35 resumes a minute of budget. */
export const RESUME_EXTRACT_PARALLEL = 3;
export const RESUME_EXTRACT_MAX_ATTEMPTS = 3;
export const RESUME_EXTRACT_BUDGET_MS = { cron: 20_000, afterUpload: 25_000, nudge: 10_000 } as const;
/**
 * Scanned resumes (owner 2026-11-11): only a PDF with no text layer is sent to the model as the PDF itself (same
 * Control Center job as the details, 'candidate_extract'), which types out the pages. One call per scan, a few at a
 * time; a call is not started with less than RESUME_SCAN_MIN_START_MS of the run left, so a slow read is not cut off
 * and counted as a failure. A scan longer than RESUME_SCAN_MAX_PAGES is not a resume worth paying to read.
 */
export const SCAN_CALL = { effort: "low", maxTokens: 12_000, otherMaxTokens: 4000, timeoutMs: 40_000 } as const;
export const RESUME_SCAN_MAX_PAGES = 6;
export const RESUME_SCAN_MIN_CHARS = 40;
export const RESUME_SCAN_BATCH = 6;
export const RESUME_SCAN_PARALLEL = 3;
export const RESUME_SCAN_MIN_START_MS = 20_000;
/** Longest a scan run may take inside each caller; the routes shorten it by what the steps before it used. */
export const RESUME_SCAN_BUDGET_MS = { cron: 25_000, nudge: 40_000 } as const;
/** A route's usable time (its limit is 60 s) for the background steps it chains. */
export const RESUME_ROUTE_BUDGET_MS = 55_000;
/** Resume text kept on the candidate for keyword search (the file keeps the full text). */
export const CANDIDATE_RESUME_TEXT_CHARS = 20_000;

/** "Delete all matching" moves at most this many records in one request (an organisation has ~3,000). */
export const MAX_BULK_RECORDS = 20_000;
/** Typed by the user to confirm "Clear all candidate data"; the server checks it too. */
export const CLEAR_ALL_CONFIRMATION = "DELETE ALL";
