/**
 * Candidate Search: the shapes shared by the API routes (app/api/candidates) and the Tech console tab
 * (frontend/components/candidates). Type-only, plus a few constant lists, so client components can import it.
 *
 * Vocabulary:
 *   candidate = one person (deduplicated by email / phone inside an organisation)
 *   record    = one Excel row or one hand-added entry = one candidate_applications row. Search and the table work on records.
 *   sheet     = one uploaded Excel file (re-uploading the same file name asks Replace or Merge)
 */

import type { SearchFilters } from "./filters";
import type { InferableField } from "./infer";
import type { Preferences } from "./query-spec";
import type { SnippetPart } from "./snippet";

// Positions and their pipelines (owner 2026-11-15; the logic is in positions.ts, which is server-only: these constants
// and shapes live here so the client components can import them without pulling the model transport in).
export const FLOW_STAGES = ["sourced", "screening", "shortlisted", "interview", "offer", "joined"] as const;
export const SIDE_STAGES = ["on_hold", "not_responding", "rejected", "others"] as const;
export const STAGES = [...FLOW_STAGES, ...SIDE_STAGES] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  sourced: "Sourced",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  joined: "Joined",
  on_hold: "On hold",
  not_responding: "Not responding",
  rejected: "Rejected",
  others: "Others",
};
/** Stages a person must explain with a remark when they move someone there. */
export const STAGE_REMARK_REQUIRED: readonly Stage[] = ["others"];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};
export const POSITION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type PositionPriority = (typeof POSITION_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<PositionPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export interface Position {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  jdFileName: string | null;
  /** Only on a single position (get), not on the list. */
  jdText?: string | null;
  filters: Partial<SearchFilters>;
  prefer: Preferences;
  status: "open" | "closed";
  targetDays: number;
  // Owner 2026-11-16: the job as a record (migration 20261116000005). Defaults before it is applied.
  designation: string | null;
  employmentType: EmploymentType | null;
  openings: number;
  hiringManager: string | null;
  priority: PositionPriority;
  /** "MBA preferred", "B.E. Electrical": free text. */
  education: string | null;
  /** Rupees per month in hand. */
  budgetMinInhand: number | null;
  budgetMaxInhand: number | null;
  /** The role in 2–3 sentences, from the JD and edited by HR. */
  summary: string | null;
  /** The recruiter's name (the person who saved it, unless changed); null when unknown. */
  recruiterName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Days since it was opened (until it was closed). */
  daysOpen: number;
  counts: Record<Stage, number>;
  /** The library JD it was opened from (owner 2026-11-17); null when none, absent before migration 20261117000002. */
  jd?: PositionJd | null;
}

/**
 * What the Create / Edit position form holds (owner 2026-11-16): the job's details and its requirements as HR sees
 * them. The AI fills it from a JD (POST /api/candidates/positions/read); position-draft.ts turns it into the search
 * filters the position runs with. Years, days and rupees per month, as typed.
 */
export interface PositionDraft {
  title: string;
  department: string | null;
  designation: string | null;
  location: string | null;
  employmentType: EmploymentType | null;
  openings: number | null;
  hiringManager: string | null;
  priority: PositionPriority;
  targetDays: number | null;
  education: string | null;
  budgetMinInhand: number | null;
  budgetMaxInhand: number | null;
  summary: string | null;
  expMinYears: number | null;
  expMaxYears: number | null;
  noticeMaxDays: number | null;
  /** Each must-have with the spellings CVs use for it; a record needs any one of them. */
  mustHaves: { text: string; alts: string[] }[];
  niceToHaves: string[];
  /** Software and tools named by the JD (CRM, Excel, AutoCAD); nice-to-haves in the search. */
  tools: string[];
  prefer: Preferences;
  jdText: string;
  jdFileName: string | null;
}

/**
 * The JD library (owner 2026-11-17; migration 20261117000002): one job description per role, every saved text kept as
 * a numbered version, and the version each position was opened from.
 */
export interface JdSummary {
  id: string;
  title: string;
  department: string | null;
  currentVersion: number;
  /** The first lines of the current text, for the list. */
  preview: string;
  updatedAt: string;
  updatedByName: string | null;
  lastUsedAt: string | null;
  /** Positions opened from this JD (any version). */
  positions: number;
}
export interface JdVersion {
  version: number;
  content: string;
  fileName: string | null;
  note: string | null;
  byName: string | null;
  at: string;
}
export interface JdDetail extends JdSummary {
  /** Newest first. */
  versions: JdVersion[];
  /** The positions opened from it, with the version each used. */
  usedBy: { positionId: string; title: string; version: number; status: "open" | "closed" }[];
}
/** What a position records about the library JD it came from. */
export interface PositionJd {
  id: string;
  title: string;
  version: number;
  currentVersion: number;
}

/** POST /api/candidates/positions/read: the draft the AI filled from a JD, for HR to check. */
export interface PositionReadResponse {
  draft: PositionDraft;
  aiParsed: boolean;
  /** Plain-language notes ("only the first N characters were read", "the JD gives two values for experience"). */
  notices: string[];
}

export interface PositionMember {
  id: string;
  positionId: string;
  candidateId: string;
  applicationId: string | null;
  stage: Stage;
  stageChangedAt: string;
  /** Who moved them last (who added them, until the first move); null when unknown. */
  stageChangedByName: string | null;
  remark: string | null;
  addedAt: string;
  /** The person's record, when the record they were added from still exists. */
  record: CandidateRecord | null;
}

export const RECORD_STATUSES = [
  "new",
  "in_process",
  "shortlisted",
  "interview",
  "on_hold",
  "not_responding",
  "rejected",
  "joined",
  // Owner 2026-11-15: anything the list above does not cover; the app requires a remark saying what (migration 20261115000002).
  "others",
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
  others: "Others",
};

/** Statuses a person must explain with a remark when they choose them. */
export const REMARK_REQUIRED_STATUSES: readonly RecordStatus[] = ["others"];

/** Why a person was blacklisted (owner 2026-11-15); the dropdown's fixed list, so reports stay usable. */
export const BLACKLIST_REASONS = ["did_not_join", "misconduct", "false_information", "asked_not_to_contact", "other"] as const;
export type BlacklistReason = (typeof BLACKLIST_REASONS)[number];
export const BLACKLIST_REASON_LABELS: Record<BlacklistReason, string> = {
  did_not_join: "Accepted an offer, did not join",
  misconduct: "Misconduct",
  false_information: "False information or documents",
  asked_not_to_contact: "Asked not to be contacted",
  other: "Other",
};

/** A person's blacklist entry, when there is one. */
export interface Blacklist {
  at: string;
  byName: string | null;
  reason: BlacklistReason;
  remark: string | null;
}

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
   * Where each keyword chip matched (owner 2026-11-15): on the record's own fields, in the resume's text, or both.
   * `text` is the spelling that matched (one of a chip's alternatives). Only with keywords, after the resume
   * migrations.
   */
  keywordHits?: { text: string; required: boolean; where: "profile" | "resume" | "both" }[];
  /**
   * The person is blacklisted (owner 2026-11-15, migration 20261115000002): hidden from search unless asked for. Set
   * on lists; the panel's full entry is `blacklist`. Absent before the migration.
   */
  blacklisted?: boolean;
  /** The blacklist entry itself, loaded for the panel. null = not blacklisted; absent = not loaded. */
  blacklist?: Blacklist | null;
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
  /** Where the sheet came from (owner 2026-11-16); null when the upload did not say. */
  sourceKind: SourceKind | null;
  sourceName: string | null;
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
  /** Rows whose person was already in the database before this upload (owner 2026-11-16): kept, and noted on the row. */
  alreadyKnownRows: number;
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
  /** Where the upload said it came from (owner 2026-11-16); null when it did not say. */
  sourceKind: SourceKind | null;
  sourceName: string | null;
  /** 'pending': a second CV for this person, waiting for HR (Update the CV or delete it); 'updated': HR made it the CV. */
  duplicateState: "pending" | "updated" | null;
  /** Filled for a pending duplicate. */
  alreadyKnown: AlreadyKnown | null;
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
  /** duplicate: the copy already stored, so the upload summary can say whose it is (owner 2026-11-16). */
  existing?: { fileName: string; candidateName: string | null; uploadedAt: string | null; uploadedBy: string | null };
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

// Calls (owner 2026-11-16, plan P3 + P7; migration 20261116000001) -----------------------------------------------------

export type CallInputKind = "audio" | "transcript";
/** uploading -> uploaded -> transcribing -> analysing -> done | failed. A pasted transcript starts at 'uploaded'. */
export type CallStatus = "uploading" | "uploaded" | "transcribing" | "analysing" | "done" | "failed";
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  uploading: "Uploading",
  uploaded: "Waiting",
  transcribing: "Transcribing",
  analysing: "Reading the call",
  done: "Analysed",
  failed: "Failed",
};

export type CallSentiment = "positive" | "neutral" | "negative";
export type CallConfidence = "high" | "medium" | "low";
export type CallInterest = "high" | "medium" | "low" | "unclear";
export const CALL_CONCERN_TOPICS = ["salary", "location", "commute", "notice", "shift", "role", "growth", "stability", "other"] as const;
export type CallConcernTopic = (typeof CALL_CONCERN_TOPICS)[number];
export const CALL_CONCERN_LABELS: Record<CallConcernTopic, string> = {
  salary: "Salary",
  location: "Location",
  commute: "Commute",
  notice: "Notice period",
  shift: "Shift timing",
  role: "The role",
  growth: "Growth",
  stability: "Stability",
  other: "Other",
};

/** One thing the candidate said, with the words it came from and (when the transcript is stamped) when. */
export interface CallEvidence {
  quote: string | null;
  /** Seconds into the call; null for a pasted transcript. */
  at: number | null;
}
export interface CallFact<T> extends CallEvidence {
  /** null = not said on the call. Never guessed. */
  value: T | null;
}

/**
 * How a pay figure was said (owner 2026-11-17, the CTC fix): "in_hand" = take-home per month; "ctc" = cost to
 * company (LPA, package), so `value` is the yearly figure / 12, NOT take-home; "unclear" = the call does not say.
 * Only an in-hand figure is a straight fit for the record's in-hand fields.
 */
export const PAY_BASES = ["in_hand", "ctc", "unclear"] as const;
export type PayBasis = (typeof PAY_BASES)[number];
export interface PayFact extends CallFact<number> {
  /** Absent on calls read before 2026-11-17 (they were all read as in-hand). */
  basis?: PayBasis;
}

/** Which round a call was for (owner 2026-11-17; migration 20261117000001). Interview rounds are read for answers too. */
export const CALL_ROUNDS = ["screening", "round_1", "round_2", "round_3", "hr_offer"] as const;
export type CallRound = (typeof CALL_ROUNDS)[number];
export const CALL_ROUND_LABELS: Record<CallRound, string> = {
  screening: "Screening",
  round_1: "Interview round 1",
  round_2: "Interview round 2",
  round_3: "Interview round 3",
  hr_offer: "HR / offer discussion",
};
export const isInterviewRound = (round: CallRound | null | undefined): boolean => round === "round_1" || round === "round_2" || round === "round_3";

/** How one answer covered a topic the round asked about (interview rounds): judged on what was said, never on delivery. */
export const ANSWER_VERDICTS = ["clear", "partial", "weak"] as const;
export type AnswerVerdict = (typeof ANSWER_VERDICTS)[number];
export const ANSWER_VERDICT_LABELS: Record<AnswerVerdict, string> = { clear: "Shown clearly", partial: "Partly shown", weak: "Weak" };

/** The facts the model listens for, and the record fields "Apply" writes them to. */
export const CALL_FACT_KEYS = ["currentInhand", "expectedInhand", "noticePeriodDays", "location", "reasonForChange"] as const;
export type CallFactKey = (typeof CALL_FACT_KEYS)[number];
export const CALL_FACT_LABELS: Record<CallFactKey, string> = {
  currentInhand: "Current in-hand",
  expectedInhand: "Expected in-hand",
  noticePeriodDays: "Notice period",
  location: "Location",
  reasonForChange: "Reason for change",
};

/** What the model read out of one call (backend/lib/callInsights/contexts/candidateScreening.ts). Advisory only. */
export interface CallInsights {
  overallSentiment: CallSentiment;
  sentimentConfidence: CallConfidence;
  interestLevel: CallInterest;
  summary: string;
  suggestedNextStep: string;
  /** In order, start to end. Seconds are set when the transcript was stamped; `share` (1–10) is the rough length. */
  timeline: { sentiment: CallSentiment; note: string; startSeconds: number | null; endSeconds: number | null; share: number }[];
  concerns: ({ topic: CallConcernTopic; note: string } & CallEvidence)[];
  redFlags: ({ note: string } & CallEvidence)[];
  facts: {
    currentInhand: PayFact;
    expectedInhand: PayFact;
    noticePeriodDays: CallFact<number>;
    location: CallFact<string>;
    reasonForChange: CallFact<string>;
  };
  language: string;
  /**
   * Interview rounds only (owner 2026-11-17): each topic asked about, how the answer covered it, with the quote; the
   * position's must-haves that never came up; questions for the next round. Empty on a screening call.
   */
  answers?: ({ topic: string; verdict: AnswerVerdict; note: string } & CallEvidence)[];
  notCovered?: string[];
  nextRoundQuestions?: string[];
}

export interface CallSegment {
  start: number;
  end: number;
  text: string;
}

/** One call on a candidate (GET /api/candidates/calls). The transcript comes only with a single call (get). */
export interface CallAnalysis {
  id: string;
  candidateId: string;
  applicationId: string | null;
  positionId: string | null;
  positionTitle: string | null;
  /** Which round the call was for; null = added before 20261117000001 (shown as Screening). */
  round: CallRound | null;
  inputKind: CallInputKind;
  fileName: string | null;
  fileSize: number | null;
  /** YYYY-MM-DD */
  calledOn: string | null;
  consentConfirmed: boolean;
  status: CallStatus;
  /** Why it failed, in HR's words. */
  error: string | null;
  attempts: number;
  language: string | null;
  durationSeconds: number | null;
  /** Only on a single call. */
  segments?: CallSegment[] | null;
  transcriptText?: string | null;
  result: CallInsights | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Facts HR already applied from this call. */
  appliedFacts: { key: CallFactKey; at: string; byName: string | null }[];
  byName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/candidates/calls with a file: the row and the one-time upload link. */
export interface PreparedCall {
  call: CallAnalysis;
  upload: { signedUrl: string; contentType: string } | null;
}

// Outreach (owner 2026-11-16, mockup board 7; migration 20261116000003) --------------------------------------------------

export const OUTREACH_KINDS = ["shortlisted", "not_shortlisted"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];
export const OUTREACH_KIND_LABELS: Record<OutreachKind, string> = {
  shortlisted: "Shortlisted",
  not_shortlisted: "Not shortlisted",
};

/** What the Send panel shows before anyone clicks Send (GET /api/candidates/outreach/preview). */
export interface OutreachPreview {
  kind: OutreachKind;
  candidateId: string;
  applicationId: string;
  positionId: string | null;
  positionTitle: string | null;
  /** The role the message names: the position's title, else the record's "sourced for" role. */
  roleTitle: string | null;
  /** The number it would go to, with the middle hidden. */
  phoneMasked: string | null;
  /** The template (= AiSensy campaign) that would be used. */
  campaign: string;
  /** The message as the candidate would read it, with the name and role filled in. */
  message: string;
  footer: string;
  checks: {
    notBlacklisted: boolean;
    phoneValid: boolean;
    notSentBefore: boolean;
    roleNamed: boolean;
    /** 9 am to 7 pm IST, Monday to Saturday. A warning, not a block. */
    withinHours: boolean;
  };
  /** Every blocking check passed. */
  canSend: boolean;
  /** Why not, in one sentence, when canSend is false. */
  blockedBy: string | null;
  /** The earlier successful send of this kind for this position, if any. */
  sentBefore: { at: string; byName: string | null } | null;
}

// Where an upload came from, and "already in the database" (owner 2026-11-16; migration 20261116000004) ------------------

export const SOURCE_KINDS = ["own", "naukri", "portal", "vendor"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  own: "Our own search",
  naukri: "Naukri",
  portal: "Job portal",
  vendor: "Vendor",
};

/**
 * The same CV file uploaded again by someone else (owner 2026-11-16): not stored twice, but listed in "Already in the
 * database" with who uploaded it first and who again, until dismissed.
 */
export interface ResumeRepeat {
  id: string;
  fileId: string;
  fileName: string;
  candidateId: string | null;
  candidateName: string | null;
  /** Who uploaded the same file again, and when. */
  againBy: string | null;
  againAt: string;
  /** Who uploaded it first, and when. */
  firstBy: string | null;
  firstAt: string | null;
}
/** Optional on every upload: who sent these resumes or this sheet. */
export interface UploadSource {
  kind: SourceKind | null;
  /** The vendor's or portal's name. */
  name: string | null;
}

/**
 * A second CV for a person who already had one (owner 2026-11-16): how the person was first sourced, and the CV that
 * was on file before this one. A CV that only meets its own sheet row is not flagged.
 */
export interface AlreadyKnown {
  /** YYYY-MM-DD */
  sourcedAt: string | null;
  /** The sheet it came from, "a resume", or "added by hand". */
  sourcedFrom: string | null;
  sourcedBy: string | null;
  /** The CV on file before this one (the latest earlier upload). */
  previous: { id: string; fileName: string; uploadedAt: string | null; uploadedBy: string | null } | null;
}

/** One attempt (GET /api/candidates/outreach, newest first). */
export interface OutreachRecord {
  id: string;
  candidateId: string;
  applicationId: string | null;
  positionId: string | null;
  positionTitle: string | null;
  kind: OutreachKind;
  phoneMasked: string;
  campaign: string;
  roleTitle: string | null;
  status: "sent" | "failed";
  error: string | null;
  byName: string | null;
  at: string;
}
