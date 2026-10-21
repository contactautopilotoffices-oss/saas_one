/**
 * Evaluate answer quality against a fixed set of test questions.
 *
 * Each question runs through the real pipeline, then a judge LLM scores:
 *  - correctness:  question + answer + reference answer -> does it match?
 *  - groundedness: retrieved chunks + answer -> is it supported by the policy?
 * Exits non-zero if either pass rate drops below PASS_THRESHOLD, so it can gate CI.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/hr-assistant/evaluate.ts
 */
import { createClient } from "@supabase/supabase-js";

import { ask, createHrAssistantDeps } from "../../backend/lib/hr-assistant/ask";
import { getGroq } from "../../backend/lib/hr-assistant/clients";
import { JUDGE_MODEL } from "../../backend/lib/hr-assistant/config";

const PASS_THRESHOLD = 0.8;

const TEST_CASES = [
  { question: "How many days of paid annual leave do I get per year?", reference: "20 days" },
  { question: "How many days of unused annual leave can be carried forward?", reference: "Up to 5 days" },
  { question: "How many paid sick days do I get per year?", reference: "10 days" },
  { question: "How many days per week can I work from home?", reference: "Up to 2 days, with manager approval" },
  { question: "How long is the probation period?", reference: "3 months" },
  { question: "What is the notice period during probation?", reference: "15 days" },
  { question: "What is the standard notice period for resignation?", reference: "30 days" },
  { question: "Within how many days must reimbursement claims be submitted?", reference: "30 days of the expense" },
  { question: "How many public holidays does the company observe each year?", reference: "12" },
  {
    question: "Within how many days is full and final settlement processed after the last working day?",
    reference: "45 days",
  },
];

const CORRECTNESS_PROMPT = `You are grading an HR assistant. Compare the ANSWER to the REFERENCE answer for the QUESTION.
The answer is correct if it states the same facts as the reference (extra helpful detail is fine; contradictions or missing key facts are not).
Respond only with JSON: {"pass": true or false, "reasoning": string}`;

const GROUNDEDNESS_PROMPT = `You are grading an HR assistant. Check whether every factual claim in the ANSWER is supported by the CONTEXT.
The answer is grounded if nothing in it is invented or contradicts the context.
Respond only with JSON: {"pass": true or false, "reasoning": string}`;

async function judge(system: string, user: string): Promise<{ pass: boolean; reasoning: string }> {
  const response = await getGroq().chat.completions.create({
    model: JUDGE_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "");
    return { pass: parsed.pass === true, reasoning: String(parsed.reasoning ?? "") };
  } catch {
    return { pass: false, reasoning: "Unparseable judge response" };
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const deps = createHrAssistantDeps({ supabase }); // no userId -> nothing is logged

  let correct = 0;
  let grounded = 0;

  for (const testCase of TEST_CASES) {
    const result = await ask(testCase.question, deps);
    const context = result.sources.map((chunk) => chunk.content).join("\n\n");

    const [correctness, groundedness] = await Promise.all([
      judge(
        CORRECTNESS_PROMPT,
        `QUESTION: ${testCase.question}\nREFERENCE: ${testCase.reference}\nANSWER: ${result.answer}`,
      ),
      judge(GROUNDEDNESS_PROMPT, `CONTEXT:\n${context || "(none)"}\n\nANSWER: ${result.answer}`),
    ]);

    if (correctness.pass) correct++;
    if (groundedness.pass) grounded++;

    console.log(
      `${correctness.pass ? "PASS" : "FAIL"} correct | ${groundedness.pass ? "PASS" : "FAIL"} grounded | ${testCase.question}`,
    );
    if (!correctness.pass) console.log(`   answer: ${result.answer}\n   why: ${correctness.reasoning}`);
    if (!groundedness.pass) console.log(`   grounding: ${groundedness.reasoning}`);
  }

  const total = TEST_CASES.length;
  const correctnessRate = correct / total;
  const groundednessRate = grounded / total;
  console.log(
    `\nCorrectness: ${correct}/${total} (${Math.round(correctnessRate * 100)}%) | ` +
      `Groundedness: ${grounded}/${total} (${Math.round(groundednessRate * 100)}%)`,
  );

  if (correctnessRate < PASS_THRESHOLD || groundednessRate < PASS_THRESHOLD) {
    console.error(`Below the ${PASS_THRESHOLD * 100}% pass threshold.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
