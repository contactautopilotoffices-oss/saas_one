/**
 * The resume filters (owner 2026-11-07, option A): education, industry, preferred location, career break, defence
 * background and currently serving notice. Run against the real migrations in PGlite, with and without
 * 20261107000001, because the panel must keep working (and grey these out) before that migration is applied.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterOptions, filterRecords, parseFilters, resetResumeColumnsCheck, resumeFieldAvailability } from "../../backend/lib/candidates/filter-search";
import { blankFields, EMPTY_FILTERS, filterChips, hasBlankableFilter, withoutResumeFields, type SearchFilters } from "../../backend/lib/candidates/filters";
import { createRecord, listRecords } from "../../backend/lib/candidates/records";

import { freshDb, MIGRATION, RESUME_FIELDS_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2026-11-07";

const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });
const education = (level: "ug" | "pg" | "ppg", mode: "any" | "specific" | "none", picks: string[] = []) =>
  ({ ...EMPTY_FILTERS.education, [level]: { mode, picks } });

async function seed(client: SupabaseClient) {
  await createRecord(client, ORG, USER, { fullName: "Asha", location: "Thane", role: "Leasing Manager", noticePeriodDays: 90, remark: "leasing" });
  await createRecord(client, ORG, USER, { fullName: "Bilal", location: "Pune", role: "Leasing Executive", noticePeriodDays: 30, remark: "leasing" });
  await createRecord(client, ORG, USER, { fullName: "Chitra", location: "Mumbai", role: "Architect", noticePeriodDays: 60 });
  await createRecord(client, ORG, USER, { fullName: "Dev", location: "Thane", role: "BMS Operator" });
}

describe("resume filters, migration applied", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const names = async (filters: SearchFilters) => (await filterRecords(client, ORG, filters, 1, 50, TODAY)).records.map((r) => r.fullName).sort();
  const person = (name: string, sql: string, params: unknown[] = []) =>
    db.query(`update public.candidates set ${sql} where full_name = $${params.length + 1}`, [...params, name]);

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    await seed(client);
    await person("Asha", "industry = 'Real estate', ug_qualification = 'B.Com', pg_qualification = 'MBA', institute = 'University of Mumbai', education_type = 'full_time', degree_year = 2015, career_break = true");
    await person("Bilal", "industry = 'Coworking', ug_qualification = 'BBA', pg_qualification = 'none', institute = 'Pune University', education_type = 'part_time', degree_year = 2020, preferred_locations = $1, defence_background = 'army'", [["Mumbai", "Thane"]]);
    await person("Chitra", "industry = 'Real estate', ug_qualification = 'B.Arch', pg_qualification = 'M.Arch', degree_year = 2012, career_break = false");
    await db.query("update public.candidate_applications set serving_notice = true where candidate_id = (select id from public.candidates where full_name = 'Asha')");
  });
  beforeEach(() => resetResumeColumnsCheck());
  after(async () => {
    await db.close();
  });

  it("leaves the earlier migrations safe to re-run, and is safe to re-run itself", async () => {
    await db.exec(MIGRATION);
    await db.exec(RESUME_FIELDS_MIGRATION);
    assert.equal((await filterRecords(client, ORG, f(), 1, 50, TODAY)).total, 4);
  });

  it("loads the resume fields with each record, for the details panel", async () => {
    const res = await filterRecords(client, ORG, f({ role: "architect" }), 1, 50, TODAY);
    assert.equal(res.resumeFields, true);
    assert.deepEqual(res.records[0].extras, {
      industry: "Real estate", preferredLocations: [], ugQualification: "B.Arch", pgQualification: "M.Arch", ppgQualification: null,
      institute: null, educationType: null, degreeYear: 2012, careerBreak: false, defenceBackground: null, servingNotice: null,
    });
  });

  it("counts which resume filters have data, so the rest stay greyed out", async () => {
    const res = await resumeFieldAvailability(client, ORG);
    assert.equal(res.applied, true);
    assert.equal(res.counts.industry, 3);
    assert.equal(res.counts.preferredLocations, 1);
    assert.equal(res.counts.ppg, 0);
    assert.equal(res.counts.careerBreak, 2);
    assert.equal(res.counts.defence, 1);
    assert.equal(res.counts.servingNotice, 1);
  });

  it("filters on industry, institute, education type and degree year", async () => {
    assert.deepEqual(await names(f({ industry: "real estate" })), ["Asha", "Chitra"]);
    assert.deepEqual(await names(f({ institute: "pune" })), ["Bilal"]);
    assert.deepEqual(await names(f({ educationTypes: ["full_time", "part_time"] })), ["Asha", "Bilal"]);
    assert.deepEqual(await names(f({ degreeYearFrom: 2014, degreeYearTo: 2020 })), ["Asha", "Bilal"]);
  });

  it("filters on a specific qualification, and on 'None' only where the CV shows none", async () => {
    assert.deepEqual(await names(f({ education: education("ug", "specific", ["B.Arch", "B.Com"]) })), ["Asha", "Chitra"]);
    assert.deepEqual(await names(f({ education: education("pg", "specific", ["MBA"]) })), ["Asha"]);
    assert.deepEqual(await names(f({ education: education("pg", "none") })), ["Bilal"]);
    assert.deepEqual(await names(f({ education: education("ug", "any") })), ["Asha", "Bilal", "Chitra", "Dev"]);
  });

  it("finds people who would move to the searched place, unless the tick box is cleared", async () => {
    assert.deepEqual(await names(f({ locations: ["Mumbai"] })), ["Bilal", "Chitra"]);
    assert.deepEqual(await names(f({ locations: ["Mumbai"], relocate: false })), ["Chitra"]);
    // "Change preferred location": match moves to these places instead of the searched ones.
    assert.deepEqual(await names(f({ locations: ["Pune"], preferredLocations: ["Thane"] })), ["Bilal"]);
    assert.deepEqual(await names(f({ preferredLocations: ["thane"] })), ["Bilal"]);
  });

  it("adds people serving notice to the notice filter", async () => {
    assert.deepEqual(await names(f({ notice: ["30"] })), ["Bilal"]);
    assert.deepEqual(await names(f({ notice: ["30"], servingNotice: true })), ["Asha", "Bilal"]);
    assert.deepEqual(await names(f({ servingNotice: true })), ["Asha"]);
  });

  it("filters on career break and defence background, never letting an unknown through", async () => {
    assert.deepEqual(await names(f({ careerBreak: true })), ["Asha"]);
    assert.deepEqual(await names(f({ careerBreak: true, includeBlank: true })), ["Asha"]);
    assert.deepEqual(await names(f({ defence: "any" })), ["Bilal"]);
    assert.deepEqual(await names(f({ defence: "army" })), ["Bilal"]);
    assert.deepEqual(await names(f({ defence: "navy" })), []);
  });

  it("counts blank resume fields like any other blank, and names them on the card", async () => {
    const res = await filterRecords(client, ORG, f({ industry: "real estate", includeBlank: true }), 1, 50, TODAY);
    assert.deepEqual(res.records.map((r) => r.fullName).sort(), ["Asha", "Chitra", "Dev"]);
    assert.equal(res.blankCount, 1);
    const dev = res.records.find((r) => r.fullName === "Dev")!;
    assert.deepEqual(blankFields(dev, f({ industry: "x", institute: "y", degreeYearFrom: 2000 })), ["industry", "institute", "degree year"]);
  });

  it("finds a qualification or institute by keyword too", async () => {
    assert.deepEqual(await names(f({ keywords: [{ text: "b.com", required: true }] })), ["Asha"]);
    // Known limit: keywords match inside words, so "mba" also finds "Mumbai". The PG filter is exact.
    assert.deepEqual(await names(f({ keywords: [{ text: "mba", required: true }] })), ["Asha", "Chitra"]);
    assert.deepEqual(await names(f({ education: education("pg", "specific", ["MBA"]) })), ["Asha"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "pune university", required: true }] })), ["Bilal"]);
  });

  it("offers industries and institutes while typing", async () => {
    assert.deepEqual((await filterOptions(client, ORG, "industry", "real")).map((o) => [o.text, o.count]), [["Real estate", 2]]);
    assert.deepEqual((await filterOptions(client, ORG, "institute", "univ")).map((o) => o.text).sort(), ["Pune University", "University of Mumbai"]);
  });

  it("leaves the records table and its own list untouched", async () => {
    const res = await listRecords(client, ORG, { pageSize: 50 });
    assert.equal(res.total, 4);
    assert.equal(res.records[0].extras, undefined);
  });
});

describe("resume filters, before the migration is applied", () => {
  let db: PGlite;
  let client: SupabaseClient;

  before(async () => {
    db = await freshDb({ resumeFields: false });
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    await seed(client);
  });
  beforeEach(() => resetResumeColumnsCheck());
  after(async () => {
    await db.close();
  });

  it("still searches, and says the resume fields were left out", async () => {
    const res = await filterRecords(client, ORG, f({ locations: ["Thane"] }), 1, 50, TODAY);
    assert.equal(res.resumeFields, false);
    assert.deepEqual(res.records.map((r) => r.fullName).sort(), ["Asha", "Dev"]);
    assert.equal(res.records[0].extras, undefined);
  });

  it("ignores a resume filter instead of failing", async () => {
    const res = await filterRecords(client, ORG, f({ industry: "real estate", servingNotice: true, careerBreak: true, education: education("ug", "none") }), 1, 50, TODAY);
    assert.equal(res.total, 4);
  });

  it("reports the resume filters as not available", async () => {
    const res = await resumeFieldAvailability(client, ORG);
    assert.equal(res.applied, false);
    assert.ok(Object.values(res.counts).every((n) => n === 0));
  });

  it("offers no industries while typing, without an error", async () => {
    assert.deepEqual(await filterOptions(client, ORG, "industry", "real"), []);
    assert.equal((await filterOptions(client, ORG, "role", "leas")).length, 2);
  });
});

describe("resume filter logic", () => {
  it("validates the new filters", () => {
    assert.throws(() => parseFilters({ defence: "marines" }), /not valid/);
    assert.throws(() => parseFilters({ educationTypes: ["evening"] }), /not valid/);
    assert.throws(() => parseFilters({ degreeYearFrom: 1800 }), /not valid/);
    assert.throws(() => parseFilters({ education: { ug: { mode: "some", picks: [] } } }), /not valid/);
    const parsed = parseFilters({ education: { pg: { mode: "specific", picks: ["MBA"] } } });
    assert.deepEqual(parsed.education.pg, { mode: "specific", picks: ["MBA"] });
    assert.deepEqual(parsed.education.ug, { mode: "any", picks: [] });
  });

  it("describes them as chips that clear themselves", () => {
    const filters = f({
      industry: "Real estate", preferredLocations: ["Mumbai"], servingNotice: true, institute: "NMIMS", educationTypes: ["full_time"],
      degreeYearFrom: 2010, careerBreak: true, defence: "navy", education: education("pg", "specific", ["MBA"]),
    });
    const chips = filterChips(filters);
    assert.deepEqual(chips.map((c) => c.label), [
      "Would move to: Mumbai", "Notice: Currently serving", "Industry: Real estate", "PG: MBA", "Institute: NMIMS",
      "Education: Full time", "Degree year 2010 or more", "Returning after a career break", "Defence: Navy",
    ]);
    for (const chip of chips) assert.equal(filterChips({ ...filters, ...chip.clear }).some((c) => c.id === chip.id), false, chip.id);
  });

  it("switches every resume filter off for a database without the migration", () => {
    const off = withoutResumeFields(f({ industry: "x", careerBreak: true, defence: "any", servingNotice: true, relocate: true, education: education("ug", "none") }));
    assert.equal(filterChips(off).length, 0);
    assert.equal(off.relocate, false);
    assert.equal(hasBlankableFilter(off), false);
  });
});
