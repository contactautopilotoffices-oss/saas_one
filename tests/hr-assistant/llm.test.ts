import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRateLimitError } from "../../backend/lib/hr-assistant/clients";
import { ANSWER_MODELS, GUARD_MODELS, PLANNER_MODELS } from "../../backend/lib/hr-assistant/config";
import { chatWithFallback, engyConfig, type ModelStep } from "../../backend/lib/hr-assistant/llm";

const REQ = { system: "rules", user: "text" };
const busy = () => Object.assign(new Error("429 Rate limit reached for model"), { status: 429 });

/** A fake caller that plays one scripted outcome per model and records who was asked. */
function scripted(outcomes: Record<string, () => string>) {
  const asked: string[] = [];
  const caller = async (step: ModelStep) => {
    asked.push(`${step.provider}/${step.model}`);
    return outcomes[step.model]();
  };
  return { caller, asked };
}

// Keep the backup logs out of the test output.
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, info } = console;
  console.warn = () => {};
  console.info = () => {};
  return fn().finally(() => {
    console.warn = warn;
    console.info = info;
  });
}

describe("model chains", () => {
  it("put Groq first everywhere and keep the same safety rules on every safety-check backup", () => {
    for (const chain of [GUARD_MODELS, PLANNER_MODELS, ANSWER_MODELS]) {
      assert.equal(chain[0].provider, "groq");
      assert.ok(chain.some((step) => step.provider === "engy"), "has an Engy backup");
    }
    assert.equal(GUARD_MODELS[0].model, "openai/gpt-oss-safeguard-20b");
    assert.equal(GUARD_MODELS[1].model, "openai/gpt-oss-20b");
  });
});

describe("chatWithFallback", () => {
  it("uses the first model when it answers", async () => {
    const { caller, asked } = scripted({ a: () => "ok-a", b: () => "ok-b" });
    const chain: ModelStep[] = [{ provider: "groq", model: "a" }, { provider: "engy", model: "b" }];
    assert.equal(await chatWithFallback("test", chain, REQ, caller), "ok-a");
    assert.deepEqual(asked, ["groq/a"]);
  });

  it("moves to the backup when Groq is busy, and on an empty reply", async () => {
    const { caller, asked } = scripted({
      a: () => {
        throw busy();
      },
      b: () => "",
      c: () => "from engy",
    });
    const chain: ModelStep[] = [
      { provider: "groq", model: "a" },
      { provider: "groq", model: "b" },
      { provider: "engy", model: "c" },
    ];
    assert.equal(await quiet(() => chatWithFallback("test", chain, REQ, caller)), "from engy");
    assert.deepEqual(asked, ["groq/a", "groq/b", "engy/c"]);
  });

  it("when every model fails, throws the rate-limit error so the user sees 'busy'", async () => {
    const { caller } = scripted({
      a: () => {
        throw busy();
      },
      b: () => {
        throw new Error("Engy HTTP 500");
      },
    });
    const chain: ModelStep[] = [{ provider: "groq", model: "a" }, { provider: "engy", model: "b" }];
    await assert.rejects(
      quiet(() => chatWithFallback("test", chain, REQ, caller)),
      (error: unknown) => isRateLimitError(error),
    );
  });
});

describe("engyConfig", () => {
  it("uses the existing COUNCIL_* Engy connection, then the plain engy key, else nothing", () => {
    assert.deepEqual(engyConfig({ COUNCIL_API_KEY: "k1", COUNCIL_BASE_URL: "https://api.engy.ai/v1" } as unknown as NodeJS.ProcessEnv), {
      baseUrl: "https://api.engy.ai/v1",
      apiKey: "k1",
    });
    assert.deepEqual(engyConfig({ engy: "k2" } as unknown as NodeJS.ProcessEnv), { baseUrl: "https://api.engy.ai/v1", apiKey: "k2" });
    assert.equal(engyConfig({} as unknown as NodeJS.ProcessEnv), null);
  });
});
