import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parseGuardResponse } from "../../backend/lib/hr-assistant/guardrails";
import { splitIntoChunks } from "../../backend/lib/hr-assistant/splitter";

const POLICY = readFileSync(path.join("data", "hr-assistant", "hr_policy.txt"), "utf8");

describe("splitIntoChunks", () => {
  it("keeps every chunk within the size limit", () => {
    const chunks = splitIntoChunks(POLICY);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 500, `chunk too long: ${chunk.length}`);
  });

  it("does not lose any policy facts", () => {
    const joined = splitIntoChunks(POLICY).join("\n");
    for (const fact of ["20 days of paid annual leave", "10 paid sick days", "12 public holidays", "within 45 days"]) {
      assert.ok(joined.includes(fact), `missing: ${fact}`);
    }
  });

  it("overlaps neighbouring chunks when a long paragraph is split", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitIntoChunks(words, { chunkSize: 100, chunkOverlap: 20 });
    assert.ok(chunks.length > 1);
    for (let i = 1; i < chunks.length; i++) {
      const firstWord = chunks[i].split(" ")[0];
      assert.ok(chunks[i - 1].includes(firstWord), `chunk ${i} doesn't overlap the previous one`);
    }
  });

  it("returns nothing for empty text", () => {
    assert.deepEqual(splitIntoChunks(""), []);
  });
});

describe("parseGuardResponse", () => {
  it("reads a safe verdict", () => {
    assert.deepEqual(parseGuardResponse('{"violation": 0, "category": null, "rationale": "ok"}'), {
      safe: true,
      category: null,
      reason: "ok",
    });
  });

  it("reads a violation", () => {
    const result = parseGuardResponse('{"violation": 1, "category": "prompt_injection", "rationale": "DAN"}');
    assert.equal(result.safe, false);
    assert.equal(result.category, "prompt_injection");
  });

  it("fails closed on garbage or a missing flag", () => {
    assert.equal(parseGuardResponse("not json").safe, false);
    assert.equal(parseGuardResponse('{"rationale": "?"}').safe, false);
    assert.equal(parseGuardResponse(null).safe, false);
  });
});
