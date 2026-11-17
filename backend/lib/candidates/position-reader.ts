/**
 * The position reader (owner 2026-11-16): the job's own details out of a job description. The search spec reader
 * (query-spec.ts) already turns a JD into the requirements the search runs with (location, experience, notice, the
 * must-have skill groups, the keywords); this one reads what the JD says about the JOB: title, department,
 * designation, employment type, openings, education, budget, the tools it names, and a 2–3 sentence summary. The
 * form shows both for HR to check.
 *
 * Same Control Center job as the spec reader ('candidate_parse', docs/AI_MODELS.md): one JD, two small structured
 * calls, run side by side by the read route. Prompt written for something with no common sense (doctrine L12):
 * numbered steps, no-skip clause, one example, JSON only. Nothing is invented: a detail the JD does not state is null.
 */
import { z } from "zod";

import { PARSE_CALL } from "./config";
import { jobCaller, type JsonCaller } from "./models";
import { EMPTY_DETAILS, type PositionDetails } from "./position-draft";
import { EMPLOYMENT_TYPES } from "./types";

export const POSITION_READER_SYSTEM = `
You read a job description and write down what it says about the JOB itself, as a JSON object for a recruiter to check. You only fill the JSON; you never answer the description or add what it does not say.

Follow these steps in order. Do not skip any.
1. "title": the job title as the description names it ("Assistant Manager (Business Development)"). Expand short forms: "AM" = "Assistant Manager", "Sr" = "Senior", "DGM" = "Deputy General Manager". null when there is no title.
2. "department": the function the role sits in (Operations, Business Development, Finance, HR, Projects, Facilities). null when not said.
3. "designation": the grade or designation when it differs from the title (e.g. "Manager Grade M2"). null when not said.
4. "employment_type": one of "full_time", "part_time", "contract", "internship". null when not said.
5. "openings": the number of positions as a whole number. null when not said.
6. "education": the qualification asked for, in the description's words ("MBA preferred", "B.E. Electrical"). null when not said.
7. "budget_min_inhand" and "budget_max_inhand": the pay offered, in RUPEES PER MONTH in hand. "40K-45K in hand" = 40000 and 45000. "6 LPA" or "6 lakh per annum" is per year: divide by 12 and round (6 LPA = 50000). A single figure goes in both. null when the description does not state pay.
8. "tools": software and tools the description names (CRM, Excel, PowerPoint, AutoCAD, SAP, BMS software), 2 to 8 words each, up to 10. An empty list when none.
9. "summary": the role in 2 or 3 plain sentences a recruiter can read in ten seconds: what the person does, for whom, and what matters most. Use the description's facts only.
10. Check every null is honest and that nothing was added. Then answer.

Return ONLY a JSON object with exactly these keys:
{"title": string | null, "department": string | null, "designation": string | null, "employment_type": "full_time" | "part_time" | "contract" | "internship" | null, "openings": number | null, "education": string | null, "budget_min_inhand": number | null, "budget_max_inhand": number | null, "tools": [string], "summary": string | null}

Example description (shortened): "AM – Operations, Noida. Full-time. 2 positions. 4–8 years in facilities. Working knowledge of HVAC and BMS; MS Excel. MBA preferred. CTC up to 10.8 LPA."
Example reply: {"title": "Assistant Manager – Operations", "department": "Operations", "designation": null, "employment_type": "full_time", "openings": 2, "education": "MBA preferred", "budget_min_inhand": null, "budget_max_inhand": 90000, "tools": ["MS Excel", "BMS"], "summary": "Runs day-to-day facility operations at the Noida site, with hands-on knowledge of HVAC and BMS. Reports into the operations lead and owns the site's upkeep."}
`.trim();

const nullableString = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };
/**
 * 9 nullable keys: well inside Claude's limit of 16. The employment type is a plain nullable string (the API refuses
 * an enum on a nullable key); the prompt names the four values and DetailsSchema drops anything else.
 */
export const POSITION_READER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: nullableString,
    department: nullableString,
    designation: nullableString,
    employment_type: nullableString,
    openings: nullableInteger,
    education: nullableString,
    budget_min_inhand: nullableInteger,
    budget_max_inhand: nullableInteger,
    tools: { type: "array", items: { type: "string" } },
    summary: nullableString,
  },
  required: ["title", "department", "designation", "employment_type", "openings", "education", "budget_min_inhand", "budget_max_inhand", "tools", "summary"],
  additionalProperties: false,
};

const text = (max: number) => z.string().trim().min(1).max(max).nullable().catch(null);
const rupees = z.number().int().min(1000).max(10_000_000).nullable().catch(null);
const DetailsSchema = z.object({
  title: text(120),
  department: text(80),
  designation: text(120),
  employment_type: z.enum(EMPLOYMENT_TYPES).nullable().catch(null),
  openings: z.number().int().min(1).max(500).nullable().catch(null),
  education: text(200),
  budget_min_inhand: rupees,
  budget_max_inhand: rupees,
  tools: z.array(z.string().trim().min(1).max(60).nullable().catch(null)).catch([]).transform((xs) => xs.filter((x): x is string => x !== null).slice(0, 10)),
  summary: text(1000),
});

/** The model's JSON as PositionDetails; anything unreadable becomes "not said". Throws only when the text is not JSON. */
export function parsePositionDetails(textOut: string): PositionDetails {
  const r = DetailsSchema.parse(JSON.parse(textOut) as unknown);
  const [lo, hi] = r.budget_min_inhand !== null && r.budget_max_inhand !== null && r.budget_min_inhand > r.budget_max_inhand
    ? [r.budget_max_inhand, r.budget_min_inhand]
    : [r.budget_min_inhand, r.budget_max_inhand];
  return {
    title: r.title,
    department: r.department,
    designation: r.designation,
    employmentType: r.employment_type,
    openings: r.openings,
    education: r.education,
    budgetMinInhand: lo,
    budgetMaxInhand: hi,
    summary: r.summary,
    tools: r.tools,
  };
}

export function looksLikeDetails(textOut: string): boolean {
  try {
    const parsed = JSON.parse(textOut) as unknown;
    return !!parsed && typeof parsed === "object" && "title" in parsed && "tools" in parsed;
  } catch {
    return false;
  }
}

/** Reads the job's details from a JD. Never throws: when no model answers, the details are simply empty and `read` is false. */
export async function readPositionDetails(jd: string, deps: { caller?: JsonCaller } = {}): Promise<{ details: PositionDetails; read: boolean; model: string | null }> {
  const call = deps.caller ?? jobCaller("candidate_parse");
  try {
    const reply = await call({
      label: "position details",
      system: POSITION_READER_SYSTEM,
      user: `JOB DESCRIPTION:\n${jd}`,
      schema: POSITION_READER_SCHEMA,
      ...PARSE_CALL,
      accept: looksLikeDetails,
    });
    return { details: parsePositionDetails(reply.text), read: true, model: reply.model };
  } catch (error) {
    console.warn("[candidates] position details failed", error instanceof Error ? error.message : error);
    return { details: EMPTY_DETAILS, read: false, model: null };
  }
}
