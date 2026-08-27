# EVAL.md — Council of Agents, self-evaluation contract

**Read this before you write code. Read it again before you claim you are done.**

You are one of several coding agents (Claude Code, Kimi Code, or another) working on the
Council of Agents build inside the Autopilot FMS. This file is the *only* definition of
"done" that counts. It exists because the person who commissioned this work is not a
developer and cannot read your diff to check whether you built what was asked or what was
easy.

Every requirement below is pinned to the **exact line of the original prompt** it came
from. You do not get to score yourself against a task you invented. If you cannot quote
the prompt line, the work does not count toward the score.

---

## 0. Protocol — how to use this file

1. **Before starting a work session**, read Parts A, B and C in full.
2. **Pick the requirement IDs** you intend to move this session. Write them down at the
   top of your session log.
3. **Build.**
4. **At the end of the session**, fill in the scorecard in Part F. For every ID you
   touched you must supply:
   - the verbatim prompt line (copy it from this file, do not paraphrase),
   - your answer to the grounding question,
   - the evidence (file path + line range, or a command that a human can run),
   - your score, 0–5,
   - one sentence on what would move it up one point.
5. **Commit the scorecard** to `/evals/<agent>-<YYYY-MM-DD>-<n>.yaml`. Never overwrite a
   previous scorecard. The history of scores is itself a signal.
6. **Never score a requirement you did not touch this session.** Carry the previous score
   forward and mark it `carried: true`.

---

## 1. Scoring scale

Use these anchors literally. They are not vibes.

| Score | Meaning |
|---|---|
| **0** | Not started, or exists only as a comment, TODO, or plan. |
| **1** | Scaffolding exists. Nothing runs end to end. Mock or hardcoded output. |
| **2** | Runs on a happy path with hand-fed input. Breaks or silently no-ops on real FMS data. |
| **3** | Works against the real database on real records. Not resilient — no error handling, no retries, no logging you could debug from. |
| **4** | Works on real data, handles failure visibly, has a trace a non-developer could read to see what the agent did and why. |
| **5** | A person could stop supervising this specific behaviour for a week and it would still be correct, still be observable, and still fail loudly rather than quietly. |

**A 5 requires the "stop supervising" test to be honestly answerable.** The entire point of
this project — stated in the prompt as *"today I am dependent on my team for getting things
done"* — is removing the need to check. A feature that requires a human to verify each run
is capped at 3, no matter how elegant.

---

## 2. Evidence rules (anti-gaming)

These are hard rules. Violating one voids the score for that requirement.

- **No score above 1 without a file path.** State it as `path/to/file.ts:120-180`.
- **No score above 2 without a reproduction command.** A human must be able to paste one
  command and see the behaviour. `npm run agent:ops -- --dry-run` counts. "Open the app and
  click around" does not.
- **No score above 2 if the data is seeded, mocked, faked, or stubbed.** If the ops agent
  reports on tickets, it reports on real ticket rows from the real database.
- **A UI that displays an agent's name, avatar, or status is worth 0 toward that agent's
  requirement.** The chrome is not the agent. Score the execution, not the surface.
- **An LLM call that returns text is not an outcome.** If the requirement says the agent
  writes a mail, the score is about the mail existing in an outbox, not about a model
  producing mail-shaped prose.
- **If you are unsure between two scores, take the lower one.** An inflated score costs the
  project more than a deflated one, because it stops someone from looking.
- **Write down what you could not test.** An honest "I could not verify X because Y" is
  worth more than a confident number. Put it in `caveats:` in the scorecard.

---

# PART A — Requirements grounded in the prompt

Weight column sums to 70 points.

---

### REQ-01 — Agents exist as addressable identities with their own email

**Prompt line (verbatim):**
> "lets build a Council of Agents who have their own email id"

> "should have an inbox of their own in the organization of our starting with 8"

**Grounding question:**
*Can I send an email to one of these agents from outside the system, and does that agent
receive it, act on it, and reply — without a human forwarding anything?*

**Done means:**
- 8 agent identities exist as records in the database, each with an organization-scoped
  address.
- Each has an inbox that receives inbound mail.
- Inbound mail is parsed into a task the agent can act on, not just stored.
- Outbound mail sends from that agent's address, not from a shared system address.

**Score anchors:** 0 = no identity records. 2 = identities exist, mail is simulated.
3 = real inbound and outbound on at least one agent. 5 = all 8, with bounce handling,
threading, and a visible log of what each agent did with each message.

**Weight: 10**

---

### REQ-02 — The eight specialist roles, as named

**Prompt line (verbatim):**
> "how does my db + llm plus a suitable framework give me a ops psecialist , a compliace
> specialist , a q/a nalyst , a product lifecycle anlyst , a cto with lens on dat breaches
> and more technical aspects , a procurement specialist agents team and llm supervised
> council"

**Grounding question:**
*If I asked each of these six named specialists the same question, would I get six
genuinely different answers shaped by six different data scopes — or one model wearing six
hats?*

**Done means each agent has, distinctly:**
- its own **data scope** (which tables/queries it may read),
- its own **evaluation lens** (what it considers a finding),
- its own **output format** (what a deliverable from this role looks like),
- its own **escalation rule** (what it must not decide alone).

Named minimum set, from the prompt: Ops Specialist, Compliance Specialist, QA Analyst,
Product Lifecycle Analyst, CTO (data-breach and technical lens), Procurement Specialist.
The prompt says *"starting with 8"* — the remaining two are yours to propose and justify
in writing, and the justification is part of the score.

**Score anchors:** 0 = one generic agent. 1 = six prompt variants on one model, same data.
3 = six distinct data scopes, real queries, distinguishable outputs. 5 = the four
properties above are enforced in code, not just in prompts, so a role cannot read outside
its scope even if the model asks.

**Weight: 10**

---

### REQ-03 — LLM-supervised council layer

**Prompt line (verbatim):**
> "and llm supervised council (https://github.com/karpathy/llm-council.git) clone this and
> help me better the FMS"

**Grounding question:**
*When two agents disagree — say Procurement wants the cheapest vendor and Compliance says
that vendor's fire NOC lapses next month — who resolves it, on what basis, and can I see
the reasoning after the fact?*

**Done means:**
- The llm-council pattern (multi-model deliberation, cross-review, chairman synthesis) is
  actually adapted, not merely referenced in a README.
- Council runs produce a stored transcript: each agent's position, each agent's review of
  the others, and the final synthesis.
- Dissent is preserved. A minority view is visible in the output, not averaged away.
- The council has a defined trigger: what makes something council-worthy vs. a single
  agent's call.

**Score anchors:** 0 = repo not cloned or not adapted. 2 = agents run in sequence and the
last one summarises. 3 = real cross-review with stored transcript. 5 = dissent surfaced,
triggers defined, and a human can read one screen and understand why the council concluded
what it concluded.

**Weight: 8**

---

### REQ-04 — Impact engine, not input/output engine

**Prompt line (verbatim):**
> "help me better the FMS beyound an Input /output engine to an impact engine"

**Grounding question:**
*Name one thing that happened this week because the system noticed it, that would not have
happened if the system had waited to be asked.*

**Done means:**
- At least one closed loop exists: signal detected → agent acts → outcome recorded →
  outcome measured against what would have happened otherwise.
- The system initiates. If every action traces back to a human click, this is still an I/O
  engine.
- Impact is quantified in the units the business runs on: hours, rupees, SLA breaches
  avoided, tickets aged out.

**Score anchors:** 0 = request/response only. 2 = scheduled jobs that produce reports
nobody acts on. 3 = one real closed loop, measured. 5 = three or more loops, with a
dashboard showing cumulative impact and an honest count of false positives.

**Weight: 8**

---

### REQ-05 — Find every ounce of data and tie value to it

**Prompt line (verbatim):**
> "its about finding every ounce of data nad tying value to it"

**Grounding question:**
*What percentage of the columns in this database are currently read by nothing, by nobody,
ever — and what did we do about the ones that matter?*

**Done means:**
- A produced inventory: every table and column, last-written, last-read, and whether any
  agent or view consumes it.
- Dark data is named explicitly — fields being captured and never used.
- Missing data is named explicitly — decisions being made without a field that should
  exist. The audit already gives you one: *intake captures no category, floor, or location
  fields, so every ticket lands as GENERAL.*
- For each live data point, a stated value hypothesis: what decision it changes.

**Score anchors:** 0 = no inventory. 2 = a table list. 3 = full inventory with read/write
usage. 5 = inventory plus value mapping plus a prioritised list of what to start capturing,
costed by effort.

**Weight: 6**

---

### REQ-06 — Absence and drift detection ("hey water not logged today")

**Prompt line (verbatim):**
> "hey water not logged today , hey the tickets look duller today"

**Grounding question:**
*Does the system notice the thing that did not happen?*

This is the hardest requirement in the file and the most characteristic of the whole idea.
Most systems only see records that exist. This asks for the negative space.

**Done means:**
- **Absence detection:** expected-event definitions exist (readings, logs, checklists) with
  expected cadence, and a missed one raises a signal within its window.
- **Drift detection:** baselines per site/metric, with a defined notion of "duller" —
  volume down, resolution time up, first-response time up, a category gone quiet. Pick your
  statistic and defend it.
- **Signals are phrased in the organization's language**, not as alert codes.
- **Noise control:** a stated suppression rule so the person is not buried. If everything
  alerts, nothing does.

**Score anchors:** 0 = threshold alarms only. 2 = absence detection on one hardcoded metric.
3 = configurable expected-events plus one working drift statistic on real history.
5 = both, tuned against real historical data with a measured false-positive rate, and
suppression that a non-developer can adjust.

**Weight: 8**

---

### REQ-07 — Agents can write mails, export audits, identify gaps, speak in the org's voice

**Prompt line (verbatim):**
> "they must have capbility to write mails export fms audits , identify gaps , duplex with
> theorganization voice"

**Grounding question:**
*Could this agent's output be forwarded to a vendor or a client without a human rewriting
it first — and would anyone be able to tell it was not written by the team?*

Note "duplex" — two-way. The voice requirement runs in both directions: the agent must
write in the organization's voice **and** correctly interpret mail written in it, including
the shorthand, the abbreviations, and the site names.

**Done means:**
- Mail composition producing send-ready output, not a draft that needs a rewrite.
- Audit export in a real format the recipient can open, matching the structure of the
  weekly deep audit already in use (P0/P1/P2, repro steps, impact, ask).
- Gap identification that produces findings not already known — the value is in the ones a
  human missed.
- A voice definition that lives in a file, is versioned, and is applied consistently.

**Score anchors:** 0 = raw model output. 2 = templated mail. 3 = send-ready mail plus a
working audit export on real data. 5 = plus inbound comprehension, plus a versioned voice
spec, plus at least one gap found that the human audit missed.

**Weight: 8**

---

### REQ-08 — WhatsApp as a hook

**Prompt line (verbatim):**
> "connecting whatsapp to get a hook of things"

**Grounding question:**
*Can a technician standing in a corridor with no laptop tell the system something, and can
the system tell him something, over WhatsApp?*

**Done means:**
- Inbound: messages become structured records — a ticket, a reading, a status update, a
  photo attached to a work order.
- Outbound: agent-initiated messages with routing rules for who gets what.
- Identity: the sender's number resolves to a real person and their role. An unrecognised
  number cannot write to the database.
- Media handling respects the security constraint in TRUTH-04 below — photos from WhatsApp
  land in a private bucket, signed on read.

**Score anchors:** 0 = not started. 1 = webhook receives and logs. 3 = round trip on one
real flow. 5 = multiple flows, identity resolution, media handled securely, and a fallback
when the WhatsApp API is down.

**Weight: 6**

---

### REQ-09 — Master admin as the safe space, then promotion

**Prompt line (verbatim):**
> "love for yout o build an mvp here into the master admin"

> "the master admin is oour safe space we play there then move them into the super admin
> and then more"

**Grounding question:**
*If an agent does something catastrophically wrong right now, what is the blast radius —
and is it genuinely confined to master admin?*

**Done means:**
- Agents run in master admin with writes to production data either blocked or gated behind
  explicit approval.
- A defined **promotion path**: what an agent must demonstrate before it is allowed into
  super admin. Write the criteria down; do not decide it later.
- Rollback exists. Every agent action is reversible or explicitly flagged as irreversible
  before it runs.
- Dry-run mode is the default, not an option.

**Score anchors:** 0 = agents write straight to production. 2 = separate UI area, same
permissions underneath. 3 = real permission separation enforced server-side. 5 = plus
written promotion criteria, plus rollback, plus an audit log of every agent action taken in
either tier.

**Weight: 6**

---

### REQ-10 — Sci-fi UI, bounded by the design file

**Prompt line (verbatim):**
> "the ui can be very sci fi but bounded by the deisn md file"

> "at the end I want aui similar tot his"

**Grounding question:**
*Did I invent a single colour, font, spacing value, or component that is not in the design
md file?*

The word to weigh is **bounded**. "Sci-fi" describes the licence; "bounded by" describes the
limit. If the design file and your ambition disagree, the design file wins and you raise the
conflict in writing instead of resolving it yourself.

**Done means:**
- Every token used traces to the design md file.
- Deviations are listed explicitly in your session log with a reason, and flagged for a
  human decision rather than silently shipped.
- The UI is legible under load — a council transcript with dissent, a drift signal, and an
  agent action log must all be readable, not merely atmospheric.

**Score anchors:** 0 = no reference to the design file. 2 = loosely inspired by it.
3 = tokens sourced from it with deviations documented. 5 = zero undocumented deviations and
the dense screens still read clearly.

**Weight: 4**

---

### REQ-11 — Framework choice, justified

**Prompt line (verbatim):**
> "how does my db + llm plus a suitable framework give me"

**Grounding question:**
*Why this framework, and what does it cost me when I want to change it in six months?*

**Done means:**
- A written decision record: what was chosen, what was rejected, on what criteria.
- The db → agent → llm data path is documented in plain language a non-developer can follow.
- Lock-in is stated honestly, including model lock-in.

**Score anchors:** 0 = undocumented. 3 = decision record exists with alternatives.
5 = plus a stated exit path and a plain-language architecture description.

**Weight: 3**

---

### REQ-12 — Reduce dependence on the team

**Prompt line (verbatim):**
> "why you ask today I am dependent on my team for getting things done"

**Grounding question:**
*Which specific task that previously required asking a person can now be completed without
asking a person? Name it. One is enough. Zero is a failing project.*

This is the requirement the whole build answers to. Score it last, after everything else,
and score it honestly — it is the only one that cannot be satisfied by building something
impressive.

**Score anchors:** 0 = nothing changed; the system now requires more supervision than before,
not less. 3 = one real task genuinely handled end to end without a human in the loop.
5 = several, with the person's own confirmation that they stopped checking.

**Weight: 3**

---

# PART B — Domain truth checks

These are facts from the FMS audit dated 28-Jun-2026 on the `fms-dev-saas-one.vercel.app`
instance. They exist so an agent cannot hallucinate the state of the system it is meant to
improve. **Each is pass/fail. A fail voids any Part A score above 3.**

| ID | Check | Pass condition |
|---|---|---|
| **TRUTH-01** | Technician role does not exist as a real role; that credential renders as Property Manager with full admin console. | Your agents' model of the role hierarchy reflects this, and the compliance/CTO agents flag it as a live privilege-escalation gap. |
| **TRUTH-02** | Tenant intake exposes an assignee @-picker surfacing real staff names, letting tenants bypass triage. | Flagged as both a workflow and a data-leak finding, not just a UI nit. |
| **TRUTH-03** | Super Admin account authenticates but has no organization membership rows. | Agents do not assume super-admin data access is available. Anything requiring it is marked blocked, not faked. |
| **TRUTH-04** | Ticket photo bucket is public. | Treated as P0 security by the CTO agent. No new feature you build may add media to a public bucket. |
| **TRUTH-05** | Dashboard shows 1198 tickets for a site; Reports shows 704 for the same site. | Agents do not quote either number as truth without naming the discrepancy. Source-of-truth ambiguity is stated wherever counts appear. |
| **TRUTH-06** | PV backlog is 210, not the 70 assumed in prior briefs. | No agent output repeats the 70 figure. |
| **TRUTH-07** | Oldest open ticket has aged 104 days with no escalation signal fired. | The escalation gap is modelled, not just the ticket. |
| **TRUTH-08** | Intake captures no category, floor, or location — every ticket lands as GENERAL. | Named as the root cause of slow triage in any triage-related output. |
| **TRUTH-09** | Test ticket `[FMS-AUDIT-TEST-15-JUN]` is still live in production with no tenant-side delete path. | Your agents must not add to this. No agent creates test records in production. Cleanup policy is proposed. |
| **TRUTH-10** | A Supabase global-logout call returned 503, possibly linked to a shared-auth logout bug. | Treated as an open investigation, not a closed finding. Do not assert a cause you have not verified. |

---

# PART C — First principles bounds

**Prompt line (verbatim):**
> "be bounded by the first principles"

Each is a gate. Any violation caps your **overall** score at 2 regardless of Part A totals.

- **FP-01 — Do not fabricate.** An agent that does not know says it does not know. A number
  with no query behind it is a lie with good posture. Every figure an agent states must be
  traceable to a query.
- **FP-02 — Read before write.** Agents default to observe-and-recommend. Write access is
  earned per capability, per the promotion path in REQ-09, and never assumed.
- **FP-03 — Legible to a non-developer.** The person commissioning this cannot read your
  code. If the only way to know what an agent did is to read source, you have not finished.
- **FP-04 — Fail loudly.** Silent failure is worse than no feature. A broken agent must be
  visibly broken. Never catch an exception into a shrug.
- **FP-05 — Nothing irreversible without a human.** Sending external mail, changing
  permissions, deleting records, raising a purchase order — a person confirms. The agent
  prepares; the person commits.
- **FP-06 — The prompt is the boundary.** If you want to build something not in Part A,
  write it in `proposals:` in your scorecard and leave it unbuilt until it is approved.
  Scope you granted yourself scores 0.

---

# PART D — What explicitly does not count

- A dashboard of agents that are not running.
- An agent whose only capability is summarising something a human already wrote.
- Passing tests you wrote against behaviour you invented.
- A council that always agrees.
- Retrying an LLM call until it returns something usable and calling that resilience.
- Any score justified by "it works on my machine" or a screenshot.

---

# PART E — Cross-agent review

When more than one coding agent works on this repo, each reads the other's most recent
scorecard and files a review at `/evals/reviews/<reviewer>-on-<subject>-<date>.yaml`:

```yaml
reviewer: kimi-code
subject_scorecard: evals/claude-code-2026-08-02-1.yaml
disputes:
  - req: REQ-06
    claimed: 4
    my_score: 2
    reason: "absence detection is hardcoded to one metric; no configurable expected-events table exists at the cited path"
    evidence: "src/agents/ops/absence.ts:44 — single literal 'water_reading'"
agreements: [REQ-01, REQ-09]
```

Disputes are not resolved by whoever writes last. They go to the human with both positions
intact — the same rule the council itself follows in REQ-03.

---

# PART F — Scorecard template

Copy this, fill it, commit it. Do not edit the requirement text.

```yaml
agent: claude-code            # or kimi-code, etc.
session: 2026-08-02-1
commit: <sha>
requirements_touched: [REQ-01, REQ-06]

scores:
  - id: REQ-01
    prompt_line: "lets build a Council of Agents who have their own email id"
    grounding_question_answer: >
      No. Inbound mail is received and stored but nothing parses it into a task,
      so an agent cannot act on an emailed instruction without a human relaying it.
    evidence:
      - "src/agents/identity/registry.ts:1-90 — 8 identity records"
      - "supabase/migrations/0021_agent_inboxes.sql"
    repro: "npm run agent:inbox -- --list"
    real_data: true
    score: 2
    to_next_point: >
      Parse inbound mail into a task record and have one agent act on it end to end.
    carried: false

caveats:
  - "Could not test outbound deliverability — no sending domain configured yet."

truth_checks:
  TRUTH-01: pass
  TRUTH-04: pass
  # ... all ten, every session

first_principles:
  FP-01: pass
  FP-05: pass
  # ... all six, every session

proposals:
  - "Suggest agents 7 and 8 be Tenant Experience Analyst and Energy/Utility Analyst —
     rationale in docs/proposals/agents-7-8.md. Not built pending approval."

overall_score: 1.4      # weighted Part A total / 70, expressed 0-5
honest_summary: >
  Two of twelve requirements moved. Identity layer is real; the mail loop is not closed.
  Nothing in this session reduced the human's supervision load.
```

---

## A closing note to whichever agent is reading this

The temptation in a project this size is to build the impressive part — the sci-fi console,
the council transcript view, the agent avatars — and score yourself on how it looks. Resist
it. The prompt that started this said the goal is *"finding every ounce of data nad tying
value to it"* and that the system should move *"beyound an Input /output engine to an impact
engine"*.

The person asking for this cannot check your work by reading it. That asymmetry is exactly
why this file exists, and it is also why an inflated score here does more damage than a
missed deadline. Score low. Say what you could not do. The gap you report honestly is the
one that gets fixed.
