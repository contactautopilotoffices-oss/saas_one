/**
 * Which files in a chosen folder are offered as resumes (owner 2026-11-07, phase 1). Pure, so the browser, the server
 * and the tests share it: a PDF or Word file, within the size limit, downloaded inside the date range, and not named
 * like an invoice, ID proof or pay slip. Anything else is listed unticked; HR can still tick it. Nothing here reads
 * the file's contents.
 *
 * The limits the browser also needs live here (config.ts re-exports them for the server), because config.ts pulls in
 * server-only settings.
 */

/** Same as the bucket's file_size_limit in migration 20261107000002. */
export const MAX_RESUME_BYTES = 15 * 1024 * 1024;
/** Files per prepare / confirm call: one request per batch keeps the calls few even for thousands of files. */
export const RESUME_BATCH = 50;
/** Files per download-links call (the ZIP download asks for links in batches). */
export const RESUME_LINK_BATCH = 100;

export const RESUME_EXTENSIONS = [".pdf", ".docx", ".doc"] as const;
export const RESUME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function fileExtension(name: string): string {
  const m = /\.[a-z0-9]+$/i.exec(name.trim());
  return m ? m[0].toLowerCase() : "";
}

export function isResumeType(name: string): boolean {
  return (RESUME_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

export type PickVerdict = "ok" | "type" | "size" | "date" | "name";

export const PICK_LABELS: Record<PickVerdict, string> = {
  ok: "Resume",
  type: "Not a PDF or Word file",
  size: "Larger than 15 MB",
  date: "Outside the dates",
  name: "Looks like another document",
};

/**
 * Names that are almost never a resume: a match only unticks the file; HR can tick it back. Also the long random codes
 * job portals put in front of a file name ("623c607b64039647485013_GET_JD_…"). What slips through is caught after the
 * text is read (resume-text.ts, looksLikeResume).
 */
const NOT_A_RESUME =
  /(^|[^a-z])(invoice|receipt|statement|bill|ticket|boarding|aadha?ar|pan[ _-]?card|passport|form[ _-]?16|pay[ _-]?slip|salary[ _-]?slip|offer|appointment[ _-]?letter|agreement|contract|policy|brochure|menu|quotation|quote|proforma|purchase[ _-]?order|gst|itr|marksheet|mark[ _-]?sheet|presentation|minutes|jd|job[ _-]?description|get[ _-]?jd)([^a-z]|$)|^[0-9a-f]{16,}[_-]/i;

export interface PickFile {
  name: string;
  size: number;
  /** Milliseconds since the epoch: the file's modified date on the laptop (File.lastModified). */
  lastModified: number;
}

export function pickVerdict(file: PickFile, range: { from: number; to: number }, maxBytes = MAX_RESUME_BYTES): PickVerdict {
  if (!isResumeType(file.name)) return "type";
  if (!(file.size > 0) || file.size > maxBytes) return "size";
  if (!Number.isFinite(file.lastModified) || file.lastModified < range.from || file.lastModified > range.to) return "date";
  if (NOT_A_RESUME.test(file.name)) return "name";
  return "ok";
}

/** 1 January of this year to the end of today, local time: the files downloaded this year. */
export function thisYearRange(now = new Date()): { from: number; to: number } {
  return {
    from: new Date(now.getFullYear(), 0, 1).getTime(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime(),
  };
}

/** Owner 2026-11-10: the laptops are named after the HR team members who use them (a dropdown, not typed). */
export const RESUME_LAPTOPS = ["Roohi Idrishi", "Sanil Parab", "Neeti Upadhyay", "Shwetha Gowda", "Srushti Madhani"] as const;

/** A day of overlap on "since the last upload": two files downloaded the same day, one of them picked later. */
export const UPLOAD_OVERLAP_MS = 24 * 60 * 60 * 1000;
/** The sidebar reminds a laptop that has not uploaded for this many days (phase 3). */
export const RESUME_REMIND_AFTER_DAYS = 7;

/**
 * Phase 3 (owner 2026-11-10): the files to tick on this laptop's next upload. With a previous upload, from a day before
 * the newest download already uploaded; on a laptop's first run, this year. Files already stored are skipped anyway.
 */
export function sinceLastUpload(newestUploadedDownload: string | null, now = new Date()): { from: number; to: number } {
  const newest = newestUploadedDownload ? new Date(newestUploadedDownload).getTime() : NaN;
  if (!Number.isFinite(newest)) return thisYearRange(now);
  return { from: newest - UPLOAD_OVERLAP_MS, to: thisYearRange(now).to };
}

/** Whole days since a date (0 when today or unknown), for the reminder badge. */
export function daysSince(iso: string | null, now = new Date()): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000)));
}
