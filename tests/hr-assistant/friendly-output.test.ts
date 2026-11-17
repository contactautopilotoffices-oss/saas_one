import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FRIENDLY_ERRORS, friendlyError } from "../../backend/lib/hr-assistant/friendly-errors";
import { formatAnswer, parseInline } from "../../frontend/components/hr-assistant/formatAnswer";

describe("friendlyError", () => {
  it("turns the real Gemini failures HR saw into plain messages", () => {
    assert.equal(
      friendlyError('Gemini embeddings failed (429): { "error": { "code": 429, "message": "You exceeded your current quota" } }'),
      FRIENDLY_ERRORS.aiBusy,
    );
    assert.equal(
      friendlyError('Gemini embeddings failed (402): { "error": { "message": "Your prepayment credits are depleted." } }'),
      FRIENDLY_ERRORS.aiAccount,
    );
  });

  it("explains our own upload limit, network errors and unknown technical errors", () => {
    assert.equal(friendlyError("Too many requests. Please wait a moment and try again."), FRIENDLY_ERRORS.tooManyUploads);
    assert.equal(friendlyError("TypeError: fetch failed"), FRIENDLY_ERRORS.network);
    assert.equal(friendlyError('duplicate key value violates unique constraint {"x":1}'), FRIENDLY_ERRORS.generic);
    assert.equal(friendlyError(null), FRIENDLY_ERRORS.generic);
  });

  it("keeps messages that are already plain", () => {
    const plain = "No text found in this file. Scanned PDFs need to be converted to text (OCR) first.";
    assert.equal(friendlyError(plain), plain);
    assert.equal(friendlyError("File is too large. The limit is 4 MB."), "File is too large. The limit is 4 MB.");
  });
});

describe("formatAnswer", () => {
  it("renders the leave answer HR saw: bold runs and a bullet list, no asterisks", () => {
    const blocks = formatAnswer(
      "According to the policy, you are entitled to:\n\n" +
        "- **Privilege Leave (PL): 16 days** (paid)\n" +
        "- **Casual Leave (CL): 9 days** (company entitlement)\n\n" +
        "So, the total paid annual leave you receive is **25 days**.",
    );
    assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "bullets", "paragraph"]);
    assert.deepEqual(blocks[1], {
      kind: "bullets",
      items: [
        [{ text: "Privilege Leave (PL): 16 days", bold: true }, { text: " (paid)" }],
        [{ text: "Casual Leave (CL): 9 days", bold: true }, { text: " (company entitlement)" }],
      ],
    });
    assert.ok(!JSON.stringify(blocks).includes("*"));
  });

  it("keeps numbered lists and their starting number", () => {
    const [block] = formatAnswer("3. Submit the form\n4. Wait for approval");
    assert.equal(block.kind, "numbered");
    assert.equal(block.kind === "numbered" && block.start, 3);
  });

  it("drops unpaired markers but leaves maths alone", () => {
    assert.deepEqual(parseInline("A **broken bold"), [{ text: "A broken bold" }]);
    assert.deepEqual(parseInline("5 * 2 = 10"), [{ text: "5 * 2 = 10" }]);
    assert.deepEqual(parseInline("an *important* note"), [
      { text: "an " },
      { text: "important", italic: true },
      { text: " note" },
    ]);
  });

  it("never produces markup from the text", () => {
    const blocks = formatAnswer("<script>alert(1)</script> **hi**");
    assert.deepEqual(blocks, [
      { kind: "paragraph", lines: [[{ text: "<script>alert(1)</script> " }, { text: "hi", bold: true }]] },
    ]);
  });
});
