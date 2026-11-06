/**
 * Ingest a policy file from disk (same pipeline as the upload UI). Handy for
 * seeding a fresh database. Re-running with the same file name replaces the
 * previous version.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/hr-assistant/ingest.ts [path/to/policy.(txt|md|pdf|docx)]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getSupabaseAdmin } from "../../backend/lib/hr-assistant/admin";
import { extractText } from "../../backend/lib/hr-assistant/extract-text";
import { ingestDocument } from "../../backend/lib/hr-assistant/ingest";

const DEFAULT_FILE = path.join("data", "hr-assistant", "hr_policy.txt");

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_FILE;
  const name = path.basename(filePath);

  const data = new Uint8Array(await readFile(filePath));
  const text = await extractText(data, name);
  console.log(`Read '${filePath}' (${text.length} characters of text).`);

  const document = await ingestDocument(getSupabaseAdmin(), {
    name,
    text,
    sizeBytes: data.byteLength,
  });
  console.log(`Stored ${document.chunk_count} chunks for '${name}' (document ${document.id}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
