/** The typed boolean search: what becomes a chip, what becomes an exclude, and what is refused with a plain reason. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksBoolean, parseBooleanQuery } from "../../backend/lib/candidates/boolean";
import { allKeywordTerms, keywordLabel, keywordTerms } from "../../backend/lib/candidates/filters";

const ok = (text: string) => {
  const r = parseBooleanQuery(text);
  assert.ok(r.ok, `expected ${text} to parse`);
  return r.ok ? r.query : { keywords: [], excludes: [] };
};
const bad = (text: string) => {
  const r = parseBooleanQuery(text);
  assert.ok(!r.ok, `expected ${text} to be refused`);
  return r.ok ? "" : r.reason;
};

describe("boolean keyword search", () => {
  it("knows which text needs parsing", () => {
    assert.equal(looksBoolean("facility manager"), false);
    assert.equal(looksBoolean("Design and Build"), false);
    assert.equal(looksBoolean("MEP / HVAC"), true);
    assert.equal(looksBoolean("MEP/HVAC"), true);
    assert.equal(looksBoolean("a AND b"), true);
    assert.equal(looksBoolean("(a OR b)"), true);
    assert.equal(looksBoolean('"technical executive"'), true);
    assert.equal(looksBoolean("NOT fresher"), true);
  });

  it("AND stars every part", () => {
    assert.deepEqual(ok("facility AND bms"), { keywords: [{ text: "facility", required: true }, { text: "bms", required: true }], excludes: [] });
    assert.deepEqual(ok("technical executive AND bms").keywords[0], { text: "technical executive", required: true });
  });

  it("OR, brackets and / make one chip with alternatives", () => {
    assert.deepEqual(ok("facility AND (MEP OR HVAC OR VRF)").keywords, [
      { text: "facility", required: true },
      { text: "MEP", required: true, alts: ["HVAC", "VRF"] },
    ]);
    assert.deepEqual(ok("MEP / HVAC / VRF").keywords, [{ text: "MEP", required: false, alts: ["HVAC", "VRF"] }]);
    assert.deepEqual(ok("MEP OR HVAC").keywords, [{ text: "MEP", required: false, alts: ["HVAC"] }]);
    assert.deepEqual(ok("(MEP OR HVAC)").keywords, [{ text: "MEP", required: false, alts: ["HVAC"] }]);
  });

  it("NOT becomes an exclude, alone or as a bracketed list", () => {
    assert.deepEqual(ok("facility AND (MEP OR HVAC) NOT fresher"), {
      keywords: [{ text: "facility", required: true }, { text: "MEP", required: true, alts: ["HVAC"] }],
      excludes: ["fresher"],
    });
    assert.deepEqual(ok("bms NOT (intern OR trainee)"), { keywords: [{ text: "bms", required: true }], excludes: ["intern", "trainee"] });
    assert.deepEqual(ok("NOT residential"), { keywords: [], excludes: ["residential"] });
  });

  it("quotes keep words together and lower-case and/or stay words", () => {
    assert.deepEqual(ok('"technical executive" AND bms').keywords, [{ text: "technical executive", required: true }, { text: "bms", required: true }]);
    assert.deepEqual(ok('"design and build" / fit-out').keywords, [{ text: "design and build", required: false, alts: ["fit-out"] }]);
  });

  it("drops repeats, case aside", () => {
    assert.deepEqual(ok("MEP / mep / HVAC").keywords, [{ text: "MEP", required: false, alts: ["HVAC"] }]);
    assert.deepEqual(ok("a NOT x NOT X").excludes, ["x"]);
  });

  it("refuses what it cannot read, with a reason HR can act on", () => {
    assert.match(bad("(MEP AND HVAC)"), /only OR/);
    assert.match(bad("(MEP OR HVAC"), /not closed/);
    assert.match(bad('"technical'), /quote/);
    assert.match(bad("AND bms"), /before/);
    assert.match(bad("bms AND"), /after/);
    assert.match(bad("OR bms"), /before/);
    assert.match(bad("()"), /empty/);
  });

  it("helpers read a chip with alternatives", () => {
    const chip = { text: "MEP", required: true, alts: ["HVAC", "mep", " VRF "] };
    assert.deepEqual(keywordTerms(chip), ["MEP", "HVAC", "VRF"]);
    assert.equal(keywordLabel(chip), "MEP / HVAC / VRF");
    assert.deepEqual(allKeywordTerms([chip, { text: "hvac", required: false }, { text: "bms", required: false }]), ["MEP", "HVAC", "VRF", "bms"]);
  });
});
