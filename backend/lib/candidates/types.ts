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
  /** Records from this sheet still waiting for their meaning-search embedding. */
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
  rowsFlagged: number;
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
  issues: string[];
  raw: Record<string, string>;
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

/** POST /api/candidates/reindex */
export interface ReindexResponse {
  indexed: number;
  remaining: number;
}
