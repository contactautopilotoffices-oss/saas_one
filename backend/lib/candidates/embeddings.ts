/**
 * Candidate Search embeddings. The provider is set by EMBEDDING_PROVIDER (config.ts; owner 2026-11-03: Gemini's free
 * tier by default, Jina when its account has credit). Both give 768-dim vectors.
 *   gemini : the HR Policy Assistant's Gemini client (backend/lib/hr-assistant/embeddings.ts), GEMINI_API_KEY
 *   jina   : jina-embeddings-v3 over REST, JINA_API_KEY
 * One model for records AND queries: vectors of different models cannot be compared, so there is no per-call fallback
 * to the other provider. A busy, unreachable or unconfigured service is a retryable EmbedError (the background worker
 * in indexing.ts pauses and tries again later); a rejected input is not retryable (that record is set aside).
 */
import {
  embedDocuments as geminiDocuments,
  embedQuery as geminiQuery,
} from "@/backend/lib/hr-assistant/embeddings";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODELS, EMBEDDING_PROVIDER } from "./config";

/** `retryable`: busy, down, timed out, out of credit, or not configured (try later). Otherwise the input was rejected. */
export class EmbedError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** 429 / 5xx: busy or down. 401 / 402 / 403: key, quota or credit problem — "try later", never the records' fault. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 401 || status === 402 || status === 403;
}

export interface EmbeddingClient {
  documents: (texts: string[]) => Promise<number[][]>;
  query: (text: string) => Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Gemini (reuses the HR assistant's client; its errors read "Gemini embeddings failed (<status>): ...")
// ---------------------------------------------------------------------------
function asEmbedError(error: unknown): EmbedError {
  if (error instanceof EmbedError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = /failed \((\d{3})\)/.exec(message)?.[1];
  // No status = network failure, missing key or an empty answer: try again later.
  return new EmbedError(message, status ? retryableStatus(Number(status)) : true);
}

function checkDimensions(vectors: number[][]): number[][] {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) throw new EmbedError(`Embedding has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`, true);
  }
  return vectors;
}

export const geminiEmbeddings: EmbeddingClient = {
  documents: async (texts) => {
    try {
      return checkDimensions(await geminiDocuments(texts));
    } catch (error) {
      throw asEmbedError(error);
    }
  },
  query: async (text) => {
    try {
      return checkDimensions([await geminiQuery(text)])[0];
    } catch (error) {
      throw asEmbedError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// Jina
// ---------------------------------------------------------------------------
const JINA_ENDPOINT = "https://api.jina.ai/v1/embeddings";
const JINA_BATCH = 100;
const JINA_TIMEOUT_MS = 30_000;

type JinaTask = "retrieval.passage" | "retrieval.query";

interface JinaResponse {
  data?: { index?: number; embedding?: number[] }[];
}

async function jina(texts: string[], task: JinaTask): Promise<number[][]> {
  const key = (process.env.JINA_API_KEY ?? "").trim();
  if (!key) throw new EmbedError("JINA_API_KEY is not set", true);

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += JINA_BATCH) {
    const batch = texts.slice(i, i + JINA_BATCH);
    let res: Response;
    try {
      res = await fetch(JINA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: EMBEDDING_MODELS.jina, task, dimensions: EMBEDDING_DIMENSIONS, embedding_type: "float", input: batch }),
        signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmbedError(`Jina unreachable: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new EmbedError(`Jina embeddings failed (${res.status}): ${detail}`, retryableStatus(res.status));
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

export const jinaEmbeddings: EmbeddingClient = {
  documents: (texts) => jina(texts, "retrieval.passage"),
  query: async (text) => (await jina([text], "retrieval.query"))[0],
};

// ---------------------------------------------------------------------------
// The configured provider
// ---------------------------------------------------------------------------
const ACTIVE: EmbeddingClient = EMBEDDING_PROVIDER === "jina" ? jinaEmbeddings : geminiEmbeddings;

/** Records' search text, for storage. */
export function embedDocuments(texts: string[]): Promise<number[][]> {
  return ACTIVE.documents(texts);
}

/** A search, for comparing against stored records. */
export function embedQuery(text: string): Promise<number[]> {
  return ACTIVE.query(text);
}
