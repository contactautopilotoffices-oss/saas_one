# IRA — architecture decision

## The short answer

**Architecture 2 as the backbone. Architecture 3's loop on top. Architecture 1 demoted to two
bounded call sites.**

Architectures 2 and 3 are not really alternatives — they are the same family.
Arch 2 is "events → state → rules". Arch 3 is "state → detect change → decide".
The event store makes it auditable and replayable. The change detector makes it proactive.
You want both. That is most of the blend already.

**Architecture 1 cannot be the primary.** Not mainly because of cost — because the LLM sits on
the numeric write path. It is the last hop before the human, so it restates numbers in prose
("roughly 38 of 43, about 88%"). A system prompt asking it not to is a preference, not a
guarantee. Priyanka is measured on that number. The first wrong figure in front of her manager
ends the product.

Cost is the second reason: ~$66,000/month at 200 groups for one department — about $2,200 per
supervised employee per month, against Indian procurement salaries of roughly $420–720/month.
Inverted by ~4x.

The 45/55, 70/30, 85/15 splits in the diagram are not settings. They are outcomes of input
volume. At 200 groups Architecture 1's split becomes ~5/95 by token volume on its own.

## The blend — 11 layers

| # | Layer | Kind | From | In repo |
|---|---|---|---|---|
| 1 | Signal capture — store raw, interpret nothing | deterministic | 2 + 3 | partial |
| 2 | Evidence extraction — pre-filtered, closed-candidate | hybrid (LLM site A) | 1 | no |
| 3 | Operational state as views, not a copied store | deterministic | 2 | partial |
| 4 | **Metric resolver — sole writer of any judged number** | deterministic | 2 | partial |
| 5 | Change detection as projection invalidation | deterministic | 3 | partial |
| 6 | Rule evaluation — rules as versioned data | deterministic | 2 | partial |
| 7 | LLM reasoning workspace — disposable, case-scoped | LLM (site B) | 1 + 3 | partial |
| 8 | Decision ledger with predicted effect | deterministic | 3 | no |
| 9 | Action orchestrator — sole dispatch path | deterministic | 2 | partial |
| 10 | Verification & feedback | deterministic | 3 | no |
| 11 | Ira Inbox + Case View — the human surface | deterministic | 2 + 3 | no |

### The rule that makes it work

**Exactly two LLM call sites. A third is an architecture violation.**
Neither writes to a database. Neither receives a raw numeric column it could re-derive a metric from.

- **Site A — the extractor.** WhatsApp text → structured signal. Only runs after a deterministic
  pre-filter (group is watched, property has open work, message matches an entity lexicon or carries
  media). ~85% of traffic never reaches a model. Output is a closed enum plus a candidate id from a
  supplied list; anything outside the list is rejected and coerced to `none`.
- **Site B — the adjudicator.** Called only when a rule cannot decide. Gets an assembled, bounded
  case context. Returns a decision from a closed enum. Never a number.

Numbers travel a separate channel the model never touches: SQL → metric resolver → rendered token.

## What the adversarial review found — both passes returned "does not survive"

Verified against the actual code, not taken on trust:

| # | Finding | Verified at |
|---|---|---|
| 1 | **`delivered_at` is a click timestamp, not a delivery timestamp** | `app/api/tickets/[id]/materials/route.ts:190` — `new Date().toISOString()` |
| 2 | **Comparative approvals never write `approved_at`** | `.../comparatives/route.ts:168` sets `status:'approved'` only |
| 3 | **Every view in the repo is SECURITY DEFINER** | zero `security_invoker` across all migrations |
| 4 | `readBundleTable` contained the table name only, not joins or columns | `backend/lib/oem/bundle.ts` |
| 5 | Group messages are dropped entirely today | `app/api/webhooks/whatsapp/route.ts:727` |

**Finding 1 is the one that matters most.** Priyanka's goal is currently computed from a column
Priyanka writes, measuring her button-pressing latency. Every safety mechanism in the design points
at the model; none points at the actual adversary. And the second-order effect is worse: material
arrives Saturday, the store-keeper clicks Monday, and IRA reports a breach everyone in the room
knows is a Monday-morning click. The project dies at that review meeting, not at go-live.

The counter-move is learned within a fortnight: click "Received" when the vendor *says* it shipped.

**Finding 2** is a hidden denominator. Large multi-vendor requests go through the comparative path —
exactly the slow ones that miss 48 hours — and they leave the measurement silently.

## Fixed in this commit

- `security_invoker = true` on `v_oem_goal_progress`, plus org-membership-scoped RLS on all `oem_*`
  tables, replacing the blanket `authenticated` policies. Individual performance data was readable
  cross-tenant.
- `readBundleTable` now rejects PostgREST embedded-resource syntax (`ticket:tickets(...)`) and
  `select *`, enforces per-column bundle limits, and injects `organization_id` inside the guard
  instead of trusting the caller.
- `oem_measurements` gains `row_ids[]` (drill-through evidence), `supersedes_id` and
  `restatement_reason` — a corrected figure is now visible as a correction, not a silent overwrite.

## Week 1, before any agent code

1. **Split claimed from evidenced delivery.** `delivered_at` becomes human-entered event time
   (constrained `>= ordered_at` and `<= now()`); add `delivery_recorded_at` as the immutable server
   clock. Measure on event time. Publish recording-lag p50/p90 as a mandatory guardrail. Any row with
   lag > 24h drops to `proof_type = 'claim'`.
2. **Make the pilot goal a pair**: `pct_marked_within_48h` (operating) and
   `evidence_corroboration_rate` (honesty). Register the divergence as a guardrail.
3. **Fix the comparative path** to write `approved_at` / `approved_by`; backfill from
   `material_request_comparatives.action_at`; add a trigger enforcing
   `status='approved' ⇒ approved_at IS NOT NULL`. Publish coverage % beside every figure and refuse
   to render below 95%.
4. **Ship `material_request_state_events`** (append-only: from/to status, column, old/new value,
   actor, occurred_at) from the trigger you are already fixing. Compile metrics against the event
   table, not the mutable columns — otherwise a revert-and-re-mark passes the 48h test with no trace.
5. **Gate the `material_requests` UPDATE trigger** with a `WHEN` clause on the four status/timestamp
   columns and emit slim typed events. Un-gated it floods `event_outbox`, whose sweep drains 20 rows
   per 5 minutes, and degrades production notifications for tickets, SOPs and bookings.
6. **Segment the metric by hand-off** — approve→order (procurement), order→dispatch (vendor),
   dispatch→receipt (site logistics), receipt→record (site admin). Nudge the owner of the currently
   *open* segment, never the case owner by default.
7. **Move the message cap into `NotificationService`**, keyed on recipient, covering all producers
   including the 18 existing crons. Otherwise IRA gets muted in week 2 and takes every SLA warning
   and SOP reminder with it — one blended stream from one AiSensy sender.

## Sequencing

- **Weeks 1–6: metric-first, no WhatsApp.** IRA nudges real people about real 48-hour deadlines using
  FMS timestamps and the notification stack already in production. Shadow mode throughout.
- **In parallel: WhatsApp ingestion de-risks and never blocks value.** Group ingestion is at zero
  today. One unofficial Baileys session handles ~30–50 groups before session instability and ban risk
  dominate; 200 groups needs 4–6 sharded sessions on separate numbers, each an independent failure
  domain with no backfill. This is an availability problem, not a cost problem.

Ingestion failure must degrade gracefully: IRA gets quieter and the Inbox gets longer. It must never
produce a wrong number.

## Open questions

1. **Is 48 hours calendar or working hours?** The review assumed "48 working hours excluding Sunday".
   Confirm — it changes every breach count.
2. **Who owns the Ira Inbox, with what daily SLA?** The design's load-bearing human action is someone
   clearing it. An unowned queue in the evidence path silently fails.
3. **Can delivery confirmation happen inside WhatsApp** (AiSensy interactive template with
   Received / Not yet / Partial)? The queue, templates and dedup index already exist. If yes, the
   confirm-button problem largely disappears.
4. **Who may see individual attainment?** Aggregates open, individual numbers scoped to owner +
   manager chain. Needs stating in writing before the first goal is seeded.
5. **Which two properties are the holdout?** Still free now, impossible to add later.
