# Orchestration layer — assessment and build plan

Companion to [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md) and [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md).
Written 2026-09-05 against the repo as it stands.

---

## 1. The finding that reframes the question

**The hard problem is not the canvas. It is durability.**

A drag-and-drop graph editor is a weekend of work with `@xyflow/react`. What is genuinely
hard is that your workflows *stop and wait*. The procurement plan we built has step `s8` —
**Procurement approval** — where the agent halts and a human decides. That may take three
days.

So the orchestrator must be able to:

- suspend mid-graph, with all state intact,
- survive a deploy, a restart, and a machine that no longer exists,
- resume on a completely different invocation, days later,
- and do it without the graph author writing any of that plumbing.

Every other requirement you named — stable orchestration, efficient tool calls, node-to-node
transmission — falls out of solving that one. Build the canvas first and you get a pretty
editor for workflows that cannot survive their own approval gates.

This is doctrine **L13** `[BAA p.90]`: statefulness across turns was *one line* — LangGraph's
checkpointer — replacing dozens of hand-written lines. That is precisely the line you have
not yet bought.

## 2. What you already have (audited, not assumed)

| Thing | State | Consequence |
|---|---|---|
| `next` 16.1.1, React 19.2.3, TypeScript | current | Stay in TS. A Python service means a second runtime, deploy, and auth surface. |
| LangChain / LangGraph | **absent** | Greenfield. Nothing to migrate. |
| Flow/canvas library | **absent** | `AgentPlanCanvas` renders a real DAG read-only today. |
| Deployment | Vercel (`vercel.json`, 28 crons) | Serverless. **This is the binding constraint.** |
| Longest `maxDuration` in repo | **300s** | Nothing may run longer in one invocation. |
| `backend/lib/council/runner.ts` | 3-stage protocol, status machine `running → stage1 → stage2 → synthesis → complete\|failed` | **You have already hand-rolled a LangGraph.** It works, and it is the proof the need is real. |
| `backend/lib/agents/{runtime,instrument}.ts` | runs, steps, tokens, cost, reliability, heartbeat | A working telemetry spine. **Do not replace it.** |
| 7 executors on `withAgentRun` | working crons | Deterministic workflows. Doctrine **L1** says leave them alone. |
| `ai-orchestrator/` | standalone Express + `p-queue` + Anthropic SDK | Precedent that a long-running Node service is acceptable here. |
| `OPENAI_API_KEY` | **absent** | No reasoning is possible today. |
| `oem_agent_bundles`, whole runtime schema | **unapplied** | The foundation under all of this is not yet poured. |

Verified on npm, 2026-09-05: `@langchain/langgraph` **1.4.13**,
`@langchain/langgraph-checkpoint-postgres` **1.0.5**, `@langchain/core` **1.2.9**,
`@xyflow/react` **12.11.6**. All 1.x. The JS story is no longer the risk it was.

## 3. The architecture

Six layers. Each is independently useful; each can ship without the next.

```
  ┌─ L6  CANVAS          @xyflow/react — edit nodes, drag edges
  │        writes ↓ reads ↑
  ├─ L5  GRAPH STORE     oem_workflows / _nodes / _edges  (versioned rows, NOT code)
  │        compiled by ↓
  ├─ L4  COMPILER        rows → LangGraph StateGraph      ← "change on the go" lives HERE
  │        executed by ↓
  ├─ L3  EXECUTOR        LangGraph + Postgres checkpointer + interrupt()
  │        instrumented by ↓
  ├─ L2  TELEMETRY       existing withAgentRun / step()   ← unchanged, reused
  └─ L1  TOOL REGISTRY   typed tools, env-resolved status ← backend/lib/agents/plan.ts today
```

### L1 — Tool registry
Already begun. `backend/lib/agents/plan.ts` resolves each tool against env and stamps
`connected | missing`. Promote those specs into real LangChain `tool()` definitions with zod
arg schemas. Doctrine **L3** `[BAA p.94]`: every tool returns its error *as text to the
model*, never throws. Doctrine **L8** `[BAA p.107]`: the description is prompt — one bad one
misroutes the whole agent.

### L2 — Telemetry: reuse, do not replace
Wrap graph execution in `withAgentRun` and emit one `step()` per node. You keep cost,
reliability, uptime and the run trace exactly as they are.

**This also closes a doctrine gap for free.** LangGraph surfaces tool calls and their
arguments as first-class events, so recording them is a listener, not a rewrite — that is
the **L4 / tool-interaction** axis `[BAA p.95]` your runtime currently cannot measure at all.

### L3 — Executor: the checkpointer is the whole point
`PostgresSaver` against your existing Supabase Postgres. Approval gates become
`interrupt()`: the graph suspends, state persists as rows, and a later HTTP request or cron
resumes from exactly that node.

### L4 — Compiler: where "change on the go" actually happens
A workflow is **data**, not a TypeScript file. The compiler reads the rows and builds the
`StateGraph` at run time. Edit a node in the canvas → next run picks it up. **No deploy.**

Compile-time validation is not optional: unknown node type, edge to a missing node, a cycle
without an exit, a tool that is `missing` — all refused before a run opens. An invalid graph
must fail at save, never at 2 a.m.

### L5 — Graph store
Three tables, versioned. A published version is immutable; edits create a draft. In-flight
runs stay pinned to the version they started on — otherwise editing a workflow silently
mutates a run that is mid-approval.

### L6 — Canvas
`@xyflow/react`. Upgrade `AgentPlanCanvas` from read-only to editable rather than starting
over.

## 4. Where it runs — the question that actually matters

**Vercel serverless, and it works — *because* of the checkpointer.**

The instinct is that a multi-day workflow needs a long-running server. It does not. Interrupts
decompose one long graph into many short, resumable segments:

```
run 1  s1→s6   (~40s)   → interrupt at approval → state persisted, function exits
   ... 3 days ...
run 2  s8→s11  (~30s)   → resumed by the approver's click, or by cron
```

No segment approaches 300s. You already run 28 crons, so the resumption driver exists.

**Move to a worker only when a single uninterrupted segment exceeds 300s** — a 20-vendor
comparative with a model call each, say. `ai-orchestrator/` is the precedent for that, and
because the checkpointer holds state in Postgres rather than memory, moving is a change of
host, not of design.

> Decision: **start on Vercel.** Revisit only on evidence, not anticipation.

## 5. Build sequence

Each step ships something usable. Stop at any point and nothing is stranded.

| # | Step | Ships |
|---|---|---|
| **0** | **Run the two migrations. Add `OPENAI_API_KEY`.** | Everything below is blocked on this. |
| 1 | Tool registry → real `tool()` defs with zod schemas | Typed, testable, reusable tools |
| 2 | Hand-code **one** LangGraph: the procurement plan | Proves interrupt + checkpointer end to end |
| 3 | Bridge LangGraph events → `step()`; add `agent_run_tool_calls` | Closes doctrine **L4** |
| 4 | Graph store tables + compiler + validation | Workflows become data |
| 5 | Canvas: `AgentPlanCanvas` → editable `@xyflow/react` | Change on the go |
| 6 | Rubric harness on graph outputs | Closes doctrine **L6** |
| 7 | LangSmith env vars | Doctrine **L14** `[BAA pp.119-120]` |

Step 2 before step 4 is deliberate, and it is doctrine **L2** `[BAA pp.94-95]`: build one by
hand, prove it, *then* generalise. A compiler written before a single graph has run is a
compiler for a language nobody has spoken.

## 6. What not to do

- **Do not migrate the 7 working cron executors.** They are deterministic workflows with a
  known path. Doctrine **L1** `[BAA p.104]` — a workflow was as accurate, cheaper and faster
  than the agent. Rewriting them into graphs buys nothing and risks everything.
- **Do not migrate `council/runner.ts` first.** It works. It is a good *later* proof, not a
  first target.
- **Do not replace `withAgentRun`.** Wrap it.
- **Do not build the canvas first.** A pretty editor over a non-durable engine is a demo.
- **Do not adopt Python LangGraph.** More mature, but a second runtime, deploy and auth
  surface for a team already shipping TS. The JS packages are 1.x.

## 7. Risks, stated plainly

| Risk | Reality |
|---|---|
| LangGraph JS trails Python | True. Book examples are Python and need translation. Mitigated by 1.x status and staying on documented primitives. |
| Checkpointer schema in your Supabase | `PostgresSaver` creates its own tables. Keep it in a separate schema so it never collides with `oem_*`. |
| 300s ceiling | Real. Interrupts decompose around it. Any *single* node exceeding 300s needs a worker. |
| Graph edited mid-run | Solved by version pinning (L5). Skip it and you get corruption that is very hard to debug. |
| Cost blowup | Graphs make loops easy. Enforce the existing `cost cap/day` and `max runs/day` at the executor, not the UI. |
| Nothing browser-verified | The plan canvas compiles and typechecks; it has not been exercised in an authenticated session. |

## 8. Honest bottom line

The orchestration layer is the right call, LangGraph JS is the right tool, and Vercel is a
viable host because the checkpointer makes it one.

But **steps 1-7 are all blocked on step 0.** Right now the agent runtime schema is
half-applied and there is no model key. Adding an orchestration layer on top of that is
roofing a house with no foundation. Two migrations and one API key convert every item above
from theory into work that can start.
