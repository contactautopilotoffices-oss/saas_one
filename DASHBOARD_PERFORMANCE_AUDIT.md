# Dashboard Performance Audit

**Date:** 10 October 2026  
**Project:** SaaS One — current Next.js / TypeScript / Supabase working tree  
**Source diagnosis:** [Dashboard Performance Diagnosis.pdf](<C:/Users/dhuri/Downloads/Dashboard Performance Diagnosis.pdf>) — all five pages reviewed.  
**Scope:** Audit only. This Markdown report is the only project file created for this request.

## 1. Executive summary

The original diagnosis identifies real performance problems, and most remain in the current source. The strongest remaining utility-tab issues are sequential requests, per-generator tariff calls, overlapping analytics datasets, and redundant property lookups.

The updated audit also finds a larger organization-dashboard cost: the ticket-summary endpoint performs **11 + 7P database requests**, where P is the number of properties returned for a non-empty organization. The new command center shares some requests correctly, but the dashboard parent independently runs an older summary fetch. This creates work outside that shared cache.

### Recommended priorities

1. Eliminate the organization ticket-summary fan-out and redundant dashboard data ownership.
2. Flatten electricity/diesel loading waterfalls and batch active tariffs.
3. Consolidate analytics datasets without losing older carry-forward readings or calendar-month data.
4. Coalesce notification refreshes and scope realtime handling.
5. Consolidate property-overview counts and move growing summaries away from raw-row downloads.
6. Lazy-load inactive role/tab code, unify session data ownership, and make cache invalidation targeted.
7. Verify deployed indexes and query plans before proposing additional database indexes.

**No runtime speedup has been measured.** This review verifies source structure and request/query counts along specified paths. It does not establish production load times, bundle sizes, database execution costs, or the cause of every slow tab. Benefits below are estimates or structural reductions, explicitly labeled.

### What is improved or already implemented

- AuthContext has membership caching, duplicate-fetch protection, parallel membership/profile queries, and a memoized value/client.
- OrgAdminDashboard no longer fetches its property list simply because activeTab changes; initialization has guard refs.
- PropertyAdminDashboard caches its property object; OverviewTab has a two-minute freshness check and duplicate-key guards.
- Diesel/electricity analytics have cached data paths; ElectricityStaffDashboard can show cached state before revalidating.
- Command-center widgets share URL-based cache and in-flight requests through useWidgetData.
- Roster GET requires property/month scope and selects explicit roster fields.
- Ticket property/status and DG tariff generator/effective-date composite indexes already exist in repository SQL.

These are verified current mitigations. Without the earlier source revision and production measurements, they are not proof of when a historical fix occurred or of a deployed performance improvement.

## 2. Method and evidence boundaries

Read the supplied PDF's complete extracted text and checked every numbered finding against component code, current callers, API implementations, caching/session infrastructure, and schema/migration files. Some “File/Files” entries in the PDF extraction contain no usable paths; corresponding paths below were located from actual implementations and call sites.

Inspected relevant organization/property/staff/MST dashboard paths, both utility staff dashboards and analytics views, spreadsheet loading, NotificationBell, property OverviewTab, shared command-center cards/hooks, and their data endpoints.

### Evidence labels

- **Verified:** directly visible source behavior, actual caller, query shape, index declaration, or counted statements.
- **Structural estimate:** request reduction or concurrency benefit if the proposed change is implemented correctly. Not measured latency.
- **Unverified runtime:** production timings, live row counts, deployed indexes, query plans, actual browser payloads, React commit time, network contention, and bundle bytes.

No application code, configuration, dependency, existing report, or database schema was changed. No packages were installed. No dashboard/API/database requests, migrations, seeds, user actions, or browser submissions were executed. Builds/tests were not run for this audit. The earlier audit's type-check result is not used as performance evidence.

The working tree already contained uncommitted task-manager/voice-related changes and CODEBASE_AUDIT.md. They were preserved.

### Counting terminology

- A browser Supabase query is an HTTP/PostgREST request plus database work.
- A Next API call is one browser request but can make many internal Supabase requests.
- An exact-count query is database work even with head:true and no row payload.
- Parallel requests still create load; fewer requests and fewer sequential stages are different benefits.
- Counts below cover successful, non-empty code paths and exclude auth/proxy checks, retries, dev-mode effect replay, and downstream triggers unless stated.
- Browser getSession/getUser latency depends on SDK/session state; source comments claiming “0ms” or “200ms” are not measurements.

## 3. Verification of every original finding

| Original finding | Current verdict | Evidence and correction |
|---|---|---|
| **P1, PDF p.1: per-generator DG tariff N+1** | **Remaining; execution description partly incorrect** | DieselStaffDashboard:180–194 and DieselSpreadsheetLogger:157–168 use Promise.all per generator, so their tariff calls are parallel, not sequential. DieselAnalyticsDashboard:143–157 does await a loop until the first valid tariff. The one-call-per-generator pattern remains. A selected-generator quick-log/history call is not itself an N+1 problem. |
| **P2, pp.1–2: DieselStaffDashboard waterfall and duplicate reads** | **Remaining; unsafe data-superset assumption** | Property:99 → generators:109 → latest readings:118 → averages:158 → parallel tariffs:180. Also, the API ignores the client's limit=100 parameter, so that “latest 100” request is not actually application-limited. A 30-day window is not guaranteed to contain the latest reading of a generator that has been idle longer. |
| **P3, p.2: ElectricityStaffDashboard eight-stage waterfall** | **Remaining, with cached-render mitigation** | Eight awaited data requests at :159, :169, :180, :202, :222, :244, :256, :264. Cache hydration at :132–144 does not stop network revalidation. Latest closings can predate the 30-day average window, so blindly merging those datasets is unsafe. |
| **P4, p.2: four overlapping Diesel Analytics reads** | **Remaining, with five-minute cache** | :175–186 issues today, current month, previous month, and trailing-30-days in parallel; custom ranges add a fifth. The 30-day window does not always cover a 31-day calendar month. The analogous electricity analytics pattern also remains. |
| **P5, p.3: every tab re-fetches property** | **Partly verified; “every tab” is too broad** | Diesel staff/analytics, electricity staff/analytics, and StockDashboard each read the property. Their parent passes propertyId rather than its available property object. Parent caching exists. Water/SOP/VMS must not be described as having the same property query without separate evidence. |
| **P6, p.3: NotificationBell getUser and unfiltered HR subscription** | **Remaining; additional comment subscription found** | :82 calls getUser per refresh; :322 calls it again during initialization. hr_tickets subscription :351–360 has no user/org filter. hr_ticket_comments :386–395 is also unfiltered. Events delivered under realtime/RLS visibility trigger full refreshes; this is not proof that all tenants' events are delivered. |
| **P7, pp.3–4: Overview has ten ticket COUNT queries** | **Remaining; count and suggested fix need correction** | Property Overview:1461–1469 has **eight** exact ticket counts plus one recent-ticket query; :1520–1537 adds a feature lookup. That is ten requests for a specific property, but not ten COUNTs. For “all”, feature lookup is a resolved local promise: nine real requests. Avoid downloading every ticket for counts; prefer an authorized aggregate result. |
| **P8, p.4: select('*') responses, including unfiltered roster** | **Partly remaining; roster claim outdated** | Diesel/electricity reading APIs and stock items still use broad projections. Roster :10–12 requires property/month, membership/staff data is property-filtered, and rosters use explicit columns plus a month range. Only offline staff retains select('*'), with a property filter. |
| **P9, pp.4–5: six missing composite indexes** | **Partly contradicted by repository SQL; deployment unknown** | Ticket (property_id,status) exists in mst_ticket_management.sql:28, with a wider variant in 20260402_performance_indexes.sql:7. DG tariff (generator_id,effective_from DESC) exists in utilities_v2_schema.sql:85–86. Four other proposed composites were not found in checked SQL. No live database catalog or plan was inspected. |

**Historical fix status:** none of P1–P7 is fully resolved in the current source. P8's broad roster claim is no longer accurate. Two P9 “missing index” claims are false at repository level. Existing mitigations above reduce repeated or perceived loading in some paths, but do not remove the cold-load bottlenecks.

## 4. Highest-impact remaining and newly discovered issues

Priorities: **P1 = high impact**, **P2 = medium impact**, **P3 = low/conditional**. They reflect source-based expected impact, not a measured production ranking.

### F1 — Organization ticket summary scales queries with property count

**Priority:** P1 / High  
**Status:** Newly documented bottleneck; verified source  
**Affected files:**
- app/api/organizations/[orgId]/tickets-summary/route.ts:22, :93, :180–212
- frontend/components/dashboard/command-center/useCommandCenterData.ts:129
- frontend/components/dashboard/OrgAdminDashboard.tsx:665–672

The endpoint first fetches properties, then runs ten organization-level requests, then launches seven exact-count queries per property. The per-property batch starts after the organization batch has completed.

**Verified formula:** 1 property request + 10 organization requests + 7P property requests = **11 + 7P** internal Supabase requests for a non-empty organization. For an illustrative P=13, that is **102**, not a verified count of current production properties. Of these, 8 + 7P are ticket-count requests.

The trend request also asks for up to 100,000 raw rows and calculates trends in server JavaScript. That limit does not prove the deployed PostgREST row cap permits 100,000 results.

**Recommended fix:** return global and per-property grouped counts from one authorized aggregation. Compute trends using a grouped query/RPC rather than transferring raw ticket history. Keep status cohorts, period boundaries, feature settings, and RLS/access scope explicit and consistent.

**Expected benefit — structural estimate:** removes the 7P request-growth term and repeated scans. More predictable database concurrency as properties grow. No millisecond or percentage gain is claimed.

**Validation:** compare all counts/trends across every status and period; inspect actual database timings/concurrency. Do not replace this with an unbounded browser download of all tickets.

### F2 — New command center and old parent summary pipeline both fetch

**Priority:** P1 / High  
**Status:** Newly discovered duplicated work; verified call paths  
**Affected files:**
- frontend/components/dashboard/OrgAdminDashboard.tsx:612–803
- frontend/components/dashboard/OrgAdminDashboard.tsx:1570
- frontend/components/dashboard/command-center/CommandCenter.tsx:111
- frontend/components/dashboard/command-center/useCommandCenterData.ts:129–138

Parent fetchSummaries runs when dashboardContent is undefined; it is not gated by the visible tab. Its batch contains five Next API calls and two direct Supabase queries. The overview now renders CommandCenter, which independently loads tickets, finance, AOP, mailbox, and material requests, followed by other card feeds.

The parent's tickets-summary call uses timePeriod while command-center cards request period=all. Even when URLs happen to match, parent fetch does not go through useWidgetData, so its in-flight deduplication cannot share that request. Cache hits in parent hydrate state but still re-fetch.

The legacy requests block at :1777 is hidden with display:none on other non-overview tabs while TicketsView remains mounted. TicketsView's mount/filter effects fetch tickets and filter options. Because its enclosing motion.div is keyed by activeTab (:1657), tab switches recreate these children rather than permanently preserving them.

**Recommended fix:** give each feed one owner, share data through the existing data layer, and gate inactive data consumers explicitly. Where state retention is desired, pass an enabled/active signal rather than relying on CSS visibility. Confirm other tabs that still need the parent's summaries before removing any fetch.

**Expected benefit — structural estimate:** avoids a redundant five-API/two-query batch where it is unnecessary and prevents hidden ticket-list/filter work on unrelated tabs. The exact savings depend on active tab, cache state, scope, and period.

### F3 — Eight awaited requests block electricity cold loads

**Priority:** P1 / High  
**Status:** Original P3 remains  
**Affected file:** frontend/components/electricity/ElectricityStaffDashboard.tsx:159–275

Verified sequence for a property with meters:
1. Property.
2. Electricity meters.
3. Facility layout.
4. Recent electricity readings.
5. Thirty-day average readings.
6. Meter multipliers.
7. Active grid tariff.
8. Pending OCR retakes.

Most requests need propertyId, which is already known. Latest-query limit depends on meter count, but many other operations are independent of it. Cached data is rendered earlier, while all eight requests still execute.

**Recommended fix:** launch independent property/meter/layout/tariff/multiplier/retake/average work concurrently. Only sequence truly dependent queries. Prefer a purpose-specific bootstrap/latest-per-meter result if reducing request count as well as elapsed wait.

**Expected benefit — structural estimate:** reduce up to eight serial network stages to one or two dependency batches; parallelization alone does not reduce total database work. Perceived cold-load improvement is likely but unmeasured.

**Correctness guard:** latest-per-meter must cover inactive meters. Current global latest limit=2 × meter count is not a guarantee that every meter appears when a few meters dominate recent readings.

### F4 — Diesel staff waterfall, tariff fan-out, and ignored limit

**Priority:** P1 / High  
**Status:** Original P1/P2 remain; ignored limit newly verified  
**Affected files:**
- frontend/components/diesel/DieselStaffDashboard.tsx:99–194
- frontend/components/diesel/DieselSpreadsheetLogger.tsx:142–204
- frontend/components/diesel/DieselAnalyticsDashboard.tsx:143–157
- app/api/properties/[propertyId]/diesel-readings/route.ts:20–58
- app/api/properties/[propertyId]/dg-tariffs/route.ts:25–82
- backend/db/migrations/utilities_v2_schema.sql:316–336

Diesel staff has four initial data requests plus G tariff calls, arranged in five dependency stages. For illustrative G=3, that is seven data requests; the three tariffs share the final parallel stage.

The latest-reading request sends limit=100, but GET reads only startDate/endDate/generatorId/period and never applies a limit. Without a date range, it asks for all property history subject to the deployed database response cap.

Analytics checks tariffs serially until the first truthy cost is found. Spreadsheet can reuse parent generators/tariffs when provided, but an empty tariff object causes fallback per-generator requests; an empty valid result is treated like “not loaded”.

**Recommended fix:** parallelize independent reads and add a bounded, explicitly latest-per-generator path. Batch active tariffs and represent “loaded with no tariff” separately from “not loaded”.

**Important correction to the old recommendation:** the unscoped DG endpoint returns tariff **history**, not an already date-filtered active-tariff map. It ignores date in the no-generator branch. Batch logic must preserve effective_from <= date, effective_to null-or->=date, and newest-valid-version rules from get_active_dg_tariff. Simply taking the first row per generator can select future or expired rates.

**Expected benefit — structural estimate:** G per-generator calls become one batch, saving G−1 browser calls when G>0. The existing all-history branch internally makes two queries, so it is not automatically a database-query win for one generator. An active-only batch provides a better bounded contract.

### F5 — Overlapping analytics in both utility modules

**Priority:** P1 / High for frequently used analytics; otherwise P2  
**Status:** Original P4 remains; electricity counterpart newly included  
**Affected files:**
- frontend/components/diesel/DieselAnalyticsDashboard.tsx:175–186
- frontend/components/electricity/ElectricityAnalyticsDashboard.tsx:283–296
- app/api/properties/[propertyId]/diesel-readings/route.ts:28–58
- app/api/properties/[propertyId]/electricity-readings/route.ts:29–61
- app/api/organizations/[orgId]/diesel-readings/route.ts:18–48
- app/api/organizations/[orgId]/electricity-readings/route.ts:17–29

Each analytics module fetches today, month-to-date, previous calendar month, and trailing thirty days. A custom range adds a fifth request, after property/equipment/tariff bootstrap work.

**Recommended fix:** either one bounded union-of-required-dates dataset with narrow fields and guaranteed completeness, or purpose-specific server aggregates for current/previous periods plus a bounded trend series. Custom-range loading should be independent when possible.

**Expected benefit — structural estimate:** standard four overlapping reading calls can become two disjoint/complete datasets or one aggregate request. Shared bootstrap data can remove additional redundant work.

**Correctness guard:** use the earliest required start date, not an assumed 30-day superset; include a full 31-day month and requested custom intervals. Preserve local business-day boundaries. Do not accept silent row-cap truncation as complete history.

### F6 — Notification events trigger full sequential refreshes

**Priority:** P1 / High under active HR workloads  
**Status:** Original P6 remains; expanded finding  
**Affected files:**
- frontend/components/dashboard/NotificationBell.tsx:80–183, :278, :320–427
- app/api/pending-actions/route.ts:22–44

A refresh awaits getUser, notification rows, recent HR comments, attention-required HR tickets, and pending-actions API work. Initialization also calls getUser again before installing channels.

Unfiltered HR ticket and comment subscriptions, filtered pending-action events, custom refresh events, browser focus, and dropdown opening can all launch full refreshes. No in-flight gate or event coalescing was found. The notification INSERT channel already updates local state without full refresh.

**Recommended fix:** reuse the known client identity for client queries while retaining server authorization; parallelize independent datasets; add single-flight/coalesced refreshes; narrow event relevance without losing submitter, assignee, HR, or reassignment cases. An assignee-only filter, as proposed in the PDF, is insufficient for all those roles.

**Expected benefit — structural estimate:** avoids an explicit repeated auth lookup and prevents E relevant delivered events from starting E overlapping refresh pipelines during a burst. Actual event rate and latency remain unmeasured.

### F7 — Property Overview counts and second batch block all results

**Priority:** P1 / High for property landing pages  
**Status:** Original P7 remains  
**Affected file:** frontend/components/dashboard/PropertyAdminDashboard.tsx:1461–1588, :1683–1704

Eight exact counts, recent tickets, and validation settings run in one batch. Only after that completes does a second batch start electricity readings, diesel readings, VMS summary, vendor summary, and SOP completions. All summary state is committed near the end.

For a specific property, **15 top-level data requests** are visible in this successful path: ten in the first batch and five in the second. Backend API internals add more work. “All properties” skips the remote validation lookup, giving fourteen.

**Recommended fix:** aggregate ticket counts, preserve the limited recent-ticket list, and load independent summary feeds at the same time. Give sections independent loading/error states. Use server aggregates for long histories rather than transferring every reading/completion to compute totals.

**Expected benefit — structural estimate:** eight count requests can become one aggregate request (seven fewer if no extra count requests are needed). Removing the first-batch dependency lets independent cards become useful earlier.

**Do not use the PDF's unbounded all-ticket select as the default fix.** It trades round-trips for growing payload, client CPU, and potential row-cap undercounting.

### F8 — Broad reading/stock responses and missing application pagination

**Priority:** P1 for long histories; P2 otherwise  
**Status:** Original P8 partly remains  
**Affected files:**
- app/api/properties/[propertyId]/diesel-readings/route.ts:28–36
- app/api/properties/[propertyId]/electricity-readings/route.ts:29–41
- app/api/organizations/[orgId]/electricity-readings/route.ts:17–21
- app/api/properties/[propertyId]/stock/items/route.ts:25–48
- frontend/components/dashboard/PropertyAdminDashboard.tsx:1545–1586
- frontend/components/dashboard/OrgAdminDashboard.tsx:636–692

Reading APIs use wildcard columns and joins. They lack an explicit application pagination contract for the examined GET paths. Stock fetches all matching items before applying the low-stock filter in JavaScript. Overview defaults can request all-time raw data.

**Recommended fix:** purpose-specific projections/summary endpoints; bounded paginated detail queries with stable ordering; completeness metadata; apply database-side filters where supported. Preserve fields required by existing logger/register/export consumers.

**Expected benefit — estimate:** fewer transferred bytes and less JSON/all-history processing as data grows. Byte and parse-time savings require actual responses. Deployed row caps may instead truncate results; absence of paging is also a correctness risk.

**Already improved:** roster is scoped by property/month and returns explicit roster columns. Its three independent GET reads are still serial and can be parallelized, but it is not an unfiltered whole-table endpoint.

### F9 — Finance summary loads complete ledgers in sequential pages

**Priority:** P1 at large ledger sizes; P2 pending measurement  
**Status:** Newly discovered scaling concern  
**Affected files:**
- app/api/accounts/summary/route.ts:21–24, :91–99, :158–196
- frontend/components/dashboard/command-center/useCommandCenterData.ts:133

PO and payment datasets are loaded org-wide, using 1,000-row pages. Their two chains run in parallel, but each chain awaits every page before starting the next. Critical flags load afterward. The endpoint then aggregates/filters in JavaScript.

The month view intentionally still reads all historic tranches to net reservations and show the full backlog. Adding a month filter to every underlying read would change financial results.

**Recommended fix:** authorized server/database aggregates or a transactionally correct precomputed summary; bounded queue queries separate from totals. Preserve reservation netting, backlog, cancelled/draft exclusions, and aligned/completed date semantics.

**Expected benefit — estimate:** work no longer requires transferring the whole ledger into Next on every uncached summary request. The number of page requests depends on actual rows; comments naming 5,265 POs are not treated as a current measured count.

### F10 — All role dashboards and many inactive tabs are statically imported

**Priority:** P2 / Medium; measure bundle before final ranking  
**Status:** Newly documented structural concern  
**Affected files:**
- frontend/components/dashboard/UnifiedDashboard.tsx:8–18
- frontend/components/dashboard/OrgAdminDashboard.tsx:21–64
- frontend/components/dashboard/PropertyAdminDashboard.tsx:20–58
- frontend/components/dashboard/MstDashboard.tsx:26–43
- frontend/components/dashboard/StaffDashboard.tsx:20–44

UnifiedDashboard imports eleven role dashboard implementations. Organization/property dashboards import many domain modules and modals even when their tabs are inactive. Some scanner imports in staff/MST are already dynamic, demonstrating an existing pattern.

OrgAdminDashboard imports BDQuickStats from UnifiedDashboard (:60), while UnifiedDashboard imports OrgAdminDashboard (:12). This cycle complicates extracting role-level lazy boundaries.

**Recommended fix:** separate shared BDQuickStats from the role router; lazy-load role bodies and heavy tabs/modals at intentional boundaries with appropriate loading states. Avoid disabling SSR globally.

**Expected benefit — estimate:** less initial JavaScript loading/parsing for users who need one role and one tab. Actual Next/Webpack chunk reuse and shipped byte reductions require a production bundle inspection; source size is not bundle size.

Measured source footprint only: OrgAdminDashboard is 4,553 physical lines / 273,944 bytes; PropertyAdminDashboard 2,694 / 171,513. These figures do not prove a specific runtime slowdown.

### F11 — Duplicate session ownership delays role selection

**Priority:** P2 / Medium  
**Status:** Newly documented duplication  
**Affected files:**
- frontend/context/AuthContext.tsx:70–126, :221–252
- frontend/hooks/useAppSession.ts:18–55, :85–107
- frontend/components/dashboard/UnifiedDashboard.tsx:152
- frontend/components/dashboard/SettingsView.tsx:34

AuthContext resolves and caches memberships/profile. useAppSession separately fetches getSession and two membership datasets per hook instance, plus an extra query for super tenants. UnifiedDashboard waits on this hook to select a role body.

The hook's two membership queries are already parallel. The issue is duplicate ownership/caching, not an eight-stage auth waterfall.

**Recommended fix:** derive a documented AppSession shape from the existing authoritative auth/membership state, ensuring equivalent role precedence, active-membership rules, organization selection, and super-tenant property scope. Do not skip server permission verification.

**Expected benefit — structural estimate:** remove two repeated membership queries per covered mount once equivalent data is available. Super-tenant assignment data may still need a dedicated query.

### F12 — Cache invalidation is too broad and cache freshness is inconsistent

**Priority:** P2 / Medium  
**Status:** Newly documented performance/recovery concern  
**Affected files:**
- frontend/context/DataCacheContext.tsx:24–48, :59–105
- frontend/components/diesel/DieselAnalyticsDashboard.tsx:95–107, :223–237
- frontend/components/electricity/ElectricityStaffDashboard.tsx:132–159
- frontend/lib/dashboard/useWidgetData.ts:27–61, :66–73, :104–124

Diesel realtime invalidates **all** DataCache entries on each property reading event, including unrelated module/user-storage entries. Cached diesel analytics returns without network work, while cached electricity staff always runs the full refresh. Cache getters change identity when cache state changes; shared provider values are not memoized, increasing consumer render/effect churn. These facts do not prove an infinite fetch loop.

useWidgetData successfully deduplicates URLs but has no active expiry timer: TTL is checked when its subscription effect runs. Mounted cards can remain unchanged beyond TTL. Its URL-only cache also lacks an auth-identity key. invalidateWidgetData deletes/notifies but does not directly reload a stable mounted URL; refresh does load. That distinction matters if invalidation is used later.

**Recommended fix:** target invalidation by user/scope/domain/date key; define consistent freshness/revalidation rules; keep getter identity/provider updates controlled; explicitly refresh active subscribers; clear or scope widget cache on auth changes. Avoid global cache wipes for ordinary reading updates.

**Expected benefit — estimate:** fewer unrelated cold reloads and less state/render churn, while retaining current-data guarantees. Do not treat skipped work from stale data as a performance fix.

### F13 — Obsolete requests continue during navigation/slow networks

**Priority:** P2 / Medium  
**Status:** Newly documented source risk  
**Affected files:**
- frontend/components/diesel/DieselStaffDashboard.tsx:93–204
- frontend/components/electricity/ElectricityStaffDashboard.tsx:129–297
- frontend/components/diesel/DieselAnalyticsDashboard.tsx:92–215
- frontend/components/electricity/ElectricityAnalyticsDashboard.tsx:187–327
- frontend/components/dashboard/PropertyAdminDashboard.tsx:1424–1704

These examined load paths lack AbortController/cancellation or request-generation checks. Switching property/range/tab can leave old loads consuming resources and writing old results after newer loads. Realtime can start another fetch while one is pending.

**Recommended fix:** request ownership by scope/generation, cancellation where supported, single-flight per key, explicit deadlines/recovery, and ignoring superseded results. Deadline handling must not blindly retry mutations.

**Expected benefit — estimate:** less abandoned work during navigation and fewer stale-result flashes. Actual waste depends on network delay and interaction frequency.

## 5. Index finding — detailed reconciliation

**Priority:** P3 / Conditional until production query-plan verification.

| PDF-proposed index | Repository evidence | Current conclusion |
|---|---|---|
| tickets(property_id,status) | backend/db/migrations/mst_ticket_management.sql:28; wider property/status/created_at index in backend/db/migrations/20260402_performance_indexes.sql:7 | Already declared. Do not propose a duplicate without checking deployed definitions/usage. |
| diesel_readings(property_id,reading_date DESC) | Single-column property/date/generator indexes in backend/db/schema/evolution.sql:202–204 | Proposed composite not found in checked SQL. Candidate, not verified live absence. |
| electricity_readings(property_id,reading_date DESC) | Single-column indexes in backend/db/migrations/electricity_logger.sql:45–47 | Proposed composite not found. Candidate. Latest query also orders by created_at, which a final plan review should consider. |
| electricity_readings(property_id,ocr_status) | ocr_status-only index in backend/db/migrations/20260404_ocr_schema.sql:65 | Proposed composite not found. Candidate; partial index for sparse retakes may be worth evaluating. |
| dg_tariffs(generator_id,effective_from DESC) | backend/db/migrations/utilities_v2_schema.sql:85–86; unique generator/effective_from at :88–89 | Already declared. Main bottleneck is calling it repeatedly, not verified missing index. |
| notifications(user_id,created_at DESC) | user_id-only index in backend/db/migrations/20260205_notification_system.sql:83 | Proposed composite not found. Candidate. |

Search included backend/db, supabase SQL/migrations, root sql, and scripts SQL; no live pg_indexes catalog or EXPLAIN plan was queried.

**Expected benefit — unverified:** potentially fewer scanned/sorted rows for observed filter/order patterns. Benefit depends on table size, selectivity, existing deployed indexes, RLS plans, and workload. Indexes also add storage/write overhead. No schema change is included in this audit.

## 6. Improvements to retain

| Current implementation | Verified evidence | Limit |
|---|---|---|
| Parallel, cached auth memberships | AuthContext:70–126; memoized context :450 | useAppSession still separately reads memberships. |
| Property list not tied to tab changes | OrgAdminDashboard:402–403, :503–521 | Other parent summaries still execute independently of visible overview. |
| Property object cache | PropertyAdminDashboard:495–519 | Child modules still re-read it. |
| Fresh property overview cache | PropertyAdminDashboard:1425–1440, :1683 | Does not change the fifteen-request cold path. |
| Parallel DG staff/spreadsheet tariffs | DieselStaffDashboard:180; DieselSpreadsheetLogger:157 | Request fan-out remains; analytics tariff loop is serial. |
| Cached analytics with early return | DieselAnalyticsDashboard:95–107; ElectricityAnalyticsDashboard:191–205 | Cold/custom/invalidation loads still overlap datasets. |
| URL cache with in-flight dedupe | useWidgetData:27–61 | Parent direct fetches bypass it; freshness/auth boundaries need attention. |
| Shared agent pulse payload | AgentActivityCard:432–435 and :613; same pulse URL | Keep sharing; do not assume a request per visible card. |
| Request-tab AgentPulse gated by activeTab | OrgAdminDashboard:1778–1783 | Ticket list itself is still mounted behind CSS visibility on other non-overview tabs. |
| Narrow, scoped roster reads | app/api/roster/route.ts:10–12, :26–40, :77–95 | Three GET datasets still await sequentially. |
| Selected narrow diesel summary fields | app/api/organizations/[orgId]/diesel-summary/route.ts:48 | Raw-reading endpoints remain broad. |

## 7. Recommended fix order

This is a plan for a separate authorized implementation task, not changes made here.

| Order | Work | Expected benefit | Dependencies / safeguards |
|---:|---|---|---|
| 0 | Capture production baseline for representative roles, sizes, cold/warm states | Establish real priority and prevent false improvement claims | Read-only traces; no live account/data mutations. |
| 1 | F1 + F2: remove org-summary per-property counts and duplicate/inactive owners | Highest expected reduction in shared landing-page database work | Preserve counts/cohorts, tenant scope, other tab consumers, and trends. |
| 2 | F3 + F4: utility parallel loading and active tariff/latest-reading batch | Reduce cold-load sequential stages and tariff fan-out | Correct versioned tariffs and idle-equipment carry-forward. |
| 3 | F5 + F8: bounded non-overlapping analytics/detail/summary contracts | Reduce duplicate transfers and history growth | Complete intervals, month boundaries, paging, existing export fields. |
| 4 | F6: notification identity reuse, relevant events, single-flight | Reduce burst-driven background load | Preserve HR/submitter/assignee/reassignment visibility and server auth. |
| 5 | F7 + F9: property aggregates and finance summary architecture | Reduce repeated count work and whole-ledger transfers | Preserve all financial reservation/backlog semantics. |
| 6 | F10 + F11: role/tab lazy boundaries and derived session | Reduce expected initial JS and redundant membership queries | Measure actual chunks; preserve SSR/loading and role resolution. |
| 7 | F12 + F13: targeted caches and request lifecycle | Reduce remount/reconnect/navigation waste | Freshness, auth scope, abort behavior, safe recovery. |
| 8 | Conditional index work | Improve measured slow query plans | Verify live existing definitions first; no duplicate/blind migration. |

Parallelization and query reduction should be reviewed together: launching 102 count requests faster is not a scalable fix.

## 8. Measurement plan and acceptance criteria

No measurements in this section were taken during this audit.

### Baseline matrix

- Roles: organization admin, property admin, staff, MST; finance and HR-heavy users where relevant.
- Scope: one property and a larger organization; record actual property/equipment/row counts.
- Screens: login-to-dashboard, overview, diesel/electricity logging, both analytics, requests, notification bell.
- States: cold navigation, warm revisit, browser refresh, rapid property/tab/range changes, slow network, realtime burst, account switching.
- Mode: production build for timing. Keep dev-mode compilation/effect replay separate.

### Record

- Time to shell, first useful card, and last required section; p50/p95 across repeated runs.
- Browser request counts, duplicates, initiators, waterfall stages, transferred bytes, JSON parsing and long tasks.
- Server endpoint elapsed time and internal query count; database query plans/timing separately.
- Initial and per-tab JavaScript chunks; React commits and list/spreadsheet interaction latency.
- Realtime events versus refreshes; aborted/superseded requests; cache hits/freshness.
- Data completeness and correct totals under realistic row caps.

### Accept a fix only when

- Its targeted redundant calls or sequential dependencies disappear from the trace.
- Cold/warm timings improve under the same scope/network conditions, not because stale data is displayed.
- Counts, tariff selection, carry-forward, financial netting, and role permissions match agreed behavior.
- No active tab requires hidden components to fetch its data.
- Bursts do not create unlimited overlapping refreshes.
- Paging/aggregate results remain correct beyond a single PostgREST page.
- Index changes are justified by deployed definitions and query-plan evidence.

Do not claim “under three seconds”, a percentage speedup, bundle reduction, or fewer production DB scans until those observations exist.

## 9. Final audit result

The PDF's central request-pattern concerns remain useful, but its sequential tariff claim, “30-day superset” assumptions, ticket COUNT count, unfiltered roster claim, and two missing-index claims need correction.

The current implementation includes genuine caching and parallelization improvements. It also has newly documented shared-dashboard fan-out and duplicated ownership that should be evaluated before smaller UI micro-optimizations.

**Deliverable:** this updated report only. No implementation, existing-file edit, dependency/configuration change, package installation, database/schema operation, or runtime performance claim was made.

