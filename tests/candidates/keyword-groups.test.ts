/**
 * Keyword chips with alternatives, phrase matching in resumes, the dropdown's count equalling the search's, and
 * "where it matched" on each result (owner 2026-11-15). Against the real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterOptions, filterRecords, keywordHits, parseFilters } from "../../backend/lib/candidates/filter-search";
import { describeFilters, EMPTY_FILTERS, specFromFilters, type SearchFilters } from "../../backend/lib/candidates/filters";
import { createRecord } from "../../backend/lib/candidates/records";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2026-11-15";

const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("keyword groups, phrases and counts", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const names = async (filters: SearchFilters) => (await filterRecords(client, ORG, filters, 1, 50, TODAY)).records.map((r) => r.fullName).sort();
  const resume = (name: string, text: string) => db.query("update public.candidates set resume_text = $1 where full_name = $2", [text, name]);

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    await createRecord(client, ORG, USER, { fullName: "Khyati", currentDesignation: "Digital Marketing Executive", currentOrganization: "Education Street", location: "Mumbai", role: "Marketing" });
    await createRecord(client, ORG, USER, { fullName: "Manoj", currentDesignation: "Technical Executive", currentOrganization: "Table Space", location: "Bengaluru", role: "Technical Executive" });
    await createRecord(client, ORG, USER, { fullName: "Priya", currentDesignation: "BMS Operator", location: "Bengaluru", role: "Technical Executive" });
    await createRecord(client, ORG, USER, { fullName: "Suresh", currentDesignation: "MEP Supervisor", location: "Bengaluru", role: "Facility", remark: "DG and UPS" });
    await createRecord(client, ORG, USER, { fullName: "Lakshmi", currentDesignation: "Electrical Engineer", location: "Bengaluru", role: "Facility", remark: "HVAC maintenance" });
    await resume("Khyati", "Brand strategist with strong technical skills. Executive presence and campaign planning.");
    await resume("Manoj", "Worked as Technical Executive at Table Space handling PPM and breakdowns.");
    await resume("Suresh", "MEP supervisor. HVAC, DG and UPS upkeep for a 52-week PPM calendar.");
  });
  after(async () => {
    await db.close();
  });

  it("matches several words as a phrase in the resume, not as the words anywhere in it", async () => {
    // Khyati's CV has "technical" and "executive" far apart: she used to be found.
    assert.deepEqual(await names(f({ keywords: [{ text: "technical executive", required: true }] })), ["Manoj", "Priya"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "technical", required: true }] })), ["Khyati", "Manoj", "Priya"]);
  });

  it("a chip with alternatives passes a record that has any one of them", async () => {
    assert.deepEqual(await names(f({ keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }] })), ["Lakshmi", "Suresh"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }, { text: "DG", required: true }] })), ["Suresh"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "MEP", required: false, alts: ["HVAC"] }, { text: "bms", required: false }] })), ["Lakshmi", "Priya", "Suresh"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "bms", required: false }], excludes: ["technical executive"] })), []);
  });

  it("the dropdown's number is the number the search will show", async () => {
    const options = await filterOptions(client, ORG, "keyword", "technical exec", TODAY);
    const option = options.find((o) => o.text.toLowerCase() === "technical executive");
    assert.ok(option, "offers Technical Executive");
    const listed = await filterRecords(client, ORG, f({ keywords: [{ text: option.text, required: true }] }), 1, 50, TODAY);
    assert.equal(option.count, listed.total);
    assert.equal(listed.total, 2);
  });

  it("says where each chip matched: the record's fields, the resume, or both", async () => {
    const found = await filterRecords(client, ORG, f({ keywords: [{ text: "technical executive", required: true }, { text: "PPM", required: false }] }), 1, 50, TODAY);
    assert.deepEqual(found.records.map((r) => r.fullName), ["Manoj"]); // the unstarred PPM: at least one of the unstarred words
    assert.deepEqual(found.records[0].keywordHits, [{ text: "technical executive", required: true, where: "both" }, { text: "PPM", required: false, where: "resume" }]);
    const priya = (await filterRecords(client, ORG, f({ keywords: [{ text: "technical executive", required: true }] }), 1, 50, TODAY)).records.find((r) => r.fullName === "Priya");
    assert.deepEqual(priya?.keywordHits, [{ text: "technical executive", required: true, where: "profile" }]);
    const suresh = (await filterRecords(client, ORG, f({ keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }] }), 1, 50, TODAY)).records.find((r) => r.fullName === "Suresh");
    assert.deepEqual(suresh?.keywordHits, [{ text: "MEP", required: true, where: "both" }]);
    const lakshmi = (await filterRecords(client, ORG, f({ keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }] }), 1, 50, TODAY)).records.find((r) => r.fullName === "Lakshmi");
    assert.deepEqual(lakshmi?.keywordHits, [{ text: "HVAC", required: true, where: "profile" }]);
  });

  it("keywordHits never claims a match it cannot see", () => {
    const record = { fullName: "X", email: null, phone: null, currentOrganization: null, currentDesignation: "Executive", location: null, role: null, candidateSource: null, remark: null } as never;
    assert.deepEqual(keywordHits(record, "technical skills, executive presence", [{ text: "technical executive", required: true }]), []);
    assert.deepEqual(keywordHits(record, "a Technical\nExecutive role", [{ text: "technical executive", required: true }]), [{ text: "technical executive", required: true, where: "resume" }]);
  });

  it("validates, describes and hands the ranking every spelling of a chip", () => {
    const parsed = parseFilters({ keywords: [{ text: "MEP", required: true, alts: ["HVAC", "VRF"] }] });
    assert.deepEqual(parsed.keywords, [{ text: "MEP", required: true, alts: ["HVAC", "VRF"] }]);
    assert.throws(() => parseFilters({ keywords: [{ text: "MEP", required: true, alts: Array.from({ length: 11 }, () => "x") }] }), /not valid/);
    assert.equal(describeFilters(parsed), "Candidates with MEP / HVAC / VRF.");
    assert.deepEqual(specFromFilters(parsed).keywords, ["MEP", "HVAC", "VRF"]);
  });
});
