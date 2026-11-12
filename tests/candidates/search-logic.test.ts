import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCandidateAccess } from "../../backend/lib/candidates/access";
import { comparePoolSize } from "../../backend/lib/candidates/config";
import { fallbackSpec, parseQuery, parseSpecJson, searchTextFor, SPEC_JSON_SCHEMA, SpecSchema, specChips } from "../../backend/lib/candidates/query-spec";
import { combine, deterministicScores, parseRerankReply, recordLine, rerank, RERANK_JSON_SCHEMA } from "../../backend/lib/candidates/rerank";
import { validateSearchBody } from "../../backend/lib/candidates/search";
import type { CandidateRecord } from "../../backend/lib/candidates/types";
import { callModels, type ChainDeps, type JsonCaller, type JsonRequest } from "../../backend/lib/candidates/models";
import { AI_JOBS } from "../../task-manager/ai/aiCatalog";

function record(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: "r1",
    candidateId: "p1",
    sheetId: "s1",
    sheetName: "June.xlsx",
    sourceRow: 2,
    fullName: "Amit Babu",
    email: "er.babu.amit@gmail.com",
    phone: "7534855802",
    currentOrganization: "Cushman & Wakefield",
    currentDesignation: "MEP Engineer",
    location: "Noida",
    totalExpMonths: 48,
    role: "BMS Operator",
    candidateSource: "Pratyarth Services",
    sourcingDate: "2026-06-30",
    relevantExpMonths: 48,
    noticePeriodDays: 15,
    currentInhand: 35000,
    expectedInhand: 37000,
    remark: "Rejected cause budget issue",
    status: "rejected",
    indexed: true,
    createdAt: "2026-11-02T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const fixed = (reply: string): JsonCaller => async () => ({ text: reply, model: "test-model" });
const down: JsonCaller = async () => {
  throw new Error("boom");
};

describe("access", () => {
  it("allows HR roles, org super admin, tech and master admins only", () => {
    for (const role of ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin", "tech", "HR"]) {
      assert.equal(resolveCandidateAccess({ isMasterAdmin: false, orgRoles: [role] }), true, role);
    }
    for (const role of ["staff", "org_admin", "procurement", "tenant", "mst"]) {
      assert.equal(resolveCandidateAccess({ isMasterAdmin: false, orgRoles: [role] }), false, role);
    }
    assert.equal(resolveCandidateAccess({ isMasterAdmin: true, orgRoles: [] }), true);
    assert.equal(resolveCandidateAccess({ isMasterAdmin: false, orgRoles: [] }), false);
  });
});

describe("validateSearchBody (owner: custom top N, max 30)", () => {
  it("accepts 1..30", () => {
    assert.deepEqual(validateSearchBody({ query: " bms ", topN: 30 }), { query: "bms", topN: 30 });
    assert.deepEqual(validateSearchBody({ query: "bms", topN: "7" }), { query: "bms", topN: 7 });
  });
  it("rejects out of range, fractions and empty queries", () => {
    for (const topN of [0, 31, 2.5, "x", null]) assert.throws(() => validateSearchBody({ query: "bms", topN }), /Top N/);
    assert.throws(() => validateSearchBody({ query: "  ", topN: 10 }), /Type what/);
  });
  it("sizes the compared pool at about 3 x N within 20..45", () => {
    assert.equal(comparePoolSize(1), 20);
    assert.equal(comparePoolSize(10), 30);
    assert.equal(comparePoolSize(30), 45);
  });
});

describe("query spec", () => {
  it("keeps valid keys and drops invalid ones without failing the whole spec", () => {
    const spec = parseSpecJson(
      JSON.stringify({
        summary: "BMS operators",
        must: { min_relevant_exp_months: 36, max_notice_days: 9999, statuses: ["rejected", "bogus"], locations: [], evil: "DROP TABLE" },
        prefer: { roles: ["BMS Operator"], max_expected_inhand: "35000" },
        keywords: ["BMS", "HVAC"],
      }),
    );
    assert.ok(spec);
    assert.deepEqual(spec.must, { min_relevant_exp_months: 36 });
    assert.deepEqual(spec.prefer, { roles: ["BMS Operator"] });
    assert.deepEqual(spec.keywords, ["BMS", "HVAC"]);
  });
  it("reads JSON wrapped in prose and rejects non-JSON", () => {
    assert.equal(parseSpecJson('Here: {"summary": "x", "must": {}, "prefer": {}, "keywords": []} done')?.summary, "x");
    assert.equal(parseSpecJson("no json here"), null);
  });
  it("falls back to text-only search when the model is down", async () => {
    const outcome = await parseQuery("bms operator thane", "2026-11-02", down);
    assert.equal(outcome.aiParsed, false);
    assert.deepEqual(outcome.spec, fallbackSpec("bms operator thane"));
  });
  it("uses the model's spec when it validates", async () => {
    const outcome = await parseQuery("x", "2026-11-02", fixed('{"summary":"s","must":{"max_notice_days":30},"prefer":{},"keywords":["BMS"]}'));
    assert.equal(outcome.aiParsed, true);
    assert.equal(outcome.spec.must.max_notice_days, 30);
  });
  it("labels chips and builds the search text", () => {
    const spec = {
      summary: "s",
      must: { min_relevant_exp_months: 36, max_notice_days: 30, exclude_statuses: ["rejected" as const] },
      prefer: { roles: ["BMS Operator"], max_expected_inhand: 35000 },
      keywords: ["HVAC"],
    };
    assert.deepEqual(specChips(spec), [
      { kind: "must", label: "Relevant exp ≥ 3 yrs" },
      { kind: "must", label: "Notice ≤ 30 days" },
      { kind: "must", label: "Not: Rejected" },
      { kind: "prefer", label: "Role: BMS Operator" },
      { kind: "prefer", label: "Expected ≤ ₹35K/month" },
      { kind: "keyword", label: "HVAC" },
    ]);
    assert.equal(searchTextFor(spec, "q"), "HVAC BMS Operator");
    assert.equal(searchTextFor(fallbackSpec("raw words"), "raw words"), "raw words");
  });
});

describe("Claude calls (owner: Claude, not Groq)", () => {
  it("are two Control Center jobs, defaulting to Claude Opus 5.5", () => {
    for (const key of ["candidate_parse", "candidate_rank"]) {
      const job = AI_JOBS.find((j) => j.key === key);
      assert.ok(job, key);
      assert.equal(job.group, "Candidate Search");
      assert.deepEqual([...job.defaults], ["anthropic:claude-opus-5-5"]);
      assert.deepEqual([...job.providers].sort(), ["anthropic", "engy", "gemini", "groq"]);
    }
  });

  it("sends the parse request with its JSON schema at low effort", async () => {
    const seen: Parameters<JsonCaller>[0][] = [];
    await parseQuery("bms", "2026-11-02", async (req) => {
      seen.push(req);
      return { text: '{"summary":"s","must":{},"prefer":{},"keywords":[]}', model: "m" };
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].effort, "low");
    assert.equal(seen[0].user, "bms");
    assert.equal(seen[0].schema, SPEC_JSON_SCHEMA);
  });

  it("sends the ranking request with its JSON schema at medium effort", async () => {
    const seen: Parameters<JsonCaller>[0][] = [];
    await rerank("q", fallbackSpec("q"), [record()], 1, async (req) => {
      seen.push(req);
      return { text: '{"ranking":[]}', model: "m" };
    });
    assert.equal(seen[0].effort, "medium");
    assert.equal(seen[0].schema, RERANK_JSON_SCHEMA);
    assert.doesNotMatch(seen[0].user, /Amit|gmail|7534855802/);
  });

  it("keeps the JSON schemas in step with the zod validators", () => {
    const props = (schema: Record<string, unknown>, key: string) =>
      Object.keys(((schema.properties as Record<string, { properties: object }>)[key]).properties).sort();
    assert.deepEqual(props(SPEC_JSON_SCHEMA, "must"), Object.keys(SpecSchema.shape.must.unwrap().shape).sort());
    assert.deepEqual(props(SPEC_JSON_SCHEMA, "prefer"), Object.keys(SpecSchema.shape.prefer.unwrap().shape).sort());
  });
});

describe("model chain (Control Center main + backups)", () => {
  const req = (over: Partial<JsonRequest> = {}): JsonRequest => ({
    label: "t", system: "s", user: "u", schema: {}, effort: "low", maxTokens: 100, otherMaxTokens: 50, timeoutMs: 10_000, budgetMs: 30_000, ...over,
  });
  const deps = (chain: string[], answers: Record<string, string | Error>, calls: string[] = []): Partial<ChainDeps> => {
    const answer = async (model: string) => {
      calls.push(model);
      const a = answers[model];
      if (a instanceof Error || a === undefined) throw a ?? new Error("no answer");
      return a;
    };
    return { chain: async () => chain, claude: (m) => answer(`claude:${m}`), other: (m) => answer(m), now: () => 0 };
  };

  it("sends Claude models to the SDK path (prefix removed) and others to the shared transport", async () => {
    const calls: string[] = [];
    const reply = await callModels("candidate_parse", req(), deps(["anthropic:claude-opus-5-5"], { "claude:claude-opus-5-5": "{}" }, calls));
    assert.deepEqual(reply, { text: "{}", model: "anthropic:claude-opus-5-5" });
    assert.deepEqual(calls, ["claude:claude-opus-5-5"]);
    const other = await callModels("candidate_parse", req(), deps(["groq:openai/gpt-oss-120b"], { "groq:openai/gpt-oss-120b": "{}" }));
    assert.equal(other.model, "groq:openai/gpt-oss-120b");
  });

  it("moves to the backup on an error or a reply in the wrong shape, in order", async () => {
    const calls: string[] = [];
    const reply = await callModels(
      "candidate_rank",
      req({ accept: (t) => t.startsWith("{") }),
      deps(["glm-5.3-flash", "qwen3.8-27b", "anthropic:claude-opus-5-5"], { "glm-5.3-flash": new Error("HTTP 500"), "qwen3.8-27b": "not json", "claude:claude-opus-5-5": "{ok}" }, calls),
    );
    assert.equal(reply.model, "anthropic:claude-opus-5-5");
    assert.deepEqual(calls, ["glm-5.3-flash", "qwen3.8-27b", "claude:claude-opus-5-5"]);
  });

  it("throws when every model fails, naming each failure", async () => {
    await assert.rejects(callModels("candidate_parse", req(), deps(["a", "b"], { a: new Error("x"), b: new Error("y") })), /a: x; b: y/);
  });

  it("stops starting new models once the step's time budget is used up", async () => {
    let t = 0;
    const calls: string[] = [];
    const d: Partial<ChainDeps> = {
      chain: async () => ["slow", "next"],
      other: async (m, _r, timeoutMs) => {
        calls.push(`${m}:${timeoutMs}`);
        t += 29_000;
        throw new Error("timeout");
      },
      now: () => t,
    };
    await assert.rejects(callModels("candidate_rank", req({ budgetMs: 30_000, timeoutMs: 45_000 }), d), /out of time/);
    assert.deepEqual(calls, ["slow:30000"], "the per-model timeout is capped by what is left, and no model starts with < 3 s left");
  });

  it("reports which model answered in the search outcome", async () => {
    const parsed = await parseQuery("x", "2026-11-02", fixed('{"summary":"s","must":{},"prefer":{},"keywords":[]}'));
    assert.equal(parsed.model, "test-model");
    const fallback = await parseQuery("x", "2026-11-02", down);
    assert.equal(fallback.model, null);
  });
});

describe("ranking", () => {
  const spec = {
    summary: "",
    must: { max_notice_days: 30 },
    prefer: { locations: ["Thane"], max_expected_inhand: 35000 },
    keywords: [],
  };

  it("scores location, notice and salary in code", () => {
    assert.deepEqual(deterministicScores(record(), spec), { location: 0, notice: 100, salary: 81 });
    assert.deepEqual(deterministicScores(record({ location: null, noticePeriodDays: 45, expectedInhand: null }), spec), {
      location: 50,
      notice: 50,
      salary: 50,
    });
  });

  it("scores only the criteria that apply and rescales weights to 100", () => {
    const { overall, criteria } = combine({ role: 100, experience: 50 });
    assert.deepEqual(criteria.map((c) => [c.key, c.weight]), [["role", 58], ["experience", 42]]);
    assert.equal(overall, 79);
    assert.deepEqual(combine({}), { overall: 0, criteria: [] });
  });

  it("never shows the model a name, email or phone", () => {
    const line = recordLine("c1", record());
    assert.doesNotMatch(line, /Amit|gmail|7534855802/);
    assert.match(line, /role sourced for: BMS Operator/);
  });

  it("ignores unknown ids and bad entries in the model's reply", () => {
    const map = parseRerankReply(
      JSON.stringify({ ranking: [{ id: "c1", role: 90, experience: 80, domain: 70 }, { id: "c9", role: 100 }, "junk"] }),
      new Set(["c1", "c2"]),
    );
    assert.deepEqual([...map.keys()], ["c1"]);
  });

  it("orders by overall match and returns the top N", async () => {
    const records = [record({ id: "a" }), record({ id: "b", location: "Thane" }), record({ id: "c" })];
    const reply = JSON.stringify({
      ranking: [
        { id: "c1", role: 40, experience: 40, domain: 40, reasons: [], missing: [], summary: "weak" },
        { id: "c2", role: 95, experience: 90, domain: 80, reasons: ["Current BMS operator"], missing: [], summary: "strong" },
        { id: "c3", role: 70, experience: 70, domain: 60, reasons: [], missing: ["HVAC not stated"], summary: "ok" },
      ],
    });
    const { results, aiRanked } = await rerank("q", spec, records, 2, fixed(reply));
    assert.equal(aiRanked, true);
    assert.deepEqual(results.map((r) => [r.rank, r.record.id]), [[1, "b"], [2, "c"]]);
    assert.ok((results[0].matchPercent ?? 0) > (results[1].matchPercent ?? 0));
    assert.deepEqual(results[0].reasons, ["Current BMS operator"]);
  });

  it("keeps search order without a match % when the model is down", async () => {
    const records = [record({ id: "a" }), record({ id: "b" })];
    const { results, aiRanked } = await rerank("q", spec, records, 5, down);
    assert.equal(aiRanked, false);
    assert.deepEqual(results.map((r) => r.record.id), ["a", "b"]);
    assert.equal(results[0].matchPercent, null);
  });
});
