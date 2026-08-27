# Target profile: how the Council reaches 4.5

Companion to `evals/claude-code-2026-08-02-1.yaml` (current score). This is a plan, not a
scorecard — nothing here is claimed as built.

---

## 0. Two corrections to the measuring stick, before any planning

### 0a. EVAL.md's weights sum to 80, not 70

`EVAL.md:81` states *"Weight column sums to 70 points"* and the scorecard template divides
by 70. The declared weights are 10, 10, 8, 8, 6, 8, 8, 6, 6, 4, 3, 3 — which **sum to 80**.

Dividing by 70 inflates every score by 80/70 = **1.143×** and allows an off-scale maximum of
5.71.

**Consequence for the committed scorecard:** the reported **1.76 should be read as 1.54**
(123 ÷ 80). I am not editing the committed file — `EVAL.md:32` says never overwrite a
previous scorecard, and the history is itself a signal — so the correction is recorded here.

All arithmetic below uses **÷80**, i.e. 4.5 = **360 of 400 points**.

Recommend fixing EVAL.md line 81 to say 80, or reweighting to actually total 70.

### 0b. The score is currently gated at 2.0 by a first principle, not by features

This is the thing that matters most and it is invisible if you only read the Part A scores.

| Gate | Rule (verbatim) | Status | Ceiling while it holds |
|---|---|---|---|
| **FP-03** legible to a non-developer | *"Any violation caps your overall score at 2"* | **fail** | **2.00** |
| **6 TRUTH fails** (01, 02, 05, 07, 08, 09) | *"A fail voids any Part A score above 3"* | **fail** | **3.00** |

So **no amount of engineering reaches 4.5 until these are cleared.** Build every feature on
the list below to perfection and the score still reads 3.0. These two gates are the whole
first phase.

---

## 1. What you asked to defer is worth ~1.5, not 0.5

You proposed leaving WhatsApp, agent inboxes, export templates and daily-activity tracking
for the final 0.5. Those map onto **REQ-08 (weight 6), REQ-01 (weight 10)** and part of
**REQ-07 (weight 8)** — 24 of 80 weight, **30% of the total score.**

Modelled (everything not named assumed a perfect 5):

| Scenario | Points | Score | 4.5? |
|---|---|---|---|
| Defer WhatsApp **and** inboxes | 330 | **4.13** | ✗ impossible |
| Defer both, inboxes partial (REQ-01=3) | 350 | 4.38 | ✗ |
| Defer WhatsApp only, inboxes=4 | 360 | **4.50** | ✓ exactly, zero slack |
| Defer WhatsApp only, everything else 5 | 370 | 4.63 | ✓ |
| **Balanced** — thin WhatsApp (3), inboxes 4 | 367 | **4.59** | ✓ recommended |

**The hard finding: you cannot defer both.** Deferring WhatsApp *and* agent inboxes caps you
at 4.13 even if all ten other requirements are flawless.

**Recommendation: the balanced profile.** "Defer WhatsApp only" requires *every* other
requirement at a perfect 5 — one slip to a 4 and you miss. Balanced carries ~7 points of
slack and asks for a thin slice of WhatsApp (one real round trip = score 3) instead of
perfection everywhere else. It is the more robust route to the same number.

Note REQ-12 at 5 requires *"the person's own confirmation that they stopped checking"* —
that is gated on elapsed time, not code. Plan for REQ-12 = 4.

---

## 2. Phase 0 — clear the gates (unlocks 2.0 → 3.0 → the rest)

Nothing else counts until this is done.

| # | Work | Clears |
|---|---|---|
| 0.1 | **Apply the migration.** One command. Identities, sessions, transcripts, findings and inbox rows begin to exist. | Half of FP-03, and prerequisites for REQ-01/03/07 |
| 0.2 | **Run one real council session** and confirm the Chamber renders it. A non-developer must be able to see what each agent did and why, without reading source. | FP-03 |
| 0.3 | **Feed the audit's known facts into the data pack** as evidence sections, so personas can flag what they currently cannot see. | TRUTH-01, 02, 07, 08 |
| 0.4 | **Add source-of-truth reconciliation** to every ticket count. Already half-proven: the council found three incompatible definitions of "active" (`command-center/portfolio:28`, `daily-whatsapp-report:25`, `tickets-summary:67-68`) diverging 213 vs 48 on the same rows. | TRUTH-05 |
| 0.5 | **Write the test-artifact cleanup policy** and a detection query for records like `[FMS-AUDIT-TEST-15-JUN]`. | TRUTH-09 |

Specifically for 0.3, the pack needs four new sections it does not have:
- **role hierarchy** — actual roles vs rendered roles, so the Technician gap is visible (TRUTH-01)
- **intake form schema + completeness** — % of tickets landing as GENERAL, category/floor/location null rates (TRUTH-08)
- **escalation events** — did an escalation *fire* on aged tickets, not just how old they are (TRUTH-07)
- **tenant-visible field exposure** — what the intake form surfaces to tenants (TRUTH-02)

---

## 3. Phase 1 — the point engine, ordered by return per unit of work

| Req | Now | Target | Δ pts | Work | ROI |
|---|---|---|---|---|---|
| **REQ-02** scoping | 2 | 5 | **+30** | Add `allowed_sections` to `CouncilAgentDef`; filter the pack in `buildOpinionMessages`; per-agent output format + escalation rule enforced in code, not prompt text. | **Highest.** Roughly half a day of pure code for 30 points. |
| **REQ-04** impact | 0 | 5 | **+40** | Three closed loops: signal → agent acts → outcome recorded → measured against the counterfactual. Plus an impact dashboard and an honest false-positive count. | Biggest single gain; also the hardest. |
| **REQ-01** inboxes | 1 | 4 | **+30** | Real inbound (the repo already reads a real mailbox via `ZohoMailService` — extend it), parse into a **task record** not just storage, outbound from the agent's own address. | High, but needs real mailboxes. |
| **REQ-05** inventory | 1 | 5 | **+24** | The actual artifact: every table + column, last-written, last-read, consuming view/agent, dark-data named, missing-data named, value hypothesis each, prioritised and costed. | Mostly a script plus analysis. Very good ROI. |
| **REQ-03** council | 2 | 5 | **+24** | Persisted transcripts (comes free with 0.1), an explicit **dissent block** in the chairman format, and a written trigger rule for council-worthy vs single-agent. | Cheap once 0.1 lands. |
| **REQ-07** mails/audits/voice | 2 | 5 | **+24** | Versioned voice spec file; one real audit workbook from a real session; inbound comprehension. **The "gap a human missed" is already in hand** — the three-way active-ticket divergence. | Cheap; evidence already exists. |
| **REQ-06** absence/drift | 2 | 4 | **+16** | `expected_events` config table (metric, scope, cadence, grace) — and implement **water** from it, the prompt's own canonical example, currently absent entirely. Plus a suppression rule a non-developer can adjust. | Medium. |
| **REQ-08** WhatsApp | 0 | 3 | **+18** | One real round trip on one flow, with sender-number → person identity resolution before any write. The queue and Graph API already work; this is wiring, not building. | Good — cheaper than perfecting others. |
| **REQ-09** safe space | 3 | 5 | **+12** | Written promotion criteria as a demonstrable checklist; rollback; append-only agent-action log across both tiers. | Cheap. |
| **REQ-12** dependence | 0 | 4 | **+12** | Weekly cron that convenes the council and emails the audit — removes the manual deep audit from a person's plate. | Cheap, high symbolic value. |
| **REQ-10** UI | 3 | 5 | **+8** | Replace the three flagged hex literals with tokens; screenshot a dense transcript to prove legibility under load. | Trivial. |
| **REQ-11** framework | 3 | 5 | **+6** | Write the exit path: what changes if the model is replaced, what is model-specific in the persona prompts. | Trivial. |

**Total: 123 → 367 points = 4.59.**

---

## 4. Suggested sequence

1. **Gates** (Phase 0) — without these the ceiling is 2.0, then 3.0. Everything else is wasted effort until done.
2. **REQ-02 scoping** — 30 points for half a day; do it before anything expensive.
3. **REQ-10, REQ-11, REQ-09, REQ-12** — 38 points of cheap, mostly-writing work.
4. **REQ-05 inventory** — 24 points, and it *informs* everything after it by revealing what data exists to act on.
5. **REQ-03, REQ-07** — 48 points, cheap once the migration is applied.
6. **REQ-01 inboxes** — 30 points, needs real mailbox provisioning (external dependency).
7. **REQ-06 absence/drift** — 16 points; ship water first.
8. **REQ-08 WhatsApp** — 18 points of wiring onto an existing queue.
9. **REQ-04 impact** — 40 points, last because it depends on signals from 6 and channels from 1 and 8.

---

## 5. Three honest warnings

- **REQ-12 cannot be bought with code.** A 5 requires you to confirm you stopped checking.
  That is weeks of the thing running correctly, not a sprint. Budget a 4.
- **The 0.5 you are reserving is really 1.5.** If WhatsApp, inboxes and export templates all
  slip, the ceiling is 4.13 — so at least a thin slice of each has to land inside the "4.5"
  phase, not after it.
- **Chasing the number can corrupt the project.** `EVAL.md` Part D already bans a dashboard of
  agents that are not running, and tests written against invented behaviour. The gates in
  Phase 0 exist precisely because they are the parts that resist being faked: a non-developer
  seeing what happened, and agents being handed the facts they are meant to reason about.
