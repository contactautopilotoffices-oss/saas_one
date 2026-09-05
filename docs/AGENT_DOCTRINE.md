# Agent Doctrine

**Binding reference for every AI agent built in this repo from 2026-09-03 onward.**

Source of authority: **Sinan Ozdemir, _Building Agentic AI: Workflows, Fine-Tuning,
Optimization, and Deployment_** (Pearson / Addison-Wesley, 2026, ISBN 978-0-13-548968-0),
Jon Krohn's Pearson AI Signature Series. Local copy: `AI Agents Handbook .pdf` (repo root).

Citations are written `[BAA p.N]` where N is the **printed book page**. The PDF is a
68-page sampler; add 65 to a PDF page to get the book page (PDF p.23 = book p.88).

## 0. What we actually hold, and what we don't

| Section | Book pages | PDF pages | Status |
|---|---|---|---|
| Front matter, series foreword, preface, full TOC | i–xx | 1–21 | **Read** |
| **Ch. 4 — First Steps with AI Agents and Multi-Agent Workloads** | 87–121 | 22–56 | **Read in full** |
| Index (concept map for the whole book) | 287–298 | 57–68 | **Read** |
| Ch. 1–3, 5–9 | 3–83, 123–285 | — | **Not in file** |

Rule: cite `[BAA p.N]` **only** for pages we hold. Anything from Ch. 1–3 or 5–9 is an
`[INDEX ONLY]` pointer — a known gap, not a claim. See §4.

---

## 1. The Laws

Each law is binding. Each new agent must cite the laws it satisfies and name the ones
it knowingly violates (§3).

### L1 — Workflow vs. agent is a measured result, never a preference
Workflows win when the pathway is known ahead of time and edge cases are few; they cost
more upfront code but are efficient once built, and let you bake in early exits, quality
checks, and few-shot tuning. Agents win when the task varies, when the system should
"figure it out," or when it must switch between explaining and doing. `[BAA p.104]`

The book's own head-to-head: the SQL workflow and the SQL agent scored **near-identical
accuracy**, but the agent was **slower and more expensive** — because it had to spend
tokens fetching context the workflow was simply handed. `[BAA p.99]`

**Our rule:** default to a workflow. An agent must be justified, and the justification
must be one of the two the book allows `[BAA p.115]`:
- (a) the decisions are too complex/near-impossible to hardcode as a pathway, **or**
- (b) the task is easy enough that a system prompt + existing MCP servers saves real
  development cycles.

State which one, in the spec block. "It feels more agentic" is not a justification.

### L2 — You do not know which is better until you have built both and tested them on the same dataset
The only way the book could assert the workflow was as accurate, cheaper, and faster was
by building both and running them against the same benchmark. `[BAA pp.94–95]`
Test, test, test — form a hypothesis, build the test environment, experiment. `[BAA p.104]`

**Our rule:** any agent that replaces an existing deterministic path ships with an A/B
against that path on a fixed case set, reporting accuracy, median cost, median latency.

### L3 — Tool execution is independent of the LLM; error handling inside tools is not optional
The model can emit a perfect tool call and the tool can still throw. When that happens the
model did nothing wrong — but if the traceback escapes, the whole agentic flow fails.
`[BAA p.94]` Every tool in the book returns its error **as a string to the model**
(`return f"Error executing SQL query: {str(e)}"`), never raises. `[BAA pp.91–92]`

**Our rule:** every tool body is wrapped `try/catch`; the catch returns human-readable
error text to the model. A tool that can throw past the runtime is a defect.

Corollary: bad tool *arguments* also kill the flow. If the model calls a tool without the
arguments the tool accepts, the run errors out. `[BAA p.93]` Validate and return a
message; don't 500.

### L4 — Judge the path, not just the answer
The book traces most agentic failures back to one question: what did the agent actually
*do* to address the task? `[BAA p.95]`

Measure: did it call the right tools, in the right order (where order matters), and how
many calls did it take. `[BAA p.95]` Real numbers from the book's SQL agent: it fetched the
schema in only ~80% of conversations `[BAA p.94]`, and in some runs called **zero** tools
and answered from parametric memory — those answers were mostly wrong. `[BAA p.95]`

**Our rule:** every run trace records tool name, arguments, and outcome per call. Tool-call
count per run is a first-class metric, not a debug detail.

### L5 — Four evaluation axes. All four, or it isn't evaluated
`[BAA pp.118–119]`

| Axis | What it covers |
|---|---|
| **System** | Behind-the-scenes: tool latency, LLM provider error rate |
| **Quality assurance** | Instruction adherence, output-format adherence, output quality |
| **Tool interaction** | Right tool for the task; right arguments passed |
| **Agent efficiency** | Steps taken, tokens burned, money spent |

And the trap the book names explicitly: an agent that emits 1,000 reasoning tokens to make
one tool call can be **slower and dearer** than one that fires five tools with no thinking
in between — "tool inefficient" and "token inefficient" are different failures and trade
against each other. `[BAA p.119]` Never optimise one blind to the other.

### L6 — The rubric: a second LLM, from a different family, mid-tier, with all context in the prompt
A rubric is one prompt handed to a separate grading LLM with the rules for what a good
response is. `[BAA p.96]` Construction rules the book is explicit about:

1. **Different model family than the agent** — to avoid subliminal shared-architecture
   bias. `[BAA pp.96–97]`
2. **Mid-tier, not frontier** — the grader never needs to reach for more information
   because the rubric prompt supplies all context. `[BAA p.97]`
3. **Structured output with a `reasoning` field declared before `score`** — chain of
   thought inside the schema elicits a more considered grade. `[BAA p.97]`
4. **A small integer scale with per-point criteria** — the book uses 0–3
   (0 = completely wrong, 3 = matches ground truth). `[BAA p.97]`
5. **Audit the grader by hand.** The author checked ~5% of responses manually and found the
   rubric matched his own judgement on the vast majority. `[BAA p.98]` The book calls the rubric method
   imperfect but effective and automatable. `[BAA p.97]`

**Our rule:** no agent claims an accuracy number without a rubric built to all five points,
plus the manual-audit percentage stated alongside the score.

### L7 — Memory is a tool the agent writes to, and it only pays off on repeating work
The Extended Mind Thesis (Clark & Chalmers, 1998 — the Otto's-notebook argument) applied to
agents: give the agent a tool to write its own findings down, not just to read.
`[BAA pp.100–102]`

The result is the most important honest finding in the chapter:

- On the **unmodified BIRD benchmark** (deliberately non-repeating questions), the agent
  wrote notes as it went and accuracy **did not move**. `[BAA p.103]`
- On a variant seeded with **synthetically rephrased near-duplicate questions**, accuracy
  climbed **37.7% → 67.2%** — and the gain did **not** appear immediately; it took time for
  enough useful evidence to accumulate. `[BAA p.103]`
- Removing retrieved evidence entirely dropped the agent from ~51% to ~36%, proving
  retrieval, not memory, was doing the heavy lifting at the start. `[BAA p.103]`

**Our rule:** agentic memory ships only where the workload genuinely repeats (recurring
requisitions, the same vendors, the same monthly close). Elsewhere it is cost with no
return. Where it ships, the write tool must **reject unknown scope keys** before writing —
the book's `log_evidence` validates `database_id` against a known list and refuses
otherwise. `[BAA p.101]`

Open questions the book leaves us, worth running here: let the agent grade its own logged
evidence and delete what proved useless; or put a structured RAG workflow behind the
retrieval tool rather than a raw similarity search. `[BAA p.103]`

### L8 — Tool descriptions are the real attack surface
Tool design and selection are critical, and MCP compounds the risk because the agent meets
unknown external tools with descriptions of wildly varying quality. The mitigation is
writing sufficiently contextful descriptions — but, in the author's words,
> "even a single bad tool description can send agents down a completely wrong path"
`[BAA p.107]`

**Our rule:** a tool description states what it does, when to use it, when *not* to, and
the exact shape of every argument with an example value. Reviewed as carefully as the
prompt, because it *is* prompt.

### L9 — MCP is the tool-transport default
An MCP server is just an API server in front of tool definitions and execution code, with
routes to list tools and to execute them. On wake-up the agent asks each configured server
what it offers; from the LLM's point of view everything downstream is identical regardless
of origin. `[BAA pp.106–107]` It is language- and framework-agnostic: the book's SDR agent
mixes two homegrown Python servers with a third-party TypeScript one (Resend's official
server) in the same agent. `[BAA p.115]`

The Python server shape is three parts: a route to list tools, a route to execute a tool
call, and the logic behind each tool. `[BAA p.107]`

**Our rule:** new integrations go behind MCP servers, not bespoke in-agent functions,
unless there's a reason to do otherwise — write it down.

Practical note the book models: when no usable third-party server existed for HubSpot, the
author had an AI agent write one, using his first MCP server as the example. It worked.
`[BAA p.111]`

### L10 — Split agents by **context**, and size the model to the cost of a false positive
The book's lead-generator and lead-qualifier agents have **identical tools and nominally
the same goal**. They are separate agents purely because their *context* differs — this is
context engineering: giving a model the information, context, and tools it needs to do a
task effectively. `[BAA p.112]`

And the cost asymmetry drives the model choice:

| Agent | Job | False positive costs | Model |
|---|---|---|---|
| Lead generator | Point at someone from the open internet and say "they seem right" | Low — a second agent double-checks | **smaller, cheaper, faster** |
| Lead qualifier | Read the syllabus/CV, make the final call to email | High — you spam a real person | **larger, slower, dearer** |

`[BAA p.112]`

**Our rule:** every agent spec states the cost of a false positive and picks the model tier
from it. Cheap models at the wide end of a funnel, expensive models at the irreversible end.

### L11 — Multi-agent is microservices; single-agent is a monolith
Three reasons the book split one SDR into three agents `[BAA p.116]`:
1. Stop the agent **forgetting a step** (emailing before qualifying / before writing the CRM note).
2. Stop **overlap and race conditions** — two agents emailing the same lead twice, and losing them.
3. Keep room to run **a different LLM per task**, including fine-tuned ones.

The governing analogy: multi-agent ≈ microservice architecture. You can tune the qualifier
in isolation without risking the rest of the funnel. With one agent, **every prompt change
risks a regression somewhere else**. `[BAA p.116]`

**Our rule:** if two responsibilities have different failure modes, different reviewers, or
different model needs — split them. If the pipeline can be tuned as one prompt without
regression risk, don't.

### L12 — Write prompts for something that has no common sense
The book's lead-gen prompt is a numbered list, and it ends by explicitly saying: follow the
steps in order, and don't skip any. It deliberately spells out things "a human might find
obvious." `[BAA p.105]`

For output shape, one in-context example (single-shot) is used to set tone — and the book
notes the example's *format* matters less when the agent is going to pass structured inputs
to a tool anyway; what mattered was that it produced HTML-encoded bodies and subject lines
and routed them to the right tool. `[BAA p.114]`

**Our rule:** ordered numbered steps; an explicit no-skipping clause; one worked example
for tone; state the terminal state ("set status to Connected so we know you sent it")
`[BAA p.114]` so the run is auditable from the data, not the logs.

### L13 — Don't hand-roll what the framework gives you
Making the agent stateful across turns was **one line** (LangGraph's `checkpointer` /
`MemorySaver`) — replacing dozens of lines of node/edge/follow-up handling written by hand
for the equivalent RAG workflow. `[BAA p.90]`

Also: an agent does not require the model's native tool-calling. It can be done purely
through prompting. The line between a plain LLM and an agent is the **surrounding system**
recognising a tool request, executing it, and feeding the result back — and, critically,
the model being allowed **to decide not to call it**. `[BAA p.90]`

### L14 — Traceability from run one
Every input, output, and tool call, recorded step by step, for debugging and long-term
monitoring and audit. `[BAA p.119]` The book's setup is five environment variables and the
SDK traces everything automatically. `[BAA p.120]` Ad-hoc chat testing against each agent
individually comes *before* trusting the system at scale. `[BAA pp.116–117]`

### L15 — Hybrid beats purity
The chapter's closing position: there is no single best approach. Workflows give
efficiency, predictability, control; agents give adaptability, flexibility, and a measure of
creative chaos. Try both, combine the best parts of each. `[BAA p.121]`

---

## 2. The Ledger — where our runtime already stands

Audited `backend/lib/agents/{runtime,instrument,reliability,compose}.ts` on 2026-09-03.

| Law | Axis `[BAA p.118–119]` | Our state | Evidence |
|---|---|---|---|
| L14 | System | **Strong** | `startRun`/`step`/`finishRun`/`failRun`, step traces with seq + status + tokens |
| L5 | System | **Strong** | `classifyError`, `reapStaleRuns` + `ABANDONED_ERROR_CLASS`, `beat` heartbeats |
| L5 | Agent efficiency | **Strong** | `tokens_in`/`tokens_out` per step, `cost_inr`/`cost_usd`, `costPerSuccessInr`, `efficiencyScore` (₹5 → 100, ₹100 → 0) |
| L5 | Agent efficiency | **Strong** | `computeReliability` = 0.50 success + 0.30 uptime + 0.20 (100 − roi_flag_rate) |
| **L4, L5** | **Tool interaction** | **ABSENT** | zero `tool_call` / `tool_name` instrumentation anywhere in `backend/lib/agents/` |
| **L6** | **Quality assurance** | **ABSENT** | no rubric, no grader, no judge model in the runtime |

**Two gaps, and they are the two the book weights heaviest.** We can currently say what an
agent *cost* and whether it *finished*. We cannot say whether it called the right tools
`[BAA p.95]` or whether its answer was any good `[BAA pp.96–98]`. Closing them is the
first doctrine-driven work item:

1. **`agent_run_tool_calls`** — tool name, arguments, outcome, latency, per step. Feeds
   tool-selection accuracy/precision/recall and tool-efficiency (L4, L5).
2. **Rubric harness** — mid-tier grader from a non-incumbent family, structured
   `{reasoning, score}` 0–3 output, with the manual-audit percentage recorded (L6).

---

## 3. Mandatory Agent Spec Block

**No agent merges without this block filled in, in its own file or PR description.**
Every line carries its citation. "N/A" is allowed; blank is not.

```markdown
## Agent Spec — <name>

**1. Workflow or agent?**  <workflow | agent>
   Justification (must be (a) or (b)) `[BAA p.115]`:
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`:
     accuracy __ | median cost __ | median latency __  (or: no prior path exists)

**2. Context** `[BAA p.112]`
   What this agent knows that its neighbours don't:

**3. Cost of a false positive** `[BAA p.112]`
   <low | high> →  model tier chosen: ______  because ______

**4. Tools**
   | tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: __   Explicit no-skip clause: __
   Single-shot tone example: __   Terminal state written to data: __

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat?  <yes | no>
   If no → no write-tool. If yes → write tool + scope-key rejection `[BAA p.101]`:

**7. Multi-agent?** `[BAA p.116]`
   If split, which of the three reasons: <forgotten step | race/overlap | per-task model>
   If single, why one prompt change can't regress another area:

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System:           
   Quality assurance (rubric: family __, tier __, scale __, manual audit __%) `[BAA pp.96–98]`:
   Tool interaction (expected tool set + order; measured call count) `[BAA p.95]`:
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`:

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: __   Ad-hoc single-agent testing done before scale: __ `[BAA p.116]`

**10. Laws knowingly violated, and why:**
```

---

## 4. Known gaps — `[INDEX ONLY]`, do not cite as read

These exist in the book and are named in the index we hold, but the text is not in our PDF.
Treat them as **open research items**, never as authority. Get the full book to close them.

| Topic | Book pages (from index) | Why it matters to us |
|---|---|---|
| Context engineering, formally | 197–198 (Ch. 7) | L10 rests on it; we only have the one-line definition from p.112 |
| Seven pillars of intelligence | 195–196 (Ch. 7) | Framework for when reasoning helps |
| Hybrid agent/workflow designs | 123–133 (Ch. 5) | The chapter that tests Ch. 4's assumptions |
| **Agentic tool-selection accuracy / precision / recall** | 149–156 (Ch. 5) | **Directly fills our Tool-interaction gap** |
| **Positional bias in tool selection** | 156, 9–10 (Ch. 5, Ch. 1) | Tool *order* in the definition list biases selection |
| Planning + reflection components | 133–136 (Ch. 5) | Deep-research-style agentic workflows |
| Multi-agent architectures: network, supervisor, handoffs | 141–149 (Ch. 5) | Our Council needs the supervisor pattern |
| `ALWAYS USE` tool prompt pattern | 130, 132 (Ch. 5) | Forcing tool use when the agent skips (cf. the 80% schema problem, p.94) |
| Guardrails for coding agents | 183 (Ch. 6) | |
| Reasoning models for ReAct agents | 209–212 (Ch. 7) | |
| Prompt caching for cost control | 19–23 (Ch. 1) | Cheapest available lever on our ₹/run |
| Evaluation metrics: precision, recall, MRR | Ch. 3 | Retrieval scoring for our RAG paths |
| AI calibration / ECE | 231–238 (Ch. 8) | Confidence that matches accuracy |
| Model compression, distillation, speculative decoding | 261–272 (Ch. 9) | Latency and cost work |

---

## 5. How this file is used

1. Read this file before designing any agent in this repo.
2. Fill the §3 spec block. Cite. Merges without it get sent back.
3. When a decision contradicts a law, say so in item 10 with the reason — the book's own
   stance is that there is no single best approach `[BAA p.121]`, but deviations are stated,
   not silent.
4. When the full book arrives, close §4 and delete the `[INDEX ONLY]` markers.

*Summaries and paraphrase only; no substantial reproduction of the source text.*
