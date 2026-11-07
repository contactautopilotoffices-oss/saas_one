/**
 * The filter panel, run against the real migration in PGlite: filters, blank details, sorting, the typing dropdown, the
 * AI ranking of filtered records, and keyword suggestions. Models are scripted; nothing here calls the network.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyFilters, filterOptions, filterRecords, isOptionField, parseFilters, preferredItems, understoodFilters,
} from "../../backend/lib/candidates/filter-search";
import {
  blankFields, describeFilters, EMPTY_FILTERS, filterChips, hasActiveFilter, hasBlankableFilter, noticeBucketsUpTo, salaryRupees, sourcedSince, specFromFilters,
  type SearchFilters,
} from "../../backend/lib/candidates/filters";
import { clearSuggestCache, parseSuggestReply, suggestKeywords, SUGGEST_JSON_SCHEMA, SUGGEST_SYSTEM } from "../../backend/lib/candidates/keyword-suggest";
import type { JsonCaller } from "../../backend/lib/candidates/models";
import { createRecord } from "../../backend/lib/candidates/records";
import { rankFiltered } from "../../backend/lib/candidates/search";
import type { CandidateRecord } from "../../backend/lib/candidates/types";
import { AI_JOBS } from "../../task-manager/ai/aiCatalog";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2026-11-06";

const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("filter panel against the real schema", () => {
  let db: PGlite;
  let client: SupabaseClient;

  const add = (orgId: string, fullName: string, fields: Record<string, unknown>) => createRecord(client, orgId, USER, { fullName, ...fields });
  const names = async (filters: SearchFilters) => (await filterRecords(client, ORG, filters, 1, 50, TODAY)).records.map((r) => r.fullName).sort();

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1), ($2)", [ORG, OTHER_ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    await add(ORG, "Asha", { role: "Leasing Manager", currentDesignation: "Senior Leasing Manager", currentOrganization: "Harbour Realty", location: "Mumbai", totalExpMonths: 108, relevantExpMonths: 84, noticePeriodDays: 60, currentInhand: 120000, expectedInhand: 145000, remark: "Commercial real estate", sourcingDate: "2026-10-20", status: "in_process" });
    await add(ORG, "Bilal", { role: "Leasing Executive", currentDesignation: "Leasing Executive", currentOrganization: "Skyward Workspaces", location: "Navi Mumbai", totalExpMonths: 48, relevantExpMonths: 36, noticePeriodDays: 30, currentInhand: 48000, expectedInhand: 60000, remark: "Coworking leasing", sourcingDate: "2026-09-01" });
    await add(ORG, "Chitra", { role: "Sales Manager", currentDesignation: "Sales Manager", currentOrganization: "Terrace Homes", location: "Thane", totalExpMonths: 72, relevantExpMonths: 60, noticePeriodDays: 90, expectedInhand: 75000, remark: "Residential real estate sales", sourcingDate: "2026-01-10", status: "rejected" });
    await add(ORG, "Dev", { role: "BMS Operator", currentDesignation: "BMS Operator", currentOrganization: "Northgate, Facility (Services)", location: "Thane", totalExpMonths: 60, remark: "100% uptime_record" });
    await add(ORG, "Esha", { role: "Leasing Manager", location: null, totalExpMonths: 120, noticePeriodDays: 120, expectedInhand: 200000, sourcingDate: "2026-11-01", remark: "Commercial leasing" });
    await add(OTHER_ORG, "Zed", { role: "Leasing Manager", location: "Mumbai", remark: "Commercial real estate" });
  });
  after(async () => {
    await db.close();
  });

  it("shows everyone, of this organisation only, with no filter", async () => {
    assert.deepEqual(await names(f()), ["Asha", "Bilal", "Chitra", "Dev", "Esha"]);
  });

  it("needs every starred keyword and at least one of the others", async () => {
    assert.deepEqual(await names(f({ keywords: [{ text: "Real Estate", required: true }] })), ["Asha", "Chitra"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "real estate", required: true }, { text: "commercial", required: true }] })), ["Asha"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "bms", required: false }, { text: "coworking", required: false }] })), ["Bilal", "Dev"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "leasing", required: true }, { text: "coworking", required: false }, { text: "commercial", required: false }] })), ["Asha", "Bilal", "Esha"]);
  });

  it("leaves out excluded words", async () => {
    assert.deepEqual(await names(f({ keywords: [{ text: "real estate", required: false }], excludes: ["residential"] })), ["Asha"]);
  });

  it("takes what HR types literally, quotes, brackets, commas, % and _ included", async () => {
    assert.deepEqual(await names(f({ company: "Northgate, Facility (Services)" })), ["Dev"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "100%", required: false }] })), ["Dev"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "uptime_record", required: true }] })), ["Dev"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "uptimeXrecord", required: true }] })), []);
    assert.deepEqual(await names(f({ keywords: [{ text: 'a"b\\c', required: false }] })), []);
    assert.deepEqual(await names(f({ keywords: [{ text: "%", required: true }] })), ["Dev"]);
  });

  it("filters on location, experience, notice and salary", async () => {
    assert.deepEqual(await names(f({ locations: ["Mumbai"] })), ["Asha", "Bilal"]);
    assert.deepEqual(await names(f({ expBasis: "total", expMin: 5, expMax: 9 })), ["Asha", "Chitra", "Dev"]);
    assert.deepEqual(await names(f({ expBasis: "relevant", expMin: 5 })), ["Asha", "Chitra"]);
    assert.deepEqual(await names(f({ notice: ["30"] })), ["Bilal"]);
    assert.deepEqual(await names(f({ notice: ["90", "more"] })), ["Chitra", "Esha"]);
    assert.deepEqual(await names(f({ salaryBasis: "expected", salaryUnit: "month", salaryMin: 60, salaryMax: 100 })), ["Bilal", "Chitra"]);
    assert.deepEqual(await names(f({ salaryBasis: "current", salaryUnit: "year", salaryMax: 6 })), ["Bilal"]);
  });

  it("filters on role, company, designation, status and sourcing date", async () => {
    assert.deepEqual(await names(f({ role: "leasing manager" })), ["Asha", "Esha"]);
    assert.deepEqual(await names(f({ company: "skyward" })), ["Bilal"]);
    assert.deepEqual(await names(f({ designation: "senior" })), ["Asha"]);
    assert.deepEqual(await names(f({ status: "rejected" })), ["Chitra"]);
    assert.deepEqual(await names(f({ excludeStatuses: ["rejected", "in_process"] })), ["Bilal", "Dev", "Esha"]);
    assert.deepEqual(await names(f({ sourcedMonths: 3 })), ["Asha", "Bilal", "Esha"]);
    assert.deepEqual(await names(f({ sourcedAfter: "2026-09-02", sourcedBefore: "2026-10-31" })), ["Asha"]);
  });

  it("counts the records hidden only for a blank field, and shows them on request", async () => {
    const strict = await filterRecords(client, ORG, f({ notice: ["30", "60"] }), 1, 50, TODAY);
    assert.equal(strict.total, 2);
    assert.equal(strict.blankCount, 1); // Dev has no notice period
    const loose = await filterRecords(client, ORG, f({ notice: ["30", "60"], includeBlank: true }), 1, 50, TODAY);
    assert.equal(loose.total, 3);
    assert.equal(loose.blankCount, 1);
    assert.ok(loose.records.some((r) => r.fullName === "Dev"));
  });

  it("does not bring blank records through a word filter or for a filter that cannot be blank", async () => {
    assert.equal((await filterRecords(client, ORG, f({ keywords: [{ text: "bms", required: true }] }), 1, 50, TODAY)).blankCount, 0);
    assert.equal(hasBlankableFilter(f({ keywords: [{ text: "x", required: true }], status: "new" })), false);
  });

  it("the salary tick box lets through records with no salary, without any other blank", async () => {
    const filters = f({ salaryBasis: "current", salaryUnit: "month", salaryMin: 40, includeNoSalary: true });
    assert.deepEqual(await names(filters), ["Asha", "Bilal", "Chitra", "Dev", "Esha"]);
    assert.deepEqual(await names({ ...filters, locations: ["Mumbai"] }), ["Asha", "Bilal"]);
  });

  it("sorts, with blanks last, and pages", async () => {
    const sorted = async (sort: SearchFilters["sort"]) => (await filterRecords(client, ORG, f({ sort }), 1, 50, TODAY)).records.map((r) => r.fullName);
    assert.deepEqual((await sorted("recent")).slice(0, 2), ["Esha", "Asha"]);
    assert.equal((await sorted("recent")).at(-1), "Dev");
    assert.deepEqual((await sorted("experience")).slice(0, 2), ["Esha", "Asha"]);
    assert.deepEqual((await sorted("notice")).slice(0, 2), ["Bilal", "Asha"]);
    assert.equal((await sorted("notice")).at(-1), "Dev");
    const first = await filterRecords(client, ORG, f(), 1, 2, TODAY);
    const second = await filterRecords(client, ORG, f(), 2, 2, TODAY);
    assert.equal(first.total, 5);
    assert.equal(new Set([...first.records, ...second.records].map((r) => r.id)).size, 4);
  });

  it("does not show deleted records", async () => {
    const { record } = await add(ORG, "Gone", { role: "Unique Role" });
    await db.query("update public.candidate_applications set deleted_at = now() where id = $1", [record.id]);
    assert.deepEqual(await names(f({ role: "unique role" })), []);
  });

  it("offers what the records hold while typing, best match first, with no other organisation's data", async () => {
    const roles = await filterOptions(client, ORG, "role", "leas");
    assert.deepEqual(roles.map((o) => [o.text, o.count]), [["Leasing Manager", 2], ["Leasing Executive", 1]]);
    const keywords = await filterOptions(client, ORG, "keyword", "thane");
    assert.deepEqual(keywords.map((o) => [o.text, o.kind]), [["Thane", "Location"]]);
    assert.deepEqual(await filterOptions(client, ORG, "location", "  "), []);
    assert.equal((await filterOptions(client, OTHER_ORG, "role", "leasing")).length, 1);
    assert.equal(isOptionField("keyword"), true);
    assert.equal(isOptionField("gender"), false);
    assert.equal(isOptionField("constructor"), false);
  });

  it("AI ranking scores the filtered records, in the visible order, and logs the run", async () => {
    let seen = "";
    const caller: JsonCaller = async (req) => {
      seen = req.user;
      return { text: JSON.stringify({ ranking: [
        { id: "c1", role: 90, experience: 80, domain: 70, reasons: ["Leasing"], missing: [], summary: "Good" },
        { id: "c2", role: 50, experience: 50, domain: 50, reasons: [], missing: [], summary: "Fair" },
      ] }), model: "scripted" };
    };
    const res = await rankFiltered(client, ORG, USER, f({ locations: ["Mumbai"] }), {}, "", { caller, today: TODAY });
    assert.equal(res.aiRanked, true);
    assert.equal(res.comparedCount, 2);
    assert.deepEqual(res.results.map((r) => r.record.fullName), ["Asha", "Bilal"]);
    assert.ok((res.results[0].matchPercent ?? 0) > (res.results[1].matchPercent ?? 0));
    assert.match(seen, /Mumbai/);
    assert.doesNotMatch(seen, /Asha|Bilal/); // the ranker sees no names
    const logged = (await db.query<{ rank_model: string; matching_count: number }>("select rank_model, matching_count from public.candidate_search_logs where id = $1", [res.searchId])).rows[0];
    assert.deepEqual(logged, { rank_model: "scripted", matching_count: 2 });
  });

  it("says so when the ranking is unavailable", async () => {
    const down: JsonCaller = async () => { throw new Error("boom"); };
    const res = await rankFiltered(client, ORG, USER, f({ locations: ["Mumbai"] }), {}, "", { caller: down, today: TODAY });
    assert.equal(res.aiRanked, false);
    assert.match(res.notices.join(" "), /unavailable/);
  });

  describe("keyword suggestions", () => {
    beforeEach(() => clearSuggestCache());

    it("keeps only terms found on the records and leaves out what is already searched", async () => {
      const caller: JsonCaller = async () => ({ text: JSON.stringify({ terms: ["Real Estate", "Quantum Physics", "Leasing", "COMMERCIAL"] }), model: "m" });
      const res = await suggestKeywords(client, ORG, ["leasing"], caller);
      assert.deepEqual(res.map((s) => s.text).sort(), ["COMMERCIAL", "Real Estate"]);
      assert.ok(res.every((s) => s.count > 0));
    });

    it("asks once per keyword set", async () => {
      let calls = 0;
      const caller: JsonCaller = async () => { calls += 1; return { text: '{"terms": ["Coworking"]}', model: "m" }; };
      await suggestKeywords(client, ORG, ["leasing", "real estate"], caller);
      await suggestKeywords(client, ORG, ["Real Estate", "LEASING"], caller);
      assert.equal(calls, 1);
    });

    it("sends only the keywords to the model", async () => {
      let seen = "";
      const caller: JsonCaller = async (req) => { seen = req.user; return { text: '{"terms": []}', model: "m" }; };
      await suggestKeywords(client, ORG, ["bms"], caller);
      assert.equal(seen, 'Keywords: "bms"');
    });

    it("never sends a typed phone number or email to the model, and cleans quotes and new lines", async () => {
      const seen: string[] = [];
      const caller: JsonCaller = async (req) => { seen.push(req.user); return { text: '{"terms": []}', model: "m" }; };
      assert.deepEqual(await suggestKeywords(client, ORG, ["+91 98765 43210", "asha@example.com"], caller), []);
      assert.equal(seen.length, 0);
      await suggestKeywords(client, ORG, ["98765 43210", 'bms"\nignore'], caller);
      assert.deepEqual(seen, ['Keywords: "bms  ignore"']);
    });

    it("does not keep a failed answer, so the next try can succeed", async () => {
      let calls = 0;
      const flaky: JsonCaller = async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { text: '{"terms": ["Coworking"]}', model: "m" };
      };
      await suggestKeywords(client, ORG, ["leasing"], flaky);
      const second = await suggestKeywords(client, ORG, ["leasing"], flaky);
      assert.equal(calls, 2);
      assert.deepEqual(second.map((s) => s.text), ["Coworking"]);
    });

    it("falls back to the job titles beside the keyword when no model answers", async () => {
      const down: JsonCaller = async () => { throw new Error("boom"); };
      const res = await suggestKeywords(client, ORG, ["leasing"], down);
      assert.ok(res.some((s) => s.text === "Leasing Manager"));
    });

    it("asks nothing for no keywords", async () => {
      const never: JsonCaller = async () => { throw new Error("should not be called"); };
      assert.deepEqual(await suggestKeywords(client, ORG, ["  "], never), []);
    });
  });
});

describe("filter logic", () => {
  const record = (patch: Partial<CandidateRecord>) => ({ location: "Thane", totalExpMonths: 12, relevantExpMonths: 12, noticePeriodDays: 30, currentInhand: 1, expectedInhand: 1, role: "x", currentOrganization: "y", currentDesignation: "z", sourcingDate: "2026-01-01", ...patch }) as CandidateRecord;

  it("rejects filters it does not know how to run", () => {
    assert.throws(() => parseFilters({ notice: ["forever"] }), /not valid/);
    assert.throws(() => parseFilters({ sourcedMonths: 7 }), /not valid/);
    assert.throws(() => parseFilters({ status: "hired" }), /not valid/);
    assert.throws(() => parseFilters({ keywords: Array.from({ length: 21 }, () => ({ text: "a", required: false })) }), /not valid/);
    assert.deepEqual(parseFilters({ sourcedMonths: 6 }).sourcedMonths, 6);
    assert.deepEqual(parseFilters(undefined), EMPTY_FILTERS);
  });

  it("converts salaries to rupees a month, in hand", () => {
    assert.deepEqual(salaryRupees(f({ salaryUnit: "year", salaryMin: 12, salaryMax: 24, salaryBasis: "current" })), { column: "current_inhand", min: 100000, max: 200000 });
    assert.deepEqual(salaryRupees(f({ salaryUnit: "month", salaryMax: 35 })), { column: "expected_inhand", min: null, max: 35000 });
    assert.equal(salaryRupees(f()), null);
  });

  it("works out the sourcing window from today", () => {
    assert.equal(sourcedSince(3, "2026-11-06"), "2026-08-06");
    assert.equal(sourcedSince(12, "2026-11-06"), "2025-11-06");
  });

  it("names which filtered field a record is blank on", () => {
    assert.deepEqual(blankFields(record({ noticePeriodDays: null, location: null }), f({ notice: ["30"], locations: ["Thane"] })), ["location", "notice period"]);
    assert.deepEqual(blankFields(record({ noticePeriodDays: null }), f({ locations: ["Thane"] })), []);
    assert.deepEqual(blankFields(record({ relevantExpMonths: null }), f({ expBasis: "relevant", expMin: 1 })), ["experience"]);
  });

  it("describes a search in words", () => {
    const filters = f({ keywords: [{ text: "leasing", required: true }], locations: ["Thane", "Pune"], expMin: 3, expMax: 8, excludes: ["residential"] });
    assert.equal(describeFilters(filters), "Candidates with leasing in Thane or Pune, total exp 3 yrs to 8 yrs, leaving out residential.");
    assert.equal(hasActiveFilter(f()), false);
    assert.equal(hasActiveFilter(filters), true);
    assert.deepEqual(filterChips(f({ salaryMax: 8 })).map((c) => c.label), ["Expected up to ₹8L a year"]);
  });

  it("clearing a chip removes that filter", () => {
    for (const chip of filterChips(f({ locations: ["Thane"], expMin: 2, notice: ["30"], salaryMin: 1, role: "r", company: "c", designation: "d", status: "new", sourcedMonths: 3 }))) {
      const after = { ...f({ locations: ["Thane"], expMin: 2, notice: ["30"], salaryMin: 1, role: "r", company: "c", designation: "d", status: "new", sourcedMonths: 3 }), ...chip.clear };
      assert.equal(filterChips(after).some((c) => c.id === chip.id), false, chip.id);
    }
  });

  it("gives the ranking the filters as its code-computed criteria", () => {
    const spec = specFromFilters(f({ locations: ["Thane"], expBasis: "relevant", expMin: 3, notice: ["15", "30"], salaryUnit: "month", salaryMax: 35, keywords: [{ text: "bms", required: true }] }));
    assert.deepEqual(spec.must, { locations: ["Thane"], min_relevant_exp_months: 36, max_notice_days: 30, max_expected_inhand: 35000 });
    assert.deepEqual(spec.keywords, ["bms"]);
    assert.equal(specFromFilters(f({ notice: ["30", "more"] })).must.max_notice_days, undefined);
  });

  it("turns a job description the AI read into filters", () => {
    const { filters, preferred } = understoodFilters({
      summary: "s",
      must: { locations: ["Thane"], min_relevant_exp_months: 36, max_notice_days: 30, exclude_statuses: ["rejected"], roles: ["BMS Operator"], max_expected_inhand: 35000 },
      prefer: { roles: ["Facility Manager"], max_notice_days: 15 },
      keywords: ["BMS", "bms operator", "HVAC"],
    });
    assert.deepEqual(filters.keywords, [{ text: "BMS Operator", required: true }, { text: "BMS", required: false }, { text: "HVAC", required: false }]);
    assert.deepEqual(filters.notice, ["15", "30"]);
    assert.equal(filters.expBasis, "relevant");
    assert.equal(filters.expMin, 3);
    assert.equal(filters.salaryMax, 35);
    assert.equal(filters.salaryUnit, "month");
    assert.deepEqual(filters.excludeStatuses, ["rejected"]);
    assert.deepEqual(preferred.map((p) => p.key), ["roles", "max_notice_days"]);
  });

  it("buckets a notice limit, and lists a preference with its words", () => {
    assert.deepEqual(noticeBucketsUpTo(0), ["15"]);
    assert.deepEqual(noticeBucketsUpTo(60), ["15", "30", "60"]);
    assert.deepEqual(noticeBucketsUpTo(120), ["15", "30", "60", "90", "more"]);
    assert.deepEqual(preferredItems({ locations: ["Pune"] }), [{ key: "locations", label: "Location: Pune" }]);
  });

  it("quotes values so a typed comma or bracket cannot add a filter", () => {
    const calls: string[] = [];
    const builder = { or(v: string) { calls.push(v); return this; }, ilike() { return this; }, eq() { return this; }, not() { return this; } };
    applyFilters(builder, f({ role: 'a,b).or(x"' }), false, TODAY);
    assert.deepEqual(calls, ['role.ilike."%a,b).or(x\\"%"']);
  });

  it("the suggestions step has a model job, a strict reply shape and rules for what never to offer", () => {
    const job = AI_JOBS.find((j) => j.key === "candidate_suggest");
    assert.equal(job?.group, "Candidate Search");
    assert.equal(job?.defaults[0], "anthropic:claude-haiku-5-5");
    assert.equal(SUGGEST_JSON_SCHEMA.additionalProperties, false);
    assert.match(SUGGEST_SYSTEM, /Do not skip any step/);
    assert.match(SUGGEST_SYSTEM, /gender/);
    assert.deepEqual(parseSuggestReply('noise {"terms": ["HVAC"]} noise'), ["HVAC"]);
    assert.equal(parseSuggestReply("no json"), null);
    assert.equal(parseSuggestReply('{"terms": "HVAC"}'), null);
  });
});
