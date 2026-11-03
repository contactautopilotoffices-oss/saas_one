/**
 * Candidate Search embeddings: Jina jina-embeddings-v3 at 768 dimensions (owner 2026-11-03; replaces Gemini here, which
 * ran out of free quota on big sheets). One model for records AND queries: vectors of different models cannot be
 * compared, so there is no per-call fallback to another provider. A busy or unreachable service is reported as a
 * retryable EmbedError; the background worker (indexing.ts) pauses and tries again later.
 * The HR Policy Assistant keeps its own Gemini embeddings (backend/lib/hr-assistant/embeddings.ts).
 *
 * REST, no SDK: POST https://api.jina.ai/v1/embeddings with JINA_API_KEY.
 */
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./config";

const ENDPOINT = "https://api.jina.ai/v1/embeddings";
/** Inputs per call. */
export const EMBED_BATCH = 100;
const TIMEOUT_MS = 30_000;

/** `retryable`: busy, down, timed out, or not configured (try later). Otherwise the input itself was rejected. */
export class EmbedError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type Task = "retrieval.passage" | "retrieval.query";

interface JinaResponse {
  data?: { index?: number; embedding?: number[] }[];
}

async function jina(texts: string[], task: Task): Promise<number[][]> {
  const key = (process.env.JINA_API_KEY ?? "").trim();
  if (!key) throw new EmbedError("JINA_API_KEY is not set", true);

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: EMBEDDING_MODEL, task, dimensions: EMBEDDING_DIMENSIONS, embedding_type: "float", input: batch }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmbedError(`Jina unreachable: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      // 429 / 5xx: busy or down. 401 / 403 / 402: key or credit problem — also "try later", never the records' fault.
      const retryable = res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 402 || res.status === 403;
      throw new EmbedError(`Jina embeddings failed (${res.status}): ${detail}`, retryable);
    }
    const data = ((await res.json().catch(() => ({}))) as JinaResponse).data ?? [];
    if (data.length !== batch.length) throw new EmbedError(`Jina returned ${data.length} embeddings for ${batch.length} inputs`, true);
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const item of ordered) {
      if (!item.embedding || item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbedError(`Jina returned an embedding of ${item.embedding?.length ?? 0} dimensions`, true);
      }
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

/** Records' search text, for storage. */
export function embedDocuments(texts: string[]): Promise<number[][]> {
  return jina(texts, "retrieval.passage");
}

/** A search, for comparing against stored records. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await jina([text], "retrieval.query");
  return vector;
}
