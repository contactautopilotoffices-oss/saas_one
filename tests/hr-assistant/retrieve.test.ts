import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TOP_K_RESULTS } from "../../backend/lib/hr-assistant/config";
import { retrievePolicyChunks } from "../../backend/lib/hr-assistant/retrieve";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

/** Records every rpc call and answers each function name from `responses`. */
function fakeClient(responses: Record<string, RpcResult>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return responses[fn] ?? { data: null, error: { message: `unexpected ${fn}` } };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const embed = async () => [0.1, 0.2];
const CHUNK = { id: 1, source: "Leave.pdf", content: "LOP applies...", similarity: 0.4 };

describe("retrievePolicyChunks", () => {
  it("uses hybrid search with the question text, its embedding and top-k", async () => {
    const { client, calls } = fakeClient({ hybrid_match_hr_policy_chunks: { data: [CHUNK], error: null } });
    const chunks = await retrievePolicyChunks(client, "What is LOP?", undefined, { embed });
    assert.deepEqual(chunks, [CHUNK]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      fn: "hybrid_match_hr_policy_chunks",
      args: { query_text: "What is LOP?", query_embedding: [0.1, 0.2], match_count: TOP_K_RESULTS },
    });
  });

  it("falls back to vector-only search when the hybrid function isn't installed", async () => {
    const { client, calls } = fakeClient({
      hybrid_match_hr_policy_chunks: { data: null, error: { code: "PGRST202", message: "not found" } },
      match_hr_policy_chunks: { data: [CHUNK], error: null },
    });
    const chunks = await retrievePolicyChunks(client, "What is LOP?", 4, { embed });
    assert.deepEqual(chunks, [CHUNK]);
    assert.deepEqual(calls.map((call) => call.fn), ["hybrid_match_hr_policy_chunks", "match_hr_policy_chunks"]);
    assert.deepEqual(calls[1].args, { query_embedding: [0.1, 0.2], match_count: 4 });
  });

  it("does not hide other database errors behind the fallback", async () => {
    const { client, calls } = fakeClient({
      hybrid_match_hr_policy_chunks: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    await assert.rejects(retrievePolicyChunks(client, "q", 5, { embed }), /permission denied/);
    assert.equal(calls.length, 1);
  });
});
