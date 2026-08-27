# Cost Intelligence Platform — Technical Specification

**Status:** Draft for team review · **Date:** 2026-08-01 · **Deliverable:** plan only, no code, no migrations applied

Two initiatives that must be built as **one system with two surfaces**:

1. **PO Intelligence** — turn 5,265 purchase orders (₹60.55 Cr) into a defensible, queryable rate book.
2. **Commercial Calculator** — replace estimate-based capex/opex assumptions with actuals from (1).

The bridge between them is the **Scenario Generator**: a free-text brief in, three or four fully-priced commercial options out, every line traceable to real purchase orders.

---

## 0. Ground truth

All figures below were queried live against Supabase project `xvucakstcmtfoanmgcql` on 2026-08-01. Nothing here is estimated.

### 0.1 What exists

| Metric | Value |
|---|---|
| Purchase orders | **5,265** (`public.zoho_purchase_orders`) |
| Date range | 2023-04-04 → 2026-07-31 |
| Total value | **₹60.55 Cr** |
| — Capex | ₹31.58 Cr across 1,655 POs |
| — Opex | ₹20.95 Cr across 2,466 POs |
| — Untagged | ₹7.98 Cr across 1,134 POs (21.5%) |
| — Admin | ₹0.04 Cr across 10 POs |
| Distinct vendors | 762 |
| Distinct sites (`project_name`, free text) | 31 |
| Distinct categories | 54 |

Status mix: `approved` 2,998 · `draft` 856 · `open` 786 · `billed` 434 · `cancelled` 107 · `pending_approval` 71 · `partially_billed` 12 · `rejected` 1.

### 0.2 The four blocking gaps

**Gap 1 — Line items are not stored.** `zoho_purchase_orders.raw` holds Zoho's *list* payload only: 46 keys, all header-level. `line_items` is absent on all 5,265 rows. Zoho returns line items exclusively from the per-PO *detail* endpoint. No `po_line_items` table exists anywhere in the repo. Without this, no per-unit rate can be computed — which is the entire premise of Project 1.

**Gap 2 — No denominator.** `public.properties` has 13 rows and no carpet area, no built-up area, no seats, no shell type. `city` is populated on 2 rows; `capacity` on 2 rows. Meanwhile POs reference 31 sites whose names do not match any property name. Until area exists per site, ₹ can never become ₹/sq.ft — the only unit both projects can speak.

**Gap 3 — Required extensions not installed.** `pgvector` 0.8.0 and `pg_trgm` are both *available* but *not installed*. `pg_net` 0.19.5 is installed.

**Gap 4 — Dirty dimension keys.** Trailing whitespace in category values (`"Housekeeping "`, `"Civil "`, `"Lights "`) and site values (`"Radical Mind - Bangalore "`). Near-duplicate sites: `"Sky mark - Noida"` vs `"Arcil Sky Mark - Noida"`; `"Mafatlal Chember -A wing"` (typo) vs `"B wing - Mafatlal Chambers"` vs `"Mafatlal WS"`. And 1,134 POs carry no `cf_category` / `cf_department` / `cf_site` at all.

### 0.3 Premise validation — SS Plaza

Before committing to the architecture, the core assumption was tested against the largest site. Excluding `draft` / `cancelled` / `rejected`, **SS Plaza** shows Capex ₹17.61 Cr over 651 POs and Opex ₹5.32 Cr over 289 POs. Its capex category profile:

| Category | % of capex | POs |
|---|---|---|
| Electrical | 18.4% | 113 |
| Civil | 15.8% | 36 |
| HVAC | 11.3% | 6 |
| Modular Furniture | 9.5% | 16 |
| Chairs | 7.2% | 12 |
| Flooring | 5.4% | 25 |
| Partitions & Doors | 3.6% | 13 |
| Carpentry | 3.5% | 52 |
| UPS | 3.5% | 8 |
| Metal Ceiling | 2.5% | 2 |

This is a legitimate fit-out weight distribution derived from ₹17.6 Cr of real spend, not an authored template. **The empirical-BOQ premise behind §6 holds.**

Two caveats it also surfaces, both of which the spec must handle:

- Using `properties.capacity` = 40,000 as the denominator gives **₹4,403/sq.ft** capex — far above the `bareShell: 2700` rate in the prototype calculator. Either that figure is not carpet area, or the Capex bucket aggregates multi-phase spend that a single fit-out benchmark must not carry. **This is why the site-area import is the top-priority blocking input.**
- `Housekeeping` appears tagged as **Capex** (₹16.9 L, 34 POs) — a tagging error. The rate book must apply its own cleaning rules rather than trusting `department` verbatim.

### 0.4 The sequencing insight that shapes everything

**Opex intelligence needs zero line-item work. Capex intelligence needs all of it.**

Opex is service-based — housekeeping, security, internet, electricity are billed as a monthly service, so the PO *header* amount is already the number. Capex is material-based, so "₹2,100/sq.ft warm shell" only decomposes into a defensible BOQ once line items exist.

The prototype calculator hardcodes seven opex buckets that map almost 1:1 onto existing PO categories:

| Calculator field | Source PO categories | POs | Value |
|---|---|---|---|
| `electricity` | Electricity | 227 | ₹6.58 Cr |
| `housekeeping` | Housekeeping | 1,024 | ₹9.27 Cr |
| `security` | Security | 72 | ₹1.00 Cr |
| `internet` | Internet | 69 | ₹0.29 Cr |
| `pantry` | Beverages + Water Supply | 495 | ₹1.22 Cr |
| `maintenance` | AMC Services + Maintenance and service + Pest Control + Repair Work | 349 | ₹1.19 Cr |
| `adminMisc` | Stationary + Consultant + Room Rent + Parking | 219 | ₹0.41 Cr |

So the opex half of the calculator becomes real the moment site areas land — days, not weeks. The capex half waits on the line-item backfill. **Build them as two parallel tracks.**

**A second, sharper split** (this one emerged from the adversarial review and corrects the framing above): the Excel is *not* on the critical path for most of the value. **Item-level unit rates — ₹/SQFT of ceiling tile, ₹/NOS of luminaire — need no site area at all.** Only ₹/sq.ft *aggregates* need a denominator. That means the entire negotiation surface (vendor comparison, price drift, single-source risk, savings-if-best-actual) ships on line items alone, with zero area data. See §B for the resulting build order.

### 0.5 Key existing files

| Path | Role |
|---|---|
| [backend/services/zohoBooksSync.ts](../backend/services/zohoBooksSync.ts) | `syncPurchaseOrdersForOrg`; upserts on `(organization_id, zoho_po_id)` in chunks of 200 |
| [backend/services/zohoService.ts](../backend/services/zohoService.ts) | OAuth refresh grant; `listPurchaseOrders` paginates 200/page, 50-page cap; `createPurchaseOrder` sends line items *outbound* |
| [app/api/cron/sync-zoho-books/route.ts](../app/api/cron/sync-zoho-books/route.ts) | Cron `0 */2 * * *`, Bearer `CRON_SECRET`, `maxDuration` 300 |
| [app/api/accounts/pos/route.ts](../app/api/accounts/pos/route.ts) | CSV import — note it deliberately *collapses* repeated line-item rows to one PO |
| [supabase/migrations/20260723000003_payment_tracker.sql](../supabase/migrations/20260723000003_payment_tracker.sql) | `zoho_purchase_orders`, `po_payments`, `accounts_zoho_config` |
| [supabase/migrations/20260801000001_po_workflow_state.sql](../supabase/migrations/20260801000001_po_workflow_state.sql) | The tier-2 RLS pattern all new tables copy |
| [backend/lib/accounts/access.ts](../backend/lib/accounts/access.ts) | `resolveAccountsAccess`, `VIEW_ROLES` |
| `Commercial Calculator /Gemini Commercial Calculator.tsx` | 715 lines — the real financial engine |
| `Commercial Calculator /Claude Commercial Calculator.tsx` | 540 lines — shell-type ladder + 16%-compounded lock-in amortization |

### 0.6 Conventions all new work must follow

- Every table carries `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
- RLS `SELECT` follows the tier-2 pattern: `EXISTS` over `organization_memberships` **or** `property_memberships`, `is_active`, role in `org_super_admin | org_admin | master_admin | purchase_manager | purchase_executive | procurement | accounts`.
- All writes go through service-role API routes under `app/api/`; permissions enforced in TypeScript, not RLS.
- Migrations are authored as files under `supabase/migrations/` and **run by the user** — never applied programmatically.
- Already available: `xlsx@0.18.5`, `papaparse@5.5.3`, `exceljs@4.4.0`, `groq-sdk`, `@google/generative-ai`, `@anthropic-ai/sdk`.

---
## A. Integration Contract — read this before any other section

The six subsystem specs in Part 2 were designed independently and adversarially reviewed. The review returned **221 findings (45 blockers)** and one structural verdict:

> *The individual sections are competent; the bundle is not yet a single system. The same entity is defined four times under four names, the same 1,134 rows are handled three incompatible ways, and three sections independently re-derive site identity from raw free text.*

This section is the resolution. **Where a subsystem spec conflicts with this contract, this contract wins.** Nothing below is optional, and no migration file should be authored until every row here is agreed.

### A.1 Canonical entity names

Four sections invented their own site dimension. There is exactly one:

| Concern | Canonical | Deleted — do not build |
|---|---|---|
| Site dimension | `site_areas` | `site_canon`, `commercial_sites` |
| Site alias map | `site_aliases` | `site_canon_map`, `commercial_site_alias` |
| PO → site join | `zoho_purchase_orders.site_id` (resolved once) | re-deriving from `project_name` in any query |
| Line items | `po_line_items` | — |
| Item dimension | `item_canon`, `item_alias`, `item_canon_map`, `item_match_event` | — |
| Category dimension | `category_canon` | ad-hoc `category_norm` strings |
| Deal root | `commercial_deals` → `scenario_sets` → `scenarios` | `deals` (**does not exist in the database**) |

**Site identity is resolved exactly once**, inside the ingestion path, onto `zoho_purchase_orders.site_id`. §3, §5 and §6 read that column. No section re-joins on `project_name`. A test must assert all consumers agree.

### A.2 The clobber premise is false — delete it

§1 and §2.2 both assert that the 2-hourly upsert clobbers any column absent from the payload, and §1 derives a design from it (resolve `site_id` inside the sync). **PostgREST emits `DO UPDATE SET` for payload keys only**; absent columns are untouched. The premise is inherited from a comment at the head of [supabase/migrations/20260801000001_po_workflow_state.sql](../supabase/migrations/20260801000001_po_workflow_state.sql) and should be corrected there too.

This inverts the design. §1's prescribed fix is the *one* change that would make `site_id` genuinely clobberable — including setting it NULL across all 5,265 rows on any failed `site_aliases` read, in a single run, with no error check. **Resolve `site_id` in a separate idempotent backfill//repair job, not in the sync payload.**

### A.3 `po_line_items` column contract

§3 queries columns §2 never defines. Pinned names — §2 owns the DDL, §3 consumes it verbatim:

| Canonical | §3 wrongly used | Notes |
|---|---|---|
| `po_id` | `purchase_order_id` | FK → `zoho_purchase_orders(id)` |
| `amount` | `line_total` | pre-tax line total |
| `desc_norm` | *(assumed)* | **§2 must create it** |
| `uom_norm` | *(assumed)* | **§2 must create it** |
| `category_norm` → `category_canon_id` | *(assumed)* | FK, not a string |
| `spec_attrs JSONB` | *(assumed)* | **§2 must create it** |
| `is_composite BOOLEAN` | *(assumed)* | **§2 must create it** |
| `normalizer_version TEXT` | — | see A.6 |

`po_line_items.site_id` references **`site_areas(id)`**, never `properties(id)`.

### A.4 One status filter, named once

Stated five times across the bundle and disagreeing three ways. One constant, referenced by name everywhere:

```
RATE_BOOK_PO_STATUSES = ('approved', 'open', 'billed', 'partially_billed')
```
= 2,998 + 786 + 434 + 12 = **4,230 of 5,265 POs**. Excluded: `draft` 856, `cancelled` 107, `pending_approval` 71, `rejected` 1. Comparisons must be `lower(trim(status))` — the CSV importer writes mixed case and NULL.

### A.5 Every rate carries a basis — or the product is 33% wrong

No rate anywhere in the bundle declares what it is per. In the Indian market rent and CAM are quoted on chargeable/BUA; fit-out and opex on carpet. §5's benchmark divides by `carpet_sqft` while the Gemini engine multiplies by `builtUpArea` — at the prototype's own default efficiency (11,700 / 15,600 = 0.75) that is a **33% overstatement**.

Every persisted rate and every API response carries:

```ts
interface Rate {
  value: number;
  unit: string;                                   // 'INR/SQFT', 'INR/NOS', 'INR'
  basis: 'carpet' | 'bua' | 'seat' | 'unit' | 'absolute';
  period: 'month' | 'year' | 'total' | null;
  n_observations: number; n_pos: number; n_vendors: number;
  window_start: string; window_end: string;
}
```

Enforced at the type boundary so an unlabelled number cannot be rendered. Convert at the API edge, never in a component.

### A.6 Normalization has one owner and a version stamp

Four sections normalize text three different ways (TypeScript, a Postgres generated column, and SQL `unaccent`). One owner: `backend/lib/rateBook/normalize.ts`. Every normalized column stores `normalizer_version`. When the abbreviation dictionary or stopword list changes, the version changes and affected rows are re-clustered — otherwise every stored `desc_norm` and every human-locked mapping silently attaches to a different cluster with no detection.

### A.7 Human locks must be un-destroyable

Three independent paths currently destroy locked human judgement:

1. `item_canon_map.po_line_item_id ... ON DELETE CASCADE` wipes every locked mapping when §2 re-ingests a PO by delete-then-insert — which is §2's own recommended idempotency strategy. **The two remedies are in direct conflict.**
2. §3's writer clause `WHERE is_locked = false` suppresses the UPDATE, so the trigger never fires and the review queue stays permanently empty.
3. §4's lock is prose only.

Contract: `ON DELETE RESTRICT` plus a `BEFORE DELETE` guard; re-ingest **upserts on a stable natural key**, never delete-then-insert; drop the `is_locked = false` writer clause and make the trigger sole authority; add append-only `item_canon_map_history`. Ship the test: lock a row, run the batch writer with a different canon, assert `item_canon_id` unchanged **and** `proposed_canon_id` populated.

### A.8 Verified SQL defects — these do not compile

Confirmed by executing against project `xvucakstcmtfoanmgcql`:

- **§3.5 winsorization.** `PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY rate) OVER (PARTITION BY ...)` → `ERROR: 0A000: OVER is not supported for ordered-set aggregate percentile_cont`. PostgreSQL does not allow ordered-set aggregates as window functions. The entire "statistical honesty" mechanism in §3.6 rests on a CTE that will not parse. **Rewrite as a separate aggregate CTE joined back**, not a window.
- **§6.2** `UNIQUE (template_id, category, COALESCE(sub_item,''))` — table-level `UNIQUE` accepts column names only, not expressions. Use a `CREATE UNIQUE INDEX ... ON (template_id, category, COALESCE(sub_item,''))` instead.
- **§6.6** `deal_id UUID REFERENCES deals(id)` — no `deals` table exists. Point at `commercial_deals`.
- **§5.1** claims "Recharts is not in `package.json`" — false; `recharts@^3.7.0` is at [package.json:60](../package.json#L60). The merge rationale for keeping hand-rolled SVG is wrong; re-decide on merit.
- **§2.3** delta sketch uses `synced_at` as the watermark — the exact thing its own Risks section forbids, because [zohoBooksSync.ts:49](../backend/services/zohoBooksSync.ts#L49) stamps `synced_at` on every row every run, so it is always newer than `last_modified_time` and the delta would fetch nothing, forever. Use a dedicated `line_items_synced_at`.
- **§4** recommends a Google embedding model via `@google/generative-ai`, which does not expose it in the installed version. Re-pick the embedding provider explicitly.

### A.9 The 21.5% figure is being misused

All four sections print "21.5% untagged" into what becomes a client-facing provenance caveat. That is the **count** share (1,134 / 5,265). The **value** share is **13.2%** (₹7.98 Cr / ₹60.55 Cr). Net of §5's 12-month window and the status filter it is smaller again. State which measure is meant, every time.

Blank-site POs map to **one `site_areas` row with `is_unallocated = true`** — never a zero-UUID sentinel, which joins to nothing. Every ₹/sq.ft view filters `WHERE NOT is_unallocated AND carpet_sqft IS NOT NULL` and publishes coverage alongside the metric.

### A.10 Shared quota and no triggers on the production write path

Four sections append work to one 300-second cron with no shared budget: a detail-fetch cron at `*/10` (up to ~17,280 Zoho calls/day on the **same OAuth client** as the live Payment Tracker sync), two matview refreshes, and a benchmark refresh. **The first thing that breaks is the live finance workflow, caused by analytics.**

Contract: a `zoho_api_budget(org_id, window_start, calls_used, daily_cap_estimate)` record both crons decrement, with a hard reserve for the header sync and refusal-to-start below it. No trigger on `zoho_purchase_orders` — re-stamp denormalized columns set-based at the head of the rate-book refresh. Every refresh moves out of the sync route into a dedicated cron behind `pg_try_advisory_lock`. One integration test: *the Payment Tracker sync succeeds while the backfill, the rate-book refresh and the benchmark refresh are all running.*

### A.11 Other pinned decisions

| Item | Decision |
|---|---|
| `created_by` / `reviewed_by` FKs | `public.users(id)` — never `auth.users` (breaks PostgREST name embedding) |
| Extensions | one migration installs `pg_trgm`, `unaccent`, `vector` into schema `extensions` |
| `micro_market` | UUID FK everywhere; never a TEXT column. Bands stay NULL until a source is named; §5 needs a documented fallback |
| Rate-book runs | §6 pins `rate_book_run_id`, but a `REFRESH MATERIALIZED VIEW` is destructive and pins nothing. §3 must emit **immutable per-run rows**, or §6 snapshots rates onto `scenario_boq_lines` and drops the pin |
| Recon gate | implemented in §3's `base` CTE where it is consumed — not as prose in §2 |
| RLS audience | the pasted procurement role list is wrong for deal economics: `bd_rep`/`bd_admin`/`bd_super_admin` are pinned to `/crm` by `resolveSilo` and can never reach these screens. **The feature is currently gated to an audience that will not use it.** Re-derive per surface |

### A.12 Prerequisites nobody has

- **No test runner exists.** `package.json` has only `dev`, `build`, `start`, `lint` — no jest, no vitest, no config. §5 specifies golden-value tests as if a harness exists. Adding one is a work item, not a footnote. And pinning *current* Gemini outputs as golden would canonize its existing capex-tail defect as the specification.
- **No migration manifest, no DOWN path.** ~20 tables, 2 matviews, 3 triggers, with real cross-file ordering dependencies. Since migrations are hand-applied, the manifest is the only ordering enforcement that exists.
- **No observability.** The only failure signal today is a `last_sync_status` string. Nothing alerts on cron failure, stalled backfill, stale benchmark, or a growing unmapped-site queue.
- **No cost model** for Zoho detail calls, Groq clustering, embeddings, or per-brief LLM parsing.
- **No named owner** for: the 54→canonical category mapping, site-alias confirmation, `roi_flag`/`is_optional` curation, vendor-tier overrides, or migration execution. Every one is a human queue with no SLA. `Mafatlal WS` alone is ₹1.79 Cr blocked on one unanswered question.
- **The area Excel has not been seen.** Every field name, sheet layout and unit convention in §1's importer is hypothesised against an unseen file.

### A.13 Measure before committing — the 50-PO reconnaissance batch

Five architectural decisions are already committed in DDL against numbers nobody has measured: canon row count (drives HNSW vs IVFFlat, embedding dimension, storage, LLM budget, review load — the estimate could be off by 7×), exact-match resolution rate (explicitly "an estimate, not an observed figure", and LLM cost scales linearly against it), lines per PO (drives every index in §2), Zoho's real daily cap, and the Excel's shape.

**One reconnaissance batch of ~50 PO detail calls answers most of it** — lines per PO, unit vocabulary, HSN coverage, discount and inclusive-tax semantics, the right recon tolerance, and observed rate-limit behaviour. Cost: a few hundred API calls. Make every dependent decision explicitly conditional in the doc (*"if canon < 10k → HNSW, else re-evaluate"*) and gate the migrations on the measured number.

---

## B. Build order

The subsystem specs frame everything as area-blocked. **That is wrong, and it costs you the critical path.** Item-level unit rates — ₹/SQFT of tile, ₹/NOS of luminaire — need no site area at all. Only ₹/sq.ft *aggregates* need the denominator. Splitting on that line gives two tracks, and only one waits for the Excel.

### Phase 0 — Document convergence (now; zero code, zero migrations)

Settle §A above: one site dimension, one `po_line_items` contract, one item-canon contract, one status constant, one category canon, one area-basis convention, one normalizer version. Delete the clobber premise. Write the migration manifest and the roles/ownership table. Correct every unverified figure. **Blocks everything — do not skip.**

### Phase 1 — Site canonicalisation (no Excel required)

Name resolution is independent of area. Seed **all 31** `project_name` values (not the top 15), build `site_aliases` with `confidence`, the admin confirm queue, and a one-time backfill predicated on `confidence = 'confident'`. Ship `Sky mark - Noida` and `Arcil Sky Mark - Noida` as **separate** sites until the business confirms. Leave every area column NULL.

*Delivers:* correct per-site **absolute** rupee reporting, plus a queue the business can start clearing immediately.

### Phase 2 — Two parallel tracks

**Track A — Opex (no line items, no Excel for the first deliverable)**
1. Seed the category→bucket map for all 54 categories, with a CHECK that leaves no default and an unmapped-observations review queue.
2. Per-site, per-bucket rollup at **absolute ₹/month**, using elapsed calendar months of tenancy — *not* months-in-which-a-PO-happened, which measurably overstates by 1.2×–12×. Until an occupancy source exists, label output "annualised from N invoices", not "₹/month".
3. Extract the engine to a pure module. Add a test runner. Fix the landlord-rent escalation and capex-tail defects **before** taking the golden snapshot.
4. Merge the two calculators; wire provenance chips with real units and a `basis` field.

**Track B — Capex / rate book (needs line items, *not* areas)**
1. Line-item ingestion with a shared Zoho budget record, claim-lease + attempt ceiling, transactional per-PO replace via RPC, a durable header-totals table, and no trigger on the production sync's write path.
2. Recon gate implemented where it is consumed.
3. Canon: versioned normalization, exact + trigram passes, LLM tail with a checkpointed job table, human lock enforced by trigger with a DELETE guard.
4. Rate book **at unit-rate grain only** — `(item_canon, vendor, quarter)`. No `site_id` leg, no ₹/sq.ft, no micro-market leg.

*Delivers without the Excel:* "we paid ₹244/sq.ft for modular furniture across 48 POs and 9 vendors; best actual ₹191" — the negotiation screen, vendor comparison, price-drift sparkline and single-source risk report. Most of the value, zero area data.

### Phase 3 — Excel lands

Import → validate (with `areaUnit` **required**, absolute cross-checks, and a dry-run showing implied ₹/sq.ft so a 10.8× sq.m error is visible before commit) → populate areas → then unlock, in order: §5's ₹/sq.ft/month opex benchmark; §3's site- and micro-market-grain legs; the coverage KPI; and §6's BOQ template derivation.

**Add `shell_type` and `spec_tier` as required columns on the Excel spec now, before the file is produced** — §6.2 is the only double-blocked item in the bundle (needs both the Excel *and* line items), and no data source currently supplies either field.

### Phase 4 — Semantic matching

Blocked on a **populated** canon, not just the schema — index choice, dimension, cost model and thresholds are all functions of a row count currently guessed and possibly off by 7×. Sequence: measure the canon → choose the index → build `item_match_event` first → ship with trigram capped *below* the auto-accept band → label ~300 BOQ lines → fit the bands against that labelled set.

### Phase 5 — Scenario generator

Last. Depends on Phase 3 (areas, templates), Phase 2B (rate book), Phase 4 (matching unseen BOQ text), and on §3 emitting versioned rate-book runs §6 can actually pin. Until then it can only run on the 2,700/2,100/500 ladder with zero provenance — which §6 itself correctly calls *"the product with its moat removed."* **Do not demo it in that state.**

### Critical path

```
Phase 0 (doc) ──► Phase 1 (site canon, no Excel)
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  Track A: opex ₹/month         Track B: line items → canon
  (ships without Excel)          → unit rate book
        │                        (ships without Excel)
        └──────────────┬──────────────┘
                       ▼
              [EXCEL ARRIVES] ──► all ÷sq.ft metrics
                       │
                       ├──► BOQ templates (double-blocked)
                       ▼
              Phase 4 matcher ──► Phase 5 scenarios
```

**Needs no line items:** Phase 0, Phase 1, all of Track A, the Excel import spec.
**Needs line items:** Track B, §4, §6.
**Needs the Excel:** only the `÷ area` step in both tracks, plus BOQ template derivation.

---

## C. Top 5 risks

**R-1 — The analytics build takes down the live finance workflow.** Four independent paths: the detail backfill exhausting the shared Zoho quota; a propagation trigger aborting a 200-row upsert chunk; `REFRESH MATERIALIZED VIEW` appended to the same 300s function; the benchmark refresh on the same tail. None has a lock, a budget or a priority. *Mitigation:* §A.10, and the concurrency integration test. If that test doesn't exist, none of this is real.

**R-2 — Human adjudication is silently destroyed.** Three verified paths (§A.7). Weeks of expert time, gone, with no error and no audit row. *Mitigation:* §A.7 in full, plus the lock-survival test.

**R-3 — The product publishes a confident wrong rupee number to a client.** This is the failure the whole system exists to prevent, and there are currently at least seven mechanisms for it: the opex denominator (1.2×–12×), carpet-vs-BUA basis (33%), percentiles of PO amounts labelled ₹/sq.ft, trigram auto-accepting `1.5 ton` as `2 ton` in the categories carrying the money, `best_actual_rate` drawn from a winsorized floor with provenance from a different aggregate, an undefined unit of observation, and rollups-of-rollups labelled "median rate". *Mitigation:* the typed `Rate` of §A.5 enforced at the type boundary; percentiles computed over the quantity displayed, never a proxy; and **five hand-computed reference figures as golden tests before anything ships.**

**R-4 — The team builds four site dimensions and four category vocabularies.** A team parallelising across sections today produces `site_areas`, `site_canon`, `commercial_sites` and a `properties` FK — all populated, all disagreeing, all with a `carpet_sqft` column. The join is then a data migration, not a rename. *Mitigation:* Phase 0 as a hard gate, plus a review rule that any new table named `*site*`, `*canon*`, `*alias*`, `*category*` or `*vendor*` must cite its owning section.

**R-5 — Central sizing assumptions are guesses that invert the plan's own decisions.** *Mitigation:* the 50-PO reconnaissance batch of §A.13, before any migration is authored.

---

# Part 2 — Subsystem specifications

> **Read §A first.** These six sections were authored independently and adversarially reviewed; the review returned 221 findings, 45 of them blockers. They are retained in full because their engineering detail is sound and hard-won — but they contain **known, verified defects** listed in §A.8, and they use **conflicting table and column names** resolved in §A.1–A.3.
>
> Where a section conflicts with §A, §A wins. Do not copy SQL from Part 2 into a migration without applying §A first.

## 1. Dimensional Layer — making Rs/sq.ft possible

Everything downstream (Rs/sq.ft benchmarks, capex-per-seat, opex-per-sqft actuals vs the hardcoded `opexPerSqft "62"` in `Commercial Calculator /Gemini Commercial Calculator.tsx`) needs a denominator. Today there is none: `zoho_purchase_orders` has Rs 60.55 Cr across 5,265 rows and 31 free-text `project_name` values, `properties` has 13 rows with no area columns at all, and `zoho_purchase_orders.property_id` is never populated by `backend/services/zohoBooksSync.ts`.

### (a) `site_areas` — why a new table, not columns on `properties`

The grain differs. POs reference 31 sites; `properties` holds 13 buildings. `7th Floor - Sigma IT Park` (301 POs / Rs 4.15 Cr) and `2nd Floor - Sigma IT Park` (296 / Rs 2.54 Cr) are two leases, two handover dates, two carpet areas, two seat counts — inside one building that isn't even in `properties`. Same for `4th Floor Mygate - Center Point` vs `7th Floor Mygate - Center Point`, and `Mafatlal Chambers C wing` / `D wing` (already two property rows, which is the schema straining against itself). A floor/wing is the unit that gets leased, fitted out and billed; a building is the unit that gets an address. Widening `properties` would force one carpet area per building and destroy the per-floor Rs/sq.ft that the whole model exists to produce. Additionally `properties.capacity` is already polluted (Rabale 19997, SS Plaza 40000 — sq.ft masquerading as seats, populated on 2 of 13 rows); reusing it would inherit that ambiguity.

`site_areas` is therefore the child: `property_id` is a **nullable** FK, because 20+ sites have no matching property row today and blocking on that would stall the import.

### (c) `micro_markets` DDL (created first — `site_areas` FKs it)

```sql
-- supabase/migrations/20260802000001_dimensional_layer.sql  (AUTHOR ONLY, do not apply)
CREATE TABLE IF NOT EXISTS public.micro_markets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    city              TEXT NOT NULL,
    name              TEXT NOT NULL,                    -- 'Thane–Wagle', 'Mahape', 'Noida Sec-62'
    grade             TEXT CHECK (grade IN ('A','B','C')),
    rent_p25_sqft     NUMERIC(10,2), rent_p50_sqft NUMERIC(10,2), rent_p75_sqft NUMERIC(10,2),
    cam_p25_sqft      NUMERIC(10,2), cam_p50_sqft  NUMERIC(10,2), cam_p75_sqft  NUMERIC(10,2),
    source            TEXT,                             -- 'CBRE H1-FY26', 'internal deal comps'
    as_of_date        DATE,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, city, name)
);
CREATE INDEX IF NOT EXISTS idx_mm_org_city ON public.micro_markets (organization_id, city);
```

Band values are **TBD — depends on the benchmark source the user nominates**. Neither calculator has any micro-market concept, so nothing can be back-derived.

### (a) `site_areas` DDL

```sql
CREATE TABLE IF NOT EXISTS public.site_areas (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id              UUID REFERENCES properties(id) ON DELETE SET NULL,  -- nullable by design
    micro_market_id          UUID REFERENCES public.micro_markets(id) ON DELETE SET NULL,

    code                     TEXT NOT NULL,             -- 'SIGMA-F7', slug, stable join key
    name                     TEXT NOT NULL,             -- '7th Floor - Sigma IT Park'
    city                     TEXT,
    floor_label              TEXT,                      -- '7th Floor', 'A wing'
    is_unallocated           BOOLEAN NOT NULL DEFAULT false,  -- the sentinel row, see (b)

    carpet_sqft              NUMERIC(12,2) CHECK (carpet_sqft > 0),
    built_up_sqft            NUMERIC(12,2) CHECK (built_up_sqft > 0),
    seats                    INTEGER CHECK (seats > 0),
    shell_type_at_handover   TEXT CHECK (shell_type_at_handover IN ('bare','warm','furnished')),
    handover_date            DATE,
    lease_start              DATE,
    lease_end                DATE,
    lock_in_months           INTEGER CHECK (lock_in_months >= 0),
    rent_per_sqft            NUMERIC(10,2),
    cam_per_sqft             NUMERIC(10,2),

    data_source              TEXT NOT NULL DEFAULT 'excel_import',  -- excel_import|manual|derived
    source_import_id         UUID,
    as_of_date               DATE,
    is_active                BOOLEAN NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_carpet_le_bua  CHECK (carpet_sqft IS NULL OR built_up_sqft IS NULL
                                         OR carpet_sqft <= built_up_sqft),
    CONSTRAINT chk_lease_order    CHECK (lease_start IS NULL OR lease_end IS NULL
                                         OR lease_start < lease_end),
    UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sa_org_active   ON public.site_areas (organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sa_property     ON public.site_areas (property_id)      WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sa_micromarket  ON public.site_areas (micro_market_id)  WHERE micro_market_id IS NOT NULL;
-- Only rows with a denominator can produce Rs/sq.ft; index them for the metrics views.
CREATE INDEX IF NOT EXISTS idx_sa_has_carpet   ON public.site_areas (organization_id)  WHERE carpet_sqft IS NOT NULL;
```

`shell_type_at_handover` is the join to the `finishingRates` ladder in `Commercial Calculator /Claude Commercial Calculator.tsx:31-68` (`bareShell 2700 / warmShell 2100 / furnished 500` Rs/sq.ft) — it turns that hardcoded ladder into a per-site expected-capex baseline testable against actual PO spend.

### (b) `site_aliases` DDL

```sql
CREATE TABLE IF NOT EXISTS public.site_aliases (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id           UUID REFERENCES public.site_areas(id) ON DELETE SET NULL,  -- NULL = unresolved
    raw_value         TEXT NOT NULL,                    -- exact zoho project_name, spaces intact
    -- trailing-space and casing defects ('Radical Mind - Bangalore ') collapse here, not in app code
    normalized_value  TEXT GENERATED ALWAYS AS (lower(btrim(regexp_replace(raw_value,'\s+',' ','g')))) STORED,
    confidence        TEXT NOT NULL DEFAULT 'needs_review'
                      CHECK (confidence IN ('confident','needs_review','unmapped')),
    match_method      TEXT,                             -- seed|exact|fuzzy|human
    mapped_by         UUID REFERENCES users(id),
    mapped_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, normalized_value)
);
CREATE INDEX IF NOT EXISTS idx_salias_site    ON public.site_aliases (site_id);
CREATE INDEX IF NOT EXISTS idx_salias_pending ON public.site_aliases (organization_id)
    WHERE site_id IS NULL OR confidence <> 'confident';
```

**Seed mapping, top ~15 by value** (`project_name` → canonical site, PO count / value from ground truth):

| raw `project_name` | POs / Rs Cr | canonical | flag |
|---|---|---|---|
| `SS Plaza` | 975 / 23.21 | SS-PLAZA (property *SS Plaza*) | confident |
| *(blank)* | 1134 / 7.98 | UNALLOCATED sentinel | unmapped — see below |
| `ETPL- Thane` | 381 / 6.76 | ETPL-THANE (property *ETPL Digitide*?) | needs_review |
| `NRK Star - Indore` | 341 / 5.01 | NRK-STAR-INDORE (property *Indore*) | confident |
| `7th Floor - Sigma IT Park` | 301 / 4.15 | SIGMA-F7 | confident |
| `2nd Floor - Sigma IT Park` | 296 / 2.54 | SIGMA-F2 (distinct site, same building) | confident |
| `Rupa Solitaire - Mahape` | 155 / 2.17 | RUPA-SOLITAIRE (property *RUPA SOLITAIRE*) | confident |
| `Mafatlal WS` | 324 / 1.79 | ? "WS" = warm shell, or a wing | **needs_review** |
| `AMR Tech Park` | 122 / 1.38 | AMR-TECH-PARK (property *AMR Altruist*?) | needs_review |
| `Quess House` | 40 / 0.92 | QUESS-HOUSE (vs `Quess Tower` 24 — different assets) | needs_review |
| `Mahindra Finance - Delhi` | 189 / 0.61 | MAHINDRA-DELHI | confident |
| `Arcil Sky Mark - Noida` + `Sky mark - Noida` | 10 + 47 / 0.57 + 0.57 | **both → SKYMARK-NOIDA** (property *Noida*) | needs_review (Arcil may be a separate tenant floor) |
| `Mafatlal Chember -A wing` | 96 / 0.52 | MAFATLAL-A (typo of "Chambers") | confident (typo), site row is new — properties has only C/D wing |
| `B wing - Mafatlal Chambers` | 3 | MAFATLAL-B | confident |
| `3i - Crescent Solitaire` | 206 / 0.49 | CRESCENT-3I | confident |
| `Radical Mind - Bangalore ` | 6 / 0.43 | RADICAL-BLR (trailing space) | confident |
| `MyGate - VKG` | 204 / 0.30 | MYGATE-VKG (≠ the two Center Point floors) | confident |

The 1,134 blank-site POs (Rs 7.98 Cr, 2023-04..2026-06, the pre-custom-field era) map to one `site_areas` row with `is_unallocated = true`, `carpet_sqft NULL`. That keeps org totals reconciling to Rs 60.55 Cr while every Rs/sq.ft view excludes it by `WHERE NOT is_unallocated AND carpet_sqft IS NOT NULL`. A later pass can attribute them by (vendor_name, category, po_date) proximity to dated site activity — that is a separate spec section, not a schema concern.

### RLS (tier-2 pattern, copied from `supabase/migrations/20260801000001_po_workflow_state.sql:58-71`)

```sql
ALTER TABLE public.site_areas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_aliases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.micro_markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acct members read site areas" ON public.site_areas;
CREATE POLICY "acct members read site areas" ON public.site_areas FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = site_areas.organization_id
              AND om.is_active AND om.role::text IN ('org_super_admin','org_admin','master_admin',
                    'purchase_manager','purchase_executive','procurement','accounts'))
    OR EXISTS (SELECT 1 FROM property_memberships pm
            WHERE pm.user_id = auth.uid() AND pm.organization_id = site_areas.organization_id
              AND pm.is_active AND pm.role::text IN ('org_super_admin','org_admin','master_admin',
                    'purchase_manager','purchase_executive','procurement','accounts'))
);
-- site_aliases and micro_markets: identical policy body, table name swapped.
-- No INSERT/UPDATE/DELETE policies anywhere — all writes go through service-role routes
-- under app/api/, permission-checked in TypeScript (backend/lib/accounts/access.ts VIEW_ROLES).
```

Rent, CAM and lock-in are commercially sensitive; `property_admin`, `tenant`, `security`, `staff` are excluded exactly as they are in `backend/lib/accounts/access.ts:13-17`.

### (d) Excel/MIS importer — tolerant two-step

Precedent: `app/api/procurement/catalog/bulk-upload/route.ts` (XLSX parse → first non-empty row as header → Groq `llama-3.3-70b-versatile` at `temperature: 0.0`, constrained to "choose only from the provided headers or null", then **backend re-validates every returned header against the real header list**). Reuse that shape verbatim; add a human confirmation step, which the catalog route lacks.

**Step 1 — `POST /api/sites/areas/import` (multipart).** Parse with `xlsx@0.18.5`; enumerate *all* sheets, not just `SheetNames[0]` (the MIS will likely be multi-sheet, as `Payment Tracker.xlsx` is with 80 sheets); scan the first 20 rows per sheet for the header row (banner/logo rows are normal in MIS files). Persist raw rows to a staging table `site_area_imports` (+ `site_area_import_rows` with `row_index`, `raw JSONB`, `status`, `errors JSONB`) so the confirm step is stateless. Return proposed mapping. Nothing touches `site_areas` yet.

```ts
// backend/lib/sites/importMapping.ts (sketch)
export type SiteAreaField =
  | 'site_name' | 'code' | 'city' | 'floor_label' | 'property_name' | 'micro_market'
  | 'carpet_sqft' | 'built_up_sqft' | 'seats' | 'shell_type_at_handover'
  | 'handover_date' | 'lease_start' | 'lease_end' | 'lock_in_months'
  | 'rent_per_sqft' | 'cam_per_sqft';

export const FIELD_ALIASES: Record<SiteAreaField, string[]> = {
  site_name:    ['site','site name','project','project name','location','premises','centre','center','facility'],
  code:         ['site code','loc code','centre code','id'],
  city:         ['city','location city','region'],
  floor_label:  ['floor','wing','level','unit'],
  property_name:['building','property','tower','complex'],
  micro_market: ['micro market','micromarket','sub market','submarket','locality','area'],
  carpet_sqft:  ['carpet','carpet area','carpet sq ft','carpet sqft','carpet area (sq.ft)','usable area','net area'],
  built_up_sqft:['bua','built up','built-up','built up area','chargeable area','super built up','saleable area','gross area','leased area','licensed area'],
  seats:        ['seats','seat count','no of seats','headcount','capacity','workstations','ws','desks'],
  shell_type_at_handover: ['shell','shell type','handover condition','condition at handover','fitout status','bare/warm/furnished'],
  handover_date:['handover','handover date','possession','possession date','fit out start','date of handover'],
  lease_start:  ['lease start','commencement','rent start','agreement start','loi date','start date'],
  lease_end:    ['lease end','expiry','lease expiry','agreement end','end date'],
  lock_in_months:['lock in','lock-in','lockin','lock in period','lock in (months)','lock in years'],
  rent_per_sqft:['rent','rent psf','rent per sq ft','rent/sqft','rental rate','basic rent'],
  cam_per_sqft: ['cam','cam psf','cam per sq ft','maintenance charges','common area maintenance'],
};

export interface ProposedMapping {
  field: SiteAreaField; header: string | null;
  method: 'exact' | 'alias' | 'fuzzy' | 'llm' | 'none';
  score: number;              // 0..1
  sampleValues: string[];     // 3 values so a human can sanity-check the column
}
```

Matching cascade, cheapest first: (1) normalized exact (`lower`, strip `sq.ft/sqft/sq ft/(...)`, collapse whitespace/punctuation); (2) alias table above; (3) fuzzy — token-set Dice/Levenshtein **in TypeScript**, because `pg_trgm` is not installed and this layer must carry zero extension dependency; (4) Groq fallback for still-null fields only, same anti-hallucination contract as the catalog route. Anything scoring < 0.75 is surfaced as `needs_confirmation`, never auto-applied.

**Step 2 — `POST /api/sites/areas/import/{importId}/commit`** with `{ mapping: Record<SiteAreaField,string|null>, unitHints: { areaUnit: 'sqft'|'sqm', lockInUnit: 'months'|'years' }, dryRun: boolean }`. `dryRun: true` returns per-row validation and the diff (new sites vs updates matched on `code`, else on normalized `site_name` via `site_aliases`) before anything is written. Commit is a single upsert on `(organization_id, code)`; every accepted `site_name` is also written into `site_aliases` with `match_method='human'`.

**Validation rules** (`error` blocks the row; `warn` is shown and overridable):
- `carpet_sqft <= built_up_sqft` — **error** (also enforced by `chk_carpet_le_bua`).
- Efficiency `carpet/BUA` outside 0.55–0.95 — **warn**. Anchor: the Gemini calculator's defaults `carpetArea 11700 / builtUpArea 15600` = 0.75.
- Density `carpet_sqft / seats` outside **30–80 sq.ft/seat** — **warn**; outside 15–150 — **error** (almost certainly a units or column mix-up).
- Area < 500 or > 200,000 sq.ft — **warn** (`properties.capacity` already shows 19,997 and 40,000 as plausible sq.ft magnitudes).
- `lease_start < lease_end` — error. `handover_date` within [`lease_start` − 180d, `lease_end`] — warn. `lock_in_months <= months_between(lease_start, lease_end)` — warn. Value ≤ 10 in a `lock_in_months` column — warn "looks like years", offer ×12.
- `shell_type_at_handover` fuzzy-normalized to `bare|warm|furnished` (accepts "Bare Shell", "Warm shell", "Fully furnished", "Plug & play"→`furnished`); unrecognized → NULL + warn.
- `rent_per_sqft` / `cam_per_sqft` outside the site's micro-market p25–p75 band → warn (skipped when `micro_markets` is unseeded).
- Duplicate `code` or duplicate normalized `site_name` within the file — error.

**Partial data is first-class.** Every dimensional column is nullable; a row with only `site_name` still commits and still gives POs somewhere to land. Expose a derived grade (view or generated column): **A** = carpet + seats + lease dates; **B** = carpet only; **C** = name only. Rs/sq.ft views filter to `carpet_sqft IS NOT NULL`; Rs/seat views to `seats IS NOT NULL`; each metric surface must state coverage as "Rs X/sq.ft across N of 31 sites covering Rs Y Cr of Rs 60.55 Cr" rather than silently averaging over a partial denominator.

### (e) Backfilling `zoho_purchase_orders.site_id`

`property_id` is the wrong grain and has never been populated — leave it, deprecate it, derive it as `site_areas.property_id` in views. Add instead:

```sql
ALTER TABLE public.zoho_purchase_orders
    ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.site_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_zpo_site ON public.zoho_purchase_orders (organization_id, site_id);
```

Critical constraint, per the comment at the top of `supabase/migrations/20260801000001_po_workflow_state.sql`: `syncPurchaseOrdersForOrg` upserts whole rows on `(organization_id, zoho_po_id)` every 2 hours (`app/api/cron/sync-zoho-books/route.ts`, cron `0 */2 * * *`), so any column absent from the upsert payload is clobbered. `site_id` is safe **only because it is derived, not human-authored** — so resolve it inside the sync:

1. `backend/services/zohoBooksSync.ts` loads the `site_aliases` map once per run into a `Map<normalized, site_id>`, then sets `site_id` on each row of the 200-row chunk payload before upsert. Unknown `project_name` → insert into `site_aliases` with `site_id NULL, confidence 'unmapped'`, `site_id` stays NULL on the PO.
2. Blank `project_name` → the `is_unallocated` sentinel site.
3. One-time backfill for the existing 5,265 rows (idempotent, safe to re-run):

```sql
UPDATE public.zoho_purchase_orders po
   SET site_id = a.site_id
  FROM public.site_aliases a
 WHERE a.organization_id = po.organization_id
   AND a.site_id IS NOT NULL
   AND lower(btrim(regexp_replace(coalesce(po.project_name,''), '\s+', ' ', 'g'))) = a.normalized_value
   AND po.site_id IS DISTINCT FROM a.site_id;
```

4. A "Site mapping" admin queue reads `site_aliases WHERE site_id IS NULL OR confidence <> 'confident'`; confirming a mapping re-runs the UPDATE above scoped to that alias. Track coverage as `SUM(po_amount) WHERE site_id IS NOT NULL` / Rs 60.55 Cr — target ≥ Rs 52.57 Cr (everything except the 1,134 blanks) after the seed.

### Risks

- **Alias merges are irreversible-looking.** Folding `Sky mark - Noida` (47 POs) into `Arcil Sky Mark - Noida` (10 POs) is a business call, not a string call — if they are two tenants on two floors, merging destroys per-site Rs/sq.ft. Ship them as separate sites and merge only on human confirmation; `site_aliases` rows are cheap to re-point, but any cached metric must be recomputed after a re-point.
- **`Mafatlal WS` (324 POs / Rs 1.79 Cr) is genuinely ambiguous** — "WS" could be warm shell, workstation, or a wing. Do not guess; it stays `needs_review` and its Rs 1.79 Cr sits outside site metrics until resolved.
- **Sync clobber.** If anyone later adds a human-edited column to `zoho_purchase_orders` (or if `site_id` is ever hand-corrected in the UI rather than via `site_aliases`), the 2-hourly sync silently erases it. Enforce in review: `zoho_purchase_orders` is sync-owned; corrections happen in `site_aliases`.
- **Units.** MIS sheets mix sq.ft/sq.m, "Rs/sq.ft/month" vs "/year", and lock-in in years vs months. The mapping-confirm step must show three sample values per column; a silent sq.m import understates carpet by ~10.8× and inflates every Rs/sq.ft figure correspondingly.
- **BUA vs chargeable vs super built-up.** Landlords bill on chargeable area, fit-out is measured on carpet. If the sheet's "BUA" is actually chargeable area, `rent_per_sqft` and `capex_per_sqft` end up on different denominators. Store what the sheet says, record `data_source`, and flag efficiency outliers rather than normalizing silently.
- **Denominator coverage bias.** If only the large sites (SS Plaza, ETPL-Thane, Sigma) get areas first, org-level Rs/sq.ft averages skew to big-floor economics. Always publish coverage alongside the metric.
- **Micro-market bands are unsourced.** Until the user names a benchmark source, `micro_markets` rows exist with NULL bands and every rent-reasonableness check is disabled — do not fabricate p25/p50/p75.
---

## 2. PO Line-Item Ingestion

The rate book is unbuildable today: all 5,265 rows in `zoho_purchase_orders` carry only Zoho's **list** payload in `raw` (46 keys, `line_items` absent on every row). Only `GET /books/v3/purchaseorders/{id}` returns lines. This section makes line items a first-class, permanently maintained table.

### 2.1 `po_line_items` DDL

```sql
CREATE TABLE IF NOT EXISTS public.po_line_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_id             UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,

    zoho_line_item_id TEXT,                 -- Zoho line_item_id; NULL for CSV-sourced rows
    line_no           INTEGER NOT NULL,     -- 1-based position within the PO
    description       TEXT,
    hsn_or_sac        TEXT,
    quantity          NUMERIC(16,4),
    unit              TEXT,                 -- raw Zoho unit; normalization is §4
    rate              NUMERIC(16,4),
    amount            NUMERIC(16,2),        -- Zoho line `item_total` (pre-tax)
    tax_percentage    NUMERIC(6,3),
    zoho_item_id      TEXT,                 -- Zoho item master id, if the line is catalogued
    account_name      TEXT,
    raw               JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- DENORMALIZED FROM zoho_purchase_orders (see rationale)
    po_date           DATE,
    po_status         TEXT,
    category          TEXT,
    vendor_name       TEXT,
    site_name         TEXT,                 -- verbatim zoho_purchase_orders.project_name
    site_id           UUID REFERENCES properties(id) ON DELETE SET NULL,  -- NULL until §3 canonicalisation

    source            TEXT NOT NULL DEFAULT 'zoho_detail'
                      CHECK (source IN ('zoho_detail','csv_export','manual')),
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (organization_id, po_id, line_no)          -- upsert conflict target
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pli_zoho_line
    ON public.po_line_items (organization_id, zoho_line_item_id)
    WHERE zoho_line_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pli_po ON public.po_line_items (po_id);

-- The rate-book workhorse: percentile math is always "category × time window",
-- and it must never see draft/cancelled/rejected lines (§2.5).
CREATE INDEX IF NOT EXISTS idx_pli_ratebook
    ON public.po_line_items (organization_id, category, po_date DESC)
    INCLUDE (rate, quantity, unit, amount)
    WHERE po_status IN ('approved','open','billed','partially_billed');

CREATE INDEX IF NOT EXISTS idx_pli_site   ON public.po_line_items (organization_id, site_name, category);
CREATE INDEX IF NOT EXISTS idx_pli_vendor ON public.po_line_items (organization_id, vendor_name, category);
CREATE INDEX IF NOT EXISTS idx_pli_hsn    ON public.po_line_items (organization_id, hsn_or_sac)
    WHERE hsn_or_sac IS NOT NULL;
-- Trigram index on description deferred: pg_trgm is NOT installed on xvucakstcmtfoanmgcql.
```

**Why denormalize `po_date` / `site_*` / `category` / `vendor_name` / `po_status`.** Every rate-book read is `percentile_cont(...) WITHIN GROUP (ORDER BY rate)` grouped by category (and later site/vendor/period). Row count is TBD — depends on average lines per PO, unknown until first ingest — but it is a multiple of 5,265 and this table is scanned on every calculator load, every outlier check, and every benchmark refresh. Keeping the grouping keys on the fact row makes those a single index-driven scan instead of a hash join back to a 5,265-row dimension per query, and it is what makes the partial `idx_pli_ratebook` possible at all — a partial index cannot filter on a joined table's column. `po_status` is denormalized specifically so status exclusion is an *index predicate*, not a post-join filter.

The cost is staleness: `zoho_purchase_orders` rows are wholly rewritten every 2 hours by the upsert in `backend/services/zohoBooksSync.ts:61-67` (same hazard documented in `supabase/migrations/20260801000001_po_workflow_state.sql`). Mitigation: an `AFTER UPDATE OF po_date, status, category, project_name, vendor_name ON zoho_purchase_orders` trigger that propagates into `po_line_items` when any of those five actually change; and the ingest writer always stamps them from the parent row it just read.

**RLS** — tier-2 pattern copied verbatim from `supabase/migrations/20260801000001_po_workflow_state.sql:58-71`: `ENABLE ROW LEVEL SECURITY`, one `FOR SELECT` policy that is `EXISTS` over `organization_memberships` **OR** `property_memberships`, each with `is_active AND role::text IN ('org_super_admin','org_admin','master_admin','purchase_manager','purchase_executive','procurement','accounts')`. No INSERT/UPDATE/DELETE policies: all writes go through service-role routes under `app/api/`, permission-checked in TypeScript via `resolveAccountsAccess` in `backend/lib/accounts/access.ts`. Line items expose negotiated unit rates — `property_admin`, `tenant`, `security`, `staff`, `super_tenant` must stay excluded. No realtime publication; this table is analytics, not a live queue.

### 2.2 Backfill of the 5,265 historical POs

**Route A — Zoho Books UI export.** Operator path: Zoho Books → **Purchases → Purchase Orders** → select the "All Purchase Orders" view → **⋯ (More) → Export** → in the dialog choose the module variant that includes line items (Zoho's export dialog exposes a header-only vs. with-items choice; the exact label is TBD — depends on the org's Books edition and UI version) → format **CSV** → date range covering Apr-2023 → Jul-2026 → Export → download from the resulting email/notification. Zero API credits, minutes.

**The disqualifying problem with Route A as system-of-record:** the export emits *UI labels and human-facing identifiers*, not API keys. It gives `Purchase Order#`, not `purchaseorder_id`; and it almost certainly gives no `line_item_id`. `po_number` is **not unique in this dataset** — `backend/services/zohoBooksSync.ts:52-55` records 16 pairs of distinct POs sharing a number, which is exactly why the header sync keys on `zoho_po_id`. A CSV join on PO number silently mis-attributes those lines, and without `line_item_id` there is no stable idempotency key for re-runs. `Payment Tracker.xlsx` "Master Data" is the same shape and has no line items either, so it is not a fallback.

**Route B — 5,265 detail calls.** Authoritative: returns `purchaseorder_id`, per-line `line_item_id`, `hsn_or_sac`, `item_id`, `account_name`, plus header `sub_total`/`tax_total`/`total` needed for §2.4. Zoho Books enforces per-minute and plan-dependent daily API limits; **do not hardcode any number** — design so the ceiling can be discovered at runtime.

**Recommendation: Route B is the pipeline.** Run Route A once as a *reconnaissance corpus* only — it costs one operator click and lets us size the job (total line count, unit vocabulary, HSN coverage) before spending credits, and it becomes a cross-check for §2.4. Promote Route A to a real importer **only if** the export is confirmed to carry both `purchaseorder_id` and `line_item_id`; that is a hard gate, not a preference. Note that the existing CSV path `app/api/accounts/pos/route.ts` deliberately *collapses* repeated line rows into one PO row (dedupe by `po_number`) — it must not be reused; a line-item import needs its own endpoint.

**Ingest ledger (needed under either route — Route A still requires reconciliation):**

```sql
CREATE TABLE public.zoho_backfill_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_type        TEXT NOT NULL CHECK (job_type IN ('po_line_items_backfill','po_line_items_delta')),
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','paused','completed','failed')),
    total_items     INTEGER NOT NULL DEFAULT 0,
    done_items      INTEGER NOT NULL DEFAULT 0,
    failed_items    INTEGER NOT NULL DEFAULT 0,
    cursor_po_id    UUID REFERENCES public.zoho_purchase_orders(id) ON DELETE SET NULL,
    rate_limit_hits INTEGER NOT NULL DEFAULT 0,
    next_run_after  TIMESTAMPTZ,           -- set by backoff on HTTP 429
    last_error      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.zoho_backfill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES public.zoho_backfill_jobs(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_id           UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    zoho_po_id      TEXT NOT NULL,
    priority        SMALLINT NOT NULL DEFAULT 100,   -- lower = sooner; drafts pushed to 900
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_flight','done','failed','skipped','rate_limited')),
    attempts        SMALLINT NOT NULL DEFAULT 0,
    http_status     INTEGER,
    last_error      TEXT,
    -- header totals from the DETAIL payload, kept here because zoho_purchase_orders
    -- is clobbered every 2h by the list sync and cannot safely hold them
    line_count        INTEGER,
    lines_sum         NUMERIC(16,2),
    header_sub_total  NUMERIC(16,2),
    header_tax_total  NUMERIC(16,2),
    header_total      NUMERIC(16,2),
    fetched_at      TIMESTAMPTZ,
    UNIQUE (job_id, po_id)
);
CREATE INDEX idx_zbi_next ON public.zoho_backfill_items (job_id, status, priority, id)
    WHERE status IN ('pending','rate_limited');
```

Both tables get the same tier-2 RLS SELECT policy (admin/procurement/accounts roles only). Resumability rules: claim a batch by flipping `pending → in_flight`; on HTTP 429 set the item back to `rate_limited`, increment `rate_limit_hits`, and set `jobs.next_run_after = now() + interval` with exponential backoff (base 30s, doubling, cap 30 min, ±20% jitter) — the cap is discovered empirically, never assumed. On 404/410 mark `skipped`. Item writes are `upsert(onConflict: 'organization_id,po_id,line_no')` followed by `DELETE ... WHERE po_id = $1 AND line_no > $lineCount`, so re-running a PO is a no-op. The job is safe to re-run end-to-end at any time.

### 2.3 Forward / delta sync

`raw->>'last_modified_time'` is already present on every list row. Extend `backend/services/zohoBooksSync.ts`:

```ts
// after the existing header upsert loop (zohoBooksSync.ts:61-67)
interface DeltaCandidate { po_id: string; zoho_po_id: string; priority: number }

async function enqueueLineItemWork(orgId: string, listRows: any[]): Promise<DeltaCandidate[]> {
  const stored = await selectPOs(orgId);          // id, zoho_po_id, synced_at, status, has_lines
  const q: DeltaCandidate[] = [];
  for (const po of listRows) {
    const s = stored.get(po.purchaseorder_id);
    if (!s) continue;                                       // header upsert just created it; next pass picks it up
    const modified = Date.parse(po.last_modified_time);     // Zoho local time; parse with the org's Books TZ
    const neverIngested = !s.has_lines;                     // LEFT JOIN po_line_items ... IS NULL
    const changed      = modified > Date.parse(s.synced_at);
    if (!neverIngested && !changed) continue;               // <-- the whole point: no detail call
    q.push({ po_id: s.id, zoho_po_id: po.purchaseorder_id,
             priority: s.status === 'draft' ? 900 : 100 });
  }
  return upsertBackfillItems(orgId, 'po_line_items_delta', q);   // idempotent on (job_id, po_id)
}
```

The detail fetcher itself is a **separate cron**, not an extension of the existing one. Budget: `app/api/cron/sync-zoho-books/route.ts` already burns most of its `maxDuration = 300` on ~27 list pages plus 27 upsert chunks per org. 5,265 serial detail calls at even a few hundred ms each is tens of minutes — it does not fit, and cannot be made to fit by raising concurrency against an unknown rate cap. Add `app/api/cron/sync-po-line-items/route.ts`, `maxDuration = 300`, same `Bearer CRON_SECRET` guard, which drains `zoho_backfill_items` under two hard stops: a wall-clock budget (~250 s, checked before each call) and `PO_DETAIL_CALLS_PER_RUN` (env-tunable, start conservative at ~120 with concurrency 2-3, raise only after observing zero 429s). Backfill duration = `ceil(5265 / PO_DETAIL_CALLS_PER_RUN)` runs — ~44 runs at 120/run. Run it at high frequency during backfill (e.g. `*/10 * * * *` → roughly 7-8 hours), then relax to `15 */2 * * *` to trail the header sync. Cron frequency granularity is TBD — depends on the Vercel plan. Steady-state delta volume is TBD — depends on observed `last_modified_time` churn; the per-run cap bounds it regardless.

### 2.4 Reconciliation & trust

Zoho line `amount` is pre-tax, so the correct assertion is against `sub_total`, not `total`. `zoho_purchase_orders.po_amount` is `total` (tax-inclusive), so it is the loose outer bound only.

```sql
CREATE OR REPLACE VIEW public.po_line_item_reconciliation
WITH (security_invoker = on) AS      -- same pattern as 20260801000004_po_alignment_queue_view.sql
SELECT p.organization_id, p.id AS po_id, p.po_number, p.status, p.po_date,
       p.category, p.project_name AS site_name, p.vendor_name,
       p.po_amount                                   AS header_total,
       i.header_sub_total, i.header_tax_total,
       COALESCE(l.line_count, 0)                     AS line_count,
       COALESCE(l.lines_sum, 0)                      AS lines_sum,
       COALESCE(l.lines_sum, 0) - COALESCE(i.header_sub_total, p.po_amount) AS variance,
       CASE
         WHEN COALESCE(l.line_count,0) = 0                       THEN 'no_lines'
         WHEN i.header_sub_total IS NULL                         THEN 'no_header_totals'
         WHEN ABS(COALESCE(l.lines_sum,0) - i.header_sub_total)
              <= GREATEST(1.00, 0.005 * ABS(i.header_sub_total)) THEN 'ok'
         WHEN COALESCE(l.lines_sum,0) > p.po_amount              THEN 'lines_exceed_total'
         ELSE 'variance'
       END AS recon_status
FROM public.zoho_purchase_orders p
LEFT JOIN (SELECT po_id, COUNT(*) line_count, SUM(amount) lines_sum
           FROM public.po_line_items GROUP BY po_id) l ON l.po_id = p.id
LEFT JOIN LATERAL (SELECT header_sub_total, header_tax_total FROM public.zoho_backfill_items zbi
                   WHERE zbi.po_id = p.id AND zbi.status = 'done'
                   ORDER BY zbi.fetched_at DESC LIMIT 1) i ON true;
```

Tolerance is `max(Re 1.00, 0.5% of sub_total)` — absorbs paise rounding and Zoho's per-line rounding, but not a dropped or duplicated line. `lines_exceed_total` catches double-ingest. **Gate:** the rate-book materialization in §5 selects only from POs with `recon_status = 'ok'`; anything else is quarantined and surfaced in an ops table alongside `po_alignment_queue`. A rate book built on POs whose lines do not sum is worse than no rate book — it looks authoritative and is wrong.

### 2.5 Status and tagging policy

**Ingest everything; exclude at query time.** Detail calls are the scarce resource, so fetch lines for all 5,265 POs once — a draft approved next month must not require a re-crawl. Exclusion lives in the `idx_pli_ratebook` predicate and in the rate-book view, never in the ingest filter. Drafts get `priority = 900` in `zoho_backfill_items` so the 4,302 committed POs land first and the churniest rows last.

**Excluded from the rate book:** `draft` (856) — not vendor-committed; prices are placeholders and drafts are frequently edited or abandoned, so including them contaminates every percentile with numbers no vendor ever agreed to. `cancelled` (107) — the commercial terms were repudiated; a cancelled PO's rate is evidence of a rejected price, not a market price. `rejected` (1) — same. `pending_approval` (71) — commercially proposed but not accepted; keep queryable as forward-looking pipeline, keep out of the benchmark. **Included:** `approved` (2,998), `open` (786), `billed` (434), `partially_billed` (12) = **4,230 POs, 80.3% of 5,265**. `billed` is the highest-trust tier — an invoice matched it.

**The 1,134 untagged POs (Rs 7.98 Cr, 21.5%).** Do **not** discard them; that is 21.5% of spend and they are the oldest records (2023-04 → 2026-06), i.e. the entire early-period baseline. They have no `cf_category`/`cf_department`/`cf_site` in `raw` — but line items are exactly the missing signal: `description`, `hsn_or_sac` (real GST codes map to material class), `account_name`, and `vendor_name` (762 distinct vendors, most of which are single-trade) together allow back-classification. Policy: ingest them at normal priority, mark derived category with `category_source = 'inferred'` in the §6 classification pass, and hold them **out of rate-book v1**. They enter the benchmark only once inferred category is confidence-scored and spot-checked — an inferred category silently mixed with a Zoho-tagged one would corrupt exactly the buckets we price against (Housekeeping Rs 9.27 Cr, Electricity Rs 6.58 Cr, Electrical Rs 5.42 Cr). Rate-book v1 therefore covers the intersection of *tagged* and *non-draft/non-cancelled* POs — count is **TBD — depends on a status × tagged crosstab**, not derivable from the figures on hand.

### Risks

- **Route A join key.** If the Books CSV export omits `purchaseorder_id`/`line_item_id`, joining on `po_number` mis-attributes lines across the 16 known duplicate-number pairs and cannot be re-run idempotently. Treat the export as reconnaissance until proven otherwise.
- **Unknown API ceiling.** Per-minute and daily Zoho limits are plan-dependent and unstated here. If backoff is too timid the job stalls silently; instrument `rate_limit_hits` and alert when a run makes zero forward progress.
- **Header clobbering.** The 2-hourly full-row upsert (`zohoBooksSync.ts:61-67`) rewrites `synced_at` on *every* PO whether or not it changed. If `synced_at` is used as the delta watermark it will always be newer than `last_modified_time` and the delta will fetch nothing. Use a dedicated `line_items_synced_at` column (or the ledger's `fetched_at`) as the watermark — **do not** reuse `synced_at`.
- **Denormalization drift.** Miss the propagation trigger and the partial index silently excludes newly-approved POs from the rate book. Add a nightly assertion that `po_line_items.po_status` matches its parent on 100% of rows.
- **Pre-tax vs tax-inclusive.** Reconciling `SUM(amount)` against `po_amount` (which is `total`) instead of `sub_total` produces a false failure on every taxed PO — i.e. nearly all of them. The ledger's `header_sub_total` is load-bearing; POs backfilled without it land in `no_header_totals`, not `ok`.
- **Line-item volume unknown.** Row count, and therefore index and scan cost, is TBD until the first batch lands. Re-evaluate `idx_pli_ratebook`'s `INCLUDE` list against real cardinality before building the materialized rate book.
- **Zero-quantity / lump-sum lines.** Service POs (AMC, Housekeeping) often carry `quantity = 1, unit = NULL` with the whole value in `rate` — these are not comparable unit rates and will skew percentiles unless §4's normalization explicitly quarantines them.
---

## 3. Item Canon & Rate Book

The rate book is the product. Everything upstream (line-item backfill, site canon) exists to feed it. Input corpus size is **TBD — depends on the line-item backfill of 5,265 POs via `GET /books/v3/purchaseorders/{id}`**; `raw` holds the LIST payload only and `line_items` is absent on all 5,265 rows, so nothing here can be built until §2 lands `po_line_items`.

### 3.1 Normalization (deterministic, before any AI)

Implemented as a pure function in `backend/lib/rateBook/normalize.ts`, applied at ingest and stored alongside the raw string (never destructively):

| # | Transform | Example |
|---|---|---|
| 1 | `lower()` + `unaccent()` (extension not installed — see §3.2) | `Housekeeping ` → `housekeeping` |
| 2 | Trailing/leading trim + `regexp_replace(s,'\s+',' ','g')` | fixes the observed `"Housekeeping "`, `"Civil "`, `"Lights "`, `"Radical Mind - Bangalore "` |
| 3 | Punctuation fold: `.`, `,`, `/`, `-`, `_`, `()` → space, then re-collapse | `sq.ft.` → `sq ft` |
| 4 | UoM synonym expansion against a closed dictionary → `uom_norm` | `sqft\|sq ft\|sft\|square feet\|sq.ft` → `SQFT`; `nos\|no\|pcs\|pieces\|pc` → `NOS`; `rmt\|rft\|running meter\|rmtr` → `RMT`; `kg\|kgs` → `KG`; `ltr\|litre\|liters\|l` → `LTR`; `set\|sets` → `SET`; `job\|lot\|ls\|lumpsum` → `LS`; `sqm\|sq.mtr` → `SQM` |
| 5 | Dimension/spec extraction into `spec_attrs` JSONB, tokens removed from residual | `600x600` → `{"size_mm":[600,600]}`; `15mm` → `{"thickness_mm":15}`; `2.5 sqmm` → `{"csa_sqmm":2.5}`; `4 core`, `40w`, `1.5 ton`, `ip65` |
| 6 | Brand token separation against a curated brand list (Jaquar, Havells, Legrand, Anchor, Asian Paints, Armstrong, Saint-Gobain, …) → `brand` column | residual loses the brand |
| 7 | Number-word and qty-prefix strip (`2 x `, `set of 4`) into `pack_size` | |
| 8 | Stopword strip (`supply`, `providing`, `and`, `fixing`, `of`, `at site`, `as per`, `including`) → `desc_norm` | verbs of installation are noise across every category |

Expected unaided resolution: **~55–70 % of lines** collapsing into exact `(desc_norm, uom_norm, spec_attrs)` hash groups. This is an estimate, not an observed figure — the true number is **TBD until the backfill runs**. The basis for optimism is that the header-level corpus already shows heavy repetition (1,024 Housekeeping POs, 252 Beverages, 243 Water Supply, 154 Stationary are recurring consumable spend where the same description is re-keyed monthly). The pessimistic tail is Civil / Modular Furniture / HVAC, where each line is a bespoke sentence.

### 3.2 Clustering

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- NOT currently installed
CREATE EXTENSION IF NOT EXISTS unaccent;   -- NOT currently installed

CREATE INDEX idx_poli_desc_norm_trgm
  ON public.po_line_items USING GIN (desc_norm gin_trgm_ops);
CREATE INDEX idx_poli_block
  ON public.po_line_items (organization_id, category_norm, uom_norm);
```

**Pass 1 — exact.** `GROUP BY md5(desc_norm || '|' || uom_norm || '|' || spec_attrs::text)`. O(N), single sequential scan. Every group ≥1 becomes a candidate canon.

**Pass 2 — trigram, blocked.** Blocking key = `(organization_id, category_norm, uom_norm)`. Comparisons only inside a block. Threshold **0.55 auto-merge / 0.35–0.55 review band / <0.35 distinct**. Justification: `desc_norm` at this stage has already had dimensions, brand and stopwords stripped, so what remains is a short material descriptor where trigram overlap is genuinely semantic. A lower threshold (the pg_trgm default 0.3) merges `mineral fibre ceiling tile` with `gypsum ceiling tile` — same block, same UoM, 0.42 similarity, materially different rate. The residual risk is handled by requiring `spec_attrs` equality as a hard gate on top of the similarity score.

**Cost model.** Unblocked all-pairs is N²/2. Blocked cost is Σ bᵢ² over blocks, and the GIN index turns each probe into a candidate-set retrieval rather than a block scan, so real cost ≈ Σ bᵢ · c where c is the candidate count surviving `set_limit(0.35)`. With 54 distinct categories × ~12 canonical UoMs = up to 648 blocks, and a heavily skewed distribution (Housekeeping is the largest block by far), the dominant term is the single largest block. Illustrative arithmetic on an assumed N = 40,000: unblocked ≈ 8×10⁸ pairs; blocked with a worst-case 6,000-row block ≈ 3.6×10⁷ within that block and far less elsewhere — roughly a 20× reduction, and the GIN prune takes another order of magnitude off. Run it as a batch job, not in a request path.

### 3.3 AI tail only

Only clusters that survive both passes unresolved — singletons and review-band pairs — go to an LLM, batched 40 clusters per call, each cluster represented by up to 5 member strings + observed UoMs + observed categories. The model returns `{cluster_id, canonical_name, uom, category}` only.

**Recommendation: Groq `llama-3.3-70b-versatile` as primary.** It is already wired and proven in `app/api/procurement/catalog/bulk-upload/route.ts` (`temperature: 0.0`, `response_format: { type: 'json_object' }`, 10 s AbortController), the OpenAI-compatible surface accepts a `seed` for run-to-run reproducibility, and per-token cost is the lowest of the three at a volume that is one-time-plus-incremental. **Gemini 2.5 Flash (`@google/generative-ai`) as the second opinion** on any cluster the guard rejects twice — its `responseSchema` gives hard-typed structured output rather than free-form JSON, which is worth the extra latency on the hard tail. **`@anthropic-ai/sdk` is reserved for human-triggered adjudication** of high-value clusters (Modular Furniture at Rs 4.39 Cr / 48 POs, HVAC at Rs 3.40 Cr / 54 POs) where one bad canon distorts a large rate. No model is bit-deterministic at temperature 0; determinism comes from the guard and from caching results keyed on the cluster hash, not from the model.

**Hallucination guard** — the precedent is explicit in `app/api/procurement/catalog/bulk-upload/route.ts`, which builds `const headerSet = new Set(headers)` and accepts a mapped column only `if (mappedCol && headerSet.has(mappedCol))`, otherwise logging `Groq hallucinated column "…" — rejected`. Apply the same closed-set discipline:

1. `uom` must be a member of the 12-value canonical UoM enum → else reject.
2. `category` must be a member of the 54 observed `zoho_purchase_orders.category` values (post-trim) → else reject.
3. `canonical_name` must be composed **only of tokens present in the cluster's member strings** (plus a whitelist of joining words). Any invented token → reject.
4. Rejected clusters fall back to `mode(desc_norm)` as canonical name, `match_method = 'trigram'`, `confidence = 0.3`, and are queued for human review. They are never dropped.

```ts
// backend/lib/rateBook/canonGuard.ts
export interface CanonProposal { cluster_id: string; canonical_name: string; uom: string; category: string; }
export interface GuardResult { accepted: CanonProposal[]; rejected: Array<{ p: CanonProposal; reason: 'uom'|'category'|'token' }>; }
export function guardProposals(props: CanonProposal[], ctx: {
  allowedUoms: Set<string>; allowedCategories: Set<string>; clusterTokens: Map<string, Set<string>>;
}): GuardResult;
```

### 3.4 Human lock

```sql
CREATE TABLE public.item_canon (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_name  TEXT NOT NULL,
  uom             TEXT NOT NULL,
  category        TEXT NOT NULL,
  spec_attrs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  brand           TEXT,
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  reviewed_by     UUID REFERENCES auth.users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_item_canon_org_name_uom
  ON public.item_canon (organization_id, lower(canonical_name), uom);
CREATE INDEX idx_item_canon_spec ON public.item_canon USING GIN (spec_attrs jsonb_path_ops);

CREATE TABLE public.item_canon_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_line_item_id  UUID NOT NULL REFERENCES po_line_items(id) ON DELETE CASCADE,
  item_canon_id    UUID NOT NULL REFERENCES item_canon(id) ON DELETE RESTRICT,
  match_method     TEXT NOT NULL CHECK (match_method IN ('exact','trigram','vector','human')),
  confidence       NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  is_locked        BOOLEAN NOT NULL DEFAULT false,
  reviewed_by      UUID REFERENCES auth.users(id),
  reviewed_at      TIMESTAMPTZ,
  -- a later AI pass that disagrees writes here, never over item_canon_id
  proposed_canon_id UUID REFERENCES item_canon(id),
  proposed_at       TIMESTAMPTZ,
  proposed_method   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_icm_line ON public.item_canon_map (po_line_item_id);
CREATE INDEX idx_icm_canon ON public.item_canon_map (organization_id, item_canon_id);
CREATE INDEX idx_icm_conflicts ON public.item_canon_map (organization_id)
  WHERE proposed_canon_id IS NOT NULL;
```

Lock enforcement is **three-layered**, because any one layer alone gets bypassed eventually:

1. **Trigger (authoritative).** `BEFORE UPDATE ON item_canon_map`: if `OLD.is_locked` and `NEW.item_canon_id IS DISTINCT FROM OLD.item_canon_id`, the trigger silently rewrites the row — `NEW.item_canon_id := OLD.item_canon_id`, `NEW.match_method := OLD.match_method`, and the incoming value lands in `proposed_canon_id/proposed_at/proposed_method` instead. Nothing errors, nothing is lost, and the disagreement becomes a review-queue item. A parallel trigger on `item_canon` blocks changes to `canonical_name/uom/category/spec_attrs` when `is_locked`.
2. **Writer clause.** The batch job uses `INSERT … ON CONFLICT (po_line_item_id) DO UPDATE SET … WHERE item_canon_map.is_locked = false`.
3. **API layer.** Setting `is_locked = true` is only possible through the service-role route `app/api/rate-book/canon/[id]/lock`, which stamps `reviewed_by = user.id` and `reviewed_at = now()` — matching the repo rule that all writes go through service-role API routes with permissions enforced in TypeScript, not RLS.

RLS follows the tier-2 pattern copied verbatim from `supabase/migrations/20260801000001_po_workflow_state.sql:58-71`: SELECT-only, `EXISTS` over both `organization_memberships` and `property_memberships` with `is_active AND role::text IN ('org_super_admin','org_admin','master_admin','purchase_manager','purchase_executive','procurement','accounts')`.

### 3.5 The rate book

Grain: `(item_canon_id, site_id, vendor_key, quarter)`. `site_id` comes from the §2 site canon — `zoho_purchase_orders.property_id` is **NEVER POPULATED**, so `project_name` (31 free-text values) is the only site signal and must be resolved first. `vendor_key` is `COALESCE(NULLIF(vendor_id,''), vendor_name)` because `vendor_id` is a TEXT Zoho contact id absent on manual/CSV rows, while `vendor_name` has 762 distinct values.

Status filter: include `approved, open, billed, partially_billed` = 2,998 + 786 + 434 + 12 = **4,230 of 5,265 POs**. Exclude `draft` (856), `cancelled` (107), `pending_approval` (71), `rejected` (1) — those are not evidence of a price anyone agreed to pay.

```sql
CREATE MATERIALIZED VIEW public.item_rate_book AS
WITH base AS (
  SELECT
    li.organization_id,
    icm.item_canon_id,
    COALESCE(scm.site_id, '00000000-0000-0000-0000-000000000000'::uuid) AS site_id,
    COALESCE(NULLIF(po.vendor_id,''), po.vendor_name)                   AS vendor_key,
    po.vendor_name,
    date_trunc('quarter', po.po_date)::date                             AS quarter,
    po.po_date,
    po.po_number,
    li.quantity,
    li.rate,
    li.line_total
  FROM public.po_line_items li
  JOIN public.item_canon_map icm ON icm.po_line_item_id = li.id
  JOIN public.zoho_purchase_orders po ON po.id = li.purchase_order_id
  LEFT JOIN public.site_canon_map scm
         ON scm.organization_id = po.organization_id
        AND scm.raw_project_name = po.project_name
  WHERE po.status IN ('approved','open','billed','partially_billed')
    AND li.rate > 0
    AND li.quantity > 0
),
fenced AS (  -- winsorize within (canon, uom-implied) across the whole window
  SELECT b.*,
         PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY b.rate)
           OVER (PARTITION BY b.organization_id, b.item_canon_id) AS p10_all,
         PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY b.rate)
           OVER (PARTITION BY b.organization_id, b.item_canon_id) AS p90_all
  FROM base b
),
w AS (
  SELECT f.*,
         LEAST(GREATEST(f.rate, f.p10_all), f.p90_all) AS rate_w,
         (f.rate < f.p10_all OR f.rate > f.p90_all)    AS is_outlier
  FROM fenced f
)
SELECT
  w.organization_id,
  w.item_canon_id,
  w.site_id,
  w.vendor_key,
  MIN(w.vendor_name)                                            AS vendor_name,
  w.quarter,
  COUNT(DISTINCT w.po_number)                                   AS n_pos,
  COUNT(*)                                                      AS n_lines,
  SUM(w.quantity)                                               AS total_qty,
  SUM(w.line_total)                                             AS total_value,
  COUNT(*) FILTER (WHERE w.is_outlier)                          AS n_outliers,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY w.rate_w)        AS p25_rate,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY w.rate_w)        AS p50_rate,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY w.rate_w)        AS p75_rate,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY w.rate_w)        AS p90_rate,
  AVG(w.rate_w)                                                 AS mean_rate,
  STDDEV_SAMP(w.rate_w)                                         AS stddev_rate,
  CASE WHEN AVG(w.rate_w) > 0
       THEN STDDEV_SAMP(w.rate_w) / AVG(w.rate_w) END           AS coeff_variation,
  MIN(w.rate_w)                                                 AS best_actual_rate,
  MAX(w.po_date)                                                AS last_paid_date,
  (ARRAY_AGG(w.rate ORDER BY w.po_date DESC, w.po_number DESC))[1] AS last_paid_rate
FROM w
GROUP BY w.organization_id, w.item_canon_id, w.site_id, w.vendor_key, w.quarter
WITH NO DATA;

-- REFRESH CONCURRENTLY REQUIRES a unique index covering the full grain
CREATE UNIQUE INDEX uq_item_rate_book
  ON public.item_rate_book (organization_id, item_canon_id, site_id, vendor_key, quarter);
CREATE INDEX idx_irb_canon_q ON public.item_rate_book (organization_id, item_canon_id, quarter DESC);
CREATE INDEX idx_irb_vendor  ON public.item_rate_book (organization_id, vendor_key);
```

The rollup carries the provenance of the best rate, which is the single most-used field in the UI:

```sql
CREATE MATERIALIZED VIEW public.item_rate_book_summary AS
WITH src AS (
  SELECT rb.*, sc.micro_market,
         -- time weighting: half-life 4 quarters from the latest quarter in the corpus
         POWER(0.5, EXTRACT(EPOCH FROM (MAX(rb.quarter) OVER (PARTITION BY rb.organization_id)
                                        - rb.quarter)) / (86400*91.3*4)) AS w_time
  FROM public.item_rate_book rb
  LEFT JOIN public.site_canon sc ON sc.id = rb.site_id
),
best AS (
  SELECT DISTINCT ON (organization_id, item_canon_id)
         organization_id, item_canon_id,
         best_actual_rate AS best_rate, vendor_key AS best_vendor_key,
         vendor_name AS best_vendor_name, site_id AS best_site_id, last_paid_date AS best_rate_date
  FROM src
  ORDER BY organization_id, item_canon_id, best_actual_rate ASC, last_paid_date DESC
)
SELECT
  s.organization_id, s.item_canon_id,
  NULL::uuid AS site_id, NULL::text AS micro_market,      -- org-wide grain
  'ALL'::text AS period,
  SUM(s.n_pos)                                              AS n_pos,
  COUNT(DISTINCT s.vendor_key)                              AS n_vendors,
  COUNT(DISTINCT s.site_id)                                 AS n_sites,
  SUM(s.total_qty)                                          AS total_qty,
  SUM(s.total_value)                                        AS total_value,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY s.p50_rate)  AS p25_rate,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.p50_rate)  AS p50_rate,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.p50_rate)  AS p75_rate,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY s.p50_rate)  AS p90_rate,
  SUM(s.p50_rate * s.w_time) / NULLIF(SUM(s.w_time),0)      AS time_weighted_rate,
  AVG(s.mean_rate)                                          AS mean_rate,
  STDDEV_SAMP(s.p50_rate)                                   AS stddev_rate,
  CASE WHEN AVG(s.mean_rate) > 0
       THEN STDDEV_SAMP(s.p50_rate)/AVG(s.mean_rate) END    AS coeff_variation,
  (ARRAY_AGG(s.last_paid_rate ORDER BY s.last_paid_date DESC))[1] AS last_paid_rate,
  MAX(s.last_paid_date)                                     AS last_paid_date,
  b.best_rate, b.best_vendor_key, b.best_vendor_name, b.best_site_id, b.best_rate_date,
  CASE
    WHEN SUM(s.n_pos) >= 5 AND COUNT(DISTINCT s.vendor_key) >= 2 THEN 'quotable'
    WHEN SUM(s.n_pos) >= 3                                        THEN 'indicative'
    ELSE 'thin'
  END                                                       AS evidence_tier
FROM src s
JOIN best b USING (organization_id, item_canon_id)
GROUP BY s.organization_id, s.item_canon_id,
         b.best_rate, b.best_vendor_key, b.best_vendor_name, b.best_site_id, b.best_rate_date
WITH NO DATA;

CREATE UNIQUE INDEX uq_irbs
  ON public.item_rate_book_summary (organization_id, item_canon_id, COALESCE(site_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(micro_market,''), period);
```

The site-level and micro-market-level grains are additional `UNION ALL` legs of the same shape with `site_id`/`micro_market` non-null and `period` set to `'ALL' | 'FY24' | 'FY25' | 'FY26' | 'L12M'`; the unique index above covers all legs.

**Refresh strategy.** `REFRESH MATERIALIZED VIEW CONCURRENTLY` on both, in dependency order (`item_rate_book` then `item_rate_book_summary`) — concurrent refresh is non-blocking for readers but mandates the unique indexes above and cannot be used on a `WITH NO DATA` view, so a one-off non-concurrent seed refresh is required immediately after creation. Triggers:

1. **Post-sync** — at the tail of `syncPurchaseOrdersForOrg(orgId)` in `backend/services/zohoBooksSync.ts`, after the chunked upsert, only if the sync touched ≥1 row.
2. **Cron** — the existing `0 */2 * * *` job at `app/api/cron/sync-zoho-books/route.ts` (`maxDuration 300`, Bearer `CRON_SECRET`). If refresh time approaches that ceiling, split into a dedicated `app/api/cron/refresh-rate-book` route.
3. **Post-review** — when a human locks a canon or remaps lines via `app/api/rate-book/canon/[id]/lock`, enqueue a debounced refresh (60 s) rather than refreshing per click.

A `rate_book_refresh_log(organization_id, view_name, started_at, finished_at, row_count, status)` table gives the UI a defensible "rates as of" timestamp.

### 3.6 Statistical honesty

- **Minimum n.** A rate is `quotable` only at `n_pos >= 5 AND n_vendors >= 2`. `indicative` at `n_pos >= 3`. Everything else is `thin`. Two vendors is the hard part: with 762 vendor names against 5,265 POs, many canon items will be single-source, and a single-source median is a vendor's price list, not a market rate.
- **Outliers: winsorize, not IQR-fence.** Winsorizing at p10/p90 within `(organization_id, item_canon_id)` is chosen because trimming destroys `n` exactly where `n` is already scarce — an IQR fence on a 5-observation cluster can delete 2 of 5 and leave a "median" that is one PO. Winsorizing preserves every row, so `n_pos`, `total_qty` and `total_value` still reconcile against the Rs 60.55 Cr corpus total, while the percentile statistics stop being dragged by a fat-finger rate. The raw `rate` is retained and `is_outlier` is exposed so a reviewer can see what was pulled in.
- **Time weighting.** The window is Apr-2023 → Jul-2026 = 14 quarters (2023 Q2 … 2026 Q3). `time_weighted_rate` uses exponential decay with a 4-quarter half-life (`POWER(0.5, quarters_ago/4)`), which keeps a 2023 observation contributing ~1/8 weight in 2026 rather than dropping it. Do **not** apply an external WPI/CPI deflator — chain a self-derived per-category index off the quarterly medians where `n_pos >= 5` per quarter, and fall back to flat (no deflation) where it is thinner, flagging the item `no_index`. An imported inflation series applied to a 5-observation cluster manufactures precision that is not there.
- **UI treatment of thin evidence.** Never hide a thin rate — hiding it is what drives buyers back to the Excel. Render it with the number visible, a muted/hatched treatment, the literal `n_pos` / `n_vendors` / `last_paid_date` inline, and a "based on N POs from M vendors, last paid <date>" tooltip. `coeff_variation > 0.35` gets a divergence badge regardless of tier. `n_vendors = 1` gets an explicit "single source" chip, which doubles as the sourcing signal in §3.7.

### 3.7 What this unlocks

1. **Same item across vendors** — `SELECT vendor_name, p50_rate, n_pos, last_paid_date FROM item_rate_book WHERE item_canon_id = $1 ORDER BY p50_rate` — the core negotiation screen.
2. **Price drift** — quarter-over-quarter `p50_rate` per canon, `LAG()` for % change, surfaced as a sparkline across the 14-quarter window; catches silent escalation in the Rs 9.27 Cr Housekeeping book.
3. **Vendor concentration / single-source risk** — per canon: `n_vendors`, HHI over `SUM(total_value)` by `vendor_key`, and `MAX(vendor_share)`. Any canon with `n_vendors = 1` and `total_value` above a threshold is a sourcing action.
4. **Site-vs-site variance** — same canon, `site_id` grain, `p50_rate` spread. Directly answers why SS Plaza (975 POs / Rs 23.21 Cr) pays differently from ETPL-Thane (381 / Rs 6.76 Cr).
5. **Savings-if-best-actual** — `SUM(total_qty * (p50_rate - best_actual_rate))` per canon, per site, per category, restricted to `evidence_tier = 'quotable'`. This is the headline number, and restricting it to quotable is what keeps it credible.
6. **Feeds the calculator** — quotable per-sqft rates replace the hardcoded `detailedOpex` at `Commercial Calculator /Gemini Commercial Calculator.tsx:160-163` (electricity 312000, housekeeping 247000, security 102000, internet 50000, pantry 105750, maintenance 54499, adminMisc 95000) and the `capexPerSqft "1800"` default, using the OPEX bucket mapping already validated in §1.

### Risks

- **Blocking key inherits dirty categories.** `category` has trailing-space variants (`"Housekeeping "`, `"Civil "`, `"Lights "`) and near-duplicates (`Gypsum` vs `Gypsum Ceiling`; `Electrical` vs `Electricity`). If `category_norm` does not merge these, the same item lands in two blocks and never gets compared. Category normalization must be a curated mapping table, reviewed by a human, not a `trim()`.
- **21.5 % of POs (1,134 / Rs 7.98 Cr) have no `cf_category`/`cf_site` at all** — these lines block to `(NULL, uom)`, a single enormous bucket that both degrades trigram precision and produces `site_id = '00000000-…'` rows that pollute site-level comparisons. Consider excluding untagged lines from site-grain rollups entirely while keeping them in the org-grain.
- **Winsorizing hides a real signal.** A genuinely renegotiated 40 %-cheaper rate looks identical to a fat finger at p10. Mitigation: the `n_outliers` column and an outlier drill-down; never delete the raw row.
- **`REFRESH CONCURRENTLY` cost grows with the corpus** and shares the 300 s `maxDuration` with the Zoho sync. Instrument `rate_book_refresh_log` from day one; migrate to a dedicated cron route before it bites.
- **The AI tail becomes the whole job** if normalization underperforms. If exact+trigram resolves well under the estimated 55–70 %, LLM cost and human review load scale linearly with the corpus. Measure the split on the first backfill batch before committing to a rollout schedule.
- **`item_canon_map` unique on `po_line_item_id` assumes one canon per line.** Composite lines ("supply and install false ceiling incl. framing") genuinely represent two items; the schema cannot express that. Accept it — flag such lines `is_composite` and exclude them from the rate book rather than mis-attributing their rate.
- **`ON DELETE RESTRICT` on `item_canon_id`** means a canon cannot be deleted while mapped. That is intentional, but the merge-two-canons flow must therefore remap before deleting, in one transaction, through the API route.
---

## 4. Semantic Item Matching (scoped pgvector)

### 4.0 Framing: why "chunks of summary in a vector DB" is the wrong build

The proposal to keep summary chunks retrievable in a vector store, then let an LLM read them and answer, must be rejected for this product. Reasons, in order of severity:

1. **An LLM reading a retrieved chunk produces confident wrong arithmetic.** Give a model the text "SS Plaza — 975 POs, Rs 23.21 Cr" and ask for an average line rate, and it will emit a number. That number carries no audit trail and no filter semantics. In a commercial quote sent to a client, a wrong rate is materially worse than no tool: the tool is trusted, so nobody re-checks it.
2. **Retrieval is silently partial.** Top-k over chunks has no concept of completeness. The 1,134 untagged POs (21.5%, Rs 7.98 Cr) and the 856 `draft` + 107 `cancelled` POs either leak into a rate or vanish from it depending on which chunks happened to be retrieved. SQL says `WHERE status IN ('approved','billed','partially_billed','open')`; a chunk says nothing.
3. **Non-determinism kills defensibility.** A quote must be reproducible line-by-line six months later. `SELECT ... WHERE` re-runs identically. "The retriever surfaced chunk 4172" does not.
4. **Staleness.** The Zoho sync runs `0 */2 * * *` (`vercel.json`, `app/api/cron/sync-zoho-books/route.ts`). Every summary chunk becomes a lie two hours after it is written unless it is rebuilt on every sync — cost and complexity for a worse answer.

**Rule for the whole system: every rupee figure in a quote comes from SQL against the §3 rate book (`po_line_items` → `item_canon` → `item_canon_map` → the rate aggregate view). pgvector never touches a number.** pgvector has exactly one job:

> Given an unseen free-text BOQ / requirement line ("supply & fix 600x600 mineral fibre ceiling tile"), return the `item_canon.id` it refers to — an identifier, plus a confidence. Nothing else.

### 4.1 (a) Scope and size

Embed **only** `item_canon` rows: one vector per canonical item, org-scoped. Do **not** embed raw PO line descriptions (the §3 backfill of all 5,265 POs via `GET /books/v3/purchaseorders/{id}` will produce tens of thousands of them — line items are absent from all 5,265 `raw` payloads today), and do **not** embed PO summaries at all.

Expected canon size: a few thousand rows — TBD until the detail backfill lands; bounded by 54 distinct categories × distinct normalized descriptions. At ~3,000 rows × 768 dims × 4 bytes ≈ **9 MB** of vectors. That fits in shared buffers; the whole index is effectively free. Recall stays high because the corpus is curated and de-duplicated: each concept appears once, so there is no near-duplicate pile-up competing for the top-k slots (the failure mode you get embedding 40k raw lines, where 30 spellings of "housekeeping manpower" crowd out the correct match for an unrelated query).

### 4.2 (b) DDL

Migration file (author only — do not apply; see repo conventions):

```sql
-- supabase/migrations/<ts>_item_semantic_match.sql
CREATE EXTENSION IF NOT EXISTS vector   WITH SCHEMA extensions;  -- 0.8.0 available, NOT installed
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;  -- NOT installed; required by stage 2
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;  -- normalization

CREATE TABLE item_embedding_model (
  model_key   text PRIMARY KEY,            -- 'google:gemini-embedding-001:768:v1'
  provider    text NOT NULL CHECK (provider IN ('google','openai','voyage','cohere','local')),
  model_name  text NOT NULL,
  dim         integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_item_embedding_model_active
  ON item_embedding_model (is_active) WHERE is_active;   -- exactly one active model, ever

CREATE TABLE item_canon_embedding (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canon_id        uuid NOT NULL REFERENCES item_canon(id) ON DELETE CASCADE,
  model_key       text NOT NULL REFERENCES item_embedding_model(model_key),
  source_text     text NOT NULL,   -- EXACTLY what was sent to the embedder
  source_hash     text NOT NULL,   -- sha256(source_text); drift detector after alias write-back
  embedding       vector(768) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ice_canon_model ON item_canon_embedding (canon_id, model_key);
CREATE INDEX idx_ice_org ON item_canon_embedding (organization_id);
CREATE INDEX idx_ice_hnsw ON item_canon_embedding
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- stage 2 support (on the §3 tables)
CREATE INDEX idx_item_canon_norm_trgm  ON item_canon  USING gin (norm_name  gin_trgm_ops);
CREATE INDEX idx_item_alias_norm_trgm  ON item_alias  USING gin (norm_alias gin_trgm_ops);
```

Separate table, not a column on `item_canon`: it lets a new model be embedded **alongside** the live one and cut over atomically, and keeps the hot `item_canon` row narrow.

**HNSW over IVFFlat.** IVFFlat needs `lists ≈ rows/1000` — at ~3,000 rows that is 3 lists, which degenerates to near-brute-force with unstable recall, and it must be *rebuilt* whenever the canon grows. HNSW is build-once (seconds at this size), needs no retraining as rows are inserted, and gives ~99% recall at `m=16, ef_construction=64`. Query with `SET LOCAL hnsw.ef_search = 64`. Honest caveat: at 3,000 rows an exact `ORDER BY embedding <=> $1 LIMIT 10` sequential scan costs single-digit milliseconds anyway — the index is insurance for growth, not a necessity.

Query shape (note the org + model_key + optional category scoping, which is what keeps recall high):

```sql
SET LOCAL hnsw.ef_search = 64;
SELECT c.id, c.canonical_name, c.unit, 1 - (e.embedding <=> $1::vector) AS cosine_sim
FROM item_canon_embedding e
JOIN item_canon c ON c.id = e.canon_id
WHERE e.organization_id = $2 AND e.model_key = $3
  AND ($4::text IS NULL OR c.category = $4)
ORDER BY e.embedding <=> $1::vector
LIMIT 10;
```

RLS: `ENABLE ROW LEVEL SECURITY` with the tier-2 SELECT policy copied from `supabase/migrations/20260801000001_po_workflow_state.sql:58-71`; all writes go through service-role routes under `app/api/`.

### 4.3 (c) Embedding model choice and versioning

**`@anthropic-ai/sdk` (^0.82.0 in `package.json`) cannot do this — Anthropic serves no embeddings endpoint.** `groq-sdk` does not either. Realistic options, user picks one:

| Option | Dim | Why / why not |
|---|---|---|
| Google `gemini-embedding-001` | 768 / 1536 / 3072 (MRL-truncatable) | `@google/generative-ai` ^0.24.1 is **already wired** (`backend/services/`, gemini-2.5-flash). Zero new vendor, zero new secret. Recommended default at **768**. |
| Voyage (`voyage-3.5-lite`) | 1024 | Anthropic's recommended embeddings partner; strong retrieval quality; new vendor + key. |
| OpenAI `text-embedding-3-small` | 1536 (shortenable) | Cheapest per token, well-understood; new vendor + key. |
| Cohere `embed-v4` | 1024/1536 | Good multilingual/short-text; new vendor. |
| Self-hosted BGE-M3 / e5 in a Supabase Edge Function | 1024 | No egress, no per-token cost; you own the ops. |

**Trade-off:** dimension buys marginal recall and costs storage + index build time linearly. At a few thousand curated items the corpus is easy — 768 dims is ample; 3072 would triple storage for gains you cannot measure without a labeled set. Cost is a rounding error either way: one full rebuild is ~3,000 items × ~25 tokens ≈ **75k tokens** (estimate; exact figure TBD once canon row count is known). Re-embedding is idempotent and cheap enough to run nightly for drifted `source_hash` rows. If you pick a >2000-dim model, the column must be `halfvec(3072)` — pgvector's HNSW limit is 2000 dims for `vector`, 4000 for `halfvec`.

**Versioning is structural, not conventional.** `model_key` encodes provider + model + dim + a manual `:vN` bump. A model change means: insert a new `item_embedding_model` row, embed the whole canon into new `item_canon_embedding` rows under the new key, flip `is_active` in one transaction, then delete the old key's rows. The matcher **always** filters `WHERE model_key = (SELECT model_key FROM item_embedding_model WHERE is_active)`. Two vector spaces can coexist on disk but can never be compared, because no query ever spans two `model_key` values. If the new model's dim differs from the column, the migration fails loudly — which is the desired outcome, not a bug.

### 4.4 (d) The hybrid matcher (the actual algorithm)

Proposed implementation: `backend/lib/pricing/itemMatcher.ts` (new).

```ts
export type MatchStage = 'exact' | 'alias' | 'trigram' | 'vector' | 'llm_rerank' | 'unmatched';

export interface MatchCandidate {
  canonId: string;          // uuid -> item_canon.id
  canonicalName: string;
  category: string | null;
  unit: string | null;
  score: number;            // stage-native score, 0..1
  observations: number;     // # of rate-book line items backing this canon item
}

export interface MatchResult {
  input: string;
  normalized: string;
  stage: MatchStage;
  confidence: number;                 // 0..1, comparable ACROSS stages
  disposition: 'auto' | 'review' | 'human';
  canonId: string | null;
  runnerUp: MatchCandidate | null;    // for margin audit
  // NOTE: deliberately NO price/rate/amount field. Prices come from §3 SQL keyed on canonId.
}
```

**Stage 0 — normalize.** lowercase → `unaccent` → collapse internal whitespace → **trim** (this alone fixes the observed `"Housekeeping "`, `"Civil "`, `"Lights "` trailing-space defects) → strip trailing punctuation → strip leading quantity/unit tokens (`2 nos`, `10 sqft`) into a separate parsed field → expand abbreviations from a static dictionary (`hk`→housekeeping, `fnf`→furniture, `ff`→false ceiling? no — dictionary is curated by the user, not guessed).

**Stage 1 — exact.** Equality against `item_canon.norm_name`, then `item_alias.norm_alias`. Hit ⇒ `confidence = 1.00`, `disposition = 'auto'`, **return immediately**. No later stage may run, and no LLM may ever second-guess an exact hit. This is the single most important property of the cascade: a matched, human-confirmed alias must behave like a primary key lookup, forever. Cost: one index probe, zero API calls. In steady state (after the write-back loop of §4.6) this stage should absorb the large majority of traffic.

**Stage 2 — trigram.** `similarity(norm_name, q) >= 0.62` (or `word_similarity >= 0.70` for short queries), take the best; accept if `best - runnerUp >= 0.08`. `confidence = 0.90 + 0.09 × (best − 0.62)/0.38`, capped 0.97. Catches typos and word-order noise — exactly the class of defect already visible in the data (`"Mafatlal Chember -A wing"` vs `"Mafatlal Chambers"`, `"Sky mark - Noida"` vs `"Arcil Sky Mark - Noida"`). Deterministic, in-database, ~1 ms, zero API cost.

**Stage 3 — vector.** Only now do we embed the query (one API call) and run the top-k=10 query above, scoped to `organization_id`, the active `model_key`, and — if the requirement line carries a category hint — `c.category`. Accept if `cosine_sim >= 0.86` **and** `margin = top1 − top2 >= 0.04`. `confidence = 0.70 + 0.25 × (cosine_sim − 0.86)/0.14`, capped 0.95.

**Stage 4 — LLM re-rank (optional, top 5 only).** Runs *only* when stage 3 returned candidates but failed the threshold or the margin test. Use the already-wired `gemini-2.5-flash` via `@google/generative-ai`. Prompt is constrained: it receives the normalized query plus 5 `{canonId, canonicalName, unit, category}` tuples and must return one `canonId` or the literal `"none"`, plus a 0–1 confidence. **It is never shown a price and never asked to compute anything.** Accept at `confidence = 0.75 + 0.15 × llmConfidence` only if the LLM's pick is in the supplied set (reject hallucinated ids outright).

**Tie-break rule**, applied at any stage when the margin test fails: (1) prefer the candidate whose `category` equals the requirement line's category hint; (2) prefer higher `observations` (more rate-book line items backing it — a canon item seen 300 times is a better prior than one seen twice); (3) prefer the more recent `last_seen_at`; (4) still tied ⇒ **human**, never coin-flip.

**Confidence bands → disposition.**

| Band | Disposition | Behaviour |
|---|---|---|
| `≥ 0.92` | `auto` | Rate pulled from §3 by `canonId`; no UI interruption. |
| `0.70 – 0.92` | `review` | Rate pulled, but the quote line is flagged amber and the estimator must tick it before the quote can be issued. |
| `< 0.70` or `canonId = null` | `human` | No rate. Line lands in the mapping queue; quote cannot be issued with unresolved lines. |

Initial thresholds are engineering defaults; **calibration TBD — requires a hand-labelled set of ~300 BOQ lines against the canon, which cannot exist until the §3 line-item backfill of 5,265 POs completes.** Log every attempt to `item_match_event` (input, normalized, stage, top-5 with scores, chosen id, final human verdict) so the bands can be re-fit from real data rather than re-guessed.

**Why cascade beats vector-only:** (i) *cost* — stages 1–2 are free and in-process; a vector-only design pays an embedding API call on every single line of every BOQ, including the ones that are byte-identical to something already mapped; (ii) *determinism* — stages 1–2 give the same answer forever, which is what an auditable quote needs; (iii) *correctness* — embeddings are notoriously bad at exactly the distinctions that matter commercially (`"chair — task"` vs `"chair — visitor"` embed near-identically but sit in different rate bands, cf. Chairs Rs 1.89 Cr / 48 POs), so an exact or alias hit must short-circuit before any similarity model gets a vote.

### 4.5 (e) Write-back loop

Every human resolution in the mapping queue writes **two** rows, in one transaction, through a service-role route (`app/api/pricing/item-match/resolve/route.ts`, new):

1. `item_canon_map` — the raw line ⇒ canon mapping, with `locked = true`, `mapped_by = <user_id>`, `mapped_at = now()`, `source = 'human'`. Locked rows are immune to any future automated re-mapping; a bulk re-match job must skip `WHERE locked`.
2. `item_alias` — the *normalized input string* as a new alias of that canon item, `source = 'human_correction'`. This is what makes the matcher provably improve: the next occurrence of that exact string resolves at **stage 1** with confidence 1.00 and zero API cost. Improvement is monotonic and measurable — track stage distribution over time in `item_match_event`; the share resolved at stage 1 should climb, and the share reaching `human` should fall.

Alias additions change the `source_text` for that canon item (canonical name + unit + top aliases), so `source_hash` no longer matches. A nightly job re-embeds only drifted rows — typically a handful, so re-embedding cost tracks human correction volume, not corpus size.

### 4.6 (f) What pgvector must NOT be used for

Hard prohibitions. Any of these appearing in a PR is a blocking review comment:

- **Computing averages, medians, percentiles, or any rate.** All rate aggregation is SQL over §3's `po_line_items`, filtered by `status`, date window, and `organization_id`.
- **Answering "how much did we spend on X at site Y".** That is a `GROUP BY` against `zoho_purchase_orders` / `po_line_items` — not a retrieval problem, and top-k retrieval would silently drop rows.
- **Generating or drafting a quote.** The commercial engine is `Commercial Calculator /Gemini Commercial Calculator.tsx` and `Commercial Calculator /Claude Commercial Calculator.tsx`; it consumes structured rates, never prose.
- **Anything where a number is the output.** The matcher's return type (`MatchResult`) deliberately has no price field. Vector search returns an **id and a similarity score**; the id goes into a parameterised SQL query, and the similarity score is used only for routing (auto / review / human) — it must never enter a arithmetic expression that reaches a quote.
- **Embedding PO summaries, digests, or narrative text** for later Q&A. If a conversational interface is ever wanted, it must be text-to-SQL with the generated SQL shown to the user, not RAG over chunks.

### Risks

- **The whole section is blocked on §3.** `line_items` is absent from all 5,265 `raw` payloads; `item_canon` cannot be populated until the per-PO detail backfill (`GET /books/v3/purchaseorders/{id}`, via `backend/services/zohoService.ts`) runs. Every threshold here is uncalibrated until then.
- **Threshold overfitting.** 0.86 cosine / 0.62 trigram are defaults, not measurements. Shipping them as gospel will either flood the human queue or, worse, auto-accept wrong matches at high confidence. Mitigation: `item_match_event` logging from day one, and start with bands deliberately biased toward `review`.
- **Silent vector-space mixing** if anyone writes a query that omits `model_key`. Mitigation: expose the search only through one function in `backend/lib/pricing/itemMatcher.ts` that resolves the active key itself; never let a route hand-roll the SQL.
- **LLM re-rank hallucinating a `canonId`** not in the supplied 5. Mitigation: validate the returned id against the candidate set and treat a miss as `unmatched`, not as an error to retry.
- **Category scoping backfires** when the requirement line's category hint is wrong — the correct canon item gets filtered out and the match silently degrades. Mitigation: run the scoped query first, and if the best result is below threshold, re-run unscoped before falling through to stage 4.
- **Cross-org leakage** if `organization_id` is omitted from the vector query; the HNSW index does not enforce it. Mitigation: the filter is in the single shared query, plus RLS as defence in depth.
- **Vendor lock via dimension.** Picking a 3072-dim model forces `halfvec` and a wider column; switching later to a 768-dim model is a table migration, not a config flip. Decide the dimension once, at the point the user picks a provider.
---

## 5. Commercial Calculator — Consolidation & Live Data Wiring

### 5.1 Merge decision

`Commercial Calculator /Gemini Commercial Calculator.tsx` (715 lines) is the base. `Commercial Calculator /Claude Commercial Calculator.tsx` (540 lines) contributes four things and is then retired.

| Feature | Gemini | Claude | Decision | Why |
|---|---|---|---|---|
| Debt EMI on capex @ `STANDARD_ROI` 12% (L216-225) | ✅ | ❌ | **Keep Gemini** | Only model that splits `debtAmount = totalCapex − readyFunds` from equity |
| Equity straight-line amortization | ✅ | ❌ | Keep Gemini | Interest-free own-funds recovery; Claude has no funding concept |
| Deposit opportunity cost on `netDepositLocked` (L241-242) | ✅ | ❌ | Keep Gemini | Real carry cost of landlord-minus-client deposit |
| Brokerage amortized over lock-in (L228-229) | ✅ | ❌ | Keep Gemini | — |
| NPV / TCV / payback / yield-on-cost / break-even occupancy / cash-on-cash (L273-300) | ✅ | ❌ | Keep Gemini | Claude stops at a per-seat sticker price |
| Pricing modes Margin ↔ Target (L252-261) | ✅ | ❌ | Keep Gemini | Regressive solve is required by section 6 |
| `seatsMode` Known\|Auto via `targetDensity` (L196-198) | ✅ | ❌ | Keep Gemini | — |
| Escalation: rent, opex, rent-free periods | ✅ | ❌ | Keep Gemini | — |
| Detailed vs blended opex toggle | ✅ | ❌ | Keep Gemini, rewire to live data | §5.3 |
| **Shell ladder** bareShell 2700 / warmShell 2100 / furnished 500 Rs/sq.ft (L31-35) | ❌ | ✅ | **Adopt** as rate-book seed | Replaces hardcoded `capexPerSqft "1800"` with a defensible ladder |
| **16%-compounded lock-in capex amortization** (L37-68) | ❌ | ✅ | **Adopt as second selectable mode** | See below |
| BUA derivation `markup` \| `efficiency` \| `direct` | derives efficiency from two areas | derives BUA from carpet | **Merge**: keep both areas as truth, add Claude's three derivation modes as input helpers | Deals arrive quoted either way |
| CAM as a distinct line (`camRate`) | folded into opex | ✅ separate | **Adopt Claude's split** | CAM is landlord-billed, escalates on the lease clock, not the opex clock |
| Parking / cafeteria fixed adders | ❌ | ✅ | Adopt as optional `otherFixedMonthly[]` | — |
| Recharts dependency | none (hand-rolled SVG) | Recharts | **Keep Gemini's SVG** | Recharts is not in `package.json` |

**The two capex models are not interchangeable — ship both, default to Gemini.** Gemini charges 12% on a *declining* balance and produces a level `capexEMI`. Claude multiplies year *N*'s entire slice by `1.16^(N-1)`, so on a 60-month lock-in year 5 costs `1.16⁴ ≈ 1.81×` year 1 — that is an escalation ladder for a client-facing quote, not an amortization of a lender's schedule, and it is monotonically increasing where an EMI is flat. Expose as `capexRecoveryModel: 'emi_reducing' | 'compounded_escalation'`. **Critical**: Gemini's NPV loop (L288-300) subtracts a constant `capexEMI` every month. The compounded mode must therefore emit `capexScheduleMonthly: number[]` and the loop must read `capexScheduleMonthly[m-1]`, otherwise escalation is silently applied twice (once in the ladder, once via `annualEscalation`) and NPV is wrong.

### 5.2 Extract the engine

The math currently lives in `useEffect` (L181-310) and is unreachable from anything else. Move it verbatim-then-refactor into a pure module — no React, no Supabase import, no `Date.now()`:

`frontend/lib/commercial/engine.ts`
```ts
export type ShellType = 'bareShell' | 'warmShell' | 'furnished';
export type SourceKind = 'derived' | 'rate_book' | 'micro_market' | 'manual' | 'default';

export interface Provenance {
  source: SourceKind; n: number; monthsCovered: number;
  periodStart: string | null; periodEnd: string | null;   // ISO
  p25: number | null; p50: number | null; p75: number | null;
  siteId: string | null; confidence: 'high' | 'medium' | 'low';
  overriddenBy?: string; overriddenAt?: string; overrideReason?: string;
}
export type Sourced<T = number> = { value: T; provenance: Provenance };

export interface OpexBuckets {                    // Rs/month, absolute
  electricity: number; housekeeping: number; security: number;
  internet: number; pantry: number; maintenance: number; adminMisc: number;
}

export interface CommercialInputs {
  termMonths: number; lockInMonths: number;
  annualEscalation: number; opexEscalation: number; wacc: number;
  builtUpArea: number; carpetArea: number;
  buaMode: 'direct' | 'markup' | 'efficiency'; buaMarkupPct?: number; efficiencyPct?: number;
  rentPerSqft: number; camPerSqft: number; makeGoodSqft: number;
  rentFreeLandlord: number; rentFreeClient: number;
  shellType: ShellType; capexPerSqft: number; capexTenure: number; readyFunds: number;
  capexRecoveryModel: 'emi_reducing' | 'compounded_escalation';
  capexInterestRate: number;          // 12 for EMI, 16 for compounded
  useDetailedOpex: boolean; opexPerSqft: number; detailedOpex: OpexBuckets;
  otherFixedMonthly: { label: string; amount: number }[];
  depositType: 'Mos' | 'Abs';
  landlordDepositMonths: number; clientDepositMonths: number;
  landlordDepositValue: number; clientDepositValue: number;
  brokerageMonths: number;
  seatsMode: 'Known' | 'Auto'; seats: number; targetDensity: number;
  pricingMode: 'Margin' | 'Target'; marginPercent: number; targetSellingPrice: number;
  standardRoi: number; standardSalvage: number;   // were constants 12.0 / 10.0
}

export interface CommercialResults {
  actualMonthlyRent: number; totalRent: number; totalCam: number;
  totalCapex: number; debtAmount: number; capexEMI: number;
  capexScheduleMonthly: number[];
  brokerageAmortization: number; monthlyDepositOpportunityCost: number;
  totalOpex: number; derivedOpexPerSqft: number; totalCost: number;
  marginAmount: number; marginPercent: number; sellingPrice: number;
  baseCostPerSeat: number; perSeatCost: number; serviceFeePerSeat: number;
  finalSeats: number; efficiency: number; seatDensity: number;
  totalLandlordDeposit: number; totalClientDeposit: number; initialCashflow: number;
  netFreeCashFlow: number; tcv: number; npv: number;
  capexPaybackMonths: number; yieldOnCost: number; cashOnCash: number;
  breakEvenOccupancy: number; salvageAmount: number; totalMakeGood: number;
  monthlySeries: { month: number; revenue: number; rent: number; opex: number;
                   capex: number; cashflow: number; discounted: number }[];
  warnings: string[];                              // e.g. 'opex derived from 3 months only'
  engineVersion: string;
}

export function computeCommercial(i: CommercialInputs): CommercialResults;
export const DEFAULT_INPUTS: CommercialInputs;
export const ENGINE_VERSION = '1.0.0';
```
All numbers, never strings — string coercion stays in the UI layer (`frontend/lib/commercial/parse.ts`). `monthlySeries` is emitted so the UI charts, section 6's scenario grid, and API responses read the *same* array rather than three re-implementations. Unit tests at `frontend/lib/commercial/__tests__/engine.test.ts` pin the current Gemini outputs as golden values before any refactor.

### 5.3 Kill the hardcodes

**(a) `detailedOpex` (L160-163) → derived Rs/sq.ft/month per site.** The seven buckets map exactly onto the validated category mapping. Trailing window: **12 complete calendar months** (2025-08-01 → 2026-07-31), because electricity has a full summer/monsoon/winter cycle and anything shorter biases the single largest opex bucket (Electricity, Rs 6.58 Cr / 227 POs). Status filter keeps `approved, open, billed, partially_billed` (2,998 + 786 + 434 + 12 = 4,230 of 5,265) and drops `draft` (856), `cancelled` (107), `pending_approval` (71), `rejected` (1).

```sql
WITH win AS (
  SELECT date_trunc('month', DATE '2026-08-01') - INTERVAL '12 months' AS s,
         date_trunc('month', DATE '2026-08-01')                        AS e
), tagged AS (
  SELECT po.organization_id,
         lower(btrim(po.project_name)) AS site_key,   -- fixes 'Radical Mind - Bangalore '
         lower(btrim(po.category))     AS cat,        -- fixes 'Housekeeping ', 'Civil '
         po.po_amount, date_trunc('month', po.po_date) AS po_month
  FROM public.zoho_purchase_orders po, win
  WHERE po.organization_id = $1
    AND po.po_date >= win.s AND po.po_date < win.e
    AND po.status IN ('approved','open','billed','partially_billed')
    AND btrim(coalesce(po.project_name,'')) <> ''     -- excludes the 1,134 blank-site POs
), b AS (
  SELECT t.*, m.bucket, s.id AS site_id, s.carpet_sqft
  FROM tagged t
  JOIN public.commercial_opex_bucket_map m
    ON m.category_norm = t.cat AND m.recurrence = 'recurring'
  JOIN public.commercial_site_alias a
    ON a.organization_id = t.organization_id AND a.alias_key = t.site_key
  JOIN public.commercial_sites s ON s.id = a.site_id
)
SELECT site_id, bucket,
       count(*) AS n_pos,
       count(DISTINCT po_month) AS months_covered,
       sum(po_amount) AS total_amount,
       sum(po_amount) / NULLIF(count(DISTINCT po_month),0)
                      / NULLIF(max(carpet_sqft),0) AS rs_per_sqft_month,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY po_amount) AS p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY po_amount) AS p50,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY po_amount) AS p75,
       min(po_month) AS period_start, max(po_month) AS period_end
FROM b GROUP BY site_id, bucket;
```

Denominator is `count(DISTINCT po_month)`, **not** a hardcoded 12 — a site live for 5 months must not be divided by 12. If `months_covered < 6`, widen to 24 months and stamp `confidence: 'low'`. Materialize into `commercial_opex_benchmark` refreshed at the tail of the existing 2-hourly job (`app/api/cron/sync-zoho-books/route.ts`).

**Why this ships first**: Housekeeping, Electricity, Security and Internet are *service* POs — one vendor, one monthly amount, header-level `po_amount` is the whole truth. The missing `line_items` (absent on all 5,265 `raw` payloads) blocks material-level capex analysis but does **not** block opex/sq.ft. No `po_line_items` table is needed for §5.

**(b) `capexPerSqft "1800"` → `commercial_capex_rate_book`** keyed `(organization_id, micro_market_id, shell_type, effective_from)`, seeded from Claude's ladder (2700 / 2100 / 500) and reconciled against actual capex POs per site (1,655 POs / Rs 31.58 Cr) once `carpet_sqft` lands.

**(c) `rentPerSqft "50"` / `camRate` → `micro_markets`** from §1, returning p25/p50/p75 asking rent and CAM for the deal's micro-market.

**Provenance display.** Every auto-filled input renders a chip under the field: `n=227 · Aug-25→Jul-26 · p25 12.4 / p50 18.9 / p75 26.1 Rs/sq.ft · 11 mo`, colour-coded by `confidence`. A lock toggle flips `source` to `'manual'` and opens a required free-text reason; `{ overriddenBy, overriddenAt, overrideReason }` are persisted on the deal, and any deal with ≥1 override renders an "Assumptions overridden" banner on the PDF/share view. Defaults are served by `GET /api/commercial/defaults?org_id=&site_id=&micro_market_id=` returning `Record<keyof CommercialInputs, Sourced>`.

### 5.4 Seasonality & normalization traps

Three independent defences so one Rs 50 L Civil PO cannot poison a monthly figure:

1. **Whitelist, not blacklist.** `commercial_opex_bucket_map` carries `recurrence ∈ ('recurring','one_off','capex')` and the rollup joins `recurrence = 'recurring'` only. Civil (Rs 5.14 Cr / 104), Electrical, HVAC, Modular Furniture, Flooring, Carpentry, Glass Work, Gypsum, Metal Ceiling, Paint, UPS, CCTV, ACS, Fire Fighting, Partitions and Doors are classified `capex` and are structurally unreachable by the opex query. Unmapped categories fall into a review queue and are excluded until classified — they never silently default to `recurring`.
2. **Month-normalised denominator + full-cycle window.** 12 complete months spans the electricity peak; dividing by `count(DISTINCT po_month)` prevents a partial year inflating the mean. Store both `rs_per_sqft_month` (mean) and `p50` so the UI can show seasonal spread, and expose a per-bucket `seasonalityIndex[12]` for Electricity so §6 scenarios can stress a summer month.
3. **Outlier guard within recurring buckets.** A recurring-bucket PO above `p75 + 3×IQR` for that (site, bucket) is flagged `is_outlier` and excluded from the mean but shown in the provenance popover with a one-click "include". This catches an annual AMC lump booked inside `Maintenance and service`. Buckets whose spread exceeds a threshold (`p75/p25 > 4`) are surfaced with a "high variance" warning rather than a single confident number.

### 5.5 Placement

- **Route**: `app/(dashboard)/[orgId]/accounts/commercial-calculator/page.tsx` — inherits `app/(dashboard)/[orgId]/accounts/layout.tsx`, which renders `frontend/components/layout/AccountsWorkspace.tsx`. Add a third entry to that component's `links` array (`Calculator` icon), gated on the new capability. Saved-deal detail at `.../commercial-calculator/[dealId]/page.tsx`.
- **Component tree**: `frontend/components/commercial/CommercialCalculator.tsx` (client shell, owns string state + debounce) → `DealHeader`, `InputsPanel` (`AreaInputs`, `LeaseInputs`, `CapexInputs` with the shell-ladder selector and the two-mode toggle, `OpexPanel` with per-bucket `<SourcedField>` provenance chips, `DealStructureInputs`), `ResultsPanel` (`KpiGrid`, `DonutChart`, `TCVAreaChart` lifted from the Gemini file), `ScenarioBar` (§6 entry point). Reuse `frontend/components/ui/NumberInputWheelGuard.tsx` on every numeric input.
- **Role gating**: new `backend/lib/commercial/access.ts` wrapping `resolveAccountsAccess` / `readOrgId` from `backend/lib/accounts/access.ts` — view = `VIEW_ROLES`, save/edit = `canAlign`, approve-and-lock a deal = `canComplete || isAdmin`. All writes via service-role routes: `app/api/commercial/defaults/route.ts`, `app/api/commercial/deals/route.ts`, `app/api/commercial/deals/[id]/route.ts`. RLS SELECT on every new table copies `supabase/migrations/20260801000001_po_workflow_state.sql:58-71` verbatim.
- **Persistence**: `commercial_deals(id uuid pk, organization_id uuid not null references organizations(id) on delete cascade, site_id uuid, micro_market_id uuid, deal_name text, client_name text, status text check (status in ('draft','shared','won','lost')), inputs jsonb not null, results_snapshot jsonb not null, provenance jsonb not null, engine_version text not null, created_by uuid, created_at, updated_at)`. `results_snapshot` + `engine_version` are frozen at save so a quote sent to a client never silently changes when the engine or the opex benchmark moves; a "recompute with today's data" action writes a new row and links via `superseded_by`. Migration files authored under `supabase/migrations/` only — **not applied**.

### Risks

- **`carpet_sqft` is the load-bearing unknown.** `public.properties` (13 rows) has no carpet/BUA/seats, `capacity` is populated on 2 rows and looks like sq.ft, and `properties.name` does not match `zoho_purchase_orders.project_name`. Every Rs/sq.ft figure is TBD until the MIS Excel lands. Ship the engine with `source: 'default'` values and a blocking banner rather than fake precision.
- **Site identity is free text.** 31 distinct `project_name` values with real near-duplicates (`Sky mark - Noida` vs `Arcil Sky Mark - Noida`; `Mafatlal Chember -A wing` vs `B wing - Mafatlal Chambers` vs `Mafatlal WS`). Without a curated `commercial_site_alias` table, per-site opex splits across two keys and both come out ~50% low. `pg_trgm` is not installed, so fuzzy matching needs either the extension or a human mapping step.
- **1,134 POs (21.5%, Rs 7.98 Cr) have blank site and no `cf_*` tags** and are excluded outright. Portfolio-level benchmarks are understated by up to that share; state the exclusion on every provenance chip.
- **Thin buckets.** Internet is 69 POs and Security 72 across 31 sites over 3+ years — after a 12-month window and a per-site split, several sites will have `n < 3`. Fall back to a micro-market or portfolio median, and never present a single-PO derivation as a benchmark.
- **`furnished: 500` semantics unconfirmed** — it is 5.4× below bareShell, implying a top-up on a landlord-completed fit-out rather than a full one. Confirm with the business before it becomes the rate-book seed; a wrong reading here mis-prices every furnished deal.
- **Dual capex modes invite mis-comparison.** Two deals saved under different `capexRecoveryModel` values are not comparable; the §6 scenario grid must pin the model per comparison set and label it on every export.
- **PO date ≠ consumption date.** `po_date` runs to Jul-2026 but a PO is raised before the service month, so trailing-window edges are approximate. `delivery_date` exists but its fill rate is unverified — validate before switching the window key.
---

## 6. Scenario Generator — text brief to 3-4 priced commercials

This is the reason the Commercial Calculator and the FMS PO ledger must be one system. A calculator alone produces an opinion; a calculator wired to 5,265 real POs worth Rs 60.55 Cr produces evidence. The generator takes a free-text brief and emits 3-4 fully priced commercial variations whose every line traces back to a purchase order the company actually paid.

### 6.1 Stage 1 — Brief parsing (extract-only, never invent)

**Contract:** the LLM is an extractor, not an estimator. Any field not literally present in the text returns `null`, is filled from a visible default, and is rendered in the UI with a "defaulted" chip the user can click to change. Ambiguous units are flagged, never resolved silently.

```ts
// frontend/lib/scenario/briefSchema.ts
export type Confidence = 'explicit' | 'inferred_unit' | 'defaulted' | 'ambiguous';
export interface Field<T> {
  value: T | null;
  raw: string | null;          // verbatim source span, for highlight-on-hover
  confidence: Confidence;
  note: string | null;         // "'18,000 sq.ft' — carpet vs BUA not stated"
}
export interface ParsedBrief {
  client_name: Field<string>;
  micro_market: Field<string>;          // "Whitefield, Bangalore"
  city: Field<string>;
  carpet_area_sqft: Field<number>;
  built_up_area_sqft: Field<number>;
  area_basis_stated: Field<'carpet' | 'bua' | 'unspecified'>;
  seats: Field<number>;
  target_density_sqft_per_seat: Field<number>;
  shell_type: Field<'bare_shell' | 'warm_shell' | 'furnished'>;
  spec_tier: Field<'grade_a' | 'grade_b' | 'premium'>;
  term_months: Field<number>;
  lock_in_months: Field<number>;
  rent_per_sqft: Field<number>;
  annual_escalation_pct: Field<number>;
  client_budget_per_seat: Field<number>;
  deposit_months_landlord: Field<number>;
  deposit_months_client: Field<number>;
  fitout_period_months: Field<number>;
  handover_date: Field<string>;         // ISO
  special_scope: Field<string[]>;       // "cafeteria", "server room", "auditorium"
  ambiguities: Array<{ field: string; raw: string; options: string[] }>;
}
```

**The call.** `@anthropic-ai/sdk` (already in `package.json`) with tool-use forced to a single `emit_brief` tool whose `input_schema` is the JSON Schema mirror of `ParsedBrief`; `tool_choice: { type: 'tool', name: 'emit_brief' }`, `temperature: 0`. Gemini 2.5 Flash via `@google/generative-ai` is the fallback with `responseMimeType: 'application/json'` + `responseSchema`. Route: `app/api/scenarios/parse-brief/route.ts` (service role, permissions in TS per repo convention).

**Validation layer** — `backend/lib/scenario/validateBrief.ts`, runs after the model, deterministic, and the model's output never bypasses it:
1. **Span check.** Every `Field` with `confidence: 'explicit'` must have `raw` that appears as a substring of the brief (case/whitespace-normalised). Fail it to `ambiguous` otherwise. This is the anti-hallucination gate.
2. **Numeric sanity.** `carpet_area_sqft` 500–500,000; `seats` 1–10,000; derived density `carpet/seats` outside 30–120 sq.ft/seat raises a warning, not a rewrite. `lock_in_months <= term_months`.
3. **Unit ambiguity.** A bare area with no "carpet"/"chargeable"/"BUA" qualifier → `area_basis_stated: 'unspecified'`, `ambiguities` entry with options `['carpet','bua']`, and the run **blocks** until the user picks. Same for "18k" vs "18,000", lakh/crore, and `sq.m` vs `sq.ft`.
4. **Defaults table.** Unstated fields fill from `scenario_defaults` (org-scoped, editable): density 45 sq.ft/seat (matches `seatsMode: 'Auto'` in `Commercial Calculator /Gemini Commercial Calculator.tsx`), WACC 12% (`STANDARD_ROI`), escalation 5%, brokerage 1 month, salvage 10%. Every default is shown with its source label.

The parsed brief is stored verbatim alongside the model output so a re-parse can be diffed.

### 6.2 Stage 2 — BOQ skeleton derived from real fit-outs

Not a hand-typed template. For each site classified as a **completed fit-out**, capex POs are normalised to Rs per carpet sq.ft by category, producing a category-weight profile:

```
weight[cat] = Σ po_amount(cat, site) / carpet_area(site)     -- Rs/sq.ft
share[cat]  = Σ po_amount(cat, site) / Σ po_amount(capex, site)
```

Aggregated across sites as a **median of per-site Rs/sq.ft** (not a pooled mean — one Rs 23 Cr site would otherwise dictate the template).

**Evidence available (real):** SS Plaza 975 POs / Rs 23.21 Cr and ETPL- Thane 381 / Rs 6.76 Cr are the two substantial fit-outs; NRK Star - Indore 341 / Rs 5.01 Cr, 7th Floor - Sigma IT Park 301 / Rs 4.15 Cr and 2nd Floor - Sigma IT Park 296 / Rs 2.54 Cr add three more. That is **five usable sites, not hundreds** — and denominators (carpet area per site) do not exist yet: `properties` has 13 rows with no carpet area, no shell type, and names that do not match `zoho_purchase_orders.project_name`. The template cannot be built until the site MIS import (§ site-master) lands.

**Minimum-evidence rule**, enforced per template line:
- `n_pos >= 5` AND `n_sites >= 2` AND `total_value >= Rs 2,00,000` → `evidence_grade = 'site_derived'`, rate = site-median Rs/sq.ft.
- Fails site test but `n_pos >= 5` org-wide in that category → `'category_median'`, rate = org-wide median unit rate, flagged amber.
- Fails both → `'operator_template'`, rate hand-entered by the operator, flagged red, and **excluded from the "backed by N POs" headline count**. A scenario whose capex is >30% red lines shows a banner: *"Thin evidence — N of M lines are operator estimates."*

Seed fallback for `shell_type` totals uses the `finishingRates` ladder already in `Commercial Calculator /Claude Commercial Calculator.tsx:31-35` — bare shell 2700, warm shell 2100, furnished 500 Rs/sq.ft — as a top-down reasonableness check against the bottom-up BOQ sum. A >25% divergence blocks publish pending review.

```sql
CREATE TABLE public.boq_template (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  shell_type         TEXT NOT NULL CHECK (shell_type IN ('bare_shell','warm_shell','furnished')),
  spec_tier          TEXT NOT NULL CHECK (spec_tier IN ('grade_b','grade_a','premium')),
  version            INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  derived_from_sites TEXT[] NOT NULL DEFAULT '{}',   -- project_name values used
  derivation_run_id  UUID,                            -- FK rate_book_run(id), §5
  po_window_start    DATE, po_window_end DATE,
  notes              TEXT,
  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shell_type, spec_tier, version)
);

CREATE TABLE public.boq_template_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id       UUID NOT NULL REFERENCES boq_template(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL,
  category          TEXT NOT NULL,          -- canonicalised (trailing spaces stripped)
  sub_item          TEXT,
  uom               TEXT NOT NULL DEFAULT 'sqft_carpet',
  qty_basis         TEXT NOT NULL CHECK (qty_basis IN ('per_carpet_sqft','per_seat','per_bua_sqft','lump_sum')),
  qty_factor        NUMERIC(12,4) NOT NULL,     -- 1.0 for per_carpet_sqft lines
  benchmark_rate    NUMERIC(14,2),              -- median Rs per uom
  share_of_capex    NUMERIC(6,4),               -- 0.0000-1.0000
  is_optional       BOOLEAN NOT NULL DEFAULT false,
  roi_flag          TEXT CHECK (roi_flag IN ('core','nice_to_have','low_roi')),
  substitution_group TEXT,                      -- e.g. 'ceiling', 'flooring'
  evidence_grade    TEXT NOT NULL CHECK (evidence_grade IN ('site_derived','category_median','operator_template')),
  n_pos             INTEGER NOT NULL DEFAULT 0,
  n_sites           INTEGER NOT NULL DEFAULT 0,
  total_value       NUMERIC(16,2) NOT NULL DEFAULT 0,
  UNIQUE (template_id, category, COALESCE(sub_item,''))
);

CREATE TABLE public.scenario_boq_lines (       -- working table, one row per line per scenario
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id       UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  template_line_id  UUID REFERENCES boq_template_lines(id),
  sort_order        INTEGER NOT NULL,
  category          TEXT NOT NULL,
  sub_item          TEXT,
  uom               TEXT NOT NULL,
  qty               NUMERIC(14,2) NOT NULL,
  rate              NUMERIC(14,2) NOT NULL,
  amount            NUMERIC(16,2) GENERATED ALWAYS AS (qty * rate) STORED,
  included          BOOLEAN NOT NULL DEFAULT true,
  is_pinned         BOOLEAN NOT NULL DEFAULT false,   -- user override, survives recompute
  override_reason   TEXT,
  provenance        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- LineProvenance, §6.5
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sbl_scenario ON scenario_boq_lines(scenario_id, sort_order);
```

All three tables carry the tier-2 RLS SELECT policy copied verbatim from `supabase/migrations/20260801000001_po_workflow_state.sql:58-71`; writes go through `app/api/scenarios/*` on the service role.

### 6.3 Stage 3 — The four lenses, as data not branches

One BOQ skeleton, one rate book, four pricing strategies. Lenses are **rows**, so a fifth can be added by an operator without a deploy.

| Lens | Percentile | Vendor tier | Scope rule | Substitution |
|---|---|---|---|---|
| Ultra Premium Capex | p75–p90 of own paid rates | `premium` only | all lines incl. every optional | none — spec as designed |
| Optimized / Value | p25 | any tier | drop `is_optional`, downgrade `roi_flag='nice_to_have'` | cheapest in `substitution_group` |
| Autopilot Best Fit | p50 rate, but best-actual vendor per line | best actual, any tier | full scope minus `roi_flag='low_roi'` | none |
| Client Benchmark | derived — solve for the rate multiplier that lands total at the client's stated budget | n/a | same lines as Best Fit | none; exposes the gap |

```sql
CREATE TABLE public.scenario_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,          -- 'ultra_premium' | 'optimized' | 'best_fit' | 'client_benchmark'
  label                 TEXT NOT NULL,
  sort_order            INTEGER NOT NULL,
  rate_selector         TEXT NOT NULL CHECK (rate_selector IN ('percentile','best_actual','budget_solve')),
  percentile            NUMERIC(4,3),           -- 0.250 / 0.500 / 0.750 ; null for best_actual
  percentile_ceiling    NUMERIC(4,3),           -- 0.900 for the premium band
  vendor_tier_filter    TEXT[] NOT NULL DEFAULT '{}',   -- empty = any
  scope_inclusion_rule  JSONB NOT NULL,   -- {"include_optional":false,"exclude_roi_flags":["low_roi"]}
  substitution_policy   TEXT NOT NULL DEFAULT 'none' CHECK (substitution_policy IN ('none','cheapest_in_group','downgrade_nice_to_have')),
  margin_override_pct   NUMERIC(5,2),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (organization_id, code)
);
```

**"Vendor tier" is derived, not typed by hand.** A nightly job scores every vendor in `zoho_purchase_orders` (762 distinct `vendor_name`, canonicalised) per category on: median unit rate percentile vs category, PO count, total value, site spread, and cancellation rate (107 cancelled POs org-wide). Top rate-quartile + `n_pos >= 3` → `premium`; bottom quartile + `n_pos >= 3` → `value`; else `standard`; `n_pos < 3` → `unrated` and excluded from tier filters. Stored in `vendor_profile(organization_id, vendor_key, category, tier, …)`. Operators can override a tier; the override is stamped with user + timestamp.

**"Optional line"** = `boq_template_lines.is_optional`, seeded automatically as *a category present in fewer than 50% of the reference fit-out sites* (e.g. a category appearing at SS Plaza and Sigma 7th but not ETPL- Thane or Indore), then curated by the operator. `roi_flag` is purely operator-maintained on the template — no data source claims to know ROI, and the spec must not pretend otherwise.

### 6.4 Stage 4 — Feed the engine

```
free-text brief
   │
   ├─► [parse-brief]  Claude tool-use → ParsedBrief ──► validateBrief.ts ──► defaults merge
   │                                                          │
   │                                              (blocks on `ambiguities`)
   ▼
resolve template: shell_type + spec_tier → boq_template (status='active', max version)
   │
   ▼
explode skeleton × brief quantities
   qty = qty_factor × (carpet_area | seats | bua | 1)     per qty_basis
   │
   ├──────────────┬──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼              ▼
 profile:      ultra         optimized      best_fit      client_benchmark
 apply scope_inclusion_rule → substitution_policy → rate_selector
   │              │              │              │
   ▼              ▼              ▼              ▼
 price each line against RATE BOOK (§5: per category/vendor/period percentiles
 over zoho_purchase_orders, capex 1,655 POs / Rs 31.58 Cr)
   │
   ▼
 scenario_boq_lines (rate + provenance JSONB per line)
   │
   ├─► Σ amount ÷ carpet_area  →  capexPerSqft
   └─► opex bucket rates (§5 mapping: electricity 227 POs/Rs 6.58Cr,
        housekeeping 1024/Rs 9.27Cr, security 72, internet 69,
        pantry = Beverages+Water Supply 495, maintenance = AMC+Maint+Pest 349,
        adminMisc = Stationary+Consultant+Room Rent+Parking 219)
        → detailedOpex{7 fields}  →  derivedOpexPerSqft
   │
   ▼
 COMMERCIAL ENGINE (port of `Commercial Calculator /Gemini Commercial Calculator.tsx`,
 lines 160-163 hardcoded detailedOpex REPLACED by the derived values;
 capexPerSqft "1800" and finishing ladder replaced by BOQ sum)
   inputs: carpetArea, builtUpArea, seats|targetDensity, rentPerSqft,
           termMonths, lockInMonths, escalations, deposits, brokerageMonths,
           wacc/STANDARD_ROI 12, capexTenure, marginPercent | targetSellingPrice
   │
   ▼
 4 × ScenarioResult { sellingPrice (per-seat/month), perSeatCost, tcv, npv,
                      capexPaybackMonths, breakEvenOccupancy, yieldOnCost,
                      cashOnCash, initialCashflow, totalCapex, derivedOpexPerSqft }
   │
   ▼
 side-by-side compare grid  +  PDF / XLSX export
```

The engine runs identically for all four lenses — only `totalCapex` and `detailedOpex` differ. Client Benchmark additionally runs in `pricingMode: 'Target'` with `targetSellingPrice = client_budget_per_seat`, so the output is the *implied* capex the client's budget can actually fund, and the gap versus Best Fit is the headline slide.

### 6.5 Stage 5 — Provenance: the moat

Every line carries its evidence. This is the whole product: a client can argue with an estimate; a client cannot argue with 48 purchase orders, named vendors, and dates.

```ts
// frontend/lib/scenario/provenance.ts
export interface LineProvenance {
  rate_used: number;                 // Rs per uom, as priced
  rate_selector: 'percentile' | 'best_actual' | 'budget_solve' | 'user_override';
  percentile: number | null;         // 0.5 = median
  evidence_grade: 'site_derived' | 'category_median' | 'operator_template';
  n_pos: number;                     // POs behind the distribution
  total_value_inr: number;           // Rs backing those POs
  distinct_vendors: number;
  distinct_sites: number;
  window_start: string;              // ISO date of earliest PO
  window_end: string;
  spread: { p25: number; p50: number; p75: number; p90: number; min: number; max: number };
  cv: number;                        // stddev/mean — >0.6 renders a "high variance" chip
  best_actual: {
    rate: number; vendor_name: string; vendor_key: string;
    project_name: string; po_number: string; po_date: string; po_amount: number;
  } | null;
  sample_po_ids: string[];           // up to 20 zoho_purchase_orders.id for drill-through
  caveats: string[];                 // 'untagged_pos_excluded', 'pre_2024_only', 'single_vendor'
}
```

Rendered line (illustrative shape; actual figures TBD — depends on the site-area MIS import and the §5 rate-book run):

> **Modular Furniture — workstations** · 18,000 sq.ft × Rs 244/sq.ft = **Rs 43,92,000**
> p50 of **48 POs** worth **Rs 4.39 Cr** from **9 vendors** across **6 sites**, Apr-2023 → Jul-2026. Spread p25 Rs 198 · p50 Rs 244 · p75 Rs 301 · p90 Rs 355.
> **Best actual: Rs 191/sq.ft — <Vendor>, ETPL- Thane, PO/2025/0417, 12-Mar-2025, Rs 62.4 L.**
> Evidence: site-derived · variance normal · *excludes 1,134 untagged POs (Rs 7.98 Cr)*.

Every number in that block is queryable back to rows in `zoho_purchase_orders`; clicking the PO count opens the drill-through list. The `caveats` array is mandatory and always rendered — hiding the 21.5% untagged tail would destroy the credibility the feature exists to create.

### 6.6 Persistence, versioning, comparison, override, export

```sql
CREATE TABLE public.scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_set_id UUID NOT NULL,              -- the 3-4 siblings from one brief
  profile_id UUID NOT NULL REFERENCES scenario_profiles(id),
  deal_id UUID REFERENCES deals(id),
  version INTEGER NOT NULL DEFAULT 1,
  parent_scenario_id UUID REFERENCES scenarios(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared','won','lost','archived')),
  brief_raw TEXT NOT NULL,
  brief_parsed JSONB NOT NULL,                -- ParsedBrief
  engine_inputs JSONB NOT NULL,               -- exact params passed to the engine
  engine_results JSONB NOT NULL,              -- ScenarioResult
  rate_book_run_id UUID,                      -- pins the rate snapshot, §5
  template_id UUID REFERENCES boq_template(id),
  engine_version TEXT NOT NULL,               -- e.g. 'engine@1.3.0'
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_set_id, profile_id, version)
);
```

**Immutable versions.** A scenario is never mutated in place. Editing forks `version + 1` with `parent_scenario_id` set, copying `scenario_boq_lines`. `rate_book_run_id` and `engine_version` are pinned, so a scenario shared with a client in August still reprices exactly the same in November — critical when the ledger grows by two months of POs. A "Rates have moved" badge appears when a newer rate-book run exists, with a one-click *Reprice to latest* that forks rather than overwrites.

**Pin / override.** `is_pinned = true` on `scenario_boq_lines` freezes `qty`/`rate`; recompute skips pinned lines, recalculates the rest, re-sums `Σ amount`, re-derives `capexPerSqft`, and reruns the engine — a single POST to `app/api/scenarios/[id]/lines/[lineId]` returning fresh totals; the UI updates optimistically and shows a delta-vs-baseline ribbon (`+Rs 12.4 L · per-seat +Rs 340`). Overridden lines get `provenance.rate_selector = 'user_override'` and render with a struck-through benchmark plus the mandatory `override_reason` — so a discount is visibly a *decision*, not a data point.

**Compare.** `/[orgId]/commercials/[setId]/compare` renders the 3-4 siblings as columns: per-seat price, TCV, NPV, payback months, break-even occupancy, capex/sq.ft, opex/sq.ft, margin %; BOQ rows align by `template_line_id` with per-cell deltas versus a user-chosen baseline column, and dropped lines shown greyed with a strikethrough rather than omitted.

**Export.** XLSX via `exceljs@4.4.0` (already a dependency): Summary, BOQ-per-lens, Provenance (one row per line with all `LineProvenance` fields), Assumptions (every `Field` with its `confidence`), Cashflow. PDF via a print-CSS route `app/(dashboard)/[orgId]/commercials/[setId]/print/page.tsx` rendered headless — client-safe by default (provenance collapsed to "backed by N POs / Rs X Cr / M vendors"), with an internal toggle that exposes vendor names, PO numbers and best-actual rates. Vendor identity is never in a client-facing export unless explicitly toggled by an `org_super_admin`.

### Risks

- **The denominator does not exist.** No carpet area, BUA, seats or shell type anywhere: `properties` has 13 rows, `capacity` populated on 2 (Rabale 19997, SS Plaza 40000 — sq.ft, not seats). Stage 2 is fully blocked on the promised site-MIS import. Until then the generator can only run on the `finishingRates` ladder (2700/2100/500) with zero provenance — which is the product with its moat removed.
- **Site-name join is dirty and unresolved.** `properties.name` does not match `zoho_purchase_orders.project_name`; `Sky mark - Noida` vs `Arcil Sky Mark - Noida`, `Mafatlal Chember -A wing` vs `B wing - Mafatlal Chambers` vs `Mafatlal WS`, and trailing spaces (`Radical Mind - Bangalore `). A wrong join silently halves or doubles a Rs/sq.ft rate. Requires the operator-confirmed alias map from §4, not fuzzy matching (pg_trgm is not installed).
- **Sample size, stated plainly.** Five usable fit-outs. A category with a handful of POs at one site yields a percentile that is arithmetic theatre. The `evidence_grade` gate and the red-line banner are the mitigation, and they must not be softened for demo polish.
- **No line items anywhere.** `raw` holds Zoho's list payload only (46 keys, `line_items` absent on all 5,265 rows); there is no `po_line_items` table. Every rate is a **header-level PO amount ÷ area**, i.e. a category cost intensity, not a true unit rate. A "Rs/sq.ft for modular furniture" is defensible; "Rs 8,400 per workstation" is not, until the per-PO detail backfill (§3) runs.
- **21.5% untagged tail.** 1,134 POs / Rs 7.98 Cr have no `cf_category`/`cf_site` and are excluded from every percentile. If those skew toward one category, benchmarks are biased in an unknown direction. Always render the caveat.
- **Draft/cancelled contamination.** 856 draft + 107 cancelled + 1 rejected must be excluded from rate derivation; only approved/open/billed/partially_billed count. A default that silently includes drafts would inflate every scenario.
- **LLM drift.** Even with forced tool use and `temperature: 0`, a model can emit a plausible number absent from the text. The substring span check is the only real defence — it must be a hard gate, not a warning.
- **Client Benchmark is adversarial output.** Showing a client that their budget funds a demonstrably sub-spec fit-out is powerful and can also lose the deal. It must be a deliberate toggle, off in the default client PDF.
---

# Annex — Full adversarial review

Output of the integration critic, retained for the reasoning behind each finding. Twelve reviewer agents ran two lenses (factual correctness against the live schema; engineering soundness at real data volume) across the six sections, producing 221 findings — 45 blockers, 96 major, 80 minor. Several were confirmed by executing SQL against the live project. The triage below marks each KEEP or DROP.

# Integration & Completeness Review

Six sections, ~175 reviewer findings. Verdict up front: **the individual sections are competent; the bundle is not a single system.** The same entity is defined four times under four names, the same 1,134 rows are handled three incompatible ways, and three sections independently re-derive site identity from raw free text. Fix the seams before anyone writes SQL.

---

## 1. INTEGRATION DEFECTS

Ordered by blast radius. Each names the two (or more) sections that disagree.

### I-1 — The site dimension is defined four times, with four names and four join keys — §1 ↔ §2 ↔ §3 ↔ §5 ↔ §6
| Section | Table | Join key into POs |
|---|---|---|
| §1 | `site_areas` + `site_aliases` | `site_aliases.normalized_value` (generated) → `zoho_purchase_orders.site_id` |
| §2 | *(none)* — `po_line_items.site_id UUID REFERENCES properties(id)` | none; "NULL until §3" |
| §3 | `site_canon` + `site_canon_map` | `scm.raw_project_name = po.project_name` (raw, untrimmed) |
| §5 | `commercial_sites` + `commercial_site_alias` | `a.alias_key = lower(btrim(project_name))` |
| §6 | *(consumes)* — cites "the operator-confirmed alias map from §4" | `derived_from_sites TEXT[]` of raw `project_name` strings |

Consequences that are not stylistic: `carpet_sqft` lives on both `site_areas` (§1) and `commercial_sites` (§5) — **two sources of truth for the denominator of every headline metric**. §3's sentinel is the zero-UUID `'00000000-…'`; §1's sentinel is a real `site_areas` row with `is_unallocated = true`. The zero-UUID will never join to §1's table, so §3's site-grain rollups silently produce NULL for the sites §1 spent an entire import pipeline resolving. §2 reintroduces `site_id → properties(id)` — the exact FK shape §1 declares dead ("wrong grain, never populated, deprecate it").

**This is the single highest-value fix in the document.** One table, one alias table, one normalized join key, named once, referenced by every other section.

### I-2 — `po_line_items` is defined in §2 and queried in §3 with different column names — §2 ↔ §3
§3.5's `base` CTE will not compile against §2.1's DDL:

| §3 reads | §2 defines | Status |
|---|---|---|
| `li.purchase_order_id` | `po_id` | **name mismatch** |
| `li.line_total` | `amount` | **name mismatch** |
| `li.desc_norm` | — | undefined |
| `li.uom_norm` | `unit` (raw) | undefined |
| `li.category_norm` | `category` (raw, trailing-space defects intact) | undefined |
| `li.spec_attrs` | — | undefined |
| `li.is_composite` (§3 Risks) | — | undefined |

§3.2 also builds `idx_poli_desc_norm_trgm ON po_line_items(desc_norm)` and `idx_poli_block ON (organization_id, category_norm, uom_norm)` — three indexes on three columns that no section creates. §3.1 says normalization is "applied at ingest and stored alongside the raw string," but §2 is the ingest section and stores nothing of the kind. **Either §2.1 gains the normalized columns or §3 gains an ALTER; neither exists today.**

### I-3 — `item_canon` / `item_canon_map` have two incompatible column vocabularies — §3 ↔ §4
§3.4 defines them; §4 writes to them with different names and adds a table §3 never creates.

| §4 uses | §3 defines |
|---|---|
| `item_canon.norm_name` | *(nothing — only `canonical_name`)* |
| `item_canon.unit` | `uom` |
| `item_alias(norm_alias, source, …)` | **table does not exist** |
| `item_canon_map.locked`, `mapped_by`, `mapped_at`, `source` | `is_locked`, `reviewed_by`, `reviewed_at`, *(no `source`)* |
| `MatchStage` values `'alias'`, `'llm_rerank'` | `CHECK (match_method IN ('exact','trigram','vector','human'))` — both would raise 23514 |
| `item_canon.last_seen_at`, `observations` (tie-break rule) | undefined |
| `item_match_event` | undefined anywhere in the bundle |

`item_alias` is load-bearing for §4's entire economic argument (stage 1 absorbs steady-state traffic; the write-back loop is what makes the matcher "provably improve") and it has no DDL, no RLS, no owner.

### I-4 — The clobber premise is false, is stated in §1, contradicted inside §2, and drives a design that creates real data loss — §1 ↔ §2
§1: "any column absent from the upsert payload is clobbered… so resolve `site_id` inside the sync." §2.2's DDL comment repeats it as justification for parking header totals in the job ledger. §2's own Risks section then says to add `line_items_synced_at` **to `zoho_purchase_orders`** — which is only safe if the premise is false. It is false: PostgREST emits `DO UPDATE SET` for payload keys only.

The inversion matters. §1's prescribed fix (put `site_id` into the sync payload) is the one change that would make `site_id` genuinely clobberable — including with NULL on any failed `site_aliases` read, across all 5,265 rows, in one run, with no error check. **Delete the premise from §1, delete it from the §2.2 comment, and correct the header comment of `20260801000001_po_workflow_state.sql`, which is where both sections inherited it.**

### I-5 — Three sections independently resolve the same PO to a site, and none is declared authoritative — §1 ↔ §3 ↔ §5
§1 writes `zoho_purchase_orders.site_id` in the sync. §3.5 ignores that column and re-joins via `site_canon_map`. §5.3 ignores both and re-joins via `commercial_site_alias`. §2 denormalizes a fourth copy (`site_name` verbatim + `site_id → properties`) onto `po_line_items`. Four resolution paths, four possible answers for one PO, no reconciliation and no test that they agree.

### I-6 — The 1,134 blank-site POs get three mutually exclusive treatments — §1 ↔ §3 ↔ §5/§6
- §1: mapped to an `is_unallocated` sentinel **row** so org totals reconcile to Rs 60.55 Cr.
- §3.5: mapped to a zero-**UUID** that matches no row, conflated with "unmapped" and "join miss."
- §5.3: excluded by `btrim(project_name) <> ''`. §6: "excluded from every percentile."

So §1's coverage metric counts them, §3's site rollup pollutes with them, and §5/§6 drop them — and all four sections print the same caveat string "21.5%," which is the **count** share. The value share is 13.2%. Net of §5's own 12-month window it is 1.4%; net of the status filter it is 5.4%. One wrong number, propagated verbatim into a client-facing provenance chip.

### I-7 — Micro-market is a UUID FK in §1 and a TEXT column in §3 — §1 ↔ §3 ↔ §5
§1: `site_areas.micro_market_id UUID REFERENCES micro_markets(id)`, bands on the `micro_markets` row. §3.5: `LEFT JOIN site_canon sc ON sc.id = rb.site_id` selecting `sc.micro_market` as TEXT, and `item_rate_book_summary` groups on `COALESCE(micro_market,'')`. §5.3(c) then sources `rentPerSqft` / `camRate` defaults from `micro_markets` p25/p50/p75 — bands §1 explicitly **refuses to populate** ("do not fabricate p25/p50/p75… every rent-reasonableness check is disabled"). §5 has a hard runtime dependency on data §1 declines to supply, and no fallback is specified.

### I-8 — §2 declares a trust gate that §3 does not implement and §5 does not need — §2 ↔ §3 ↔ §5
§2.4: "the rate-book materialization in §5 selects only from POs with `recon_status = 'ok'`; anything else is quarantined." The rate book is §3, not §5. §3.5's `base` CTE has **no recon predicate at all**. §5 states it needs no line items whatsoever. The hard gate exists in prose in one section and nowhere in the SQL of the two sections it names.

### I-9 — §6 pins `rate_book_run_id`; no section produces runs — §3 ↔ §6
§6's entire reproducibility guarantee ("a scenario shared in August reprices exactly the same in November") rests on `rate_book_run_id` and `derivation_run_id → rate_book_run(id)`. §3 delivers `REFRESH MATERIALIZED VIEW CONCURRENTLY` — an in-place overwrite — plus `rate_book_refresh_log`, which is a log, has no DDL, and is not versioned data. **Pinning an id to a matview that is destructively refreshed pins nothing.** Either §3 materializes immutable per-run percentile rows, or §6 must snapshot rates onto `scenario_boq_lines` and drop the pin.

### I-10 — §5 and §6 persist two unrelated deal entities — §5 ↔ §6
§5 creates `commercial_deals` (inputs, results_snapshot, provenance, engine_version, status draft/shared/won/lost). §6 creates `scenarios` (brief, engine_inputs, engine_results, engine_version, status draft/shared/won/lost/archived) plus a phantom `deal_id → deals(id)`. Nothing links them. A §5 deal and a §6 scenario set for the same client are two records with two version schemes, two snapshot mechanisms, and no foreign key. §6 also has no `scenario_sets` parent, so `brief_raw`/`brief_parsed` are duplicated across siblings and can diverge.

### I-11 — Area basis is never declared on any rate, and the three sections assume different ones — §1 ↔ §5 ↔ §6
§1 stores carpet and BUA. §5's benchmark divides by `carpet_sqft`; the Gemini engine multiplies opex and capex by `builtUpArea` (efficiency 0.75 → **33% overstatement on both**). §5 also seeds `capexPerSqft` from a fit-out ladder conventionally quoted on carpet. §6's `qty_basis` offers `per_carpet_sqft` and `per_bua_sqft` but `boq_template_lines.benchmark_rate` is documented only as "median Rs per uom." No rate anywhere in the bundle carries a `basis` field. Rent and CAM are quoted on chargeable/BUA in the Indian market; fit-out and opex on carpet. **Add `basis` to every persisted rate and convert at the API boundary, or every number in the product is 33% wrong in an unpredictable direction.**

### I-12 — Extension policy is decided three times, three ways — §1 ↔ §3 ↔ §4 ↔ §5
§1 deliberately implements fuzzy matching in TypeScript "because `pg_trgm` is not installed and this layer must carry zero extension dependency." §3.2 installs `pg_trgm` and `unaccent` into `public`. §4.2 installs both plus `vector` `WITH SCHEMA extensions` and references `gin_trgm_ops` unqualified. §5's Risks still says "`pg_trgm` is not installed, so fuzzy matching needs either the extension or a human mapping step" — written against a premise §3 and §4 invalidate. Pick one schema, install once, in one migration, and revisit §1's TS-only decision.

### I-13 — Normalization has four owners and no version — §1 ↔ §3 ↔ §4
§1: TS (`importMapping.ts`) **plus** a Postgres `GENERATED ALWAYS AS` column on `site_aliases`. §3.1: "a pure function in `backend/lib/rateBook/normalize.ts`" whose transform table is SQL and whose §3.2 installs `unaccent`. §4.4 stage 0: TS again in `backend/lib/pricing/itemMatcher.ts`, depending on the SQL `unaccent`. Nothing stamps a `normalizer_version`. The day the abbreviation dictionary or stopword list changes, every stored `norm_name`, `normalized_value`, `desc_norm` and every human-locked map row silently attaches to a different cluster, with no detection.

### I-14 — Category has three vocabularies — §3 ↔ §5 ↔ §6
§3 blocks on `category_norm` from "a curated mapping table" it never defines. §5 defines `commercial_opex_bucket_map(category_norm, bucket, recurrence)` — the closest thing to that table, with different columns and a different purpose. §6 stores "canonicalised category" on template lines. §4's HNSW query filters `c.category = $4` against raw values carrying the trailing-space defect. Four surfaces, one dirty source column, no single owner.

### I-15 — Status filter is stated five times and disagrees three ways — §2 ↔ §3 ↔ §5 ↔ §6
`approved/open/billed/partially_billed = 4,230` in §2.5, §3.5, §5.3. §2.5 also says "the 4,302 committed POs land first" while the sketch's `draft`-only rule yields 4,409. §6's Risks excludes 964 and **silently loses the 71 `pending_approval`**. §6.2's actual formula (`Σ po_amount(cat, site)`) has no status predicate at all. §3.5's filter is case-sensitive and NULL-hostile against a CSV importer that writes `Approved` and NULL. **Define one constant, in one place, and have every section reference it by name.**

### I-16 — `created_by` points at two different tables — §1 ↔ §3 ↔ §6
§1: `mapped_by UUID REFERENCES users(id)`. §3 and §6: `REFERENCES auth.users(id)`. The repo's tier-2 template and `zoho_purchase_orders` both use `public.users`. PostgREST embedding of the display name breaks on the `auth.users` variants.

### I-17 — Four sections append work to one 300-second cron with no shared budget — §2 ↔ §3 ↔ §4 ↔ §5
§2.3 adds a detail-fetch cron at `*/10` (up to 17,280 Zoho calls/day on the **same OAuth client and quota** as the production Payment Tracker sync). §3's refresh triggers 1 and 2 are the same cron counted twice, with a debounce that is unimplementable on Vercel. §5 materializes its benchmark "at the tail of the existing 2-hourly job." §4 adds a nightly re-embed with no route, no cron entry, no lock. No section reserves quota, takes an advisory lock, or defines priority. **The first thing that breaks is the live finance workflow, caused by analytics.**

### I-18 — RLS role list is copied verbatim into surfaces with different audiences — §1 ↔ §5 ↔ §6
The tier-2 procurement list (`purchase_manager, purchase_executive, procurement, accounts` + admins) is pasted onto site lease economics (§1), commercial deals (§5) and client-facing scenarios with margin and budget (§6). Meanwhile the people who actually price deals — `bd_rep/bd_admin/bd_super_admin` — are hard-pinned by `resolveSilo` to `/crm` and can never reach `/[orgId]/accounts/*`. **The feature is gated to an audience that will not use it and exposed to one that should not see it.** §1 additionally cites `VIEW_ROLES` (a module-private *read* whitelist) as the *write* gate, and omits `super_tenant` from the excluded set.

---

## 2. MISSING

Absent from all six sections, needed by any team that has to build this.

**M-1 — The area Excel has not been seen.** Every field name, sheet layout, unit convention and row count in §1's importer is hypothesised. `FIELD_ALIASES` is a guess against an unseen file; the "grade A/B/C" completeness model is a guess about what the file contains. This should be stated once, at the top of the document, as the single largest scope unknown — not implied in a Risks bullet in §5.

**M-2 — No test strategy, and no test runner exists.** `package.json` has `dev`, `build`, `start`, `lint`. No jest, no vitest, no config. §5 casually specifies golden-value tests at `frontend/lib/commercial/__tests__/engine.test.ts` as if a harness exists. Adding a runner is a prerequisite work item, not a footnote — and §5's plan to pin *current* Gemini outputs would canonize the capex-tail defect (EMI charged for `termMonths` while amortised over `capexTenure`) as the specification.

**M-3 — No rollback / DOWN path anywhere.** ~20 tables, 2 materialized views, at least 3 triggers, 2 of them on the production sync's write path. No section states drop order (matviews before tables, trigger independently and first), and no section notes that the `site_id` FK takes ACCESS EXCLUSIVE on `zoho_purchase_orders`.

**M-4 — No migration manifest or ordering contract.** §3's matviews depend on §2's `po_line_items` and §1's site tables. §4's indexes depend on §3's `item_canon` and a non-existent `item_alias`. §6's FKs depend on §3 and §5. Not one filename-order dependency is stated. Given the standing rule that migrations are authored but applied by hand later, an ordering table is mandatory.

**M-5 — No observability.** The only existing failure signal is a `last_sync_status` string in `accounts_zoho_config`. Nothing here adds: alerting on cron failure, a stale-run reaper (§3's `rate_book_refresh_log` can hold a row with `started_at` and no `finished_at` forever), a freshness assertion on §5's benchmark, an embedding-coverage metric (§4), an unmapped-site/unmapped-category counter (§5/§6 both promise review queues that no DDL creates), or a "backfill stalled" alert that fires on `done+failed+skipped < total_items` rather than per-run progress.

**M-6 — No data-retention policy.** `zoho_backfill_items` (5,265 rows/run, and it holds the load-bearing `header_sub_total`), `item_match_event` (jsonb top-5 per BOQ line at BOQ volume), `site_area_import_rows`, `event_outbox` growth. §2 even notes ledger rows "can never be pruned" — which is a design defect, not a retention policy.

**M-7 — No cost model.** Zoho detail calls (~17k/day against an undiscovered plan cap), Groq clustering (§3's tail, sized off an admittedly-guessed 55–70% auto-resolution rate), embedding API (§4 prices one rebuild at 75k tokens off an unmeasured 3,000-row canon that could plausibly be 20k), Claude tool-use per brief parse (§6), Supabase compute for two matviews + REPLICA IDENTITY FULL WAL amplification. No section states a rupee number or a monthly ceiling.

**M-8 — No ownership map.** Who curates the 54→canonical category mapping? Who confirms a site alias, and against what SLA (the `Mafatlal WS` row blocks Rs 1.79 Cr indefinitely)? Who sets `roi_flag` and `is_optional` on BOQ template lines (§6 admits "no data source claims to know ROI")? Who overrides a vendor tier? Who approves a `provenance.override_reason`? Who runs migrations? Who owns the abbreviation dictionary in §4? Every one of these is a human queue with no named owner and no service level.

**M-9 — No auth/roles model for writes.** Read policies are specified (and mis-specified, see I-18). Write permission is described as "checked in TypeScript" with no role set named for: importing site areas, confirming an alias, locking a canon, editing a scenario, or toggling vendor identity into a client export. §1 cites the wrong constant; §5 cites a constant that isn't exported.

**M-10 — No definition of "site live months" or occupancy.** §5's opex normalisation needs it and substitutes "months in which a PO happened," which measurably overstates by 1.2×–12×. No section identifies a source for lease/occupancy windows — and it is not in §1's `site_areas` either (`lease_start`/`lease_end` are nullable, from the unseen Excel).

**M-11 — No effective-dating anywhere.** One `carpet_sqft`, one `rent_per_sqft`, one `as_of_date` per site, applied to a 39-month PO window. Floors get added; rents escalate. Either add `site_area_versions` with a daterange exclusion constraint, or **explicitly forbid publishing any series predating `as_of_date`** — but say which, in the doc.

**M-12 — No timezone or currency convention.** Supabase runs UTC; the business runs IST. `CURRENT_DATE` flips month boundaries 5.5h late. Zoho returns local time. Only one calculator finding mentions this. Also unstated: rounding policy for rupee figures, and the fact that `currency = 'INR'` on all 5,265 rows is a settled assumption.

**M-13 — No acceptance criteria per phase.** "Coverage ≥ Rs 52.57 Cr" is the only quantified gate in the bundle, and it is arithmetically unreachable by the seed the doc specifies (achievable ≈ Rs 49.6 Cr). No section states what "done" looks like for line-item ingestion, canon quality, matcher precision, or benchmark credibility.

**M-14 — No sizing measurement plan.** Canon row count is TBD and drives five decisions (HNSW vs IVFFlat, embedding dim, storage, LLM budget, human review load). Lines-per-PO is TBD and drives index design. Both are answerable by a 50-PO sample **before** committing to any of it. No section proposes that sample.

**M-15 — No glossary / data dictionary.** Directly causes I-1 through I-3, I-7, I-14. One page listing every entity, its owning section, its key, and its column contract would have caught most of the defects above.

**M-16 — No staging/branch plan.** Supabase branches are available. Nothing says whether any of this is validated on a branch before hand-application to production.

---

## 3. TRIAGE

KEEP = real, must be fixed in the document. DROP = false positive, subsumed, or not worth review cycles. Duplicates across the two reviewer passes are collapsed.

### §1 dimensions

| # | Issue | Verdict | Reason |
|---|---|---|---|
| D-1/D-13 | Coverage metric counts sentinel → 100% day one | **KEEP** | Metric reads 100% while Rs 7.98 Cr is unattributed; dup of the blocker, fix once as a JOIN + `confidence='confident'`. |
| D-2/D-20 | `code NOT NULL` vs "grade C = name only"; commit not implementable | **KEEP** | The importer contract and the DDL cannot both ship; `ON CONFLICT` takes one inference target, so alias-matched sites duplicate. |
| D-3 | Staging tables have no DDL / org_id / RLS; `source_import_id` no FK | **KEEP** | Tenancy convention violation in a section that ships full DDL for three other tables. |
| D-4/D-12 | Clobber claim backwards; design inverts the risk | **KEEP** | See I-4. Highest-value single fix in §1; also correct the migration header comment it was inherited from. |
| D-5 | `'capacity'` in `seats` aliases | **KEEP** | Re-imports the exact pollution the section rejects two paragraphs earlier; one-token fix. |
| D-6 | No unique index on the sentinel | **KEEP** | Partial unique index, one line, prevents non-deterministic resolution after any re-import. |
| D-7/D-30 | Alias auto-insert raises 23505 and fails the sync; per-row inserts | **KEEP** | Fails on the exact defect it exists to absorb; collapse both into one bulk `DO NOTHING` upsert. |
| D-8 | Seat-density band uncited | **KEEP (reduced)** | Cite `targetDensity: 45` as the anchor. **DROP** the demand to lower the warn floor below 19.5 — the calculator's `seats: 600` demo default *should* trip the band. |
| D-9 | `confident` rows assert property links that don't exist | **KEEP** | Conflates site canonicalization confidence with a separate human property decision; one of the "confident" properties (Delhi) isn't among the 13. |
| D-10 | Wrong constant (`VIEW_ROLES`), no writer role, `super_tenant` omitted | **KEEP** | See I-18 and M-9. |
| D-11 | Duplicate `(a)` headings, `(c)` before `(a)`, wrong table caption | **KEEP (editorial)** | Cheap; a plan doc handed to engineers must be navigable. Batch with all other editorial fixes. |
| D-14 | Rs/sq.ft has no time denominator | **KEEP** | 21-day and 39-month sites divided by the same area are ~50× apart for non-economic reasons; also blocks comparability with §5's per-month `opexPerSqft`. |
| D-15 | Rs 52.57 Cr target unreachable (achievable ≈ 49.6) | **KEEP** | The only quantified acceptance gate in the bundle is wrong by 5.6pp; seed all 31 sites and restate as two gates. |
| D-16 | Skymark merge contradicts Risks; backfill has no confidence predicate | **KEEP** | Rs 10.2 Cr of `needs_review` mappings enter Rs/sq.ft while the queue still calls them unreviewed. |
| D-17 | Status filter undefined; 9.4% of value non-committed | **KEEP** | Cross-section: §2/§3/§5 all define it, §1 doesn't. Reuse `is_payable`. |
| D-18 | Denominator not effective-dated | **KEEP (scoped)** | Ship v1 without `site_area_versions` if you must, but the doc must then **forbid** publishing series predating `as_of_date`. Silence is not an option. |
| D-19 | Four single-column FKs with no tenant binding | **KEEP** | RLS is off on the write path; the FK is the only guard, and the repo's own precedent binds tenancy in the constraint. |
| D-21 | p25–p75 outlier band flags half of healthy values | **KEEP** | IQR excludes 50% by construction; at n≈3 per micro-market percentiles aren't estimable. Add `sample_n`, suppress below it. |
| D-22 | sq.m import undetected on the modal row shape | **KEEP** | Section names the failure (10.8× error) and none of its four rules catch it without `seats`. Make `areaUnit` required, add an absolute cross-check. |
| D-23 | `updated_at` decorative; no re-point signal | **KEEP** | Trigger already exists in the repo; the "recompute after re-point" requirement has no mechanism otherwise. |
| D-24 | Blank-site alias internally inconsistent; pollutes queue forever | **KEEP** | Specify the sentinel alias row explicitly; exclude `is_unallocated` from the queue predicate. |
| D-25 | `is_non_attributable` rename + reason column | **DROP** | `WHERE NOT is_unallocated AND carpet_sqft IS NOT NULL` already excludes arealess rows; a reason taxonomy is a nice-to-have, not a defect. Revisit if pan-India buckets multiply. |
| D-26 | No `maxDuration`, no >4.5MB body path on import routes | **KEEP** | An 80-sheet workbook is the stated comparable; both failure modes are silent. |
| D-27 | `site_id` invisible to `po_alignment_queue`; migration order unstated | **KEEP** | Enumerated-column view won't pick it up; `CREATE OR REPLACE` fails on a mid-list insert. |
| D-28 | Five useless indexes; the needed one is absent | **KEEP (partial)** | Keep the *added* indexes (`(org, site_id, po_date)`, `(org, category, po_date)`). **DROP** the demand to remove three indexes on a 31-row table — the write cost is noise. |
| D-29 | Lease economics and the denominator share one table | **KEEP** | RLS is row-level; there is no way to give an FM surface the area without the rent. Split into `site_areas` / `site_commercials`. |

### §2 ingestion

| # | Issue | Verdict | Reason |
|---|---|---|---|
| G-1/G-14 | Delta watermark uses `synced_at`, which Risks forbids | **KEEP** | The forward-sync mechanism is dead on arrival; after backfill it enqueues zero rows forever, silently. |
| G-2/G-23 | "21.5% of spend" is the count share; real exposure 5.4% | **KEEP** | Inflates the §6 inference pipeline's payoff ~4×; the same wrong figure is printed on a client-facing chip in §5/§6. |
| G-3/G-15 | Two unique constraints + `ON CONFLICT` → 23505 on line reorder | **KEEP** | The 856 "frequently edited" drafts are exactly the population that trips it; the compensating DELETE runs after. |
| G-4 | Section contradicts itself on whether ZPO can hold derived columns | **KEEP** | Same root as I-4; pick one story and state it precisely. |
| G-5 | "4,302 committed" doesn't match the `draft`-only sketch (4,409) | **KEEP** | Numbers in a spec become numbers in a dashboard. |
| G-6 | "TBD crosstab" is one query; population contradicts §2.5 | **KEEP** | 3,951 POs / 75.0%. Remove the fake unknown. |
| G-7 | "burns most of its `maxDuration`" is invented | **KEEP (editorial)** | The conclusion survives on the 26-min estimate; delete the fabricated figure so nobody plans against it. |
| G-8/G-31 | "Cron granularity TBD" refuted by `vercel.json` | **KEEP (once)** | 19 crons exist, five at `* * * * *`. Fold the two duplicates into one edit; also reframe the budget as quota-driven, not time-driven. |
| G-9 | `category` copied untrimmed into the grouping key | **KEEP** | Defect-proofing: today btrim collapses nothing, but one clean row forks the largest spend bucket. |
| G-10/G-22 | `AFTER UPDATE OF` fires on SET-list membership, not value change | **KEEP** | 5,265 cascades every 2h, and an error inside the trigger takes down the Payment Tracker sync. Prefer the set-based re-stamp. |
| G-11 | `site_id REFERENCES properties(id)` pre-commits the wrong dimension | **KEEP** | See I-1; this is the FK §1 declares dead. |
| G-12/G-27 | Recon view: unreachable branch, mixed variance bases | **KEEP** | Masks the double-ingest signal and fabricates a negative variance on rows with no evidence. |
| G-13 | Gate can't pass any non-detail-sourced PO | **KEEP** | Contradicts "needed under either route"; Route A and manual rows are permanently quarantined. |
| G-16 | Header totals live in a cascade-deletable job ledger | **KEEP** | Deleting one finished job silently empties the rate book, with no fallback (`sub_total` exists nowhere else). |
| G-17 | No claim lease, no attempt ceiling, `in_flight` invisible to the drain | **KEEP** | The backfill stalls short of 5,265 without failing, and the proposed alert cannot fire. |
| G-18 | Backfill shares one Zoho quota with the production sync | **KEEP** | See I-17. Analytics degrading a live finance workflow is the worst failure mode in the bundle. |
| G-19 | `po_line_items.category`/`site_id` re-introduce the clobber anti-pattern | **KEEP** | For the 1,134 untagged POs the parent `category` is NULL, so the trigger actively overwrites derived values with NULL. |
| G-20 | Recon view: whole-table aggregate, unindexed LATERAL, no InitPlan | **KEEP** | Regresses from the repo's own established pattern in the file it cites. |
| G-21 | `security_invoker` makes the trust gate reader-dependent | **KEEP** | A header-visible/line-invisible user gets a fabricated 100%-quarantine report with no error. |
| G-24 | Percentiles over lines treat N lines from one PO as N observations | **KEEP** | 49.6% of category×year cells have <10 POs; publishing p50 on pseudo-replicated evidence is the credibility risk the product exists to avoid. |
| G-25 | Recon ignores line discounts and inclusive tax | **KEEP** | Quarantines legitimate POs as ingest bugs; exposure can't be pre-checked from the list payload. |
| G-26 | `getAccessToken()` has no cache — a second, unhandled rate limit | **KEEP** | 120 grants/run × 144 runs/day, surfacing as per-item failures that burn `attempts` on healthy POs. |
| G-28 | Delta enqueue idempotency: lossy or unbounded | **KEEP** | Both branches are wrong as written; needs one long-lived job + a conditional re-queue. |
| G-29 | Upsert + DELETE not transactional; DELETE omits `organization_id` | **KEEP** | Tenant-scoping convention violation on a write, plus torn state at the 300s boundary. |
| G-30 | `idx_pli_site` on raw `site_name` splits sites | **KEEP** | Defer the index; store `site_name_raw` + a normalized key so defects are visible. |
| G-32 | No rollback or migration ordering | **KEEP** | See M-3/M-4. The trigger specifically needs an independently droppable kill switch. |
| G-33 | RLS granularity is org-wide-by-role, not per-site | **KEEP** | Section presents RLS as the control protecting rate confidentiality; state the real granularity and flag per-site as a §1 dependency. |
| G-34 | Route A recon purpose is circular | **KEEP** | A UI export cannot supply `sub_total`; narrow Route A to sizing + vocabulary and validate tolerance on ~50 Route B calls. |

### §3 canon

| # | Issue | Verdict | Reason |
|---|---|---|---|
| C-1 | `PERCENTILE_CONT … OVER (…)` — not a window function | **KEEP** | Verified `ERROR 0A000`. The matview cannot be created; §3.5 and every §3.7 consumer are unbuildable. Dup ×2. |
| C-2 | Expression unique index can't support `REFRESH … CONCURRENTLY` | **KEEP** | Materialize the sentinels as real columns. Dup ×2. |
| C-3 | `EXTRACT(EPOCH FROM (date - date))` — integer, not interval | **KEEP** | Verified `ERROR 42883`; the `86400` factor is also wrong once fixed. Dup ×2. |
| C-4 | No RLS possible on matviews; none specified | **KEEP** | Default Supabase grants make the most commercially sensitive relation in the design cross-org readable by any authenticated user. Dup ×2. |
| C-5 | "Winsorizing preserves reconciliation to Rs 60.55 Cr" | **KEEP** | False four times over; justify winsorizing on its real merit (preserves n) and publish an explicit coverage waterfall. Dup ×2. |
| C-6 | "54 observed categories (post-trim)" | **KEEP** | Post-trim is <54, and the closed set should be the canonical list, not the dirty column. |
| C-7 | "12 canonical UoMs" vs 8 enumerated | **KEEP** | Propagates into the 648-block cost arithmetic; enumerate or renumber. |
| C-8 | Lock layers 1 and 2 are mutually exclusive | **KEEP** | The `WHERE is_locked = false` guard means the trigger never fires, so `idx_icm_conflicts` is permanently empty. Dup ×2. |
| C-9 | `MIN(rate_w) AS best_actual_rate` | **KEEP** | The headline savings number is computed against a synthetic p10 floor, with provenance attached to a different aggregate. Dup ×2. |
| C-10 | `vendor_key` mixes two key spaces; no vendor canon | **KEEP** | 4 vendor names already carry >1 `vendor_id`; the `n_vendors ≥ 2` gate can be satisfied by one vendor counted twice. Dup ×2. |
| C-11/C-41 | `md5(a \|\| b \|\| c)` — NULL-poisoning and jsonb numeric scale | **KEEP** | One NULL `uom_norm` folds every such row into one bogus canon; `15` vs `15.0` splits identical items. |
| C-12 | 0.42 similarity fabricated; `spec_attrs` gate passes trivially | **KEEP** | Both example descriptions carry no dimensions, so the stated mitigation is vacuous; replace with an empirical calibration step + head-noun gate. |
| C-13/C-39 | Join on raw `project_name`; sentinel conflates 3 states | **KEEP** | See I-1/I-6. Add `site_match_status ∈ {matched, untagged, unmapped}` and alert on `unmapped > 0`. |
| C-14/C-50 | Cost model mixes N²/2 and b² (20× vs 44×) | **KEEP (trivial)** | One-word fix; keep it because a wrong order-of-magnitude in the sizing argument is what people quote. |
| C-15/C-45 | `period` enum omits FY27; L12M is 11 or 13 months | **KEEP** | Today is 2026-08-01 — every most-recent PO has no FY leg. Generate FY legs dynamically; build L12M from line level. |
| C-16/C-48 | `'vector'` in `match_method` CHECK "documents a stage that doesn't exist" | **DROP (as stated)** | §4 specifies the vector pass in full. This is cross-section blindness by the §3 reviewer. **Keep the ordering consequence only**: the §3 migration must not install pgvector, and §4's migration must sort after it. The `is_composite` half of the finding is **KEEP** (no column, no filter). |
| C-17/C-30 | `uq_item_canon_org_name_uom` omits `spec_attrs` and `brand` | **KEEP** | Directly contradicts transforms 5 and 6; 600×600 and 1200×600 collide and pool two rates. |
| C-18 | `CREATE EXTENSION` into `public` | **KEEP** | Trips Supabase's `extension_in_public` advisor and makes `gin_trgm_ops` unresolvable under a restricted `search_path`. See I-12. |
| C-19/C-47 | TS-vs-SQL normalization; no `normalizer_version` | **KEEP** | See I-13/M-15. Load-bearing for the site join and for re-normalizing when dictionaries change. |
| C-20 | §3.7.1 query: no org predicate, wrong grain | **KEEP** | A cross-tenant read on a relation with no tenancy enforcement, returning one row per site per quarter. |
| C-21 | §3.7.6 claims per-sqft rates replace absolute `detailedOpex` | **KEEP** | Those are absolute monthly rupees for a 15,600 sq.ft site; the substitution needs an area that doesn't exist yet. |
| C-22 | Dead `site_canon` join in the summary's `src` | **KEEP** | Also never matches the zero-UUID sentinel, so the mitigation the Risks section proposes is unimplementable. |
| C-23 | Nullable `po_date`/`vendor_name` in a plain unique index | **KEEP** | NULLs are distinct; rows churn instead of matching on `CONCURRENTLY` refresh. |
| C-28 | `ON DELETE CASCADE` from `po_line_items` destroys locked map rows | **KEEP** | Weeks of human adjudication vanish on a delete-then-reinsert re-ingest, silently, with no audit. This is the worst §3 finding. |
| C-33 | `COUNT(DISTINCT po_number)` on a documented non-unique key | **KEEP** | 17 collisions today; `n_pos` is the numeric gate for `quotable`. Also fixes the lexicographic `PO-9 > PO-10` tie-break. |
| C-35 | Line UoM never required to match canon UoM; blocking splits NOS/SET | **KEEP** | A single SQM line in a SQFT canon injects a 10.76× rate into the pool; the split is permanent and invisible. |
| C-36 | The "three" refresh triggers are two; no lock; debounce impossible | **KEEP** | See I-17. Drive it from `event_outbox` + the existing `sweep-outbox` cron. |
| C-37 | `WITH NO DATA` + `CONCURRENTLY` = hard error on first cron run | **KEEP** | Given migrations are hand-applied later, this fails invisibly on a Bearer-guarded route. |
| C-38 | "Batch job, not a request path" — but every surface is a request path | **KEEP** | Needs a checkpoint/cursor table, per-batch commit, cached cluster-hash ledger, and Groq backoff. |
| C-40 | Summary percentiles are unweighted percentiles of cell medians | **KEEP** | A 1-line cell weighs as much as a 500-line cell; `coeff_variation > 0.35` drives a UI badge off between-cell dispersion. |
| C-42 | Status filter case-sensitive and NULL-hostile | **KEEP** | Latent today (0 rows), fires the first time someone uses the CSV importer, which the repo's own view already defends against. |
| C-43 | `ON DELETE RESTRICT` vs org cascade ordering | **KEEP (trivial)** | One-word change to `NO ACTION`; low frequency, zero cost to fix. |
| C-44 | Decay anchored to corpus max, not to now; partial current quarter | **KEEP** | If the sync breaks, every rate keeps full weight forever and staleness is undetectable. |
| C-46 | `n_outliers` always flags min and max at small n | **KEEP** | 2 of 5 flagged on every thin cluster trains reviewers to ignore the badge. |
| C-49 | `rate > 0 AND quantity > 0` silently drops free-issue/credit lines | **KEEP** | Directly contradicts §3.6's "never hide a thin rate"; count them into the refresh log. |
| C-51 | No DDL for `rate_book_refresh_log`; no ordering; no rollback | **KEEP** | Referenced twice as load-bearing. See M-3/M-4/I-9. |

### §4 vector

| # | Issue | Verdict | Reason |
|---|---|---|---|
| V-1 | Installed `@google/generative-ai` 0.24.1 has no `outputDimensionality` | **KEEP** | Every insert into `vector(768)` fails; "zero new vendor, zero new secret" is not free. |
| V-2 | `item_embedding_model`: no org_id, no RLS, globally-unique active flag | **KEEP** | A model cutover is a silent cross-tenant switch; the table is anon-readable in `public`. |
| V-3/V-23 | `item_match_event` has no DDL | **KEEP** | Every threshold in the section is declared uncalibrated and TBD; this table is the only calibration substrate. Cited three times, defined zero. |
| V-4/V-25 | Filtered HNSW post-filtering destroys recall; `iterative_scan` off | **KEEP** | The section's own stated mitigation masks the bug as a threshold miss. With 54 categories a scoped query survives with 0–2 of 10 rows. |
| V-5 | DDL pre-commits `vector(768)` while §4.3 leaves the choice open; "migration fails loudly" is false | **KEEP** | `dim` is an unlinked integer; the failure surfaces at runtime insert, not migration. |
| V-6 | Stage 0 normaliser in TS depends on a Postgres extension | **KEEP** | One character of divergence silently kills stage 1's primary-key guarantee. See I-13. |
| V-7 | Stage 0 credited with fixing stored `category` defects | **KEEP** | Trimming query input changes no stored row, and categories never pass through the item matcher. |
| V-8 | Trigram justified with site-name examples; one quoted string doesn't exist | **KEEP** | Evidence quality: the section's only justification for its own stage is drawn from a different table. |
| V-9/V-30 | `SET LOCAL` is a no-op outside a transaction; supabase-js has no transactions | **KEEP** | Affects `ef_search`, the two-row write-back, and the model cutover. All three must be plpgsql RPCs. |
| V-10 | §4.6 vs §4.5 cross-reference | **KEEP (editorial)** | One-character fix; batch it. |
| V-11 | Unedited reasoning left in the deliverable (`fnf`→furniture? no…`) | **KEEP (editorial)** | Guesses at a dictionary the same clause forbids guessing. |
| V-12 | "bounded by 54 categories × distinct descriptions" | **KEEP (trivial)** | Overcounts by 54×; the real bound is distinct descriptions. |
| V-13/V-38 | No `IF NOT EXISTS`, unqualified table names, no ordering, no rollback | **KEEP** | Deviates from the file the section cites as its own template; creates indexes on §3 tables with no stated ordering. |
| V-14 | `zohoService.ts` has no per-PO getter | **KEEP** | The Risks bullet implies a capability that must be built; it's a §2 work item, not an assumption. |
| V-15 | `'human'` vs `'human_correction'` in one transaction | **KEEP** | One CHECK constraint away from a hard failure; unify the vocabulary. |
| V-16 | `halfvec` escape hatch omits opclass and cast changes | **KEEP (trivial)** | Two-line completion of an already-stated fallback. |
| V-17 | `procurement_catalog` already exists with the proposed shape | **KEEP** | Two item masters destroy the "each concept appears once" property the whole recall argument rests on. |
| V-18 | "The commercial engine consumes structured rates" — present tense, false | **KEEP** | It consumes hardcoded literals; the sentence hides the work item. |
| V-19 | Model cutover violates its own partial unique index | **KEEP** | Partial unique indexes aren't deferrable; also, no active model = silent zero-row matcher outage. |
| V-20 | Migration-file heading contradicts plan-doc-only instruction | **KEEP (editorial)** | Retitle as a DDL sketch. Applies to §1, §3, §6 headings too. |
| V-21 | Trigram is the only non-exact path to `auto` and is blind to spec tokens | **KEEP** | The strongest finding in the section: `1.5 ton` vs `2 ton` auto-accepts at conf 0.937 in the categories carrying the money. Cap trigram below the auto band and add a hard spec-token gate. |
| V-22 | Stages 3 and 4 structurally cannot reach `auto`; "comparable across stages" is false | **KEEP** | Stage 4 maxes at 0.90 by construction. Three incommensurable quantities through one threshold table is a category error. |
| V-24 | Only human matches are persisted → reproducibility claim is false | **KEEP** | §4.0's central architectural argument. Persist every accepted match and snapshot the quote. |
| V-26 | Canon-size premise unmeasured; every downstream number derived from it | **KEEP** | Inverts the HNSW-vs-IVFFlat decision at ≥10k rows. Make the index choice conditional and gate on a measured count. See M-14. |
| V-27 | Extensions in `extensions` schema, referenced unqualified | **KEEP** | Any SECURITY DEFINER function written to the repo's `SET search_path = public` convention cannot resolve `vector` or `<=>`. |
| V-28 | Stage 2's `similarity(...) >= 0.62` cannot use the GIN index | **KEEP** | The "~1 ms, deterministic" claim is unsupported; use `%` with `similarity_threshold`. |
| V-29 | Alias multiplicity collapses the margin test | **KEEP** | The write-back loop advertised as "provably improve" actively degrades stage 2 over time. Aggregate to `max(score)` per canon before ranking. |
| V-31 | No embedding-coverage invariant | **KEEP** | New canon rows are invisible to stage 3 for up to 24h; a partial re-embed flips the matcher onto a fractional index with no alarm. |
| V-32 | Locked rows protected by prose only | **KEEP** | The repo already learned this lesson and documented it; enforce in the DB with a trigger + history table. |
| V-33 | Stage 1 has no ambiguity handling; aliases irrevocable | **KEEP** | Two estimators can mint conflicting aliases; every later occurrence returns one at confidence 1.00, unappealable, forever. |
| V-34 | Normalization unversioned | **KEEP** | Same root as I-13/C-19; the failure is silent and its symptom is the exact metric proposed to prove improvement. |
| V-35 | No throughput/batching/resumability; nightly job has no home | **KEEP** | 500-line BOQ times out mid-import with no checkpoint; the re-embed cron has no route, no `maxDuration`, no `CRON_SECRET`, no single-flight. |
| V-36 | "RLS as defence in depth" doesn't defend the service-role path | **KEEP** | Service role bypasses RLS entirely. Use a composite FK so the org/canon mismatch is impossible, and drop the claim. |
| V-37 | `MatchResult` discards `observations`; popularity tie-break | **KEEP** | §3's `n` never reaches §4's disposition; a n=2 rate is visually indistinguishable from n=300. |

### §5 calculator

| # | Issue | Verdict | Reason |
|---|---|---|---|
| K-1 | "Recharts is not in package.json" — it is (^3.7.0) | **KEEP** | The entire stated rationale for a merge decision is false. Re-argue or reverse. |
| K-2 | "escalation applied twice via `annualEscalation`" — mechanism doesn't exist | **KEEP** | `capexEMI` is never touched by `annualEscalation`. Keep the remedy, delete the false reasoning; a spec that misdescribes the code it cites will be mis-implemented. |
| K-3 | Rollup never emits `organization_id` | **KEEP** | The benchmark table can satisfy neither the repo convention nor the RLS policy the section says it copies — and the hole propagates into §6. |
| K-4 | Provenance chip invents and misattributes numbers | **KEEP** | 227 is the all-sites all-time count; percentiles are of rupee PO amounts labelled Rs/sq.ft. This chip is client-facing. |
| K-5/K-17 | Window hardcodes `DATE '2026-08-01'`; no TZ pin | **KEEP** | Refreshes every 2h forever without advancing; also needs `Asia/Kolkata` since Supabase runs UTC. See M-12. |
| K-6/K-24 | Outlier defence not implemented; degenerate at real n | **KEEP** | IQR is exactly zero for 5 of 10 internet pairs (fence collapses to `> p75`), and where it fires it removes 13–22% of value downward — stacked on the upward bias of K-7. Also mean and percentiles are computed in one pass, so no second pass can exclude. |
| K-7/K-16 | `count(DISTINCT po_month)` denominator | **KEEP** | Measured 1.2×–12× overstatement on 28 of 29 (site,bucket) pairs. This is the number the calculator sells on. See M-10. |
| K-8/K-20 | Merge table credits Gemini with rent escalation it doesn't have | **KEEP** | Landlord rent is flat for the whole term; year-5 rent understated ~21%, flowing straight into NPV as profit. Must be fixed *before* the golden snapshot. |
| K-9 | "CAM folded into opex" — Gemini has no CAM concept | **KEEP** | And the section never says where `totalCam` enters `totalCost` / the monthly loop — the same wiring gap it calls "Critical" for capex. |
| K-10 | `VIEW_ROLES` is not exported | **KEEP (trivial)** | One-line export, or express access via `resolveAccountsAccess`. |
| K-11/K-28 | `superseded_by` doesn't exist; shared quotes are editable | **KEEP** | Snapshot freezing protects nothing if `status='shared'` rows can be UPDATEd; overrides live in mutable `provenance` jsonb with no audit trail. |
| K-12 | No test runner exists | **KEEP** | See M-2. Prerequisite tooling, not an assumption. |
| K-13 | `standardRoi` and `capexInterestRate` both claim the EMI rate | **KEEP** | One source constant does two jobs today; two fields with no stated split invites silently charging 12% on deposits and 16% on debt. |
| K-14 | Sidebar active-match, missing icon, unnamed capability | **KEEP** | `startsWith` makes Payment Tracker render active on every calculator page; "the new capability" is never named. |
| K-15 | L273-300 citation; `clientBudget` dropped | **DROP the citation nit** / **KEEP `clientBudget`** | Off-by-three line reference has no engineering consequence; silently dropping the budget-badge input from `CommercialInputs` does. |
| K-18 | Percentiles are of PO rupee amounts, rendered as Rs/sq.ft | **KEEP** | ~carpet_sqft factor apart; also makes the `p75/p25 > 4` variance rule measure invoice lumpiness. |
| K-19 | Benchmark denominated in carpet, consumed against BUA | **KEEP** | 33% overstatement on both opex and capex, compounding into EMI, NPV, payback and yield-on-cost. See I-11. |
| K-21 | Golden tests would canonize the capex-tail defect | **KEEP** | Split into characterisation tests (labelled `KNOWN_WRONG`) and a hand-computed correctness suite; fix the tail first. |
| K-22 | Approval lag truncates the trailing edge; benchmark drifts weekly | **KEEP** | Jul-2026 keeps only 71% of POs. Two salespeople quoting the same site two weeks apart get different opex with no explanation. |
| K-23 | 12-month rationale false; seasonality underivable per site | **KEEP** | Zero sites reach 12 months of electricity; max is 9. Compute seasonality at portfolio level only, and change the thin-data fallback from "widen the window" to "portfolio median." |
| K-25 | INNER JOINs silently drop sites; no review queue exists | **KEEP** | 8.1% of window value falls outside the mapped buckets, with no row, no warning, no table, no owner. See M-5/M-8. |
| K-26 | Cron coupling fragile and unnecessary (query is 14ms) | **KEEP** | Route is dormant without an active `accounts_zoho_config`, so CSV-sourced orgs never get a benchmark; torn refresh is indistinguishable from a good one. Compute on demand. |
| K-27 | Role gating excludes the actual users | **KEEP** | See I-18. Confirm the audience with the business before writing the migration. |
| K-29 | "21.5% excluded" is the all-time figure, wrong for the window | **KEEP** | In-window blank site is 1.4%; the real exclusions are status (192) and unmapped category (397). A false caveat on a client artefact. |
| K-30 | `total*` names carry monthly quantities | **KEEP** | Three new consumers about to read this contract; rename while characterisation tests pin behaviour. |
| K-31 | No migration ordering/rollback; realtime/REPLICA IDENTITY unstated | **KEEP** | A 2-hourly full-table refresh with REPLICA IDENTITY FULL would WAL-burst to every connected client. |
| K-32 | `max(carpet_sqft)` not effective-dated; NULL rate with high confidence | **KEEP** | A chip can render "n=227 · 11 mo · confidence high" next to a blank value — thin evidence dressed as strong. Make the NULL case unrepresentable in the type. |
| K-33 | `delivery_date` fill rate is 36.2% | **KEEP** | Settles an open question and closes it; also record `po_date`/`amount`/`currency`/`status` validations as settled so downstream sections stop re-opening them. |

### §6 scenarios

| # | Issue | Verdict | Reason |
|---|---|---|---|
| S-1/S-19 | `REFERENCES deals(id)` — no such table | **KEEP** | Migration fails at apply. Point at `crm_leads` or drop; also add missing `ON DELETE` actions. |
| S-2/S-18 | `UNIQUE (…, COALESCE(sub_item,''))` — syntax error | **KEEP** | Table-level UNIQUE takes column names only; it's the last statement so the whole CREATE TABLE fails. |
| S-3 | Cumulative Cr totals fed into monthly `detailedOpex` fields | **KEEP** | Rs 6.58 Cr across 31 sites over 39 months cannot become a Rs 3.12L/month field. The normalisation stage is missing from the diagram and the opex path is presented as unblocked while it is not. |
| S-4/S-24 | Every headline evidence figure is pre-status-filter | **KEEP** | Contradicts the section's own Risks bullet; also stats must be recomputed *after* tier and percentile filters, not stamped at template-derivation time. |
| S-5 | `pending_approval` (71) in neither list | **KEEP** | 964 + 4,230 ≠ 5,265. See I-15. |
| S-6 | Vendor tiering requires unit rates that don't exist | **KEEP** | Area denominators exist for ≤5 sites; most of 762 vendors can't be scored on rate at all. Redefine on observable quantities or mark `unrated`. |
| S-7 | Site totals presented as capex evidence | **KEEP** | Implies ~73% of company capex sits at SS Plaza, which is nowhere established; capex-only per-site counts are unmeasured. |
| S-8/S-35c | "6 sites" vs "five usable"; real and invented figures mixed | **KEEP** | The flagship provenance example asserts more evidence than the spec says exists, behind one parenthetical. Bracket every fabricated token. |
| S-9 | No RLS on `scenario_profiles` or `scenarios` | **KEEP** | `scenarios` holds `brief_parsed.client_budget_per_seat`, `engine_results` and margin — cross-tenant readable. 20 existing migrations enable RLS. |
| S-10 | Finishing ladder attributed to the wrong file | **KEEP** | `finishingRates` is in the Claude file only; the Gemini engine has nothing named a ladder to replace. |
| S-11 | "Autopilot Best Fit" specified three ways | **KEEP** | p50-vs-best-actual is a 28% price difference in the section's own example; the DDL comment says `percentile` is null for `best_actual`. |
| S-12/S-21 | Client Benchmark solves the same equation twice; Target can't emit implied capex | **KEEP** | Verified against the engine: Target mode solves for margin with capex as input. Recovering capex needs a root-finder nothing describes. |
| S-13/S-35a | `auth.users` vs `users` | **KEEP** | See I-16; breaks PostgREST embedding of the actor name. |
| S-14 | Comment-only "FKs"; three referenced tables undefined | **KEEP** | The §6.6 immutability guarantee rests on an unenforced integer. See I-9. |
| S-15 | "copied verbatim" won't compile; missing `IF NOT EXISTS` | **KEEP** | The policy body references `po_workflow_state.organization_id` and must be rebound per table. |
| S-16 | `seatsMode`/`targetDensity` and `wacc`/`STANDARD_ROI` conflated | **KEEP** | Two distinct engine inputs that coincide numerically today; carrying them as one default guarantees they diverge wrongly later. |
| S-17 | `'inferred_unit'` never assigned; no `brief_model_raw` column | **DROP the enum half** / **KEEP the column half** | An unused union member has no failure mode. The "stored verbatim so a re-parse can be diffed" promise is impossible with one `brief_parsed` column — that's real. |
| S-20 | The core statistic is not well-defined | **KEEP** | Two defensible readings of the same text, one of which underprices every BOQ line by ~an order of magnitude. Define the unit of observation once; forbid p75/p90 below n=8. |
| S-22 | `shell_type` × `spec_tier` = 9 cells, both axes unobservable; `furnished 500` gate unsatisfiable | **KEEP** | Ship one cell derived, eight operator-authored; make >25% divergence a warning, not a publish block. |
| S-23 | `included` flag never applied in the rollup | **KEEP** | The Optimized lens produces identical capex to Ultra Premium, silently. Use `SUM(amount) FILTER (WHERE included)` plus a persisted `included_amount`. |
| S-25 | Percentile band → scalar undefined; zero CHECK constraints | **KEEP** | Lenses are operator-editable rows, so the DB is the only guard on the pricing path and it guards nothing. |
| S-26 | Immutable-versions claim contradicted one paragraph later | **KEEP** | Also no concurrency control on version allocation; two editors race into an opaque 23505. |
| S-27 | No `scenario_sets` parent | **KEEP** | Brief duplicated across siblings, no generation state, no transaction boundary — a timed-out run renders as a complete 2-lens comparison. |
| S-28 | Status filter absent from the derivation formula | **KEEP** | Asserted in Risks, missing from the SQL; and `boq_template` records no `status_filter`, so a derivation run is not auditable. |
| S-29 | `sample_po_ids` capped at 20; predicate not persisted | **KEEP** | The drill-through count will disagree with the number on the client slide once the alias map or rate book moves. Persist `filter_spec`. |
| S-30 | RLS role list wrong audience for client commercials | **KEEP** | Exposes `provenance.best_actual.vendor_name`/`po_number` to every purchase executive while excluding sales entirely, and the UI toggle sits on top of data the client can already read. See I-18. |
| S-31 | `rate_book_run_id` dangling; snapshot can be torn by the 2-hourly sync | **KEEP** | See I-9. Also schedule derivation off the sync boundary and refuse to start mid-sync. |
| S-32 | 39-month window with no recency rule or indexation | **KEEP** | `po_window_start/end` columns exist and are never populated; the `pre_2024_only` caveat is a chip, not a mitigation. |
| S-33 | `uom` and `qty_basis` encode the same fact twice | **KEEP** | A `sqft_carpet` + `per_seat` row mis-scales by ~45× with no error. |
| S-34 | Two `status='active'` templates possible | **KEEP** | Archiving v5 silently changes the pricing basis of every subsequent scenario, with no audit trail. |
| S-35b | "a fifth lens without a deploy" | **KEEP (trivial)** | True only if it reuses an existing `rate_selector`; also `profile_id NOT NULL` with no `ON DELETE` means a lens can never be retired. |
| S-35d | `client_budget_per_seat` carries no period; no `maxDuration` on `/api/scenarios/*` | **KEEP** | In the one schema whose stated job is flagging ambiguous units. A tool-use call plus a Gemini fallback will exceed the platform default. |

**Triage totals: 6 DROPs (D-25, D-8-partial, D-28-partial, C-16-as-stated, K-15-partial, S-17-partial), everything else KEEP.** That ratio is itself a finding: the reviewers were right almost everywhere, which means the spec's error density is high enough that a line-by-line correction pass is cheaper than a rewrite of any one section.

---


---

*Sections 4 (Build order) and 5 (Top 5 risks) of the review have been promoted into §B and §C above, edited for accuracy, and are not repeated here.*
