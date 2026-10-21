import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DocumentError, extractText, isSupportedFile } from "../../backend/lib/hr-assistant/extract-text";

const encode = (text: string) => new TextEncoder().encode(text);

// Smallest useful PDF: one page with one line of Helvetica text.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 61>>stream
BT /F1 12 Tf 72 720 Td (Employees get 20 days of paid leave.) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF`;

describe("extractText", () => {
  it("reads text and markdown files and normalizes whitespace", async () => {
    const text = await extractText(encode("Leave policy\r\n\r\n\r\n\r\n20 days   \nper year\n"), "policy.md");
    assert.equal(text, "Leave policy\n\n20 days\nper year");
  });

  it("reads PDFs", async () => {
    const text = await extractText(encode(MINIMAL_PDF), "policy.pdf");
    assert.match(text, /20 days of paid leave/);
  });

  it("rejects unreadable PDFs and Word files with a user-facing error", async () => {
    await assert.rejects(extractText(encode("not a pdf"), "policy.pdf"), DocumentError);
    await assert.rejects(extractText(encode("not a docx"), "policy.docx"), DocumentError);
  });

  it("rejects empty documents", async () => {
    await assert.rejects(extractText(encode("  \n\n "), "policy.txt"), /No text found/);
  });

  it("rejects unsupported file types", async () => {
    await assert.rejects(extractText(encode("x"), "policy.exe"), /Unsupported file type/);
  });
});

describe("isSupportedFile", () => {
  it("accepts only txt, md, pdf and docx (case-insensitive)", () => {
    assert.equal(isSupportedFile("Policy.PDF"), true);
    assert.equal(isSupportedFile("handbook.docx"), true);
    assert.equal(isSupportedFile("notes.md"), true);
    assert.equal(isSupportedFile("old.doc"), false);
    assert.equal(isSupportedFile("noextension"), false);
  });
});
