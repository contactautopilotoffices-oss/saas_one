/**
 * The job-description reader's new shape (owner 2026-11-15): must-have skill groups become starred chips with
 * alternatives, a JD that contradicts itself becomes choices for HR, and the JSON schema stays in step with zod.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conflictChoices, filtersFromSpec, mustPatch } from "../../backend/lib/candidates/filters";
import { buildParsePrompt, parseSpecJson, searchTextFor, SPEC_JSON_SCHEMA, specChips } from "../../backend/lib/candidates/query-spec";
import { understoodFilters } from "../../backend/lib/candidates/filter-search";

const AM_OPS = JSON.stringify({
  summary: "Assistant Manager – Operations in Noida",
  must: { locations: ["Noida"], skill_groups: [["Facility management", "Operations management", "IFM", "Soft services"], ["Vendor management"]] },
  prefer: { roles: ["Assistant Manager – Operations"] },
  keywords: ["HVAC", "BMS", "facility management", "MBA"],
  conflicts: [{
    field: "experience",
    note: "The header says 4–8 years; the candidate profile says 8–12 years.",
    options: [
      { label: "4–8 years", must: { min_total_exp_months: 48, max_total_exp_months: 96 } },
      { label: "8–12 years", must: { min_total_exp_months: 96, max_total_exp_months: 144 } },
    ],
  }],
});

describe("job description reader", () => {
  it("reads skill groups and conflicts, and drops what does not validate", () => {
    const spec = parseSpecJson(AM_OPS);
    assert.ok(spec);
    assert.deepEqual(spec.must.skill_groups, [["Facility management", "Operations management", "IFM", "Soft services"], ["Vendor management"]]);
    assert.equal(spec.conflicts?.length, 1);
    assert.equal(spec.conflicts?.[0].options[0].label, "4–8 years");
    // Too many groups, a group with no spelling, and a conflict with one option: dropped, the rest kept.
    const loose = parseSpecJson(JSON.stringify({
      summary: "x", must: { skill_groups: [["a"], ["b"], ["c"], ["d"], ["e"]] }, prefer: {}, keywords: [],
      conflicts: [{ field: "experience", note: "", options: [{ label: "only one", must: {} }] }],
    }));
    assert.ok(loose);
    assert.equal(loose.must.skill_groups, undefined);
    assert.deepEqual(loose.conflicts, []);
    // No conflicts key at all (an older reply): still a spec.
    assert.deepEqual(parseSpecJson('{"summary":"x","must":{},"prefer":{},"keywords":[]}')?.conflicts, []);
  });

  it("turns each skill group into one starred chip with alternatives, and keeps the rest as plain keywords", () => {
    const spec = parseSpecJson(AM_OPS);
    assert.ok(spec);
    const filters = filtersFromSpec(spec);
    assert.deepEqual(filters.keywords, [
      { text: "Facility management", required: true, alts: ["Operations management", "IFM", "Soft services"] },
      { text: "Vendor management", required: true },
      { text: "HVAC", required: false },
      { text: "BMS", required: false },
      { text: "MBA", required: false },
    ]);
    assert.deepEqual(filters.locations, ["Noida"]);
    // The conflicting experience was left out of must, so it is not filtered until HR picks.
    assert.equal(filters.expMin, null);
    assert.equal(filters.expMax, null);
  });

  it("offers each conflict as filter changes HR can apply with one click", () => {
    const spec = parseSpecJson(AM_OPS);
    assert.ok(spec);
    const choices = conflictChoices(spec);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].field, "experience");
    assert.deepEqual(choices[0].options.map((o) => o.label), ["4–8 years", "8–12 years"]);
    assert.deepEqual(choices[0].options[1].filters, { expBasis: "total", expMin: 8, expMax: 12 });
    // An option that changes nothing is dropped; a conflict left with one option is dropped with it.
    assert.deepEqual(conflictChoices({ ...spec, conflicts: [{ field: "location", note: "", options: [{ label: "a", must: {} }, { label: "b", must: { locations: ["Pune"] } }] }] }), []);
    assert.deepEqual(understoodFilters(spec).conflicts.length, 1);
  });

  it("mustPatch names only the keys the must-haves set", () => {
    assert.deepEqual(mustPatch({}), {});
    assert.deepEqual(mustPatch({ max_notice_days: 30 }), { notice: ["15", "30"] });
    assert.deepEqual(mustPatch({ min_relevant_exp_months: 36, locations: ["Thane"] }), { expBasis: "relevant", expMin: 3, expMax: null, locations: ["Thane"] });
    assert.deepEqual(mustPatch({ max_expected_inhand: 35000 }), { salaryBasis: "expected", salaryUnit: "month", salaryMax: 35 });
  });

  it("shows groups as chips and hands their spellings to the text search", () => {
    const spec = parseSpecJson(AM_OPS);
    assert.ok(spec);
    const labels = specChips(spec).map((c) => c.label);
    assert.ok(labels.includes("Facility management / Operations management / IFM / Soft services"));
    assert.match(searchTextFor(spec, ""), /Soft services/);
  });

  it("keeps the JSON schema in step with the zod shape and the prompt", () => {
    const must = (SPEC_JSON_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>).must.properties;
    assert.ok(must.skill_groups && must.max_total_exp_months);
    assert.deepEqual((SPEC_JSON_SCHEMA.required as string[]), ["summary", "must", "prefer", "keywords", "conflicts"]);
    const prompt = buildParsePrompt("2026-11-15");
    assert.match(prompt, /skill_groups/);
    assert.match(prompt, /"conflicts"/);
    assert.match(prompt, /Bengaluru/);
    assert.match(prompt, /Do not skip any step/);
  });
});
