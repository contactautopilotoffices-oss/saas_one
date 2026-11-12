import { NextResponse } from "next/server";

import { RESUME_RATE_LIMIT, WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { setResumeCandidate } from "@/backend/lib/candidates/resume-text";
import { deleteResumeFile, resumeFileText, resumeLink, resumeOpen, resumeStorage } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Query: orgId, and optionally inline=1 or text=1.
 *   default   download: sends the signed-in HR login on to a short-lived link that saves the file under its name
 *   inline=1  read it: a PDF opens in the browser's viewer, a .docx is shown as a page, anything else downloads
 *   text=1    { fileName, text, fromScan }: the file's text as read, for the candidate's panel
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(query.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (query.get("text") === "1") {
      return NextResponse.json(await resumeFileText(auth.admin, auth.orgId, id), { headers: { "Cache-Control": "no-store" } });
    }
    if (query.get("inline") === "1") {
      const opened = await resumeOpen(auth.admin, resumeStorage(auth.admin), auth.orgId, id);
      if (opened.kind === "html") {
        return new NextResponse(opened.html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            // Nothing inside a resume may run or load from elsewhere: inline styles and embedded images only.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return NextResponse.redirect(opened.url, { status: 302, headers: { "Cache-Control": "no-store" } });
    }
    const { url } = await resumeLink(auth.admin, resumeStorage(auth.admin), auth.orgId, id);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Couldn't open the resume");
  }
}

/** Attach the file to a candidate, or detach it: { orgId, candidateId: uuid | null }. A detached file is not matched again by itself. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    await setResumeCandidate(auth.admin, auth.orgId, id, body.candidateId ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't change the resume's candidate");
  }
}

/** Removes a file uploaded by mistake (the stored file and its row). Query: orgId. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(query.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    await deleteResumeFile(auth.admin, resumeStorage(auth.admin), auth.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the resume");
  }
}
