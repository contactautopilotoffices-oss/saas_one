/**
 * Turn text into vectors with Gemini embeddings.
 *
 * Calls the Gemini REST API directly: the app's @google/generative-ai SDK (0.24) can't
 * set outputDimensionality, and we don't want a second Google SDK just for this.
 */
import { getGeminiApiKey } from "./clients";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./config";

const BATCH_SIZE = 100; // Gemini's max inputs per batchEmbedContents call
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;

type TaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

interface BatchEmbedResponse {
  embeddings?: { values?: number[] }[];
}

async function embed(texts: string[], taskType: TaskType): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": getGeminiApiKey() },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini embeddings failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const embeddings = ((await res.json()) as BatchEmbedResponse).embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, got ${embeddings.length}`);
    }
    for (const embedding of embeddings) {
      if (!embedding.values?.length) throw new Error("Gemini returned an empty embedding");
      vectors.push(embedding.values);
    }
  }
  return vectors;
}

/** Embed a user question for similarity search. */
export async function embedQuery(question: string): Promise<number[]> {
  const [vector] = await embed([question], "RETRIEVAL_QUERY");
  return vector;
}

/** Embed policy chunks for storage. */
export function embedDocuments(chunks: string[]): Promise<number[][]> {
  return embed(chunks, "RETRIEVAL_DOCUMENT");
}
