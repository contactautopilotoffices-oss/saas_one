import { NextResponse } from "next/server";

import { MAX_JD_BYTES, MAX_JD_LENGTH, RESUME_SCAN_MAX_PAGES, SEARCH_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { draftFromReads } from "@/backend/lib/candidates/position-draft";
import { readPositionDetails } from "@/backend/lib/candidates/position-reader";
import { jobCaller } from "@/backend/lib/candidates/models";
import { pdfPageCount, scanResume } from "@/backend/lib/candidates/resume-scan";
import { parseQuery } from "@/backend/lib/candidates/query-spec";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import type { PositionReadResponse } from "@/backend/lib/candidates/types";
import { DocumentError, extractText, fileExtension, isSupportedFile } from "@/backend/lib/hr-assistant/extract-text";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
// Two model chains side by side (the search spec and the job's details), each inside PARSE_CALL's 35 s budget; a PDF read first.
export const maxDuration = 60;

/** The JD: pasted text as JSON { orgId, text }, or an uploaded file as a form with `orgId` and `file` (PDF, Word or text). */
async function readBody(request: Request): Promise<{ orgId: unknown; text: string; file: File | null } | NextResponse> {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Choose a valid job description file." }, { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF, Word or text file." }, { status: 400 });
    if (!isSupportedFile(file.name)) return NextResponse.json({ error: "That file type is not supported. Use PDF, Word (.docx) or text." }, { status: 400 });
    if (file.size > MAX_JD_BYTES) return NextResponse.json({ error: "That file is too large. Keep a job description under 5 MB." }, { status: 400 });
    return { orgId: form.get("orgId"), text: "", file };
  }
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  return { orgId: body.orgId, text: typeof body.text === "string" ? body.text : "", file: null };
}

/**
 * Owner 2026-11-16: a job description -> the Create position form, filled in. The search spec reader gives the
 * requirements (location, experience, notice, the must-have groups, the keywords) and the position reader the job's
 * own details (title, department, employment type, openings, education, budget, tools, a summary). HR checks every field.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("search", auth.user.id, SEARCH_RATE_LIMIT);
  if (limited) return limited;
  try {
    let text = body.text.trim();
    const fileName = body.file?.name ?? null;
    const notices: string[] = [];
    if (body.file) {
      const bytes = new Uint8Array(await body.file.arrayBuffer());
      try {
        text = await extractText(bytes, body.file.name);
      } catch (error) {
        if (!(error instanceof DocumentError)) throw error;
        if (fileExtension(body.file.name) !== ".pdf" || !error.message.startsWith("No text found")) {
          throw new CandidateActionError(400, error.message);
        }
        const pages = await pdfPageCount(bytes);
        if (pages && pages > RESUME_SCAN_MAX_PAGES) throw new CandidateActionError(400, `Split the scanned JD into sections of up to ${RESUME_SCAN_MAX_PAGES} pages or paste its text.`);
        try {
          text = (await scanResume(bytes, jobCaller("candidate_parse"), 18_000)).text;
        } catch {
          throw new CandidateActionError(422, "The configured JD model could not read this scanned PDF. Upload a text-based PDF or paste the JD text.");
        }
        notices.push("Review the values read from the scanned PDF before saving.");
      }
    }
    if (!text.trim()) throw new CandidateActionError(400, fileName ? "No text could be read from that file." : "Paste a job description first.");
    const cut = text.length > MAX_JD_LENGTH;
    const read = cut ? text.slice(0, MAX_JD_LENGTH) : text;
    const [spec, details] = await Promise.all([parseQuery(read, new Date().toISOString().slice(0, 10)), readPositionDetails(read)]);
    if (!spec.aiParsed && !details.read) notices.push("The AI couldn't read that just now, so nothing was filled in. Please try again or fill the form by hand.");
    else if (!spec.aiParsed) notices.push("The requirements could not be read this time; the job's details were. Fill the must-haves by hand or try again.");
    else if (!details.read) notices.push("The job's details could not be read this time; the requirements were. Fill the title and the rest by hand or try again.");
    if (cut) notices.push(`Only the first ${MAX_JD_LENGTH.toLocaleString("en-IN")} characters were read.`);
    const conflicts = spec.spec.conflicts?.filter(c => c.field !== "experience" || !details.read) ?? [];
    if (conflicts.length) notices.unshift(`The JD gives conflicting values for ${conflicts.map(c => c.field).join(" and ")}. Check those fields.`);
    if (details.details.experienceConflict) notices.unshift("The JD gives conflicting experience requirements. Check the experience range.");
    else if (details.read && !details.details.experience && /experience/i.test(read)) notices.push("Check the experience range. No clear, required range could be verified from the JD.");
    const draft = draftFromReads(spec.spec, details.details, read, fileName);
    const out: PositionReadResponse = { draft, aiParsed: spec.aiParsed || details.read, notices };
    return NextResponse.json(out);
  } catch (error) {
    return errorResponse(error, "Couldn't read the job description");
  }
}
