/**
 * Candidate Search: the shapes shared by the API routes (app/api/candidates) and the Tech console tab
 * (frontend/components/candidates). Type-only, plus a few constant lists, so client components can import it.
 *
 * Vocabulary:
 *   candidate = one person (deduplicated by email / phone inside an organisation)
 *   record    = one Excel row or one hand-added entry = one candidate_applications row. Search and the table work on records.
 *   sheet     = one uploaded Excel file (re-uploading the same file name asks Replace or Merge)
 */

import type { InferableField } from "./infer";
import type { SnippetPart } from "./snippet";

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
  /** The fields resumes will fill (migration 20261107000001). Only the filter panel loads them; absent before the migration. */
  extras?: CandidateExtras;
  /** A stored resume is linked to this candidate (migration 20261110000001). Absent before that migration. */
  hasResume?: boolean;
  /** The lines of the resume around the search keywords, keywords marked (filter search with keywords only). */
  resumeSnippet?: SnippetPart[];
  /**
   * Fields whose value was worked out from the employers the resume lists, not stated on it (owner 2026-11-11,
   * migration 20261111000004). The screens mark them; a value HR types in is no longer listed.
   */
  inferred?: InferableField[];
}

/** `candidate_source` of a candidate the system created from an uploaded resume (phase 4). */
export const RESUME_SOURCE = "Resume";

/** Where a record came from: a sheet, an uploaded resume, or typed in by someone. */
export type RecordOrigin = "sheet" | "resume" | "manual";
export function recordOrigin(record: Pick<CandidateRecord, "sheetId" | "sheetName" | "candidateSource">): RecordOrigin {
  if (record.sheetId || record.sheetName) return "sheet";
  return record.candidateSource === RESUME_SOURCE ? "resume" : "manual";
}
/** The sheet's name, "From resume" or "Added manually" (owner 2026-11-11). */
export function originLabel(record: Pick<CandidateRecord, "sheetId" | "sheetName" | "candidateSource">): string {
  const origin = recordOrigin(record);
  return origin === "sheet" ? record.sheetName ?? "A sheet" : origin === "resume" ? "From resume" : "Added manually";
}

/** Owner 2026-11-07: filled from resumes. A qualification of "none" means the CV shows none; null means not known. */
export interface CandidateExtras {
  industry: string | null;
  preferredLocations: string[];
  ugQualification: string | null;
  pgQualification: string | null;
  ppgQualification: string | null;
  institute: string | null;
  educationType: "full_time" | "part_time" | "correspondence" | null;
  degreeYear: number | null;
  careerBreak: boolean | null;
  defenceBackground: "army" | "navy" | "air_force" | "paramilitary" | null;
  servingNotice: boolean | null;
  /** Phase 4 (owner 2026-11-11): read from the resume by the model; empty before migration 20261111000002. */
  skills: string[];
  pastCompanies: PastCompany[];
  resumeSummary: string | null;
}

/** One employer read from a resume (phase 4). Dates as YYYY-MM or YYYY when the resume gives them. */
export interface PastCompany {
  company: string;
  designation: string | null;
  from: string | null;
  to: string | null;
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
  // What a resume fills (owner 2026-11-11: HR can correct these by hand). Person fields, shared by all their records.
  industry?: string | null;
  ugQualification?: string | null;
  pgQualification?: string | null;
  ppgQualification?: string | null;
  institute?: string | null;
  educationType?: CandidateExtras["educationType"];
  degreeYear?: number | null;
  skills?: string[];
  preferredLocations?: string[];
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
  /** Candidates with a record in this sheet who have a stored resume (phase 2); null before migration 20261110000001. */
  candidatesWithResume: number | null;
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

/** POST /api/candidates/sheets/[id]/discard: flagged rows deleted from "View issues". */
export interface AiFixDiscardResponse {
  /** Records moved to Deleted (restorable from the Candidates tab). */
  deleted: number;
  /** Rows whose issues were closed, so they left "Needs review" (also rows whose record was deleted earlier). */
  closed: number;
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
// Resume files (owner 2026-11-07, phase 1) --------------------------------------------------------------------------------

/** Phase 2 (owner 2026-11-10): has the file's text been read yet, and how was it linked to a candidate. */
/** 'scan' / 'scanning' (owner 2026-11-11): a PDF with no text layer, waiting for or being typed out by the model. */
export type ResumeTextStatus = "pending" | "working" | "ready" | "unreadable" | "failed" | "scan" | "scanning";
export type ResumeMatchReason = "email" | "phone" | "both" | "manual" | "detached" | "resume";
/** Phase 4: has the model read the details out of the file yet. */
export type ResumeExtractStatus = "pending" | "working" | "done" | "failed" | "skipped";

export const EXTRACT_STATUS_LABELS: Record<ResumeExtractStatus, string> = {
  pending: "Details soon",
  working: "Reading details",
  done: "Details read",
  failed: "Details failed",
  skipped: "",
};

export const TEXT_STATUS_LABELS: Record<ResumeTextStatus, string> = {
  pending: "Reading soon",
  working: "Reading",
  ready: "Read",
  unreadable: "Couldn't read",
  failed: "Couldn't read",
  scan: "Scan: reading soon",
  scanning: "Reading the scan",
};

export const MATCH_REASON_LABELS: Record<ResumeMatchReason, string> = {
  email: "Email",
  phone: "Phone",
  both: "Email and phone",
  manual: "Attached by HR",
  detached: "Detached by HR",
  resume: "Candidate created from this resume",
};

/** One stored resume file (GET /api/candidates/resumes). */
export interface ResumeFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** The file's modified date on the laptop: for a file in Downloads, the day it was downloaded. Null when unknown. */
  downloadedAt: string | null;
  /** The laptop name HR typed when uploading, if any. */
  deviceLabel: string | null;
  folderPath: string | null;
  uploadedByEmail: string | null;
  createdAt: string;
  /** Read, found not to be a resume, and removed (owner 2026-11-10): no bytes any more; textError says why. */
  removed: boolean;
  /** Read and kept as another document (a portfolio): never matched, out of the Excel; textError says why. */
  other: boolean;
  textStatus: ResumeTextStatus;
  extractStatus: ResumeExtractStatus;
  extractError: string | null;
  /** Why the text could not be read, in HR's words. */
  textError: string | null;
  /** The candidate this file belongs to, once matched or attached. */
  candidateId: string | null;
  candidateName: string | null;
  matchReason: ResumeMatchReason | null;
}

export interface ResumeFilesResponse {
  files: ResumeFile[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ResumeSummary {
  total: number;
  totalBytes: number;
  /** Per laptop: files, bytes, oldest / newest download, and when it last uploaded (phase 3's "since last time"). */
  devices: { label: string | null; count: number; bytes: number; oldest: string | null; newest: string | null; lastUploadedAt: string | null }[];
  oldest: string | null;
  newest: string | null;
  /** Phase 2: linked to a candidate / not linked / text still being read / text could not be read. */
  linked: number;
  unlinked: number;
  textPending: number;
  /** The part of textPending that is scanned PDFs waiting for the model to type them out. */
  scanPending: number;
  unreadable: number;
  /** Files read and removed as not resumes (not counted in `total`). */
  rejected: number;
  /** Files kept as other documents, e.g. portfolios (not counted in `total`). */
  other: number;
  /** Phase 4: resumes whose details the model has not read yet. */
  extractPending: number;
  /** The signed-in person's name, which their uploads are filed under (set by the summary route, owner 2026-11-11). */
  uploader?: string | null;
}

/** One answer per file sent to POST /api/candidates/resumes (prepare), in the order sent. */
export interface PreparedUpload {
  index: number;
  /** upload: send the bytes to signedUrl; duplicate: already stored (any laptop); rejected: see reason. */
  outcome: "upload" | "duplicate" | "rejected";
  id?: string;
  signedUrl?: string;
  /** The stored file type, from the extension; the browser sends the bytes with it. */
  contentType?: string;
  reason?: string;
}

export interface ResumeConfirmResponse {
  ready: string[];
  /** Ids whose bytes never reached storage (the browser retries those). */
  missing: string[];
}

export interface ResumeLinksResponse {
  links: { id: string; url: string; fileName: string }[];
}

export interface ResumeManifestResponse {
  files: { id: string; fileName: string; fileSize: number; downloadedAt: string | null }[];
  /** True when more files matched than the export limit. */
  truncated: boolean;
}

export interface ReindexResponse {
  indexed: number;
  /** Still waiting (counted up to 500; -1 when unknown). */
  remaining: number;
  /** Nothing was done this time (paused after a busy answer, or another run is working). */
  waiting: boolean;
}
