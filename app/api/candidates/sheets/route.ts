import { after, NextResponse } from "next/server";

import { MAX_UPLOAD_BYTES, SUPPORTED_SHEET_EXTENSIONS, UPLOAD_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { findLiveSheetByName, importSheet } from "@/backend/lib/candidates/import";
import { indexPending } from "@/backend/lib/candidates/indexing";
import { parseSheet } from "@/backend/lib/candidates/parse-sheet";
import { linkUnmatched, sheetCandidatesWithResume } from "@/backend/lib/candidates/resume-text";
import { getSheetSummary, listSheets } from "@/backend/lib/candidates/sheets";
import type { ImportSummary, UploadConflict, UploadMode } from "@/backend/lib/candidates/types";

import { errorResponse, rateLimited, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// Import runs in the request; the embeddings run afterwards, bounded by the same limit.
export const maxDuration = 60;

/** Sheets: live ones, or deleted ones with ?deleted=1. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await listSheets(auth.admin, auth.orgId, params.get("deleted") === "1"));
  } catch (error) {
    return errorResponse(error, "Couldn't load the sheets");
  }
}

const MODES: readonly UploadMode[] = ["new", "replace", "merge"];

/**
 * Upload a sheet (multipart: orgId, file, optional mode). If a live sheet has the same file name and no mode (or
 * "new") is sent, replies 409 with the clash so the portal can ask "Replace or Merge?" and resend with that mode.
 */
export async function POST(request: Request) {
  // Refuse an oversized body before reading it into memory (the multipart wrapper adds a little over the file size).
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: `File is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  const auth = await requireCandidateAccess(form.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("upload", auth.user.id, UPLOAD_RATE_LIMIT);
  if (limited) return limited;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a non-empty file to upload" }, { status: 400 });
  }
  const lower = file.name.toLowerCase();
  if (!SUPPORTED_SHEET_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type. Use ${SUPPORTED_SHEET_EXTENSIONS.join(", ")}.` }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }
  const modeField = form.get("mode");
  const mode: UploadMode | null = typeof modeField === "string" && modeField ? (modeField as UploadMode) : null;
  if (mode && !MODES.includes(mode)) return NextResponse.json({ error: "mode must be new, replace or merge" }, { status: 400 });

  try {
    const parsed = parseSheet(new Uint8Array(await file.arrayBuffer()), file.name);
    const existing = await findLiveSheetByName(auth.admin, auth.orgId, file.name);
    if (existing && (!mode || mode === "new")) {
      const summary = await getSheetSummary(auth.admin, auth.orgId, existing.id);
      const body: UploadConflict = {
        conflict: { sheetId: existing.id, name: existing.name, liveRecordCount: summary.liveRecordCount, uploadedAt: existing.updated_at },
      };
      return NextResponse.json(body, { status: 409 });
    }

    const result = await importSheet(auth.admin, {
      orgId: auth.orgId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      fileName: file.name,
      parsed,
      mode: mode ?? "new",
      existing,
    });
    after(() => indexPending(auth.admin, auth.orgId));

    const { sheetId, ...counts } = result;
    // Phase 2: stored resumes whose email or phone matches a new row are linked now, so the summary can say how many
    // of the sheet's candidates have one. Quick (database only); never fails the import.
    await linkUnmatched(auth.admin, auth.orgId);
    const candidatesWithResume = await sheetCandidatesWithResume(auth.admin, auth.orgId, sheetId);
    const summary: ImportSummary = { ...counts, candidatesWithResume, sheet: await getSheetSummary(auth.admin, auth.orgId, sheetId) };
    return NextResponse.json({ ...summary, warnings: parsed.warnings }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Couldn't import the sheet");
  }
}
