/**
 * A position's own screening questions (owner 2026-11-25: "use AI to generate screening questions based on the JD";
 * migration 20261125000001). HR presses "Suggest questions" on the position: the AI drafts as many as HR asks for from
 * the job description, and "Suggest more" adds new ones without repeating. HR edits, removes or adds, then saves.
 * Nothing reaches a candidate until HR saves.
 *
 * What a candidate is asked: the standard questions that fill the record (Recruitment → Outreach → Screening: the ones
 * with a record field, e.g. experience, city, notice, salary) always, then the position's own. A position with none
 * saved asks HR's standard list as it is. The total is capped by HR's "most questions" setting (default 25): the form is
 * answered on a phone.
 *
 * One model call, job 'candidate_screening_questions' (Brain → AI models; docs/AI_MODELS.md). Not an agent: no tools, no
 * loop, and the draft only fills an editor (docs/AGENT_DOCTRINE.md does not apply; like keyword-suggest.ts).
 * Guardrails: the prompt forbids questions about protected or personal matters, and anything that still mentions them
 * is dropped, as is anything repeating a standard question or one already on the list.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { jobCaller, type JsonCaller } from "./models";
import { FieldInput, type ApplicationField, type OutreachSettings } from "./outreach-settings";
import { CandidateActionError } from "./records";
import { loadRecruitmentConfig } from "./requisitions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const POSITION_SCREENING_MIGRATION_MESSAGE = "This needs a database update first: run 20261125000001_recruitment_position_screening.sql in Supabase.";
const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42703", "PGRST204"].includes(error?.code ?? "") || /screening_fields|schema cache/i.test(error?.message ?? ""));

/** The questions every candidate is asked: HR's standard ones that fill the record. */
export const standardQuestions = (s: OutreachSettings): ApplicationField[] => s.screening.fields.filter((f) => f.target);
/** What a candidate in this position is asked. */
export const questionsFor = (s: OutreachSettings, own: ApplicationField[] | null): ApplicationField[] =>
  own?.length ? [...standardQuestions(s), ...own] : s.screening.fields;

/** A position's own questions, or null (none saved, the position is gone, or the migration is not run yet). */
export async function ownQuestions(client: SupabaseClient, orgId: string, positionId: string | null): Promise<ApplicationField[] | null> {
  if (!positionId) return null;
  const { data, error } = await client.from("candidate_positions").select("screening_fields").eq("organization_id", orgId).eq("id", positionId).maybeSingle();
  if (error || !data) return null;
  const list = (data as { screening_fields: unknown }).screening_fields;
  const parsed = z.array(FieldInput).safeParse(list);
  return parsed.success && parsed.data.length ? (parsed.data as ApplicationField[]) : null;
}

export interface PositionScreening {
  standard: ApplicationField[];
  /** HR's whole standard list, used when the position has none of its own. */
  fallback: ApplicationField[];
  own: ApplicationField[];
  max: number;
  hasJd: boolean;
}

async function position(client: SupabaseClient, orgId: string, positionId: unknown) {
  if (typeof positionId !== "string" || !UUID.test(positionId)) throw new CandidateActionError(404, "That position no longer exists.");
  const { data, error } = await client.from("candidate_positions").select("id, title, department, designation, location, jd_text, summary, deleted_at").eq("organization_id", orgId).eq("id", positionId).maybeSingle();
  if (error) throw new CandidateActionError(500, "Couldn't load the position.");
  const p = data as { id: string; title: string; department: string | null; designation: string | null; location: string | null; jd_text: string | null; summary: string | null; deleted_at: string | null } | null;
  if (!p || p.deleted_at) throw new CandidateActionError(404, "That position no longer exists.");
  return p;
}

export async function positionScreening(client: SupabaseClient, orgId: string, positionId: unknown): Promise<PositionScreening> {
  const p = await position(client, orgId, positionId);
  const s = (await loadRecruitmentConfig(client, orgId)).outreach;
  return { standard: standardQuestions(s), fallback: s.screening.fields, own: (await ownQuestions(client, orgId, p.id)) ?? [], max: s.screening.maxQuestions, hasJd: Boolean((p.jd_text || p.summary || "").trim()) };
}

const OWN_TYPES = ["text", "textarea", "number", "select", "date"] as const;

/** Saves the position's own questions (an empty list: the position goes back to the standard list). */
export async function savePositionQuestions(client: SupabaseClient, orgId: string, positionId: unknown, input: unknown): Promise<ApplicationField[]> {
  const p = await position(client, orgId, positionId);
  const s = (await loadRecruitmentConfig(client, orgId)).outreach;
  const parsed = z.array(FieldInput).max(40).safeParse(input ?? []);
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the questions.");
  const standard = standardQuestions(s);
  const fields = parsed.data.map((f) => ({ ...f, target: null })) as ApplicationField[];
  for (const f of fields) {
    if (!(OWN_TYPES as readonly string[]).includes(f.type)) throw new CandidateActionError(400, `"${f.label}": use a short answer, paragraph, number, choice or date.`);
    if (f.type === "select" && (f.options ?? []).length < 2) throw new CandidateActionError(400, `"${f.label}": a choice needs at least two options.`);
  }
  const ids = [...standard.map((f) => f.id), ...fields.map((f) => f.id)];
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new CandidateActionError(400, `Two questions use the id "${dupe}".`);
  if (standard.length + fields.length > s.screening.maxQuestions) {
    throw new CandidateActionError(400, `That is ${standard.length + fields.length} questions with the ${standard.length} standard ones; the most is ${s.screening.maxQuestions} (Recruitment → Outreach → Screening & interviews).`);
  }
  const { error } = await client.from("candidate_positions").update({ screening_fields: fields.length ? fields : null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", p.id);
  if (error) {
    if (missing(error)) throw new CandidateActionError(503, POSITION_SCREENING_MIGRATION_MESSAGE);
    throw new CandidateActionError(500, "The questions could not be saved. Try again.");
  }
  return fields;
}

// The AI draft ----------------------------------------------------------------------------------------------------------

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "type", "options", "required", "help"],
        properties: {
          label: { type: "string", description: "The question, as the candidate reads it; under 140 characters" },
          type: { type: "string", enum: ["text", "textarea", "number", "select"], description: "number for counts and years; select for a fixed set of answers; textarea for a short paragraph" },
          options: { type: "array", items: { type: "string" }, description: "For select: 2 to 6 answers; otherwise empty" },
          required: { type: "boolean" },
          help: { type: "string", description: "A short hint under the question, or empty" },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You write screening questions for an HR team in India. A candidate answers them on a phone before a short screening call.",
  "Write questions that test what this job description really needs: tools, hands-on experience, certifications, the kind of work done, working conditions the role asks for (shifts, travel, field work).",
  "Prefer questions that are quick to answer: a number, a choice, or one line. Use a paragraph only where a short explanation helps the recruiter.",
  "Never ask about age, date of birth, gender, marital status, children, pregnancy, family, religion, caste, community, health, disability, politics, photographs, or anything not about the job.",
  "Do not ask about salary, notice period, current city or total experience: those are already asked.",
  "Plain, polite English. Return JSON only.",
].join(" ");

const BANNED = /\b(age|aged|birth|born|gender|sex|married|marital|spouse|husband|wife|child|children|kids|pregnan\w*|family|religio\w*|caste|community|health|medical|disab\w*|politic\w*|photo\w*|blood group|horoscope)\b/i;
const STANDARD_TOPIC = /\b(salary|ctc|in-hand|take[- ]home|notice period|current city|where do you live|total experience)\b/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const slug = (s: string) => norm(s).split(" ").filter((w) => w.length > 2).slice(0, 4).join("_").slice(0, 32) || "question";

/**
 * Drafts `count` new questions for the position from its JD, leaving out what is already on HR's list (`existing`).
 * Returns them for HR's editor; nothing is saved.
 */
export async function suggestScreeningQuestions(
  client: SupabaseClient, orgId: string, positionId: unknown,
  opts: { count: unknown; existing?: unknown },
  caller: JsonCaller = jobCaller("candidate_screening_questions"),
): Promise<ApplicationField[]> {
  const p = await position(client, orgId, positionId);
  const jd = [p.summary, p.jd_text].filter((x): x is string => Boolean(x && x.trim())).join("\n\n").trim();
  if (!jd) throw new CandidateActionError(400, "Add the job description to the position first: the questions are drafted from it.");
  const s = (await loadRecruitmentConfig(client, orgId)).outreach;
  const standard = standardQuestions(s);
  const existing = z.array(FieldInput).max(40).safeParse(opts.existing ?? []);
  const current = existing.success ? (existing.data as ApplicationField[]) : [];
  const room = s.screening.maxQuestions - standard.length - current.length;
  if (room <= 0) throw new CandidateActionError(400, `The list is at the most allowed (${s.screening.maxQuestions} with the standard ones). Remove some, or raise the limit in Recruitment → Outreach → Screening & interviews.`);
  const asked = Math.round(Number(opts.count));
  const count = Math.max(1, Math.min(Number.isFinite(asked) ? asked : 8, 20, room));

  const avoid = [...standard, ...current].map((f) => f.label);
  const user = [
    `Role: ${p.title}${p.designation ? ` (${p.designation})` : ""}${p.department ? `, ${p.department}` : ""}${p.location ? `, ${p.location}` : ""}`,
    `Job description:\n${jd.slice(0, 15_000)}`,
    `Already asked (do not repeat or rephrase these):\n${avoid.map((l) => `- ${l}`).join("\n")}`,
    `Write ${count} new question${count === 1 ? "" : "s"}.`,
  ].join("\n\n");

  let text: string;
  try {
    ({ text } = await caller({
      label: "screening-questions", system: SYSTEM, user, schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "low", maxTokens: 4000, otherMaxTokens: 2000, timeoutMs: 45_000, budgetMs: 60_000,
      accept: (t) => { try { return Array.isArray(JSON.parse(t).questions); } catch { return false; } },
    }));
  } catch (e) {
    console.error("[candidates] screening questions draft failed", e instanceof Error ? e.message : e);
    throw new CandidateActionError(502, "The AI could not draft questions just now. Try again, or write them yourself.");
  }
  const raw = (JSON.parse(text) as { questions: { label?: unknown; type?: unknown; options?: unknown; required?: unknown; help?: unknown }[] }).questions;
  const seen = new Set(avoid.map(norm));
  const ids = new Set([...standard, ...current].map((f) => f.id));
  const out: ApplicationField[] = [];
  for (const q of raw) {
    const label = String(q.label ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!label || BANNED.test(label) || STANDARD_TOPIC.test(label) || seen.has(norm(label))) continue;
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 100)).filter(Boolean).slice(0, 6);
    let type = (["text", "textarea", "number", "select"] as const).find((t) => t === q.type) ?? "text";
    if (type === "select" && options.length < 2) type = "text";
    let id = `q_${slug(label)}`;
    for (let n = 2; ids.has(id); n += 1) id = `q_${slug(label)}_${n}`;
    ids.add(id);
    seen.add(norm(label));
    const help = String(q.help ?? "").trim().slice(0, 200);
    out.push({ id, label, type, required: q.required !== false, ...(help ? { help } : {}), ...(type === "select" ? { options } : {}), target: null });
    if (out.length >= count) break;
  }
  return out;
}
