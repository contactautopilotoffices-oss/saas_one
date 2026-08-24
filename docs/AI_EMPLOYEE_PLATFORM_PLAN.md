# AI Employee Platform — Build Plan

**The claim:** a company goal is decomposed into a personal goal, an agent drives and
verifies the daily execution of that goal against system evidence, the pattern is
replicated across a department, and the aggregate movement is expressed as ROI.

**The metaphor:** an automatic watch movement. The mainspring (company goal) drives the
gear train (employee goals), the escapement (AI agent) releases that energy in small,
controlled, *verified* steps, the gears move the hands, and the hands show the time (ROI).
The escapement is the load-bearing part of the metaphor: it does not just push, it
**releases energy one measured step at a time and confirms the gear advanced before
releasing the next.** An agent that sends reminders without verifying movement is a
mainspring with no escapement — it unwinds in seconds and tells no time.

**Reference use case (the vertical slice we build first):**

| Layer | Instance |
|---|---|
| L1 Company macro goal | Eliminate friction and delay in site material deliveries |
| L2 Employee goal | Priyanka: 90% of approved site-material requests delivered within 48h |
| L3 AI agent | Watches every open request, finds the segment burning the clock, nudges the owner of *that* segment, verifies movement |
| L4 Department scale | Same goal template instantiated for every procurement owner, rolled up |
| L5 Technology ROI | Baseline-vs-current TAT × cost of delay, with assumptions on the face |

---

## 0. Three decisions that determine whether this works

Everything else is implementation. These three are the ones that fail silently.

### 0.1 The metric is computed from system-of-record timestamps. Never self-reported. Never LLM-computed.

The agent's authority comes entirely from the fact that it is reading the same timestamps
the business already trusts. The moment "did she do it?" is answered by a person ticking a
box, or by a language model's opinion of a WhatsApp thread, the entire clock is decorative.

**Division of labour:** SQL measures. The LLM interprets, drafts, and prioritises. The LLM
is never in the path that produces the number on the dashboard.

### 0.2 A goal is only legitimate if its owner controls the segment being measured

Priyanka does not control vendor lead time. If we hold her to an end-to-end 48h clock that
includes a vendor's four-day cement dispatch, she will be nudged for something she cannot
fix, and the platform loses credibility in week two — permanently.

So the request lifecycle is decomposed into **segments**, each with an owner:

| Seg | From | To | Owner |
|---|---|---|---|
| S1 | `material_requests.created_at` | `approved_at` | Property admin |
| S2 | `approved_at` | `ordered_at` | Procurement (Priyanka) |
| S3 | `ordered_at` | dispatch event | Vendor |
| S4 | dispatch | `delivered_at` | Logistics / site receiving |

- **Company metric (L1)** = total S1+S2+S3+S4 vs 48h. This is what the business feels.
- **Employee goal (L2)** = the segments the owner actually controls (S2, plus S3 chase
  behaviour measured as *time-to-first-chase*, not as vendor lead time itself).
- The agent attributes every breach to a segment. "Which gear is slipping" is the single
  most useful output of the entire system, and it is available before any AI is involved.

### 0.3 Target a distribution, not an average

"Average TAT 48h" is satisfied by a pile of 6-hour deliveries hiding a 9-day one — and the
9-day one is the entire source of site friction. State it as:

> **P90 ≤ 48h**, i.e. 90% of approved site-material requests delivered within 48 hours.

Track P50/P90/P99 and the count of breaches. The tail is the product.

---

## 1. Blocking data gaps (found in the current schema)

These must be closed in Phase 0. Until they are, no number downstream is real.

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | `procurement_orders.actual_delivery` and `expected_delivery` are **`date`**, not `timestamptz` | A 48-hour TAT cannot be computed from a date. Same-day vs 23-hours-later are indistinguishable | Migrate to `timestamptz`; backfill from `procurement_activity_log.created_at` where an action row exists |
| 2 | **No dispatch timestamp** anywhere | S3 and S4 cannot be separated, so vendor delay and logistics delay are indistinguishable — the exact attribution the agent needs | Add `dispatched_at timestamptz` to `procurement_orders` + a capture point in the UI/WhatsApp flow |
| 3 | `procurement_activity_log` completeness unverified | If transition rows are written on some paths and not others, TAT is silently wrong for a subset | **Audit before building anything.** Reconcile `material_requests` status timestamps against log rows for the last 90 days; report coverage % per transition |
| 4 | No partial-delivery model | `delivery_status` has a `partial` value but no per-line-item fulfilment. "Delivered" for a 12-line request where 2 lines arrived is a lie the metric will inherit | Decide the rule explicitly and write it into the metric contract: recommend **clock stops when the last line lands** |
| 5 | No goal/objective framework at all (`crm_targets` is sales-only, month-grain) | Nothing to hang L1/L2 on | Build the goal spine (§2) |

> Gap 3 is the one that quietly ruins the project. Run it first, as a query, before writing
> a line of application code.

---

## 2. The data model (the gear train)

Seven new tables. Everything else reuses what exists.

### 2.1 `metrics` — the measurement contract

```sql
metrics (
  id, organization_id,
  key,                    -- 'procurement.delivery_tat_hours'
  title, unit,            -- 'hours'
  grain,                  -- 'per_material_request'
  source_view,            -- 'v_metric_delivery_tat'
  aggregation,            -- 'p90' | 'avg' | 'pct_within' | 'count'
  inclusion_rules  jsonb, -- {categories:['site_material'], min_value: 0}
  exclusion_rules  jsonb, -- {statuses:['cancelled','rejected'], exclude_vendor_blocked:true}
  calendar         jsonb, -- {business_hours_only:false, holidays_ref:'IN'}
  segments         jsonb, -- the S1..S4 definition above
  version int, effective_from timestamptz,
  UNIQUE (organization_id, key, version)
)
```

**Versioned, and the version is immutable.** Changing a metric definition mid-quarter
without a version bump makes every ROI claim built on it unfalsifiable. A goal binds to
`(metric_key, version)`. Redefining the metric creates v2 and a visible discontinuity on
the chart, which is honest.

`inclusion_rules` / `exclusion_rules` / `calendar` exist because every argument about this
metric will be a definitional argument — "that one was a Sunday", "the vendor was blocked
on payment", "the site refused the delivery". Write the answers down once, in the row, and
the argument happens once.

### 2.2 `objectives` — L1

```sql
objectives (
  id, organization_id, title, statement, owner_uid,
  period_start, period_end, status, created_at
)
```

### 2.3 `goals` — L2

```sql
goals (
  id, organization_id, objective_id -> objectives,
  template_id -> goal_templates,          -- null for bespoke goals
  owner_uid, department, title,
  metric_key, metric_version,
  segment_scope   text[],                 -- ['S2','S3_chase'] — what THIS owner is held to
  target_op, target_value, target_unit,   -- 'lte', 48, 'hours'
  target_percentile,                      -- 90  → "P90 ≤ 48h"
  scope           jsonb,                  -- {property_ids:[...], categories:[...]}
  baseline_value, baseline_window jsonb,  -- FROZEN at activation, never recomputed
  cadence, starts_on, ends_on, status
)
```

`segment_scope` is decision 0.2 made structural. `baseline_value` is frozen at activation —
this is what makes Phase 4's ROI defensible rather than retrofitted.

### 2.4 `goal_measurements` — the time series

```sql
goal_measurements (
  id, goal_id, measured_at, window_start, window_end,
  value, sample_size,
  segment_breakdown jsonb,   -- {S1: 4.2, S2: 9.8, S3: 31.0, S4: 2.1} median hours
  breach_ids uuid[],         -- the actual requests that blew the target
  computed_by, metric_version
)
```

`breach_ids` matters: every number on the dashboard must be clickable down to the rows that
produced it. A metric you cannot drill into will not be believed, and correctly so.

### 2.5 `agent_definitions`, `agent_runs`, `agent_interventions` — L3

```sql
agent_definitions (
  id, organization_id, key, goal_id, tick_cron, enabled,
  mode,          -- 'shadow' | 'live'
  policy jsonb   -- budgets + escalation ladder, see §3.3
)

agent_runs (
  id, agent_id, started_at, finished_at, status,
  observed jsonb,     -- metric state + open items at risk
  diagnosis jsonb,    -- per-item: segment at fault, owner, headroom_hours
  decisions jsonb,    -- what it chose to do and what it deliberately skipped
  token_cost, error
)

agent_interventions (
  id, run_id, goal_id,
  subject_type, subject_id,        -- 'material_request', <uuid>
  segment, target_uid, channel, action, message_ref,
  sent_at,
  predicted_effect jsonb,          -- {expect: 'ordered_at set', by: <ts>}
  verified_at, outcome             -- 'moved' | 'no_change' | 'escalated' | 'moot'
)
```

`predicted_effect` + `outcome` is the escapement closing. It also yields **intervention
effectiveness per channel/segment/person**, which is the only honest input to ROI and the
signal that stops the agent from repeating tactics that never work.

### 2.6 `agent_memory` — L7

```sql
agent_memory (
  id, organization_id, subject_type, subject_id,   -- 'vendor'|'property'|'user'
  fact, evidence_refs uuid[], confidence,
  first_seen, last_confirmed, superseded_by
)
```

Structured facts, not embeddings: *"Vendor Sharma Cement averages 62h dispatch on cement,
14h on hardware"*, *"SS Plaza cannot receive after 18:00"*. This is what turns a generic
nudge into `"raise the cement PO today — Sharma runs ~62h and the site can't receive after
6pm, so tomorrow's dispatch misses the window."`

Deliberately **not** starting with vector search. "Which vendor is slow" is an aggregate
query, not a similarity search. Add pgvector later, if and only if free-text recall (email
threads, WhatsApp context) becomes the bottleneck.

### 2.7 `roi_ledger` — L5

See §5.

---

## 3. The agent (L3 — the escapement)

**Not a chatbot.** A scheduled, budgeted, verifying control loop. New cron route
`app/api/cron/agent-tick/route.ts`, alongside the 18 existing cron routes.

### 3.1 The tick

```
OBSERVE   → current metric value vs target (SQL), all open in-scope requests,
            per-item elapsed time by segment, headroom to breach
DIAGNOSE  → for each at-risk item: which segment is burning the clock,
            who owns it, what memory says about this vendor/site/person
DECIDE    → rank by (headroom ascending × business impact), apply budget,
            choose channel + escalation rung, or deliberately do nothing
ACT       → INSERT INTO event_outbox  ← reuses the existing omnichannel service
RECORD    → agent_runs + agent_interventions, with predicted_effect
VERIFY    → next tick: did the predicted timestamp actually get set?
            → outcome, and feed the result back into ranking
```

Only DIAGNOSE-narrative and ACT-message-drafting use an LLM. OBSERVE and the target
comparison are pure SQL.

### 3.2 Shadow mode first — non-negotiable

`agent_definitions.mode = 'shadow'` for the first two weeks: the agent runs the full loop
and writes `agent_interventions`, but **does not insert into `event_outbox`**. A human reads
the log daily and answers: *would this message have been right, to the right person, at the
right time?*

Turning on an autonomous nudger that WhatsApps the procurement team wrongly for three days
will end the project socially, whatever the code does. Shadow mode costs two weeks and buys
the credibility the rest of the plan depends on.

### 3.3 The policy (`agent_definitions.policy`)

Escapements are defined by restraint. The policy encodes it:

```jsonc
{
  "budgets": {
    "max_messages_per_person_per_day": 3,
    "max_messages_per_item": 4,
    "quiet_hours": ["21:00", "08:00"],
    "working_days_only": true
  },
  "ladder": [
    { "at_headroom_hours": 24, "channel": "push",     "to": "segment_owner" },
    { "at_headroom_hours": 12, "channel": "whatsapp", "to": "segment_owner" },
    { "at_headroom_hours": 4,  "channel": "whatsapp", "to": "segment_owner + reporting_manager" },
    { "at_headroom_hours": 0,  "channel": "email",    "to": "property_admin + procurement_head" }
  ],
  "suppress": {
    "if_no_movement_after_rungs": 3,   // stop nagging, escalate structurally instead
    "if_blocked_reason_set": true       // a declared blocker silences the clock, and is logged
  }
}
```

`if_no_movement_after_rungs` is the anti-nag valve. If three nudges produced nothing, the
problem is structural, not attentional — the agent should stop messaging and raise it as a
**blocker for a human decision**, which is a far more valuable output than a fourth ping.

### 3.4 Two-way

Inbound WhatsApp replies (`app/api/webhooks/`) must be able to (a) set a blocker reason,
(b) confirm an action, (c) snooze with a reason. A one-way agent trains people to mute it.

---

## 4. Department scale (L4)

`goal_templates` holds the parameterised goal; instantiation creates one `goals` row per
owner with their own scope. The rollup metric is computed over the department's items, not
averaged over people's percentages (averaging percentages across unequal volumes is a
classic and invisible error).

The honest question — *does it replicate?* — is answered by a table, not a slogan:

| Owner | Adoption (items in scope) | Baseline P90 | Current P90 | Δ | Interventions | Effectiveness |
|---|---|---|---|---|---|---|

Expect the second and third adopters to move less than Priyanka. She will be the motivated
volunteer; they will not be. Budget for that in the ROI model rather than extrapolating
her curve across the department.

---

## 5. ROI (L5 — the hands of the watch)

This is where platforms like this lie to themselves. Rules:

1. **Baseline frozen before go-live.** Minimum 90 days of history, stored in
   `goals.baseline_value`, never recomputed. A recomputed baseline can prove anything.
2. **Run a holdout.** Two comparable properties stay off the agent for six weeks. Pre/post
   alone cannot separate the agent's effect from seasonality, a vendor change, or the
   Hawthorne effect of simply being measured. **The holdout is the only credible evidence,
   and it is cheap — it costs nothing but patience.**
3. **Separate hard from soft savings.** Hard: reduced expedited freight, reduced idle site
   labour, fewer emergency local purchases at retail rates. Soft: staff hours saved on
   chasing. Report them in separate columns. Soft savings only become real if headcount or
   scope actually changes.
4. **Assumptions render on the dashboard, always.** No naked rupee figure.

```sql
roi_ledger (
  id, organization_id, objective_id, goal_id, period_start, period_end,
  method,                 -- 'pre_post' | 'holdout' | 'segment_shift'
  baseline_value, current_value, delta, holdout_delta,
  value_model jsonb,      -- {hours_saved_per_request, loaded_cost_per_hour, n_requests, expedite_rate_before/after}
  hard_value, soft_value, currency,
  confidence,             -- 'high' (holdout) | 'medium' (pre_post, n>200) | 'low'
  assumptions text[],     -- rendered verbatim in the UI
  computed_at, metric_version
)
```

**The watch-face dashboard is the last thing built, not the first.** It is the most
tempting artifact and the least load-bearing one.

---

## 6. Mapping to what already exists

| Layer | Status | Where |
|---|---|---|
| L1 Company goal | **New** | `objectives` |
| L2 Employee goal | **New** | `goals`, `goal_templates` |
| L3 AI agent | **New** | `app/api/cron/agent-tick`, `backend/lib/agent/*` |
| L4 Department scale | **New** | rollup views + adoption table |
| L5 ROI | **New** | `roi_ledger` |
| L6 Systems & data | **Mostly exists** | Supabase, `material_requests`, `procurement_orders`, `procurement_activity_log`. Needs the §1 fixes + `v_metric_*` views |
| L7 Intelligence & memory | **New, precedent exists** | `agent_memory`; pattern from `backend/lib/coaching/longitudinal.ts` (score → trend → direction → weakest link → next focus) |
| L8 Communication & action | **Already exists — reuse, do not rebuild** | `event_outbox`, `NotificationService`, `WhatsAppService`/AiSensy, `EmailService`, push, `notification_matrix`, `cron/sweep-outbox` |

The single biggest accelerator: **L8 is done.** The agent writes rows to `event_outbox` and
inherits templating, routing, retries, dedup, and the org-level notification matrix. Any
plan that builds a second messaging path is wrong.

`backend/lib/llm/groq.ts` (structured, Zod-validated, confidence-gated classification) is
the right pattern for the agent's LLM calls — reuse its shape rather than free-text prompting.

---

## 7. Phasing

Each phase ships something usable on its own. **No phase depends on the next one to have
been worth doing** — that is the test of whether the phasing is honest.

| Phase | Duration | Deliverable | Contains AI? |
|---|---|---|---|
| **0 — Instrument & baseline** | 2 wks | Data-quality audit report; `timestamptz` migration; `dispatched_at`; `v_metric_delivery_tat` with S1–S4; **a chart of the real current TAT distribution by segment, 90 days** | **No** |
| **1 — Goal spine** | 2 wks | `objectives`/`metrics`/`goals`/`goal_measurements`; Priyanka's goal live; read-only dashboard: target, current P90, trend, segment breakdown, drill-through to breaches | **No** |
| **2 — The escapement** | 3 wks | Agent tick, diagnosis, policy/budgets, intervention log, verification loop. **Week 1–2 shadow mode**, then live | Yes |
| **3 — Department scale** | 3 wks | Templates, per-owner instantiation, rollup, adoption table, **holdout properties designated** | Yes |
| **4 — ROI ledger** | 2 wks | `roi_ledger`, holdout comparison, assumptions-visible exec view (the watch face) | No |
| **5 — Generalise** | — | Second use case in a *different* department, to prove this is a platform and not a procurement feature | Yes |

**Phase 0 is the go/no-go gate.** If the segment chart cannot be built, or shows that
`procurement_activity_log` coverage is (say) 60%, then everything above is fiction and the
correct move is to fix instrumentation and re-plan. Do not skip it because it contains no AI.

Phases 0 and 1 deliver most of the practical value on their own: a procurement lead who can
see *"S3 vendor dispatch is 31 of our 47 median hours"* will act on it without any agent at
all. That is a feature, not an argument against the agent — it is the proof the measurement
is real, which is what earns the agent the right to act on it later.

---

## 8. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| **Gaming** — mark delivered early, close and re-raise | Any metric with a named owner gets gamed. Non-negotiably so | Evidence from timestamps + `delivered_by` + photo/GRN attachment; flag re-raises of the same items within 72h as a distinct signal on the dashboard |
| **Definitional disputes** | Every breach review becomes an argument about the denominator | `metrics.inclusion_rules` / `exclusion_rules` / `calendar`, versioned, agreed in Phase 1 and cited in the UI |
| **Nag fatigue** → agent muted | The most likely failure mode, and it is terminal and quiet | Budgets, escalation ladder, `if_no_movement_after_rungs`, quiet hours, two-way snooze-with-reason |
| **Owner blamed for others' segments** | Destroys credibility permanently and immediately | `goals.segment_scope`; agent routes to the *segment* owner |
| **ROI inflation** | Executive trust is spent once | Frozen baseline, holdout, hard/soft split, assumptions rendered |
| **LLM in the measurement path** | Non-deterministic numbers cannot be audited | SQL measures, LLM interprets. Enforced by review |
| **Building 8 layers instead of 1 slice** | The layer diagram is a communication artifact; read as a build order it produces four half-platforms | Vertical slice through all 8 layers for one goal, first |

---

## 9. Open questions for the business (not for engineering)

1. **Does the 48h clock start at request or at approval?** Recommend: total clock is the
   company metric (L1), approval→delivery is Priyanka's goal (L2). Needs sign-off, because
   it determines who gets nudged.
2. **Partial delivery** — clock stops at first line or last line? Recommend last.
3. **Is 48h calendar hours or working hours?** A Friday-evening request is otherwise a
   guaranteed breach.
4. **What are the legitimate stop-the-clock blockers?** (payment hold, site refusal,
   customer-requested delay) — these go in `exclusion_rules`.
5. **Which two properties can be the holdout,** and who authorises leaving them off for six
   weeks?
6. **What is the loaded cost of one hour of delay?** Needed for `value_model`. If nobody can
   answer, ROI is reported in hours and breach-counts only — which is still useful, and more
   honest than an invented rupee figure.
