/**
 * The Create position form's draft (owner 2026-11-16), pure: a JD's two readings become one draft; a saved position
 * becomes the draft to edit it; the draft's requirements become the search the position runs with; and the position
 * reader's JSON is read without inventing anything.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftFromPosition, draftFromReads, emptyDraft, filtersFromDraft, preferFromDraft } from "../../backend/lib/candidates/position-draft";
import { looksLikeDetails, parsePositionDetails, POSITION_READER_SCHEMA, POSITION_READER_SYSTEM } from "../../backend/lib/candidates/position-reader";
import type { SearchSpec } from "../../backend/lib/candidates/query-spec";
import type { Position } from "../../backend/lib/candidates/types";

const SPEC: SearchSpec = {
  summary: "AM BD in Noida",
  must: {
    locations: ["Noida", "Delhi", "Gurugram"],
    min_total_exp_months: 60,
    max_total_exp_months: 84,
    max_notice_days: 30,
    skill_groups: [["Business development", "Enterprise B2B sales", "Client acquisition"], ["Commercial real estate", "Coworking", "Managed office"]],
  },
  prefer: { roles: ["Business Development Manager"] },
  keywords: ["brokers", "negotiation", "CRM", "Business development"],
};

describe("the position draft", () => {
  it("joins the two readings: details first, the spec's requirements, no duplicates between groups, keywords and tools", () => {
    const d = draftFromReads(SPEC, {
      title: "Assistant Manager (Business Development)", department: "Business Development", designation: null, employmentType: "full_time", openings: 2,
      education: null, budgetMinInhand: 60000, budgetMaxInhand: 75000, summary: "Drives enterprise client acquisition.", tools: ["CRM", "Excel", "PowerPoint"],
    }, "JD text", "AM_BD.pdf");
    assert.equal(d.title, "Assistant Manager (Business Development)");
    assert.deepEqual([d.department, d.employmentType, d.openings, d.location, d.budgetMinInhand, d.budgetMaxInhand], ["Business Development", "full_time", 2, "Noida", 60000, 75000]);
    assert.deepEqual([d.expMinYears, d.expMaxYears, d.noticeMaxDays], [5, 7, 30]);
    assert.deepEqual(d.mustHaves, [{ text: "Business development", alts: ["Enterprise B2B sales", "Client acquisition"] }, { text: "Commercial real estate", alts: ["Coworking", "Managed office"] }]);
    assert.deepEqual(d.tools, ["CRM", "Excel", "PowerPoint"]);
    // "Business development" is a must-have and "CRM" a tool: neither is repeated among the nice-to-haves.
    assert.deepEqual(d.niceToHaves, ["brokers", "negotiation"]);
    assert.deepEqual([d.jdText, d.jdFileName, d.prefer], ["JD text", "AM_BD.pdf", SPEC.prefer]);
  });

  it("falls back for the title (preferred role, then the file name) and keeps the defaults", () => {
    const none = { title: null, department: null, designation: null, employmentType: null, openings: null, education: null, budgetMinInhand: null, budgetMaxInhand: null, summary: null, tools: [] };
    assert.equal(draftFromReads(SPEC, none, "x", null).title, "Business Development Manager");
    assert.equal(draftFromReads({ ...SPEC, prefer: {} }, none, "x", "Sr_TE-Bengaluru.docx").title, "Sr TE Bengaluru");
    const d = draftFromReads({ ...SPEC, prefer: {} }, none, "x", null);
    assert.deepEqual([d.openings, d.priority, d.targetDays, d.hiringManager], [1, "normal", 21, null]);
    assert.equal(emptyDraft().title, "");
  });

  it("turns the requirements into the search: must-haves starred with their spellings, the rest plain, the ranges as filters", () => {
    const d = { ...emptyDraft(), title: "AM BD", location: "Noida", expMinYears: 5, expMaxYears: 7, noticeMaxDays: 30, budgetMaxInhand: 75000, mustHaves: [{ text: "Business development", alts: ["B2B sales"] }], niceToHaves: ["brokers", "Business development"], tools: ["CRM", "brokers"] };
    const f = filtersFromDraft(d);
    assert.deepEqual(f.keywords, [{ text: "Business development", required: true, alts: ["B2B sales"] }, { text: "brokers", required: false }, { text: "CRM", required: false }]);
    assert.deepEqual([f.locations, f.expBasis, f.expMin, f.expMax], [["Noida"], "total", 5, 7]);
    assert.deepEqual(f.notice, ["15", "30"], "notice up to 30 days = the two buckets within it");
    assert.deepEqual([f.salaryBasis, f.salaryUnit, f.salaryMax, f.includeNoSalary], ["expected", "month", 75, true]);
    assert.deepEqual(filtersFromDraft({ ...d, noticeMaxDays: 10 }).notice, ["15"], "a short notice still allows the first bucket");
    assert.deepEqual(filtersFromDraft({ ...d, noticeMaxDays: null, budgetMaxInhand: null }).notice, []);
    assert.deepEqual(preferFromDraft({ ...d, prefer: { roles: ["BD Manager"], max_notice_days: 30 } }), { roles: ["AM BD", "BD Manager"], max_notice_days: 30 });
  });

  it("reads a saved position back into the form, requirements out of its filters", () => {
    const p = {
      id: "p1", title: "AM BD", department: "BD", location: "Noida", jdFileName: "jd.pdf", jdText: "the JD", status: "open", targetDays: 30,
      designation: null, employmentType: "contract", openings: 2, hiringManager: "Lohitaksha", priority: "urgent", education: "MBA", budgetMinInhand: null, budgetMaxInhand: null, summary: "s",
      filters: { keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }, { text: "AutoCAD", required: false }], locations: ["Noida"], expMin: 4, expMax: 8, notice: ["15", "30", "60"], salaryBasis: "expected", salaryUnit: "month", salaryMin: 40, salaryMax: 60 },
      prefer: { roles: ["AM BD"] }, recruiterName: null, createdAt: "", updatedAt: "", closedAt: null, daysOpen: 1, counts: {},
    } as unknown as Position;
    const d = draftFromPosition(p);
    assert.deepEqual([d.title, d.employmentType, d.openings, d.hiringManager, d.priority, d.targetDays, d.education, d.jdText], ["AM BD", "contract", 2, "Lohitaksha", "urgent", 30, "MBA", "the JD"]);
    assert.deepEqual([d.expMinYears, d.expMaxYears, d.noticeMaxDays], [4, 8, 60]);
    assert.deepEqual(d.mustHaves, [{ text: "MEP", alts: ["HVAC"] }]);
    assert.deepEqual(d.niceToHaves, ["AutoCAD"]);
    assert.deepEqual([d.budgetMinInhand, d.budgetMaxInhand], [40000, 60000], "the budget read back from the salary filter when the position has none");
  });

  it("reads the position reader's answer without inventing, and its schema stays within Claude's limit", () => {
    assert.equal(looksLikeDetails('{"title":"x","tools":[]}'), true);
    assert.equal(looksLikeDetails("nope"), false);
    const d = parsePositionDetails(JSON.stringify({ title: " AM BD ", department: null, designation: "", employment_type: "gig", openings: 0, education: "MBA", budget_min_inhand: 80000, budget_max_inhand: 60000, tools: ["CRM", 7, ""], summary: "ok" }));
    assert.deepEqual([d.title, d.designation, d.employmentType, d.openings, d.education], ["AM BD", null, null, null, "MBA"]);
    assert.deepEqual([d.budgetMinInhand, d.budgetMaxInhand], [60000, 80000], "a reversed budget is put the right way round");
    assert.deepEqual(d.tools, ["CRM"]);
    assert.throws(() => parsePositionDetails("not json"));
    const props = POSITION_READER_SCHEMA.properties as Record<string, { type: unknown }>;
    const nullable = Object.values(props).filter((p) => Array.isArray(p.type) && (p.type as unknown[]).includes("null")).length;
    assert.ok(nullable <= 16 && nullable === 9, `nullable keys: ${nullable}`);
    assert.match(POSITION_READER_SYSTEM, /Do not skip any/);
    assert.match(POSITION_READER_SYSTEM, /RUPEES PER MONTH/);
  });
});
