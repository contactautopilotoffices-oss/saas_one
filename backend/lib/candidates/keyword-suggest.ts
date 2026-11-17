/**
 * "AI suggested keywords" under the search bar (owner 2026-11-06). Spec block: docs/features/candidate_search.md.
 *   1. the model proposes related search terms from the keywords alone (Control Center job 'candidate_suggest')
 *   2. every term is shown as soon as the model answers
 *   3. afterwards, in a second request, the page asks how many records carry each term and shows that beside it
 * If no model answers, the job titles that sit beside these keywords in the records are offered instead.
 *
 * Owner 2026-11-11: step 2 used to wait for a check against the records and drop every term not found on them. On a
 * small database that threw away 14 to 16 of the model's 16 terms (the server log showed "0 of 16", "1 of 16") after a
 * 1.2 to 3.1 s wait, so the panel looked slow and nearly empty. Now nothing is dropped and nothing waits for the
 * records: a term nobody has yet is still a useful search word once more resumes arrive. The trade: a click on a term
 * that is on no record can empty the list when it is the only keyword or is starred; the count beside each term (0
 * shown as "none yet") tells HR before the click.
 *
 * The model's terms depend only on the keywords, so they are kept for six hours per keyword set for every organisation
 * together: a recruiter never waits twice and a repeat costs nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { SUGGEST_CALL, SUGGEST_COUNT_MAX, SUGGEST_MAX } from "./config";
import { keywordCounts } from "./filter-search";
import type { KeywordSuggestion } from "./filters";
import { jobCaller, type JsonCaller } from "./models";

const Reply = z.object({ terms: z.array(z.string().trim().min(2).max(40)).max(24) });

export const SUGGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { terms: { type: "array", items: { type: "string" } } },
  required: ["terms"],
  additionalProperties: false,
};

export const SUGGEST_SYSTEM = `You help a recruiter at an Indian coworking and facility-management company widen a candidate search. You are given the keywords already in the search. You only fill the JSON; you never answer in words.

Follow these steps in order. Do not skip any step.
1. Work out the job family the keywords describe.
2. List up to 16 other short search terms a recruiter would add for that job family: skills, systems, job titles, and the different ways the same thing is written on a CV.
3. Keep each term to 1-3 words. Use the way it is written on Indian CVs.
4. Leave out the keywords you were given, and anything that names a person, a gender, an age, a religion or a caste.
5. Reply with the JSON object only: {"terms": [<term>, ...]}.

Example keywords: "BMS operator"
Example reply: {"terms": ["Building Automation", "HVAC", "BMS Engineer", "Honeywell", "Energy Monitoring", "DG Set", "MEP", "Facility Technician"]}`;

export function parseSuggestReply(text: string): string[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = Reply.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data.terms : null;
  } catch {
    return null;
  }
}

const contains = (text: string) => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function visible(client: SupabaseClient, orgId: string, columns: string, options?: { count: "exact"; head: true }) {
  return client.from("candidate_records").select(columns, options).eq("organization_id", orgId).eq("sheet_live", true).is("deleted_at", null);
}

/** Search finds people by phone and email too, so one can be typed as a keyword. Those never go to a model. */
const looksPersonal = (keyword: string) => keyword.includes("@") || /\d{6,}/.test(keyword.replace(/[\s()+-]/g, ""));

/** No model answered: the roles and designations on records that carry these keywords. */
async function fromRecords(client: SupabaseClient, orgId: string, keywords: string[]): Promise<string[]> {
  const tally = new Map<string, { text: string; n: number }>();
  for (const keyword of keywords.slice(0, 3)) {
    const { data } = await visible(client, orgId, "role, current_designation").ilike("lookup_text", contains(keyword)).limit(300);
    for (const row of (data ?? []) as unknown as { role: string | null; current_designation: string | null }[]) {
      for (const value of [row.role, row.current_designation]) {
        const text = value?.trim();
        if (!text || text.length > 40) continue;
        const entry = tally.get(text.toLowerCase());
        if (entry) entry.n += 1;
        else tally.set(text.toLowerCase(), { text, n: 1 });
      }
    }
  }
  return [...tally.values()].sort((a, b) => b.n - a.n).map((t) => t.text).slice(0, 16);
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
/** The model's terms per keyword set. No organisation in the key: the terms come from the keywords alone. */
const cache = new Map<string, { at: number; terms: string[] }>();

/** The keywords as the model and the cache see them: lower case, no quotes or line breaks, nothing personal, in order. */
function cleanKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.replace(/["\r\n]/g, " ").trim().toLowerCase()).filter((k) => k && !looksPersonal(k)))].sort();
}

/**
 * Related search terms for these keywords, without their counts (`count` is null until countKeywords fills it in).
 * Nothing here reads the records unless no model answers.
 */
export async function suggestKeywords(
  client: SupabaseClient,
  orgId: string,
  keywords: string[],
  caller: JsonCaller = jobCaller("candidate_suggest"),
  now = Date.now(),
): Promise<KeywordSuggestion[]> {
  const given = cleanKeywords(keywords);
  if (!given.length) return [];
  const shape = (terms: string[]): KeywordSuggestion[] =>
    [...new Map(terms.map((t) => [t.toLowerCase(), t])).entries()].filter(([low]) => !given.includes(low)).slice(0, SUGGEST_MAX).map(([, text]) => ({ text, count: null }));
  const key = given.join("|");
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return shape(hit.terms);

  const started = Date.now();
  let terms: string[] | null = null;
  let model: string | null = null;
  try {
    const reply = await caller({
      label: "candidate-search:suggest",
      system: SUGGEST_SYSTEM,
      user: `Keywords: ${given.map((k) => `"${k}"`).join(", ")}`,
      schema: SUGGEST_JSON_SCHEMA,
      ...SUGGEST_CALL,
      accept: (text) => parseSuggestReply(text) !== null,
    });
    terms = parseSuggestReply(reply.text);
    model = reply.model;
  } catch (error) {
    console.warn("[candidates] keyword suggestions fell back to the records", error instanceof Error ? error.message : error);
  }
  // Only the model's answer is kept: a passing failure must not leave this search on the fallback for hours.
  if (terms) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, terms });
  }
  const value = shape(terms ?? (await fromRecords(client, orgId, given)));
  console.info(`[candidates] keyword suggestions: ${value.length} terms, model ${model ?? "none"}, ${Date.now() - started} ms`);
  return value;
}

/**
 * How many of this organisation's records carry each term, counted the way the search itself matches a keyword (the
 * record's own fields, or a whole word in the resume's text). A term that could not be counted comes back with null.
 */
export async function countKeywords(client: SupabaseClient, orgId: string, terms: string[]): Promise<KeywordSuggestion[]> {
  const wanted = [...new Map(terms.map((t) => [t.trim().toLowerCase(), t.trim()])).values()].filter((t) => t && !looksPersonal(t)).slice(0, SUGGEST_COUNT_MAX);
  return keywordCounts(client, orgId, wanted);
}

/** Tests only. */
export function clearSuggestCache(): void {
  cache.clear();
}
