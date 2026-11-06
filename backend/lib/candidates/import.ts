/**
 * Import a parsed sheet: de-duplicate people, write candidates + records + the raw rows, then make the sheet live.
 *
 *   new     : a new sheet.
 *   replace : a new sheet; when it is complete the old sheet with the same name is soft-deleted in the same
 *             transaction (candidate_finish_sheet), so a failed import never loses the old one.
 *   merge   : rows go into the existing sheet. A row whose person (same email / phone) already has a record for the
 *             same role in that sheet updates it; anything else is added. Nothing in the sheet is deleted.
 *
 * People are matched across the whole organisation by valid email, then valid phone. A matched person's details are
 * updated with the uploaded values that are not empty (the latest upload wins).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { FIXED_PREFIX, sheetNameKey } from "./normalize";
import { needsReview, type CleanRow, type ParsedSheet } from "./parse-sheet";
import { buildSearchText } from "./profile";
import { CandidateActionError, refreshSearchText } from "./records";
import type { ImportSummary, UploadMode } from "./types";

const BATCH = 500;
const IN_CHUNK = 200;

export interface SheetRowDb {
  id: string;
  organization_id: string;
  name: string;
  name_key: string;
  status: "importing" | "ready" | "failed";
  error: string | null;
  row_count: number;
  flagged_count: number;
  skipped_count: number;
  upload_count: number;
  uploaded_by_email: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface PersonRow {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  email_key: string | null;
  phone: string | null;
  phone_key: string | null;
  current_organization: string | null;
  current_designation: string | null;
  location: string | null;
  total_exp_months: number | null;
  created_by: string | null;
}

const PERSON_SELECT =
  "id, organization_id, full_name, email, email_key, phone, phone_key, current_organization, current_designation, location, total_exp_months, created_by";

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(context: string, error: unknown): never {
  console.error(`[candidates] import: ${context}`, error);
  throw new Error(`Couldn't ${context}.`);
}

/** The live sheet with this file name, if any (the "same sheet" test). */
export async function findLiveSheetByName(client: SupabaseClient, orgId: string, fileName: string): Promise<SheetRowDb | null> {
  const { data, error } = await client
    .from("candidate_sheets")
    .select("*")
    .eq("organization_id", orgId)
    .eq("name_key", sheetNameKey(fileName))
    .eq("status", "ready")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("check for a sheet with the same name", error);
  return (data as SheetRowDb | null) ?? null;
}

/** Group rows that are the same person inside the file (same valid email or same valid phone). */
export function groupPeople(rows: { clean: CleanRow }[]): number[] {
  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();
  let next = 0;
  return rows.map(({ clean }) => {
    const group =
      (clean.emailKey ? byEmail.get(clean.emailKey) : undefined) ??
      (clean.phoneKey ? byPhone.get(clean.phoneKey) : undefined) ??
      next++;
    if (clean.emailKey && !byEmail.has(clean.emailKey)) byEmail.set(clean.emailKey, group);
    if (clean.phoneKey && !byPhone.has(clean.phoneKey)) byPhone.set(clean.phoneKey, group);
    return group;
  });
}

/** Same person + same role (case-insensitive) = the same record when merging. */
export function recordKey(candidateId: string, role: string | null): string {
  return `${candidateId}|${(role ?? "").trim().toLowerCase()}`;
}

async function loadPeopleByContact(client: SupabaseClient, orgId: string, emails: string[], phones: string[]): Promise<PersonRow[]> {
  const found = new Map<string, PersonRow>();
  for (const [column, values] of [
    ["email_key", emails],
    ["phone_key", phones],
  ] as const) {
    for (const part of chunks([...new Set(values)], IN_CHUNK)) {
      const { data, error } = await client.from("candidates").select(PERSON_SELECT).eq("organization_id", orgId).in(column, part);
      if (error) fail("check for existing candidates", error);
      for (const row of (data ?? []) as PersonRow[]) found.set(row.id, row);
    }
  }
  return [...found.values()];
}

async function upsertBatches(client: SupabaseClient, table: string, rows: Record<string, unknown>[], context: string) {
  for (const part of chunks(rows, BATCH)) {
    const { error } = await client.from(table).upsert(part, { onConflict: "id" });
    if (error) fail(context, error);
  }
}

async function insertBatches(client: SupabaseClient, table: string, rows: Record<string, unknown>[], context: string) {
  for (const part of chunks(rows, BATCH)) {
    const { error } = await client.from(table).insert(part);
    if (error) fail(context, error);
  }
}

export interface ImportArgs {
  orgId: string;
  userId: string;
  userEmail: string | null;
  fileName: string;
  parsed: ParsedSheet;
  mode: UploadMode;
  /** The live sheet with the same name (required for replace / merge). */
  existing: SheetRowDb | null;
}

export interface ImportResult extends Omit<ImportSummary, "sheet"> {
  sheetId: string;
}

export async function importSheet(client: SupabaseClient, args: ImportArgs): Promise<ImportResult> {
  const { orgId, userId, parsed } = args;
  const mode: UploadMode = args.existing ? args.mode : "new";
  if (args.existing && mode === "new") throw new CandidateActionError(409, "A sheet with this name already exists.");
  const now = new Date().toISOString();

  const valid = parsed.rows.filter((row): row is typeof row & { clean: CleanRow } => row.clean !== null);
  const skippedCount = parsed.rows.length - valid.length;
  const counts = {
    row_count: parsed.rows.length,
    flagged_count: parsed.rows.filter((row) => row.clean && needsReview(row.issues)).length,
    skipped_count: skippedCount,
  };

  // 1. The sheet row.
  let sheetId: string;
  let uploadNo = 1;
  if (mode === "merge" && args.existing) {
    sheetId = args.existing.id;
    uploadNo = args.existing.upload_count + 1;
  } else {
    sheetId = randomUUID();
    const { error } = await client.from("candidate_sheets").insert({
      id: sheetId,
      organization_id: orgId,
      name: args.fileName,
      name_key: sheetNameKey(args.fileName),
      status: "importing",
      ...counts,
      uploaded_by: userId,
      uploaded_by_email: args.userEmail,
      replaces_sheet_id: mode === "replace" ? args.existing?.id ?? null : null,
    });
    if (error) fail("start the import", error);
  }

  try {
    // 2. People: inside the file, then against the organisation.
    const groups = groupPeople(valid);
    const existingPeople = await loadPeopleByContact(
      client,
      orgId,
      valid.map((row) => row.clean.emailKey).filter((key): key is string => Boolean(key)),
      valid.map((row) => row.clean.phoneKey).filter((key): key is string => Boolean(key)),
    );
    const personByEmail = new Map<string, PersonRow>();
    const personByPhone = new Map<string, PersonRow>();
    for (const person of existingPeople) {
      if (person.email_key && !personByEmail.has(person.email_key)) personByEmail.set(person.email_key, person);
      if (person.phone_key && !personByPhone.has(person.phone_key)) personByPhone.set(person.phone_key, person);
    }

    const people = new Map<number, PersonRow & { isNew: boolean }>();
    valid.forEach((row, i) => {
      const group = groups[i];
      const c = row.clean;
      let person = people.get(group);
      if (!person) {
        const match = (c.emailKey && personByEmail.get(c.emailKey)) || (c.phoneKey && personByPhone.get(c.phoneKey)) || null;
        person = match
          ? { ...match, isNew: false }
          : {
              id: randomUUID(),
              organization_id: orgId,
              full_name: c.fullName,
              email: null,
              email_key: null,
              phone: null,
              phone_key: null,
              current_organization: null,
              current_designation: null,
              location: null,
              total_exp_months: null,
              created_by: userId,
              isNew: true,
            };
        people.set(group, person);
      }
      // Latest non-empty value wins.
      person.full_name = c.fullName;
      if (c.email) [person.email, person.email_key] = [c.email, c.emailKey];
      if (c.phone) [person.phone, person.phone_key] = [c.phone, c.phoneKey];
      if (c.currentOrganization) person.current_organization = c.currentOrganization;
      if (c.currentDesignation) person.current_designation = c.currentDesignation;
      if (c.location) person.location = c.location;
      if (c.totalExpMonths !== null) person.total_exp_months = c.totalExpMonths;
    });

    const personRows = [...people.values()].map((person) => {
      const row: Record<string, unknown> = { ...person, updated_at: now };
      delete row.isNew;
      return row;
    });
    await upsertBatches(client, "candidates", personRows, "save the candidates");

    // 3. Records.
    const existingRecords = new Map<string, { id: string; search_text: string }>();
    if (mode === "merge") {
      const { data, error } = await client
        .from("candidate_applications")
        .select("id, candidate_id, role, search_text")
        .eq("organization_id", orgId)
        .eq("sheet_id", sheetId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) fail("read the existing sheet", error);
      for (const app of data ?? []) {
        const key = recordKey(app.candidate_id as string, app.role as string | null);
        if (!existingRecords.has(key)) existingRecords.set(key, { id: app.id as string, search_text: app.search_text as string });
      }
    }

    const records = new Map<string, Record<string, unknown>>();
    const rowApplication = new Map<number, string>();
    const rowIssues = new Map<number, string[]>();
    let recordsUpdated = 0;
    const firstRowForKey = new Map<string, number>();

    valid.forEach((row, i) => {
      const c = row.clean;
      const person = people.get(groups[i])!;
      const key = recordKey(person.id, c.role);
      const searchText = buildSearchText({
        role: c.role,
        currentDesignation: person.current_designation,
        currentOrganization: person.current_organization,
        location: person.location,
        totalExpMonths: person.total_exp_months,
        relevantExpMonths: c.relevantExpMonths,
        noticePeriodDays: c.noticePeriodDays,
        candidateSource: c.candidateSource,
        remark: c.remark,
      });

      const previousRow = firstRowForKey.get(key);
      if (previousRow !== undefined) {
        rowIssues.set(row.rowNumber, [`${FIXED_PREFIX}Same candidate and role as row ${previousRow}; this row's values were used`]);
      } else firstRowForKey.set(key, row.rowNumber);

      const existing = existingRecords.get(key);
      const prior = records.get(key);
      const id = (prior?.id as string | undefined) ?? existing?.id ?? randomUUID();
      if (existing && !prior) recordsUpdated += 1;
      records.set(key, {
        id,
        organization_id: orgId,
        candidate_id: person.id,
        sheet_id: sheetId,
        source_row: row.rowNumber,
        role: c.role,
        candidate_source: c.candidateSource,
        sourcing_date: c.sourcingDate,
        relevant_exp_months: c.relevantExpMonths,
        notice_period_days: c.noticePeriodDays,
        current_inhand: c.currentInhand,
        expected_inhand: c.expectedInhand,
        remark: c.remark,
        status: c.status,
        search_text: searchText,
        updated_by: userId,
        updated_at: now,
        // set below: keep the embedding only when an existing record's text did not change
        embedding: null,
        embedding_model: null,
        created_by: userId,
      });
      rowApplication.set(row.rowNumber, id);
    });

    const recordRows = [...records.values()];
    const existingText = new Map([...existingRecords.values()].map((e) => [e.id, e.search_text]));
    // Three batches, each with identical keys per object (supabase-js sends a missing key as NULL):
    //   updated records whose text is unchanged keep their embedding; updated records with new text lose it;
    //   new records are inserted whole.
    const sameText: Record<string, unknown>[] = [];
    const newText: Record<string, unknown>[] = [];
    const added: Record<string, unknown>[] = [];
    for (const row of recordRows) {
      const { embedding, embedding_model, created_by, ...rest } = row;
      const previous = existingText.get(row.id as string);
      if (previous === undefined) added.push(row);
      else if (previous === row.search_text) sameText.push(rest);
      else newText.push({ ...rest, embedding, embedding_model });
      void created_by;
    }
    await upsertBatches(client, "candidate_applications", sameText, "save the records");
    await upsertBatches(client, "candidate_applications", newText, "save the records");
    await insertBatches(client, "candidate_applications", added, "save the records");

    // Matched people may also have records in other sheets: their profile text changes with the new details.
    const matchedIds = [...people.values()].filter((p) => !p.isNew).map((p) => p.id);
    await refreshSearchText(client, orgId, matchedIds);

    // 4. The raw rows, for audit and the issues report.
    await insertBatches(
      client,
      "candidate_sheet_rows",
      parsed.rows.map((row) => ({
        sheet_id: sheetId,
        upload_no: uploadNo,
        row_number: row.rowNumber,
        raw: row.raw,
        issues: [...row.issues, ...(rowIssues.get(row.rowNumber) ?? [])],
        skipped: row.clean === null,
        application_id: rowApplication.get(row.rowNumber) ?? null,
      })),
      "save the uploaded rows",
    );

    // 5. Make it live.
    if (mode === "merge") {
      const { error } = await client
        .from("candidate_sheets")
        .update({ ...counts, name: args.fileName, upload_count: uploadNo, uploaded_by: userId, uploaded_by_email: args.userEmail, error: null, updated_at: now })
        .eq("id", sheetId);
      if (error) fail("finish the import", error);
    } else {
      const { error } = await client.rpc("candidate_finish_sheet", {
        p_sheet_id: sheetId,
        p_replace_sheet_id: mode === "replace" ? args.existing?.id ?? null : null,
        p_user_id: userId,
      });
      if (error) {
        if (error.code === "23505") throw new CandidateActionError(409, "Another sheet with this name was uploaded at the same time. Refresh and try again.");
        fail("finish the import", error);
      }
    }

    return {
      sheetId,
      mode,
      rowsRead: parsed.rows.length,
      recordsAdded: recordRows.length - recordsUpdated,
      recordsUpdated,
      rowsSkipped: skippedCount,
      rowsFlagged: counts.flagged_count,
      // Imported rows whose only notes are automatic fixes (including "same candidate as row N" added above).
      rowsAutoFixed: parsed.rows.filter((row) => {
        const all = [...row.issues, ...(rowIssues.get(row.rowNumber) ?? [])];
        return row.clean && all.length > 0 && !needsReview(all);
      }).length,
      newCandidates: [...people.values()].filter((p) => p.isNew).length,
      matchedCandidates: matchedIds.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    const now2 = new Date().toISOString();
    // A failed new / replace sheet never goes live. A failed merge keeps the sheet live (part of the rows may already
    // be saved; re-uploading with Merge is safe) and shows the error on the sheet.
    const patch = mode === "merge" ? { error: `Last merge failed: ${message}`, updated_at: now2 } : { status: "failed", error: message, updated_at: now2 };
    await client.from("candidate_sheets").update(patch).eq("id", sheetId);
    throw error;
  }
}
