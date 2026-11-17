/**
 * Second round of the redesign (owner 2026-11-11): what is worked out from a resume's employers and how it is marked,
 * the new ways to order the list, and the resume's text laid out for reading. Pure functions first, then the real
 * migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterRecords, getFullRecord } from "../../backend/lib/candidates/filter-search";
import { EMPTY_FILTERS, SORT_LABELS, SORTS, type SearchFilters } from "../../backend/lib/candidates/filters";
import { inferFromEmployers } from "../../backend/lib/candidates/infer";
import { createRecord, updateRecord } from "../../backend/lib/candidates/records";
import { inferMissingDetails } from "../../backend/lib/candidates/resume-extract";
import { formatMonth, formatResume } from "../../backend/lib/candidates/resume-format";
import type { PastCompany } from "../../backend/lib/candidates/types";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-11-11T10:00:00Z");
const TODAY = "2026-11-11";
const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });
const job = (company: string, designation: string | null, from: string | null, to: string | null): PastCompany => ({ company, designation, from, to });

describe("working details out from the employers a resume lists", () => {
  it("takes the job still running as the current one and counts the months the dates cover", () => {
    const got = inferFromEmployers([
      job("Skyward Offices", "Facility Executive", "2018-06", "2021-03"),
      job("Harbour Realty", "Senior Facility Manager", "2021-04", null),
    ], NOW);
    assert.deepEqual([got.designation, got.company], ["Senior Facility Manager", "Harbour Realty"]);
    // Jun 2018 to Mar 2021 is 33 months; Apr 2021 to Nov 2026 is 67.
    assert.equal(got.totalMonths, 100);
  });
  it("counts a month worked in two jobs once and leaves a gap between jobs out", () => {
    const overlap = inferFromEmployers([job("A", null, "2020-01", "2021-01"), job("B", null, "2020-07", "2021-07")], NOW);
    assert.equal(overlap.totalMonths, 18);
    const gap = inferFromEmployers([job("A", null, "2015-01", "2016-01"), job("B", null, "2020-01", "2021-01")], NOW);
    assert.equal(gap.totalMonths, 24);
  });
  it("reads years on their own, and treats the job that ended last as the latest when none is running", () => {
    const got = inferFromEmployers([job("Old Co", "Trainee", "2016", "2018"), job("New Co", "Manager", "2018", "2023")], NOW);
    assert.deepEqual([got.designation, got.company, got.totalMonths], ["Manager", "New Co", 84]);
    assert.equal(inferFromEmployers([job("One Year Co", null, "2020", "2020")], NOW).totalMonths, 6, "a job inside one year is part of that year");
  });
  it("claims nothing it cannot support", () => {
    assert.deepEqual(inferFromEmployers([], NOW), { designation: null, company: null, totalMonths: null });
    assert.deepEqual(inferFromEmployers(null, NOW), { designation: null, company: null, totalMonths: null });
    // No dates at all: the first job listed is the latest one, and there is no experience to add up.
    assert.deepEqual(inferFromEmployers([job("First Listed", "Lead", null, null), job("Second", "Junior", null, null)], NOW), { designation: "Lead", company: "First Listed", totalMonths: null });
    // An old job with no end date is not assumed to run until today; only the latest one is.
    assert.equal(inferFromEmployers([job("Old", null, "2010-01", null), job("Now", null, "2024-11", null)], NOW).totalMonths, 24);
    assert.equal(inferFromEmployers([job("Future", null, "2031-01", null)], NOW).totalMonths, null);
    assert.equal(inferFromEmployers([job("Typo", null, "1960-01", null)], NOW).totalMonths, null, "dates that add up to more than a working life are not believed");
  });
});

describe("the resume's text laid out for reading", () => {
  const RESUME = [
    "ASHA RAO",
    "Senior Facility Manager",
    "asha@example.com | 98200 00000",
    "",
    "PROFESSIONAL SUMMARY",
    "Facility manager with eight years in commercial real estate. Skilled at driving member",
    "engagement and running large technical teams across",
    "",
    "two cities.",
    "W O R K  E X P E R I E N C E",
    "Senior Facility Manager, Harbour Realty | Apr 2021 – Present",
    "• Ran BMS and HVAC operations for a 12-floor tower,",
    "leading 14 technicians.",
    "•",
    "◦Cut unplanned downtime by a third.",
    "Skills:",
    "BMS, HVAC, Fire systems",
    "Vendor management",
    "Languages: English, Hindi",
    "HOBBIES &",
    "INTERESTS",
    "Travelling | Photography",
    "EDUCATION",
    "MBA Operations",
    "University of Mumbai",
    "2016 - 2018",
  ].join("\n");
  const blocks = formatResume(RESUME);
  const headings = blocks.filter((b) => b.kind === "heading").map((b) => (b.kind === "heading" ? b.text : ""));

  it("finds the section headings however the file wrote them, and shows them one way", () => {
    assert.deepEqual(headings, ["Professional summary", "Work experience", "Skills", "Hobbies & interests", "Education"]);
  });
  it("joins a sentence the file broke over lines, even across an empty line", () => {
    const summary = blocks[blocks.findIndex((b) => b.kind === "heading" && b.text === "Professional summary") + 1];
    assert.deepEqual(summary, { kind: "paragraph", text: "Facility manager with eight years in commercial real estate. Skilled at driving member engagement and running large technical teams across two cities." });
  });
  it("keeps bullets as bullets, joins a wrapped one, and drops bullet marks that stand alone", () => {
    const bullets = blocks.find((b) => b.kind === "bullets");
    assert.deepEqual(bullets, { kind: "bullets", items: ["Ran BMS and HVAC operations for a 12-floor tower, leading 14 technicians.", "Cut unplanned downtime by a third."] });
  });
  it("sets a job line with dates apart, and a line in capitals that is not a known heading", () => {
    const roles = blocks.filter((b) => b.kind === "role").map((b) => (b.kind === "role" ? b.text : ""));
    assert.deepEqual(roles, ["ASHA RAO", "Senior Facility Manager, Harbour Realty | Apr 2021 – Present", "2016 - 2018"]);
  });
  it("turns a skills list into labels, but keeps a labelled line whole", () => {
    const tags = blocks.filter((b) => b.kind === "tags").map((b) => (b.kind === "tags" ? b.items : []));
    assert.deepEqual(tags, [["BMS", "HVAC", "Fire systems", "Vendor management"], ["Travelling", "Photography"]]);
    assert.ok(blocks.some((b) => b.kind === "paragraph" && b.text === "Languages: English, Hindi"));
  });
  it("does not mistake a list item for a heading, and copes with nothing", () => {
    const skills = formatResume("SKILLS\nProject Management\nCommunication Skills\nTeam Leadership");
    assert.deepEqual(skills, [{ kind: "heading", text: "Skills" }, { kind: "tags", items: ["Project Management", "Communication Skills", "Team Leadership"] }]);
    assert.deepEqual(formatResume(""), []);
    assert.deepEqual(formatResume(null), []);
  });
  it("groups short lines that stand together", () => {
    assert.deepEqual(formatResume("Bengaluru, India\nlinkedin.com/in/someone\n\nOpen to relocation"), [{ kind: "lines", items: ["Bengaluru, India", "linkedin.com/in/someone", "Open to relocation"] }]);
  });
  it("writes an employer's dates the way people read them", () => {
    assert.deepEqual([formatMonth("2021-06"), formatMonth("2021"), formatMonth(null), formatMonth("Jun 21")], ["Jun 2021", "2021", null, "Jun 21"]);
  });
});

describe("the list's order", () => {
  it("offers the orders that suit candidates from resumes as well as from sheets", () => {
    assert.deepEqual([...SORTS], ["recent", "added", "updated", "name", "experience", "relevant", "notice", "salary"]);
    assert.ok(SORTS.every((sort) => SORT_LABELS[sort]));
  });
});

describe("worked-out details in the database", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const ids: Record<string, { id: string; candidateId: string }> = {};

  const person = async (name: string) =>
    (await db.query<{ current_designation: string | null; current_organization: string | null; total_exp_months: number | null; inferred_fields: string[] }>(
      "select current_designation, current_organization, total_exp_months, inferred_fields from public.candidates where id = $1", [ids[name].candidateId],
    )).rows[0];

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const add = async (key: string, body: Record<string, unknown>, past: PastCompany[], summary: string | null = "From a resume.") => {
      const { record } = await createRecord(client, ORG, USER, body);
      ids[key] = { id: record.id, candidateId: record.candidateId };
      await db.query("update public.candidates set past_companies = $1::jsonb, resume_summary = $2 where id = $3", [JSON.stringify(past), summary, record.candidateId]);
    };
    // Nothing on record: all three can be worked out.
    await add("blank", { fullName: "Blank Person", email: "blank@example.com" }, [job("Skyward", "Executive", "2018-06", "2021-03"), job("Harbour Realty", "Senior Manager", "2021-04", null)]);
    // HR typed the designation: it stays; the rest is worked out.
    await add("typed", { fullName: "Typed Person", email: "typed@example.com", currentDesignation: "Head of Facilities" }, [job("Northgate", "Manager", "2020", "2024")]);
    // Complete already: untouched.
    await add("full", { fullName: "Full Person", email: "full@example.com", currentDesignation: "Lead", currentOrganization: "Crest", totalExpMonths: 60 }, [job("Other", "Junior", "2019", null)]);
    // No resume data: not looked at, even with employers on the row.
    await add("sheet", { fullName: "Sheet Person", email: "sheet@example.com" }, [job("Somewhere", "Clerk", "2019", null)], null);
    // Resume data, but employers with nothing to go on.
    await add("vague", { fullName: "Vague Person", email: "vague@example.com", currentOrganization: "Known Co", currentDesignation: "Known Role" }, [job("Known Co", null, null, null)]);
  });
  after(async () => {
    await db.close();
  });

  it("fills only what is empty, for people with resume data, and remembers which values it worked out", async () => {
    assert.equal(await inferMissingDetails(client, ORG, NOW), 2);
    assert.deepEqual(await person("blank"), { current_designation: "Senior Manager", current_organization: "Harbour Realty", total_exp_months: 100, inferred_fields: ["currentDesignation", "currentOrganization", "totalExpMonths"] });
    assert.deepEqual(await person("typed"), { current_designation: "Head of Facilities", current_organization: "Northgate", total_exp_months: 48, inferred_fields: ["currentOrganization", "totalExpMonths"] });
    assert.deepEqual(await person("full"), { current_designation: "Lead", current_organization: "Crest", total_exp_months: 60, inferred_fields: [] });
    assert.deepEqual(await person("sheet"), { current_designation: null, current_organization: null, total_exp_months: null, inferred_fields: [] });
    assert.deepEqual((await person("vague")).total_exp_months, null, "no dates, no experience claimed");
    assert.equal(await inferMissingDetails(client, ORG, NOW), 0, "a second run has nothing left to do");
  });

  it("the screens are told which values were worked out, and the values are searchable", async () => {
    const full = await getFullRecord(client, ORG, ids.blank.id);
    assert.deepEqual([full.currentDesignation, full.totalExpMonths, full.inferred], ["Senior Manager", 100, ["currentDesignation", "currentOrganization", "totalExpMonths"]]);
    assert.equal((await getFullRecord(client, ORG, ids.full.id)).inferred, undefined);
    const found = await filterRecords(client, ORG, f({ sort: "experience" }), 1, 20, TODAY);
    assert.deepEqual(found.records.slice(0, 3).map((r) => [r.fullName, r.totalExpMonths, r.inferred?.includes("totalExpMonths") ?? false]), [["Blank Person", 100, true], ["Full Person", 60, false], ["Typed Person", 48, true]]);
    assert.deepEqual((await filterRecords(client, ORG, f({ designation: "Senior Manager" }), 1, 20, TODAY)).records.map((r) => r.fullName), ["Blank Person"]);
  });

  it("a value a person types is theirs: the mark goes", async () => {
    await updateRecord(client, ORG, USER, ids.blank.id, { currentDesignation: "Facility Manager" });
    assert.deepEqual((await person("blank")).inferred_fields, ["currentOrganization", "totalExpMonths"]);
    await updateRecord(client, ORG, USER, ids.blank.id, { remark: "Called on Monday" });
    assert.deepEqual((await person("blank")).inferred_fields, ["currentOrganization", "totalExpMonths"], "an edit elsewhere changes nothing here");
    // Cleared by hand, it may be worked out again later (it is empty again), and is marked again.
    await updateRecord(client, ORG, USER, ids.blank.id, { totalExpMonths: null });
    assert.deepEqual((await person("blank")).inferred_fields, ["currentOrganization"]);
    assert.equal(await inferMissingDetails(client, ORG, NOW), 1);
    assert.deepEqual([(await person("blank")).total_exp_months, (await person("blank")).inferred_fields], [100, ["currentOrganization", "totalExpMonths"]]);
  });

  it("orders the list by name, by when a candidate was added, and by relevant experience", async () => {
    const names = async (sort: SearchFilters["sort"]) => (await filterRecords(client, ORG, f({ sort }), 1, 20, TODAY)).records.map((r) => r.fullName);
    assert.deepEqual(await names("name"), ["Blank Person", "Full Person", "Sheet Person", "Typed Person", "Vague Person"]);
    assert.equal((await names("added"))[0], "Vague Person", "the last one added comes first");
    await updateRecord(client, ORG, USER, ids.sheet.id, { relevantExpMonths: 30 });
    assert.equal((await names("relevant"))[0], "Sheet Person", "a record with no relevant experience comes after those with one");
    assert.equal((await names("updated"))[0], "Sheet Person");
  });
});
