import { NextResponse } from "next/server";

import { MAX_JD_BYTES, WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { createJd, listJds } from "@/backend/lib/candidates/jd-library";
import { DocumentError, extractText, isSupportedFile } from "@/backend/lib/hr-assistant/extract-text";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** The JD library (owner 2026-11-17), most recently changed first. Query: orgId, q (title or department). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ jds: await listJds(auth.admin, auth.orgId, params.get("q") ?? "") });
  } catch (error) {
    return errorResponse(error, "Couldn't load the JD library");
  }
}

/**
 * A new JD, as version 1: JSON { orgId, title, department?, content }, or a form with orgId, title, department? and
 * `file` (PDF, Word or text), whose text is read here, as for a position.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF, Word or text file." }, { status: 400 });
    if (!isSupportedFile(file.name)) return NextResponse.json({ error: "That file type is not supported. Use PDF, Word (.docx) or text." }, { status: 400 });
    if (file.size > MAX_JD_BYTES) return NextResponse.json({ error: "That file is too large. Keep a job description under 5 MB." }, { status: 400 });
    let content: string;
    try {
      content = await extractText(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
      if (error instanceof DocumentError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    body = { orgId: form.get("orgId"), title: form.get("title"), department: form.get("department") || null, content, fileName: file.name };
  } else {
    const json = await readJson(request);
    if (json instanceof NextResponse) return json;
    body = json;
  }
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const fields = { ...body };
  delete fields.orgId;
  try {
    return NextResponse.json({ jd: await createJd(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), fields) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the JD");
  }
}
