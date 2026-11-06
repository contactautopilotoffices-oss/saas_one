/**
 * Candidate Search: the shapes shared by the API routes (app/api/candidates) and the Tech console tab
 * (frontend/components/candidates). Type-only, plus a few constant lists, so client components can import it.
 *
 * Vocabulary:
 *   candidate = one person (deduplicated by email / phone inside an organisation)
 *   record    = one Excel row or one hand-added entry = one candidate_applications row. Search and the table work on records.
 *   sheet     = one uploaded Excel file (re-uploading the same file name asks Replace or Merge)
 */

export const RECORD_STATUSES = [
  "new",
  "in_process",
  "shortlisted",
  "interview",
  "on_hold",
  "not_responding",
  "rejected",
  "joined",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const STATUS_LABELS: Record<RecordStatus, string> = {
  new: "New",
  in_process: "In process",
  shortlisted: "Shortlisted",
  interview: "Interview",
  on_hold: "On hold",
  not_responding: "Not responding",
  rejected: "Rejected",
  joined: "Joined",
};

/** Top N the HR user may ask for (owner 2026-11-02: custom number, max 30). */
export const TOP_N_MIN = 1;
export const TOP_N_MAX = 30;
export const TOP_N_DEFAULT = 10;

export interface CandidateRecord {
  /** The record (candidate_applications) id. */
  id: string;
  candidateId: string;
  /** null = added by hand in the portal. */
  sheetId: string | null;
  sheetName: string | null;
  /** The Excel row number this record came from (as shown in Excel), null when added by hand. */
  sourceRow: number | null;

  // Person fields: shared by every record of the same candidate.
  fullName: string;
  email: string | null;
  phone: string | null;
  currentOrganization: string | null;
  currentDesignation: string | null;
  location: string | null;
  totalExpMonths: number | null;

  // Record fields.
  /** The role the candidate was sourced FOR (owner 2026-11-02). */
  role: string | null;
  candidateSource: string | null;
  /** YYYY-MM-DD */
  sourcingDate: string | null;
  relevantExpMonths: number | null;
  noticePeriodDays: number | null;
  /** Rupees per month, in hand (owner 2026-11-02). */
  currentInhand: number | null;
  expectedInhand: number | null;
  remark: string | null;
  status: RecordStatus;

  /** Has a meaning-search embedding. Records without one are still found by filters and keywords. */
  indexed: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Body of POST /api/candidates and PATCH /api/candidates/[id]. On PATCH every field is optional. */
export interface CandidateInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  currentOrganization?: string | null;
  currentDesignation?: string | null;
  location?: string | null;
  totalExpMonths?: number | null;
  role?: string | null;
  candidateSource?: string | null;
  sourcingDate?: string | null;
  relevantExpMonths?: number | null;
  noticePeriodDays?: number | null;
  currentInhand?: number | null;
  expectedInhand?: number | null;
  remark?: string | null;
  status?: RecordStatus;
}

export interface CandidateListResponse {
  records: CandidateRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export type SheetStatus = "importing" | "ready" | "failed";

export interface CandidateSheet {
  id: string;
  name: string;
  status: SheetStatus;
  error: string | null;
  /** Data rows read from the file on the last upload. */
  rowCount: number;
  /** Rows that had at least one data-quality problem (still imported unless skipped). */
  flaggedCount: number;
  /** Rows that could not be imported (e.g. no name). */
  skippedCount: number;
  /** 1 + number of merges into this sheet. */
  uploadCount: number;
  /** Records from this sheet that are not deleted. */
  liveRecordCount: number;
  /** Records from this sheet still being prepared for meaning search (HR sees it as a progress bar). */
  pendingIndexCount: number;
  uploadedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SheetsResponse {
  sheets: CandidateSheet[];
  /** Records in the whole organisation still waiting for an embedding. */
  pendingIndexTotal: number;
}

export type UploadMode = "new" | "replace" | "merge";

/** 201 from POST /api/candidates/sheets. */
export interface ImportSummary {
  sheet: CandidateSheet;
  mode: UploadMode;
  rowsRead: number;
  recordsAdded: number;
  recordsUpdated: number;
  rowsSkipped: number;
  /** Imported rows with at least one problem HR should review. */
  rowsFlagged: number;
  /** Imported rows whose only problems were fixed automatically (shown in "View issues", not counted as flagged). */
  rowsAutoFixed: number;
  newCandidates: number;
  matchedCandidates: number;
}

/** 409 from POST /api/candidates/sheets when a live sheet with the same file name exists and no mode was sent. */
export interface UploadConflict {
  conflict: {
    sheetId: string;
    name: string;
    liveRecordCount: number;
    uploadedAt: string;
  };
}

/** GET /api/candidates/sheets/[id]/issues */
export interface SheetIssueRow {
  rowNumber: number;
  /** Problems HR should review. Empty when the row only had automatic fixes. */
  issues: string[];
  /** What was fixed automatically, or resolved by HR (with or without an AI suggestion). */
  fixed: string[];
  /** Not imported (e.g. no name): fix it in the Excel file and upload again with Merge. */
  skipped: boolean;
  /** The record this row became (null when skipped or since deleted). */
  applicationId: string | null;
  raw: Record<string, string>;
}

/** Record fields the AI fix may suggest a value for. Person fields apply to every record of that person. */
export const AI_FIX_FIELDS = [
  "email",
  "phone",
  "currentOrganization",
  "currentDesignation",
  "location",
  "totalExpMonths",
  "role",
  "candidateSource",
  "sourcingDate",
  "relevantExpMonths",
  "noticePeriodDays",
  "currentInhand",
  "expectedInhand",
] as const;
export type AiFixField = (typeof AI_FIX_FIELDS)[number];

export const AI_FIX_FIELD_LABELS: Record<AiFixField, string> = {
  email: "Email",
  phone: "Phone",
  currentOrganization: "Current organisation",
  currentDesignation: "Current designation",
  location: "Location",
  totalExpMonths: "Total experience",
  role: "Role sourced for",
  candidateSource: "Candidate source",
  sourcingDate: "Sourcing date",
  relevantExpMonths: "Relevant experience",
  noticePeriodDays: "Notice period",
  currentInhand: "Current in-hand",
  expectedInhand: "Expected in-hand",
};

/** One suggested change. Values use the record's units: months, days, rupees per month, YYYY-MM-DD, or text. */
export interface AiFixChange {
  field: AiFixField;
  current: string | number | null;
  proposed: string | number | null;
  reason: string;
}

export interface AiFixProposal {
  rowNumber: number;
  applicationId: string;
  fullName: string;
  /** The row's "needs review" issues the suggestion is answering. */
  issues: string[];
  changes: AiFixChange[];
  /** Issues the AI could not fix from what the row says (HR decides). */
  cannotFix: string[];
}

/** POST /api/candidates/sheets/[id]/ai-fix */
export interface AiFixResponse {
  proposals: AiFixProposal[];
  /** The fix log id, sent back with the apply call so the log records what HR accepted. */
  logId: string | null;
  /** The model that answered, as the Control Center names it. */
  model: string | null;
  /** Rows that were asked for but cannot be fixed here (skipped rows, deleted records, no open issues). */
  notFixable: number[];
}

/** POST /api/candidates/sheets/[id]/ai-fix/apply: one row's approved changes ({} = "mark as reviewed" only). */
export interface AiFixApproval {
  rowNumber: number;
  changes: Partial<Record<AiFixField, string | number | null>>;
}

export interface AiFixApplyResponse {
  applied: number;
  /** Rows that could not be saved, with the reason. */
  failed: { rowNumber: number; error: string }[];
  /** The sheet's flagged-row count after this. */
  flaggedCount: number;
}

/** POST /api/candidates/bulk */
export interface BulkResponse {
  /** Records deleted (moved to deleted, or deleted permanently for "purge"). */
  records: number;
  /** People removed because they had no record left ("purge" only). */
  people: number;
}

/** POST /api/candidates/clear and DELETE /api/candidates/sheets/[id]?permanent=1 */
export interface PurgeResponse {
  sheets: number;
  records: number;
  people: number;
}

export type CriterionKey = "role" | "experience" | "domain" | "location" | "notice" | "salary";

export interface CriterionScore {
  key: CriterionKey;
  label: string;
  /** 0-100 */
  score: number;
  /** Share of the overall match, in percent; the weights of the scored criteria add up to 100. */
  weight: number;
}

export interface SearchResult {
  rank: number;
  record: CandidateRecord;
  /** 0-100. null when the AI ranking was unavailable and results are in search order. */
  matchPercent: number | null;
  criteria: CriterionScore[];
  /** Evidence from the record that supports the match. */
  reasons: string[];
  /** Information HR would need to check (not in the record). */
  missing: string[];
  /** One sentence. */
  summary: string;
}

export type ChipKind = "must" | "prefer" | "keyword";

export interface SearchResponse {
  results: SearchResult[];
  understood: {
    summary: string;
    chips: { kind: ChipKind; label: string }[];
  };
  topN: number;
  /** Records that passed the must-have filters. */
  matchingCount: number;
  /** Records the AI compared before picking the top N. */
  comparedCount: number;
  aiRanked: boolean;
  /** Plain-language notes, e.g. "AI ranking was busy, showing search order." */
  notices: string[];
  searchId: string | null;
}

/** POST /api/candidates/reindex: the Sheets page's quiet nudge to the background worker (always 200). */
export interface ReindexResponse {
  indexed: number;
  /** Still waiting (counted up to 500; -1 when unknown). */
  remaining: number;
  /** Nothing was done this time (paused after a busy answer, or another run is working). */
  waiting: boolean;
}
