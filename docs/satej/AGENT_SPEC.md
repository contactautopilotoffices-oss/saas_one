# Satej — vendor discovery agent

A purchase requirement goes in. Satej structures it, finds local vendors on the
web, has **Meera** (the Bolna voice agent) phone each one, scores every call with
a fixed rulebook, and sends the ranked shortlist to the purchase team on WhatsApp.

- Code: `backend/lib/satej/` · API: `app/api/satej/*`, `app/api/cron/satej-worker`
- Screens: procurement dashboard → **Vendor Discovery (Satej)**; org admin → Procurement → **Vendor Discovery (Satej)**; `/[orgId]/satej`
- Voice agent: Meera on Bolna, configured from code by `scripts/satej-sync-bolna.ts`
- Schema: `supabase/migrations/20260928000001_satej_vendor_discovery.sql`
- Plan it came from: `Procurement_Agent_Plan.md` (the procurement-agent package)

## Agent Spec — Satej

**1. Workflow or agent?** Workflow. `[BAA p.104]`
   Justification: the pathway is known ahead of time — structure, search, approve, call, analyse, rank, notify — with few edge cases, which is where a workflow wins. `[BAA p.104]` Model calls sit inside fixed stages; none of them chooses the next stage.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior automated path exists; today a procurement executive searches and phones vendors by hand. The first five live requirements are to be run alongside that manual process and the shortlists compared (see item 10).

**2. Context** `[BAA p.112]`
   Satej holds the whole requirement, every web page it read, every transcript and the rulebook. Meera holds one CSV row (one vendor, one requirement) and the company brief — nothing else. That split is deliberate: the caller cannot leak another vendor's name or the internal budget, because it never has them.

**3. Cost of a false positive** `[BAA p.112]`
   - Reading search pages → **low** (a wrong vendor lands on a list a person approves) → cheapest fast model, `deepseek-v4-flash-0731`.
   - Placing a call → **high** (a real business is phoned) → a person approves every call list first (`SATEJ_AUTO_START_CALLS` is off by default).
   - Analysing a call → **medium** (feeds a ranking a person reads) → the council model (`glm-5.3-flash`), and the score itself is computed by fixed rules from quoted evidence, not by the model.

**4. Tools**

| tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
|---|---|---|---|---|
| Exa web search (`clients/exa.ts`) | yes — per-query, failures counted; all-failed is a named failure, never "no vendors" | yes — recorded on the trace step and the activity log | query strings built by code from the brief | no — see 10 |
| Engy via council client (`clients/llm.ts`) | yes — JSON-only stages, no retry-until-it-parses | yes — stage fails with the model's own error | output validated/sanitised field by field | no — see 10 |
| Bolna batch (`clients/bolna.ts`) | yes — only after approval; batch webhook + 5-min sync | yes — logged, retried by the worker | CSV columns fixed = `CALL_VARIABLES`; the sync script refuses a prompt using any other variable | no — see 10 |
| AiSensy WhatsApp (`clients/whatsapp.ts`) | yes — best effort; the Satej page is the record | yes — never throws; logged | template params stripped of new lines | no — see 10 |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes, in all four prompts (structurer, discovery, call analyst, Meera). Explicit no-skip clause: yes, in all four.
   Single-shot tone example: yes, in Meera's prompt (one exchange, "do not copy word for word"). Terminal state written to data: requirement `status = notified` with the ranking stored on the row; every stage writes its status. `[BAA p.114]`

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Yes — the same vendor categories recur by city. No write-tool is shipped yet: memory pays off only once enough evidence accumulates `[BAA p.103]`, and there is none. The one use of history today is a read — the 30-day do-not-recall rule on this organisation's own calls. A vendor master with score history is the planned next step; its write path must reject unknown scope keys. `[BAA p.101]`

**7. Multi-agent?** `[BAA p.116]`
   Split into two: Satej (workflow and analysis, on Engy) and Meera (the phone conversation, on Bolna's own LLM). Reason: **per-task model** — a live call needs a fast conversational model and speech stack; the analysis needs a careful reader. Each can be tuned without risking the other. `[BAA p.116]`

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: every working stage runs inside `withAgentRun`; errors land on the run and in the requirement's activity log; the worker names a missing migration instead of failing silently.
   Quality assurance (rubric: family __, tier __, scale __, manual audit __%) `[BAA pp.96–98]`: **not built yet** — see 10.
   Tool interaction (expected tool set + order; measured call count) `[BAA p.95]`: expected order search → read pages → approve → call → analyse → notify; each is a trace step with counts (queries, pages, vendors, calls analysed).
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`: cost per stage recorded from the council client's spend counter; tokens per call are not (the shared client does not return usage). Measured: one brief ≈ 20 s; one Exa query ≈ 2 s; a page read 3–25 s on the fast model.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: yes — the Satej page has a **Run log** (the Agent Console's run list and step trace, scoped to Satej), visible to procurement users.
   Ad-hoc single-agent testing done before scale: `[BAA p.116]` yes for the pipeline (`scripts/satej-simulate.ts`, all mock stages end to end) and for each live connector once (Engy brief, Exa search, page read). **Not yet** for a real Bolna call.

**10. Laws knowingly violated, and why:**
   - **L6 (rubric) and the QA axis of L5** `[BAA pp.96–98, 118–119]`: no grader exists yet because there are no real transcripts to grade. First step after go-live: hand-audit the first 20 call analyses against their recordings, then add a grader from a different model family.
   - **L2 (head-to-head)** `[BAA pp.94–95]`: there is no automated baseline; the comparison is against the purchase team's own shortlist on the first five requirements.
   - **L9 (MCP as transport)** `[BAA pp.106–107]`: Exa, Engy, Bolna and AiSensy are called through FMS's existing clients. None has an MCP server in this repo, and a workflow with fixed calls gains nothing from tool discovery.
   - **L4 (path recording) partially** `[BAA p.95]`: steps record counts and ids, not every argument of every call.

## Go-live, in order

1. Apply `supabase/migrations/20260928000001_satej_vendor_discovery.sql`.
2. In Vercel, add `SATEJ_BOLNA_AGENT_ID` and `SATEJ_BOLNA_WEBHOOK_TOKEN` (same values as the local `.env`), and check that `EXA`, `BOLNA_API_KEY`, `COUNCIL_PROVIDER` / `COUNCIL_BASE_URL` / `COUNCIL_API_KEY` / `COUNCIL_MODEL`, `AISENSY_API_KEY` and `CRON_SECRET` are set there too (they are in the local `.env`; Vercel was not checked).
3. In AiSensy, create the two templates in `WHATSAPP_META_TEMPLATES.md` (section "Satej") and wait for Meta approval.
4. Deploy. The Satej worker cron (every minute) comes with `vercel.json`.
5. Open Vendor Discovery (Satej): the setup line must say **Ready**. Anything else names what is missing.
6. First real run: 3 vendors, approve the list by hand, listen to every recording.

Meera's prompt, voice and webhook are changed only through `npx tsx scripts/satej-sync-bolna.ts --apply`. Editing her in the Bolna dashboard works, but the next sync puts the repo's version back.
