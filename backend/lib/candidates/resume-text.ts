/**
 * Resume text and matching (owner 2026-11-10, phase 2). No AI here.
 *
 * Who runs it: the cron /api/cron/candidate-indexing every minute (every organisation with files waiting), and right
 * after an upload batch is confirmed (after()). Per run, within its time budget:
 *   claim up to RESUME_TEXT_BATCH stored files whose text has not been read -> download -> read the text with the
 *   installed readers (unpdf, mammoth) -> keep the emails and phones found -> link the file to the candidate with the
 *   same email (first) or phone (same keys the sheet import de-duplicates by)
 * A PDF with no text layer (a scan) is handed to the scan reader (resume-scan.ts, owner 2026-11-11); an old .doc is
 * marked unreadable and left for HR to attach by hand; a read that keeps failing for another reason is given up
 * after RESUME_TEXT_MAX_ATTEMPTS. Nothing here ever fails a request.
 *
 * Matching runs both ways: new files against existing candidates, and (linkUnmatched, called after a sheet import or
 * an edit) existing files against new or changed candidates. A file HR detached is never linked automatically again.
 * Needs migration 20261110000001 (until then a run does nothing and logs why once).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DocumentError, extractText } from "@/backend/lib/hr-assistant/extract-text";

import {
  RESUME_LINK_PAGE, RESUME_TEXT_BATCH, RESUME_TEXT_BUDGET_MS, RESUME_TEXT_MAX_ATTEMPTS, RESUME_TEXT_MAX_CHARS, RESUME_TEXT_MAX_INFLIGHT,
  RESUME_TEXT_PARALLEL, RESUME_TEXT_STALE_MINUTES,
} from "./config";
import { parsePhone } from "./normalize";
import { CandidateActionError } from "./records";
import { resumeStorage, type ResumeStorage } from "./resumes";
import type { ResumeMatchReason } from "./types";

const TABLE = "candidate_resume_files";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stop starting a new file this close to the end of the budget. */
const SAFETY_MS = 3_000;

export type TextReader = (data: Uint8Array, fileName: string) => Promise<string>;

export interface ResumeTextOptions {
  budgetMs?: number;
  /** Tests pass a scripted reader. */
  read?: TextReader;
  now?: () => number;
  /** The cron's bucket (tests pass a fake); defaults to the client's. */
  storage?: ResumeStorage;
  /** Files mid-read across all runs before this run stands aside (tests lower it). */
  maxInflight?: number;
}

export interface ResumeTextResult {
  read: number;
  unreadable: number;
  /** PDFs with no text layer, handed to the scan reader. */
  scans: number;
  failed: number;
  /** Read, found not to be resumes, and removed (the row stays so the file is not uploaded again). */
  rejected: number;
  /** Read and kept as other documents (portfolios). */
  other: number;
  linked: number;
  /** Files still waiting to be read (-1 when unknown). */
  remaining: number;
  /** Enough other runs are reading this organisation's files already; this one did nothing. */
  waiting: boolean;
}

export function linksMigrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "");
}

let warnedMissing = false;
function warnMissing(error: unknown) {
  if (warnedMissing) return;
  warnedMissing = true;
  console.error("[candidates] resume text needs migration 20261110000001_candidate_resume_links.sql", message(error));
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  const m = (error as { message?: unknown })?.message;
  return typeof m === "string" ? m : String(error);
}

// Contacts in the text ------------------------------------------------------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/** An Indian mobile as resumes write it: optional +91 / 0, spaces, dots or dashes between digits; not part of a longer number. */
const PHONE_RE = /(?<!\d)(?:\+?91[\s.-]*)?(?:\(?0\)?[\s.-]*)?[6-9](?:[\s.-]?\d){9}(?!\d)/g;
const MAX_CONTACTS = 10;

/** The email addresses (lower case) and 10-digit mobile keys found in a resume's text, in the order found. */
export function contactsInText(text: string): { emails: string[]; phones: string[] } {
  const emails = new Set<string>();
  for (const found of text.match(EMAIL_RE) ?? []) {
    if (emails.size >= MAX_CONTACTS) break;
    emails.add(found.toLowerCase().replace(/^[._-]+/, ""));
  }
  const phones = new Set<string>();
  for (const found of text.match(PHONE_RE) ?? []) {
    if (phones.size >= MAX_CONTACTS) break;
    const key = parsePhone(found).key;
    if (key) phones.add(key);
  }
  return { emails: [...emails], phones: [...phones] };
}

// Is it a resume? ------------------------------------------------------------------------------------------------------

/** Words a resume has (each counts once). */
const RESUME_WORDS = [
  /\bexperience\b/, /\beducation\b/, /\bskills?\b/, /\bqualifications?\b/, /\bwork history\b/, /\bcareer\b/, /\bobjective\b/,
  /\bprofile\b/, /\bsummary\b/, /\bcertifications?\b/, /\bprojects?\b/, /\blanguages?\b/, /\bhobbies\b/, /\bdeclaration\b/,
  /\bdate of birth\b|\bdob\b/, /\bnationality\b/, /\bmarital\b/, /\bcurriculum vitae\b|\bresume\b|\bbio-?data\b/, /\bachievements?\b/,
  /\bpresent\b|\btill date\b/, /\binternship\b/, /\bgraduat/,
];
/** Words of a job description, an invoice or another document, with a weight: the strong ones rarely appear in a resume. */
const OTHER_WORDS: [RegExp, number][] = [
  [/\bjob description\b/, 2], [/\bwe are (?:looking|hiring|seeking)\b/, 2], [/\bthe ideal candidate\b/, 2], [/\bcandidates? (?:should|must|will|who)\b/, 2],
  [/\babout (?:the )?(?:company|role|us)\b/, 2], [/\bjob (?:title|type|location|summary|role|id|code)\b/, 2], [/\bapply (?:now|here|at|to)\b|\bhow to apply\b/, 2],
  [/\bopenings?\b|\bvacanc(?:y|ies)\b/, 2], [/\bwhat you(?:'|’)?ll do\b|\bwhat you will do\b|\bwhat we offer\b/, 2], [/\bno\.? of positions\b|\bnumber of positions\b/, 2],
  [/\brequirements?\b/, 1], [/\bresponsibilities\b/, 1], [/\bctc\b/, 1], [/\bnotice period\b/, 1],
  [/\binvoice\b/, 2], [/\bgstin?\b/, 2], [/\btotal amount\b|\bamount due\b|\bgrand total\b/, 2], [/\bbill to\b/, 2], [/\breceipt\b/, 1],
  [/\bterms (?:and|&) conditions\b/, 2], [/\bagreement\b/, 1], [/\bboarding pass\b|\bpnr\b/, 2], [/\bpurchase order\b/, 2],
  [/\baccount (?:number|no)\b|\bstatement period\b/, 2], [/\bdear (?:sir|madam|team|candidate)\b/, 1],
];

/** Design-template headings come out letter-spaced ("E D U C A T I O N", "S K I L L S"); join them so the words match. */
function joinSpacedLetters(text: string): string {
  return text.replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (run) => run.replace(/ /g, ""));
}

/** A designer's portfolio or a project showcase: kept as "other" (owner 2026-11-11), not removed, never matched. */
const PORTFOLIO_RE = /\bportfolio\b|\bdesign vision\b|\bcase stud(?:y|ies)\b|\bmock-?ups?\b|\btypography\b|\bcolou?r palette\b|\bbranding\b|\bui\s*\/?\s*ux\b|\bwireframes?\b|\blogo design\b|\bshowcase\b|\bart direction\b/;

export type ResumeVerdict = "resume" | "other" | "reject";

/**
 * Whether a file's text reads like a resume (owner 2026-11-10: files that do not are removed by themselves; owner
 * 2026-11-11: portfolios are kept as other documents). Deterministic and conservative: a resume has contact details and
 * a few resume words, and not more job-description / invoice words than resume words; without contact details it needs
 * clearly more. The reason is what HR sees for a removed or kept-aside file.
 */
export function looksLikeResume(text: string, contacts: { emails: string[]; phones: string[] }): { verdict: ResumeVerdict; reason: string | null } {
  const t = joinSpacedLetters(text).toLowerCase();
  const resumeHits = RESUME_WORDS.filter((re) => re.test(t)).length;
  const otherScore = OTHER_WORDS.reduce((n, [re, weight]) => n + (re.test(t) ? weight : 0), 0);
  const hasContact = contacts.emails.length + contacts.phones.length > 0;
  if (hasContact && resumeHits >= 2 && otherScore <= resumeHits) return { verdict: "resume", reason: null };
  // Both an email and a mobile, nothing document-like, and at least one resume word: a job description or an invoice
  // almost never carries a person's mobile and email together (seen on the owner's 50-file sample, 2026-11-11).
  if (contacts.emails.length && contacts.phones.length && resumeHits >= 1 && otherScore === 0) return { verdict: "resume", reason: null };
  if (!hasContact && resumeHits >= 4 && otherScore <= 1) return { verdict: "resume", reason: null };
  if (otherScore <= 1 && PORTFOLIO_RE.test(t)) return { verdict: "other", reason: "Other document (kept, not matched): reads like a portfolio" };
  const why = hasContact ? `only ${resumeHits} resume ${resumeHits === 1 ? "word" : "words"}` : "no email or phone";
  const kind = /\bjob description\b|\bwe are (?:looking|hiring|seeking)\b|\bthe ideal candidate\b|\bopenings?\b/.test(t)
    ? "reads like a job description"
    : /\binvoice\b|\bgstin?\b|\btotal amount\b|\bbill to\b|\breceipt\b/.test(t)
      ? "reads like an invoice or receipt"
      : otherScore >= 2
        ? "reads like another document"
        : "does not read like a resume";
  return { verdict: "reject", reason: `Not a resume: ${why}; ${kind}` };
}

/** What HR reads in the list for a file that could not be read. */
function unreadableReason(error: DocumentError, fileName: string): string {
  if (/Unsupported file type/.test(error.message) && /\.doc$/i.test(fileName)) {
    return "Old Word format (.doc): save it as .docx or PDF to read it";
  }
  if (/No text found/.test(error.message)) return "No text in the file (a scanned image); attach it to a candidate by hand";
  return error.message;
}

// Reading --------------------------------------------------------------------------------------------------------------

interface ClaimedRow {
  id: string;
  file_name: string;
  storage_path: string;
  text_attempts: number | string;
}

/** One organisation, within the time budget. Never throws. */
export async function processResumeText(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  options: ResumeTextOptions = {},
): Promise<ResumeTextResult> {
  const now = options.now ?? Date.now;
  const read = options.read ?? extractText;
  const deadline = now() + (options.budgetMs ?? RESUME_TEXT_BUDGET_MS.afterUpload);
  const result: ResumeTextResult = { read: 0, unreadable: 0, scans: 0, failed: 0, rejected: 0, other: 0, linked: 0, remaining: -1, waiting: false };

  // A run that died mid-file left rows at 'working'; after a while they are waiting again.
  const stale = new Date(now() - RESUME_TEXT_STALE_MINUTES * 60_000).toISOString();
  const reset = await client.from(TABLE).update({ text_status: "pending" }).eq("organization_id", orgId).eq("text_status", "working").lt("updated_at", stale);
  if (reset.error) {
    if (linksMigrationMissing(reset.error)) warnMissing(reset.error);
    else console.error("[candidates] resume text: reset failed", message(reset.error));
    return result;
  }

  // Several runs read side by side (the cron, after-upload bursts, the page's nudges); files mid-read sit at 'working'.
  // Past the cap this run stands aside, so a burst of uploads cannot swamp storage or the database.
  const inflight = await client
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("text_status", "working")
    .gte("updated_at", stale);
  if (inflight.error) {
    console.error("[candidates] resume text: counting runs failed", message(inflight.error));
    return result;
  }
  if ((inflight.count ?? 0) >= (options.maxInflight ?? RESUME_TEXT_MAX_INFLIGHT)) {
    result.waiting = true;
    result.remaining = await countWaiting(client, orgId);
    return result;
  }

  // One try per file per run (a failed read goes back to waiting for the next run, like the indexing worker).
  const attempted = new Set<string>();
  while (now() < deadline - SAFETY_MS) {
    let list = client
      .from(TABLE)
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "ready")
      .eq("text_status", "pending")
      .order("created_at")
      .limit(RESUME_TEXT_BATCH);
    if (attempted.size) list = list.not("id", "in", `(${[...attempted].join(",")})`);
    const waiting = await list;
    if (waiting.error) {
      console.error("[candidates] resume text: listing failed", message(waiting.error));
      break;
    }
    const ids = (waiting.data ?? []).map((r) => r.id as string);
    if (!ids.length) break;

    // Claim them: another run (the cron and an after-upload run can overlap) takes only what is still pending.
    const claimed = await client
      .from(TABLE)
      .update({ text_status: "working", updated_at: new Date(now()).toISOString() })
      .eq("organization_id", orgId)
      .eq("text_status", "pending")
      .in("id", ids)
      .select("id, file_name, storage_path, text_attempts");
    if (claimed.error) {
      console.error("[candidates] resume text: claim failed", message(claimed.error));
      break;
    }
    const rows = (claimed.data ?? []) as unknown as ClaimedRow[];
    if (!rows.length) break;

    // RESUME_TEXT_PARALLEL files at a time: reading is mostly waiting on storage.
    let next = 0;
    const lane = async () => {
      while (next < rows.length) {
        const row = rows[next];
        next += 1;
        attempted.add(row.id);
        if (now() >= deadline - SAFETY_MS) {
          // Out of time: hand the rest back.
          await client.from(TABLE).update({ text_status: "pending" }).eq("id", row.id).eq("text_status", "working");
          continue;
        }
        const outcome = await readOne(client, storage, orgId, row, read, now);
        if (outcome !== "retry") result[outcome] += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESUME_TEXT_PARALLEL, rows.length) }, lane));
  }

  result.linked = await linkUnmatched(client, orgId);
  result.remaining = await countWaiting(client, orgId);
  return result;
}

/**
 * A file's text is in hand (from the file itself, or typed out from a scan): decide what the file is and save it.
 * Not a resume -> the bytes go and the row stays; a portfolio -> kept aside; a resume -> text and contacts saved,
 * ready to be matched and to have its details read. `extra` rides along on the same update (the scan's model and
 * tokens). Throws on a storage or database error; the caller counts the attempt.
 */
export async function saveResumeText(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  row: { id: string; storage_path: string },
  rawText: string,
  now: () => number,
  extra: Record<string, unknown> = {},
): Promise<"read" | "rejected" | "other"> {
  const update = (values: Record<string, unknown>) =>
    client.from(TABLE).update({ ...values, ...extra, updated_at: new Date(now()).toISOString() }).eq("id", row.id).eq("organization_id", orgId);
  // Postgres refuses a NUL in text or JSON ("unsupported Unicode escape sequence"); some PDFs carry one.
  const text = rawText.replace(/\u0000/g, "").slice(0, RESUME_TEXT_MAX_CHARS);
  const contacts = contactsInText(text);
  const { verdict, reason } = looksLikeResume(text, contacts);
  if (verdict === "reject") {
    // Owner 2026-11-10: not a resume -> the bytes go, the row stays (status 'rejected') so the file is not uploaded again.
    const { error: rmErr } = await storage.remove([row.storage_path]);
    if (rmErr && !/not found/i.test(rmErr.message)) throw rmErr;
    const { error: rejErr } = await update({
      status: "rejected", text_status: "ready", text_error: reason, resume_text: null, emails: contacts.emails, phones: contacts.phones,
      candidate_id: null, match_reason: null, matched_at: null, extract_status: "skipped",
    });
    if (rejErr) throw rejErr;
    return "rejected";
  }
  if (verdict === "other") {
    // Owner 2026-11-11: a portfolio or similar is kept (bytes stay), never matched, out of the Excel.
    const { error: otherErr } = await update({
      status: "other", text_status: "ready", text_error: reason, resume_text: text, emails: contacts.emails, phones: contacts.phones,
      candidate_id: null, match_reason: null, matched_at: null, extract_status: "skipped",
    });
    if (otherErr) throw otherErr;
    return "other";
  }
  const { error: saveErr } = await update({ text_status: "ready", text_error: null, resume_text: text, emails: contacts.emails, phones: contacts.phones });
  if (saveErr) throw saveErr;
  return "read";
}

async function readOne(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  row: ClaimedRow,
  read: TextReader,
  now: () => number,
): Promise<"read" | "unreadable" | "scans" | "failed" | "rejected" | "other" | "retry"> {
  const at = new Date(now()).toISOString();
  const update = (values: Record<string, unknown>) => client.from(TABLE).update({ ...values, updated_at: at }).eq("id", row.id).eq("organization_id", orgId);
  try {
    const { data, error } = await storage.download(row.storage_path);
    if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);
    const text = await read(new Uint8Array(await data.arrayBuffer()), row.file_name);
    return await saveResumeText(client, storage, orgId, row, text, now);
  } catch (error) {
    if (error instanceof DocumentError) {
      // Owner 2026-11-11: a PDF with no text layer is a scan -> the scan reader types it out (resume-scan.ts). Before
      // migration 20261111000003 the database refuses the new status and the file is marked unreadable, as it was.
      if (/No text found/.test(error.message) && /\.pdf$/i.test(row.file_name)) {
        const queued = await update({ text_status: "scan", text_error: null, text_attempts: 0 });
        if (!queued.error) return "scans";
        if (queued.error.code !== "23514") console.error("[candidates] resume text: queueing the scan failed", message(queued.error));
      }
      await update({ text_status: "unreadable", text_error: unreadableReason(error, row.file_name), extract_status: "skipped" });
      return "unreadable";
    }
    const attempts = (Number(row.text_attempts) || 0) + 1;
    const givenUp = attempts >= RESUME_TEXT_MAX_ATTEMPTS;
    console.error(`[candidates] resume text: ${row.file_name} attempt ${attempts} failed`, message(error));
    await update({
      text_status: givenUp ? "failed" : "pending", text_attempts: attempts, text_error: message(error).slice(0, 500),
      // A file given up on has no text to read details from; leaving it 'pending' kept the progress bar from finishing.
      ...(givenUp ? { extract_status: "skipped" } : {}),
    });
    return givenUp ? "failed" : "retry";
  }
}

async function countWaiting(client: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await client
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .in("text_status", ["pending", "working"]);
  return error ? -1 : count ?? 0;
}

// Matching -------------------------------------------------------------------------------------------------------------

const unique = (values: string[]) => [...new Set(values)];
function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Link every stored file whose text is read and that is not linked yet (and was not detached by HR) to the candidate
 * with the same email, else the same phone. Called after a read, after a sheet import and after an edit. Never throws;
 * returns how many files were linked.
 */
export async function linkUnmatched(client: SupabaseClient, orgId: string): Promise<number> {
  let linked = 0;
  let cursor: string | null = null;
  try {
    for (let pass = 0; pass < 20; pass += 1) {
      let query = client
        .from(TABLE)
        .select("id, emails, phones")
        .eq("organization_id", orgId)
        .eq("status", "ready")
        .eq("text_status", "ready")
        .is("candidate_id", null)
        .or("match_reason.is.null,match_reason.neq.detached")
        .order("id")
        .limit(RESUME_LINK_PAGE);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as { id: string; emails: string[] | null; phones: string[] | null }[];
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;

      const emails = unique(rows.flatMap((r) => r.emails ?? []));
      const phones = unique(rows.flatMap((r) => r.phones ?? []));
      const byEmail = await candidatesByKey(client, orgId, "email_key", emails);
      const byPhone = await candidatesByKey(client, orgId, "phone_key", phones);
      const at = new Date().toISOString();
      for (const row of rows) {
        const byMail = (row.emails ?? []).map((e) => byEmail.get(e)).find((id): id is string => Boolean(id)) ?? null;
        const byTel = (row.phones ?? []).map((p) => byPhone.get(p)).find((id): id is string => Boolean(id)) ?? null;
        const candidateId = byMail ?? byTel;
        if (!candidateId) continue;
        const reason: ResumeMatchReason = byMail && byTel && byMail === byTel ? "both" : byMail ? "email" : "phone";
        const { error: linkErr } = await client
          .from(TABLE)
          .update({ candidate_id: candidateId, match_reason: reason, matched_at: at, updated_at: at })
          .eq("id", row.id)
          .eq("organization_id", orgId)
          .is("candidate_id", null);
        if (linkErr) throw linkErr;
        linked += 1;
      }
      if (rows.length < RESUME_LINK_PAGE) break;
    }
  } catch (error) {
    if (linksMigrationMissing(error as { code?: string })) warnMissing(error);
    else console.error("[candidates] resume matching failed", message(error));
  }
  return linked;
}

/** key -> the oldest candidate of the organisation with that key (people are de-duplicated on these keys anyway). */
async function candidatesByKey(client: SupabaseClient, orgId: string, column: "email_key" | "phone_key", keys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const chunk of chunks(keys, 200)) {
    const { data, error } = await client.from("candidates").select(`id, ${column}, created_at`).eq("organization_id", orgId).in(column, chunk).order("created_at");
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      const key = row[column];
      if (key && !map.has(key)) map.set(key, row.id);
    }
  }
  return map;
}

/** HR attaches a file to a candidate (reason "manual") or detaches it (reason "detached": never matched again by itself). */
export async function setResumeCandidate(client: SupabaseClient, orgId: string, fileId: unknown, candidateId: unknown): Promise<void> {
  if (typeof fileId !== "string" || !UUID.test(fileId)) throw new CandidateActionError(400, "id must be a uuid.");
  if (candidateId !== null && (typeof candidateId !== "string" || !UUID.test(candidateId))) {
    throw new CandidateActionError(400, "candidateId must be a uuid or null.");
  }
  const file = await client.from(TABLE).select("id, status").eq("organization_id", orgId).eq("id", fileId).maybeSingle();
  if (file.error) failWith("attach the resume", file.error);
  if (!file.data || file.data.status !== "ready") throw new CandidateActionError(404, "That resume is no longer here.");
  if (candidateId) {
    const person = await client.from("candidates").select("id").eq("organization_id", orgId).eq("id", candidateId).maybeSingle();
    if (person.error) failWith("attach the resume", person.error);
    if (!person.data) throw new CandidateActionError(404, "That candidate no longer exists.");
  }
  const at = new Date().toISOString();
  const { error } = await client
    .from(TABLE)
    .update({ candidate_id: candidateId, match_reason: candidateId ? "manual" : "detached", matched_at: candidateId ? at : null, updated_at: at })
    .eq("id", fileId)
    .eq("organization_id", orgId);
  if (error) failWith(candidateId ? "attach the resume" : "detach the resume", error);
}

function failWith(context: string, error: { code?: string; message?: string }): never {
  if (linksMigrationMissing(error)) {
    throw new CandidateActionError(503, "This needs a database update first: run 20261110000001_candidate_resume_links.sql in Supabase.");
  }
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

/** How many candidates with a live record in this sheet have a stored resume; null before the migration. */
export async function sheetCandidatesWithResume(client: SupabaseClient, orgId: string, sheetId: string): Promise<number | null> {
  const apps = await client.from("candidate_applications").select("candidate_id").eq("organization_id", orgId).eq("sheet_id", sheetId).is("deleted_at", null);
  if (apps.error) {
    console.error("[candidates] resume count: records failed", message(apps.error));
    return null;
  }
  const ids = unique((apps.data ?? []).map((a) => a.candidate_id as string));
  const withResume = new Set<string>();
  for (const chunk of chunks(ids, 200)) {
    const { data, error } = await client.from(TABLE).select("candidate_id").eq("organization_id", orgId).eq("status", "ready").in("candidate_id", chunk);
    if (error) {
      if (linksMigrationMissing(error)) warnMissing(error);
      else console.error("[candidates] resume count failed", message(error));
      return null;
    }
    for (const row of data ?? []) if (row.candidate_id) withResume.add(row.candidate_id as string);
  }
  return withResume.size;
}

// The cron -------------------------------------------------------------------------------------------------------------

/** Every organisation with files waiting to be read, until the budget is used. Never throws. */
export async function processResumeTextAll(
  client: SupabaseClient,
  options: ResumeTextOptions = {},
): Promise<{ organisations: number; read: number; linked: number }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? RESUME_TEXT_BUDGET_MS.cron);
  const { data, error } = await client.from(TABLE).select("organization_id").eq("status", "ready").eq("text_status", "pending").limit(500);
  if (error) {
    if (linksMigrationMissing(error)) warnMissing(error);
    else console.error("[candidates] resume text: listing organisations failed", message(error));
    return { organisations: 0, read: 0, linked: 0 };
  }
  const orgs = unique((data ?? []).map((r) => r.organization_id as string));
  const storage = options.storage ?? resumeStorage(client);
  let organisations = 0;
  let read = 0;
  let linked = 0;
  for (const orgId of orgs) {
    const left = deadline - now();
    if (left <= SAFETY_MS * 2) break;
    const result = await processResumeText(client, storage, orgId, { ...options, budgetMs: left });
    organisations += 1;
    read += result.read;
    linked += result.linked;
  }
  return { organisations, read, linked };
}
