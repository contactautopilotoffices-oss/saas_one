/**
 * Owner 2026-11-24 (HR recruitment meeting, 23 Nov): an AI score for a submitted assignment, against the position's job
 * description. HR sees it; the hiring manager never does ("so the hiring manager's opinion stays unbiased"). The score is
 * advice only: a person decides who moves on.
 *
 * One model call, job 'candidate_assignment_score' (Tech console → Brain → AI models; docs/AI_MODELS.md). Not an agent:
 * no tools, no loop, no action taken on the result (docs/AGENT_DOCTRINE.md does not apply; it is a single structured
 * call like resume-extract.ts).
 *
 * The work is read as text when the file has text (PDF, Word); a scanned PDF goes to Claude as the PDF itself; other
 * files (images, slides, ZIP) and links are scored from what the candidate wrote, and the summary says so.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { RESUME_BUCKET } from "./config";
import { jobCaller, type JsonCaller } from "./models";

const TABLE = "recruitment_assignments";
const MAX_TEXT = 40_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "summary", "strengths", "gaps"],
  properties: {
    score: { type: "integer", description: "0 to 100: how well the work meets the brief and the job description" },
    summary: { type: "string", description: "Two or three plain sentences for HR" },
    strengths: { type: "array", items: { type: "string" }, description: "Up to 4 short points" },
    gaps: { type: "array", items: { type: "string" }, description: "Up to 4 short points" },
  },
} as const;

const SYSTEM = [
  "You review a job candidate's take-home assignment for an HR team in India.",
  "Score it from 0 to 100 against the assignment brief and the job description: 80+ strong, 60-79 good, 40-59 mixed, below 40 weak.",
  "Judge only the work you can see. If the work itself is not visible (only a link or a file type you cannot read), say so in the summary and score only what is there, conservatively.",
  "Never judge the person's name, gender, age, religion, caste, region or anything not about the work.",
  "Write plain, short English. Return JSON only.",
].join(" ");

export interface ScoreDeps {
  caller?: JsonCaller;
  /** The stored file's bytes; null when it cannot be read. */
  download?: (path: string) => Promise<Uint8Array | null>;
  /** Text from a PDF or Word file; "" when there is none. */
  read?: (bytes: Uint8Array, fileName: string) => Promise<string>;
}

export interface ScoreResult { status: "scored" | "failed" | "skipped"; score?: number }

const defaultDownload = (client: SupabaseClient) => async (path: string) => {
  const { data, error } = await client.storage.from(RESUME_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
};
const defaultRead = async (bytes: Uint8Array, fileName: string) => {
  try {
    const { extractText } = await import("@/backend/lib/hr-assistant/extract-text");
    return await extractText(bytes, fileName);
  } catch {
    return "";
  }
};

const clean = (list: unknown) => (Array.isArray(list) ? list : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 4);

/** Scores one submitted assignment and stores the result on its row. Never throws. */
export async function scoreAssignment(client: SupabaseClient, orgId: string, assignmentId: string, deps: ScoreDeps = {}): Promise<ScoreResult> {
  const { data, error } = await client.from(TABLE)
    .select("id, position_id, title, brief, guidelines, status, submission_link, submission_note, file_path, file_name, ai_status")
    .eq("organization_id", orgId).eq("id", assignmentId).maybeSingle();
  if (error || !data) return { status: "failed" };
  const a = data as { id: string; position_id: string; title: string; brief: string; guidelines: string | null; status: string; submission_link: string | null; submission_note: string | null; file_path: string | null; file_name: string | null; ai_status: string | null };
  if (a.status !== "submitted" || a.ai_status === "scored") return { status: "skipped" };

  const { data: pos } = await client.from("candidate_positions").select("title, jd_text, summary").eq("organization_id", orgId).eq("id", a.position_id).maybeSingle();
  const p = (pos ?? {}) as { title?: string; jd_text?: string | null; summary?: string | null };
  const jd = (p.jd_text || p.summary || "").trim();

  let workText = "";
  let document: { mediaType: "application/pdf"; base64: string } | undefined;
  if (a.file_path) {
    const bytes = await (deps.download ?? defaultDownload(client))(a.file_path);
    if (bytes) {
      const name = a.file_name || a.file_path;
      if (/\.(pdf|docx?)$/i.test(name) || /\.(pdf|docx?)$/i.test(a.file_path)) workText = (await (deps.read ?? defaultRead)(bytes, a.file_path)).slice(0, MAX_TEXT);
      if (!workText.trim() && /\.pdf$/i.test(a.file_path) && bytes.byteLength <= 4 * 1024 * 1024) document = { mediaType: "application/pdf", base64: Buffer.from(bytes).toString("base64") };
    }
  }
  if (!workText.trim() && !document && !(a.submission_note ?? "").trim()) {
    await client.from(TABLE).update({ ai_status: "skipped", ai_error: "Nothing readable to score (a link or a file type the AI cannot read). Review it yourself." }).eq("id", a.id);
    return { status: "skipped" };
  }

  const user = [
    `Role: ${p.title ?? "(not given)"}`,
    `Job description:\n${jd ? jd.slice(0, 12_000) : "(not given; judge against the brief)"}`,
    `Assignment: ${a.title}\nBrief:\n${a.brief}${a.guidelines ? `\nGuidelines:\n${a.guidelines}` : ""}`,
    `Candidate's link: ${a.submission_link ?? "(none)"}`,
    `Candidate's notes:\n${a.submission_note ?? "(none)"}`,
    workText ? `The submitted file's text:\n${workText}` : document ? "The submitted file is attached as a PDF." : "No readable file was submitted.",
  ].join("\n\n");

  try {
    const reply = await (deps.caller ?? jobCaller("candidate_assignment_score"))({
      label: "assignment-score", system: SYSTEM, user, schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "medium", maxTokens: 6000, otherMaxTokens: 1200, timeoutMs: 90_000, budgetMs: 150_000, document,
      accept: (text) => { try { const j = JSON.parse(text); return Number.isFinite(Number(j.score)) && typeof j.summary === "string"; } catch { return false; } },
    });
    const j = JSON.parse(reply.text) as { score: number; summary: string; strengths: unknown; gaps: unknown };
    const score = Math.max(0, Math.min(100, Math.round(Number(j.score))));
    await client.from(TABLE).update({
      ai_status: "scored", ai_score: score, ai_summary: String(j.summary).slice(0, 1500), ai_strengths: clean(j.strengths), ai_gaps: clean(j.gaps),
      ai_model: reply.model, ai_scored_at: new Date().toISOString(), ai_error: null,
    }).eq("id", a.id);
    return { status: "scored", score };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error("[candidates] assignment score failed", why);
    await client.from(TABLE).update({ ai_status: "failed", ai_error: why.slice(0, 300) }).eq("id", a.id);
    return { status: "failed" };
  }
}
