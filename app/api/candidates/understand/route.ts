import { NextResponse } from "next/server";

import { MAX_JD_BYTES, MAX_JD_LENGTH, SEARCH_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { understoodFilters } from "@/backend/lib/candidates/filter-search";
import { parseQuery } from "@/backend/lib/candidates/query-spec";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { DocumentError, extractText, isSupportedFile } from "@/backend/lib/hr-assistant/extract-text";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// One model chain, with PARSE_CALL's 35 s budget; a PDF read first.
export const maxDuration = 60;

/**
 * The job description to read: pasted text as JSON { orgId, text }, or (owner 2026-11-15) an uploaded file as a form
 * with `orgId` and `file` (PDF, Word or text), whose text is read here with the same readers the resumes use.
 */
async function readBody(request: Request): Promise<{ orgId: unknown; text: string; fileName?: string } | NextResponse> {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF, Word or text file." }, { status: 400 });
    if (!isSupportedFile(file.name)) return NextResponse.json({ error: "That file type is not supported. Use PDF, Word (.docx) or text." }, { status: 400 });
    if (file.size > MAX_JD_BYTES) return NextResponse.json({ error: "That file is too large. Keep a job description under 5 MB." }, { status: 400 });
    try {
      const text = await extractText(new Uint8Array(await file.arrayBuffer()), file.name);
      return { orgId: form.get("orgId"), text, fileName: file.name };
    } catch (error) {
      if (error instanceof DocumentError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  return { orgId: body.orgId, text: typeof body.text === "string" ? body.text : "" };
}

/** "Paste or upload a job description" -> the filters the AI read from it, for HR to check and change. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("search", auth.user.id, SEARCH_RATE_LIMIT);
  if (limited) return limited;
  try {
    const text = body.text.trim();
    if (!text) throw new CandidateActionError(400, body.fileName ? "No text could be read from that file." : "Paste a job description first.");
    // A very long JD is read up to the limit (the requirements come first); the rest is dropped, not refused.
    const cut = text.length > MAX_JD_LENGTH;
    const read = cut ? text.slice(0, MAX_JD_LENGTH) : text;
    const { spec, aiParsed } = await parseQuery(read, new Date().toISOString().slice(0, 10));
    const notices: string[] = [];
    if (!aiParsed) notices.push("The AI couldn't read that just now, so no filters were filled in. Please try again or set them by hand.");
    else if (cut) notices.push(`Only the first ${MAX_JD_LENGTH.toLocaleString("en-IN")} characters were read.`);
    return NextResponse.json({
      ...understoodFilters(spec),
      summary: read,
      aiParsed,
      notices,
      ...(body.fileName ? { fileName: body.fileName } : {}),
    });
  } catch (error) {
    return errorResponse(error, "Couldn't read the job description");
  }
}
