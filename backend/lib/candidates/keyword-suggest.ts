/**
 * "AI suggested keywords" under the search bar (owner 2026-11-06). Spec block: docs/features/candidate_search.md.
 *   1. the model proposes related search terms from the keywords alone (Control Center job 'candidate_suggest')
 *   2. code keeps only terms found on this organisation's records, so a click can never empty the results
 * If no model answers, the job titles that sit beside these keywords in the records are offered instead. Answers are
 * kept for an hour per organisation and keyword set, so a recruiter never waits twice and a repeat costs nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { SUGGEST_CALL, SUGGEST_CHECK_MAX, SUGGEST_MAX } from "./config";
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

/** The terms that appear on this organisation's records, with how many records carry each. */
async function keepFound(client: SupabaseClient, orgId: string, terms: string[]): Promise<{ found: KeywordSuggestion[]; complete: boolean }> {
  const counted = await Promise.all(terms.map(async (text) => {
    const { count, error } = await visible(client, orgId, "id", { count: "exact", head: true }).ilike("lookup_text", contains(text));
    return { text, count: count ?? 0, failed: !!error };
  }));
  return { found: counted.filter((t) => t.count > 0).map(({ text, count }) => ({ text, count })), complete: !counted.some((t) => t.failed) };
}

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

const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: KeywordSuggestion[] }>();

export async function suggestKeywords(
  client: SupabaseClient,
  orgId: string,
  keywords: string[],
  caller: JsonCaller = jobCaller("candidate_suggest"),
  now = Date.now(),
): Promise<KeywordSuggestion[]> {
  const given = [...new Set(keywords.map((k) => k.replace(/["\r\n]/g, " ").trim().toLowerCase()).filter((k) => k && !looksPersonal(k)))].sort();
  if (!given.length) return [];
  const key = `${orgId}:${given.join("|")}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

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
  const candidates = [...new Map((terms ?? (await fromRecords(client, orgId, given))).map((t) => [t.toLowerCase(), t])).entries()]
    .filter(([low]) => !given.includes(low))
    .map(([, t]) => t);
  const { found, complete } = await keepFound(client, orgId, candidates.slice(0, SUGGEST_CHECK_MAX));
  const value = found.slice(0, SUGGEST_MAX);
  console.info(`[candidates] keyword suggestions: ${value.length} of ${candidates.length} on records, model ${model ?? "none"}, ${Date.now() - started} ms`);

  // Only a full answer is kept: a passing failure must not leave this search without suggestions for an hour.
  if (terms && complete) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, value });
  }
  return value;
}

/** Tests only. */
export function clearSuggestCache(): void {
  cache.clear();
}
