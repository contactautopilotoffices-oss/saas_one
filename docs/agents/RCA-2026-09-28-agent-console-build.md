# RCA — "Build says it worked, but the agent's flow is not visible, and we can't tell why it fails"

**Date:** 2026-09-28 · **Area:** Agent Console → Describe it → Plan workflow / Build / Accept
**Status:** root causes fixed in code (not yet deployed). Open items at the end.

## What people saw

- Plan workflow sometimes produced a generic procurement template that ignored what was typed.
- Build and Accept reported success, but nowhere afterwards showed the agent's workflow.
- When something failed, the screen did not say what.

## Root causes (each checked in the code, with a live reproduction where possible)

1. **The planner never saw the organisation's tables.** In `backend/lib/agents/planModel.ts` the table list was built with a plain-quoted string instead of a template string, so the model received the literal text `${t.name} [${t.domain}] — ${t.purpose}` 94 times. Any step naming a real table was then stripped as "a reference this org does not have".
2. **A model failure was silently replaced by a template.** The planner's `catch { return fallback(); }` threw the error away and returned the rule-based plan, which the canvas labelled "rule-based · no model ran". A timeout, a cut-off answer or a malformed answer all looked like a normal plan.
3. **The planner was running out of room.** Measured today, one ordinary paragraph produced a 9-step plan using **6,011 output tokens** out of the 7,000 it borrowed from the `opinion` setting, and took 82 s. A longer description ran out (`finish_reason=length`) — and cause 2 hid it.
4. **The plan route had no time limit of its own**, so the platform default applied and a slow plan could be cut off with an HTML 504.
5. **The workflow was never saved.** Build (identity, prompt, data bundle) and Plan (the workflow) are separate, and the plan lived only in the Describe-it box's memory. Collapsing the box or switching agent discarded it. After a successful build there was nothing to show — this is the "flow is not visible" symptom.
6. **Answers to the plan's questions were dropped.** "Accept plan & build" appended the answers and started the build in the same click, but the build read the text from before the answers were added.
7. **"Saved" when nothing was saved.** On a database without the agent runtime tables, the save calls answer `provisioned: false`, which the console treated as success: "Updated.", "Saved as vundefined.", "Version undefined is now active."
8. **Misleading panels on the agent page.** The readiness panel crashed the Configure tab on an error reply, and said "Ready to run" when it could not read the agent. The first-run preview showed Ira's email on every agent's page.
9. **The flow editor's Save did nothing**, and its palette was a fixed list that omitted WhatsApp, push, Zoho — and had no voice-call or webhook step at all.

## What changed

| # | Fix | Where |
|---|---|---|
| 1 | Template string fixed; the model now also gets each tool's label, purpose and live status | `planModel.ts` |
| 2 | Failure reason kept (`fallbackReason`), logged, and shown in red above the plan: "the model could not plan this… Why: …" | `planModel.ts`, `plan.ts`, `AgentPlanCanvas.tsx` |
| 3 | Planner gets its own 12,000-token allowance (`plan` purpose) | `council/llm.ts` |
| 4 | `maxDuration = 300` on the plan route | `app/api/agents/plan/route.ts` |
| 5 | Accept now saves the workflow onto the agent (`oem_agents.config.plan`, merged); the Configure tab shows it, or says plainly that none is saved | `AgentConsole.tsx` |
| 6 | Build takes the finished text, answers included | `AgentConsole.tsx` |
| 7 | `provisioned: false` counts as a failure and says why; no more "vundefined" | `AgentConsole.tsx` |
| 8 | Readiness panel shows its error instead of crashing, "Not ready" when it cannot run; Ira's preview only on Ira | `AgentPreflight.tsx`, `AgentConsole.tsx` |
| 9 | Palette built from the tool registry; **Voice call (Bolna)** and **WhatsApp webhook (inbound)** added as tools, with new `call` and `trigger` step types; "Use this flow" keeps edits for Accept; **Full screen** for the workflow (Esc to exit) | `plan.ts`, `AgentFlowCanvas.tsx`, `AgentPlanCanvas.tsx` |

Also: WhatsApp's tool status now checks `AISENSY_API_KEY` (what actually sends) instead of `WASENDER_API_KEY` (which no sending code reads), and the three hard-coded tool lists now read one registry (`TOOL_SLUGS`).

## Verified

- Live planner run after the fixes: 9 steps, `trigger (WhatsApp webhook) → … → approve → call (Bolna) → … → notify (WhatsApp)`, all tools connected, no fallback.
- Type check clean; server render of the plan canvas in proposal, failed-model and saved modes.
- **Not verified in a signed-in browser** — the test browser has no FMS session.

## What the flow is — and is not

The workflow drawn in the console is a **specification**. Nothing in FMS executes a drawn flow step by step; an agent's behaviour lives in code (Ira's routes, Satej's pipeline). A flow that shows a Bolna call step documents that the agent calls vendors; Satej's code is what actually places the calls.

## Still open (not fixed here)

- **A new agent can overwrite an existing one** whose key the composer happens to pick. The console now warns before Accept; it does not block.
- **Build can outrun its function:** the composer may make two model calls of up to 240 s each inside one 300 s function. When that happens the screen says the server was cut off, which is true but not specific.
- **Security, found in passing:** `GET /api/agents/preflight` reads another organisation's agent for any signed-in user; the model routes (compose, plan, optimize, setup) check sign-in but not organisation membership; `/api/voice/webhook` (Ira's Bolna webhook) accepts unauthenticated posts.
