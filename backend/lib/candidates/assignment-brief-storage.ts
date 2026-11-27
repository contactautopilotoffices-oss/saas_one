import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { RESUME_BUCKET } from "./config";
import { BriefAttachmentSchema, MAX_BRIEF_BYTES, type BriefAttachment } from "./outreach-settings";
import { CandidateActionError } from "./records";

const types = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const pathFor = (orgId: string, key: string) => `assignment-briefs/${orgId}/${key}`;

export async function uploadAssignmentBrief(client: SupabaseClient, orgId: string, file: File): Promise<BriefAttachment> {
  if (!file.size || file.size > MAX_BRIEF_BYTES) throw new CandidateActionError(400, "Choose a non-empty file of up to 4 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split(".").pop();
  const valid = ext === "pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : ext === "doc" ? bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1" && bytes.includes(Buffer.from("WordDocument", "utf16le"))
    : ext === "docx" && bytes.subarray(0, 4).toString("hex") === "504b0304" && bytes.includes(Buffer.from("word/document.xml"));
  if (!valid || !(ext === "pdf" || ext === "doc" || ext === "docx")) throw new CandidateActionError(400, "Choose a PDF or Word document (.pdf, .doc or .docx).");
  const parsed = BriefAttachmentSchema.safeParse({ key: createHash("sha256").update(bytes).digest("hex") + "." + ext, name: file.name });
  if (!parsed.success) throw new CandidateActionError(400, "Use a shorter filename without path separators or control characters.");
  const { error } = await client.storage.from(RESUME_BUCKET).upload(pathFor(orgId, parsed.data.key), bytes, { contentType: types[ext], upsert: false });
  if (error && !/^(?:duplicate|resource already exists|the resource already exists)\.?$/i.test(error.message)) throw new CandidateActionError(502, "The attachment could not be stored. Try again.");
  return parsed.data;
}

export async function briefDownloadUrl(client: SupabaseClient, orgId: string, attachment: BriefAttachment) {
  const { data, error } = await client.storage.from(RESUME_BUCKET).createSignedUrl(pathFor(orgId, attachment.key), 60, { download: attachment.name });
  if (error || !data?.signedUrl) throw new CandidateActionError(404, "The assignment attachment is unavailable.");
  return data.signedUrl;
}
