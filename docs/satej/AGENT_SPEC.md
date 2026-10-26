# Meera — procurement agent (vendor discovery)

Called **Satej** until 2026-10-06; renamed because Satej Sadhye is on the purchase team. Code paths, tables, routes and env vars keep the `satej` name (renaming them would need migrations, Vercel env changes and a new Bolna webhook, for no visible gain). People see Meera everywhere; `/[orgId]/meera` and `/[orgId]/satej` open the same console.

A purchase requirement goes in. Meera structures it, finds local vendors on the
web, has **Meera** (the Bolna voice agent) phone each one, scores every call with
a fixed rulebook, and sends the ranked shortlist to the purchase team on WhatsApp.

- Code: `backend/lib/satej/` · API: `app/api/satej/*`, `app/api/cron/satej-worker`
- Screens: procurement dashboard → **Vendor Discovery (Meera)**; org admin → Procurement → **Vendor Discovery (Meera)**; `/[orgId]/satej`
- Voice agent: Meera on Bolna, configured from code by `scripts/satej-sync-bolna.ts`
- Schema: `supabase/migrations/20260928000001_satej_vendor_discovery.sql`; rate benchmark + FAQ: `supabase/migrations/20261006000001_satej_rate_benchmark.sql`
- Plan it came from: `Procurement_Agent_Plan.md` (the procurement-agent package)

## Agent Spec — Meera

**1. Workflow or agent?** Workflow. `[BAA p.104]`
   Justification: the pathway is known ahead of time — structure, search, approve, call, analyse, rank, notify — with few edge cases, which is where a workflow wins. `[BAA p.104]` Model calls sit inside fixed stages; none of them chooses the next stage.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior automated path exists; today a procurement executive searches and phones vendors by hand. The first five live requirements are to be run alongside that manual process and the shortlists compared (see item 10).

**2. Context** `[BAA p.112]`
   Meera's back office (the workflow) holds the whole requirement, every web page it read, every transcript and the rulebook. Meera on the phone holds one CSV row (one vendor, one requirement), the company brief and the approved FAQ — nothing else. That split is deliberate: the caller cannot leak another vendor's name or the internal budget, because it never has them.
   Since 2026-10-06 the row also carries two negotiating numbers (target and ceiling, from `benchmark.ts`). Meera gets those two figures only — never the history, the vendors behind it, or the source — and is told never to say where they come from.

**3. Cost of a false positive** `[BAA p.112]`
   - Reading search pages → **low** (a wrong vendor lands on a list a person approves) → cheapest fast model, `deepseek-v4-flash-0731`.
   - Placing a call → **high** (a real business is phoned) → a person approves every call list first (`SATEJ_AUTO_START_CALLS` is off by default).
   - Analysing a call → **medium** (feeds a ranking a person reads) → the council model (`glm-5.3-flash`), and the score itself is computed by fixed rules from quoted evidence, not by the model.
   - Pushing back on a rate on the call → **medium** (a vendor may be put off) → at most one push, only when a trustworthy benchmark exists (same unit, ≥3 past lines, similarity ≥0.5), and never agreeing a final price. The verdict on a quote is SQL (`satej_quote_verdict`), not the model.

**4. Tools**

| tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
|---|---|---|---|---|
| Exa web search (`clients/exa.ts`) | yes — per-query, failures counted; all-failed is a named failure, never "no vendors" | yes — recorded on the trace step and the activity log | query strings built by code from the brief | no — see 10 |
| Engy via council client (`clients/llm.ts`) | yes — JSON-only stages, no retry-until-it-parses | yes — stage fails with the model's own error | output validated/sanitised field by field | no — see 10 |
| Bolna batch (`clients/bolna.ts`) | yes — only after approval; batch webhook + 5-min sync | yes — logged, retried by the worker | CSV columns fixed = `CALL_VARIABLES`; the sync script refuses a prompt using any other variable | no — see 10 |
| AiSensy WhatsApp (`clients/whatsapp.ts`) | yes — best effort; the Meera page is the record | yes — never throws; logged | template params stripped of new lines | no — see 10 |
| Rate benchmark (`benchmark.ts` → SQL `satej_rate_pool`, `satej_quote_verdict`) | yes — used only when the match is the same unit, ≥3 lines, similarity ≥0.5; otherwise Meera asks without a target | yes — a missing migration is named in the activity log; the call goes ahead without a target | query + unit + rate only; normalised in SQL | no — see 10 |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes, in all four prompts (structurer, discovery, call analyst, Meera). Explicit no-skip clause: yes, in structurer, discovery and call analyst. Meera's 2026-10-06 rewrite deliberately lets the four checks come "in any natural order" — a fixed order made her sound like a survey on the live calls — and keeps the order only for open → checks → close.
   Single-shot tone example: yes, in Meera's prompt (one exchange, "do not copy word for word"). Terminal state written to data: requirement `status = notified` with the ranking stored on the row; every stage writes its status. `[BAA p.114]`

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Yes — the same vendor categories recur by city. No write-tool is shipped yet: memory pays off only once enough evidence accumulates `[BAA p.103]`, and there is none. The one use of history today is a read — the 30-day do-not-recall rule on this organisation's own calls. A vendor master with score history is the planned next step; its write path must reject unknown scope keys. `[BAA p.101]`

**7. Multi-agent?** `[BAA p.116]`
   Split into two, both presented as Meera: the back office (workflow and analysis, on Engy) and the phone conversation. Reason: **per-task model** — a live call needs a fast conversational model and speech stack; the analysis needs a careful reader. Each can be tuned without risking the other. `[BAA p.116]`
   Meera's stack since 2026-10-06: Sarvam end to end — `sarvam-105b-conversations` (our key, registered on Bolna as a custom model), Bulbul v3 voice "Priya", Saaras v4 transcription; Bolna only dials over our Plivo number. Measured with her real prompt: first token 0.1–0.16 s (was ~0.4 s on Azure GPT-5.4-mini). Rollback: `npx tsx scripts/satej-sync-bolna.ts --apply --llm=azure`.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: every working stage runs inside `withAgentRun`; errors land on the run and in the requirement's activity log; the worker names a missing migration instead of failing silently.
   Quality assurance (rubric: family __, tier __, scale __, manual audit __%) `[BAA pp.96–98]`: **not built yet** — see 10.
   Tool interaction (expected tool set + order; measured call count) `[BAA p.95]`: expected order search → read pages → approve → call → analyse → notify; each is a trace step with counts (queries, pages, vendors, calls analysed).
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`: cost per stage recorded from the council client's spend counter; tokens per call are not (the shared client does not return usage). Measured: one brief ≈ 20 s; one Exa query ≈ 2 s; a page read 3–25 s on the fast model.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: yes — the Meera page has a **Run log** (the Agent Console's run list and step trace, scoped to Meera), visible to procurement users.
   Ad-hoc single-agent testing done before scale: `[BAA p.116]` yes for the pipeline (`scripts/satej-simulate.ts`, all mock stages end to end) and for each live connector once (Engy brief, Exa search, page read). Meera on Sarvam: four scripted turns run against the model directly (2026-10-06: introduction, a ₹45 quote pushed back to the target, a call-screening assistant, "are you a robot"). **Not yet** a real phone call on the Sarvam stack — use "Call me first".

**10. Laws knowingly violated, and why:**
   - **L6 (rubric) and the QA axis of L5** `[BAA pp.96–98, 118–119]`: no grader exists yet because there are no real transcripts to grade. First step after go-live: hand-audit the first 20 call analyses against their recordings, then add a grader from a different model family.
   - **L2 (head-to-head)** `[BAA pp.94–95]`: there is no automated baseline; the comparison is against the purchase team's own shortlist on the first five requirements.
   - **L9 (MCP as transport)** `[BAA pp.106–107]`: Exa, Engy, Bolna and AiSensy are called through FMS's existing clients. None has an MCP server in this repo, and a workflow with fixed calls gains nothing from tool discovery.
   - **L4 (path recording) partially** `[BAA p.95]`: steps record counts and ids, not every argument of every call.
   - **L7 (no-skip clause) for Meera's middle section** `[BAA p.105]`: the four checks may come in any order — see 5. The flow's ends (introduce first, close last) stay fixed.

## Go-live, in order

1. Apply `supabase/migrations/20260928000001_satej_vendor_discovery.sql` (applied 2026-10-03) and `supabase/migrations/20261003000001_satej_chat.sql` (the chat panel).
2. In Vercel, add `SATEJ_BOLNA_AGENT_ID`, `SATEJ_BOLNA_WEBHOOK_TOKEN` and `SATEJ_ELEVENLABS_AGENT_ID` (same values as the local `.env`), and `ELEVENLABS_API_KEY` if it is not there; and check that `EXA`, `BOLNA_API_KEY`, `COUNCIL_PROVIDER` / `COUNCIL_BASE_URL` / `COUNCIL_API_KEY` / `COUNCIL_MODEL`, `AISENSY_API_KEY` and `CRON_SECRET` are set there too (they are in the local `.env`; Vercel was not checked).
3. In AiSensy, create the two templates in `WHATSAPP_META_TEMPLATES.md` (section "Meera") and wait for Meta approval.
4. Deploy. The Meera worker cron (every minute) comes with `vercel.json`.
5. Open Vendor Discovery (Meera): the setup line must say **Ready**. Anything else names what is missing.
6. First real run: 3 vendors, approve the list by hand, listen to every recording.

## Prices and the FAQ (2026-10-06)

- **Benchmark.** `satej_rate_benchmark` is rebuilt from `zoho_po_line_items` (approved/open/billed POs, last 36 months) by `satej_refresh_rate_benchmark()` — cron `/api/cron/satej-benchmark` on days 1, 11, 21, 31, and a **Refresh now** button. Products are keyed on the normalised line *description* (the Zoho item name is an accounting bucket); spelling variants are pooled at lookup time by trigram similarity, within one unit.
- **On a requirement.** After the brief, Meera looks up the item. With a trustworthy match it sets Meera's target (the cheaper quarter of what we paid, or the 12-month median if lower) and ceiling (the usual price, +5%, capped at the upper quartile). Shown on the requirement as **Price history**.
- **After the calls.** The analyst extracts each vendor's final and first rate; SQL places it against history; the rate is 20 of the 100 points (good 20 · fair 15 · a little high 8 · high 2 · no history 10 · no rate 0). The summary opens with Meera's pick and its reason; a person decides.
- **FAQ tab.** `satej_faq`. Procurement drafts; org super admins / master admins approve and **Publish to Meera**, which rewrites only the "# Common questions" section of her live script through the versioned publish path.

## Talking to Meera

Each requirement has a chat panel (Meera answers from that requirement's record and proposes changes; a person presses Apply) and a **Call** button — a voice call on ElevenLabs Conversational AI, agent "Meera (FMS vendor discovery)", voice Amay (Indian English). The agent is set up by `npx tsx scripts/satej-sync-elevenlabs.ts --apply`; every call overrides its prompt with the requirement's live record. Call minutes land in the chat, and any change asked for on the call arrives as a proposal to apply. Nothing said in chat or on a call changes a requirement by itself.

Meera's prompt, voice and webhook are changed only through `npx tsx scripts/satej-sync-bolna.ts --apply`. Editing her in the Bolna dashboard works, but the next sync puts the repo's version back. (On 2026-10-06 the sync found a 32,684-character dashboard script from 3 Oct using variables Meera never sends — `{project_work_type}`, `{project_city}`… — so every Meera call since then would have spoken blanks. It was replaced; the original is in `docs/satej/bolna-agent-backup-2026-10-06-09-50-38.json`.)
