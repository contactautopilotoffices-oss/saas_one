import { NextResponse } from "next/server";
import { MAX_JD_LENGTH, MAX_REQUISITION_JD_BYTES } from "@/backend/lib/candidates/config";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import type { RequisitionDeps } from "@/backend/lib/candidates/requisitions";
import { DocumentError, extractText } from "@/backend/lib/hr-assistant/extract-text";
import { readJson } from "../../_lib/auth";

export async function readRequisitionForm(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fields = await readJson(request);
    return fields instanceof NextResponse ? fields : { fields, file: null };
  }
  try {
    const form = await request.formData();
    const fields = JSON.parse(String(form.get("fields"))) as Record<string, unknown> | null;
    const file = form.get("jd");
    if (fields && typeof fields === "object" && !Array.isArray(fields) && file instanceof File) return { fields, file };
  } catch { /* report malformed form below */ }
  return NextResponse.json({ error: "The hiring request or its PDF could not be read." }, { status: 400 });
}

export async function readRequisitionJd(file: File | null): Promise<RequisitionDeps["jd"]> {
  if (!file) return undefined;
  if (file.size > MAX_REQUISITION_JD_BYTES) throw new CandidateActionError(413, "Choose a job description PDF under 4 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!/\.pdf$/i.test(file.name) || bytes.toString("ascii", 0, 5) !== "%PDF-") throw new CandidateActionError(400, "Choose a valid job description PDF.");
  let text: string | null = null;
  try {
    text = (await extractText(bytes, file.name)).slice(0, MAX_JD_LENGTH);
  } catch (error) {
    // A scanned JD is still useful as an attachment. The requester can enter requirements manually.
    if (!(error instanceof DocumentError) || !error.message.startsWith("No text found")) {
      if (error instanceof DocumentError) throw new CandidateActionError(400, error.message);
      throw error;
    }
  }
  return { fileName: file.name.slice(-200), text, pdfBase64: bytes.toString("base64") };
}
