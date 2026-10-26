# Dashboard performance — baseline (Phase 0)

Purpose: write down how fast the dashboard is **before** any optimisation, so every later phase can be compared with the
same numbers. Nothing in the app changes in Phase 0. Source: *Dashboard Performance audit* (Codex, 11 Oct 2026).

Fill in the "Before" column once. After each phase, add a new column and fill it in the same way.

---

## 1. Code sent to the browser (measured by script)

Run after a production build:

```
npm run build
node scripts/measure_dashboard_bundle.mjs
```

| Measure (dashboard page `/[orgId]/dashboard`) | Before (2026-10-12) |
|---|---|
| JavaScript files loaded up front | **69** |
| Size, uncompressed | 7,625 KB |
| Size, gzip | 1,927 KB |
| Size, Brotli (what most browsers receive) | **1,576 KB** |
| Largest single file (Brotli) | 195 KB (911 KB raw) |

The audit measured 69 files / 7,634 KB raw / 1,937 KB gzip / 1,577 KB Brotli on 11 Oct — our script agrees.

What the biggest files seem to contain (a text search of the built files, so a strong hint, not proof): **Excel
libraries** (`xlsx` / SheetJS, `exceljs`), **PDF export** (`html2canvas`, `jspdf`, `pdfjs`), `three` (3D) and the
Supabase client. Excel and PDF code is only needed when someone imports or exports a file, yet every user downloads it
when the dashboard opens — a good first target for Phase 1.

---

## 2. Browser timings (you, ~15 minutes, Chrome)

Use the **live site**, a normal Chrome window (not incognito, extensions are fine), on your usual internet.

**Setup, once:**
1. Open the dashboard and log in.
2. Press **F12** → open the **Network** tab.
3. Tick **Disable cache** only for the "cold" test (step A), untick it for the others.

**For each role (org admin, property admin, MST):**

| Step | How | Write down |
|---|---|---|
| A. Cold load | Network tab: tick *Disable cache*. Press **Ctrl+Shift+R**. Stop the clock when the page is usable (you could click a card). | Seconds (a phone stopwatch is fine). Also the two numbers at the bottom of the Network tab: **requests** and **transferred**. |
| B. Warm load | Untick *Disable cache*. Press **F5**. | Seconds, requests, transferred |
| C. First tab open | Click the **Diesel** tab (or Electricity / Tickets if Diesel is not there). Click 🚫 (clear) in the Network tab first. | Seconds until the numbers show, requests |
| D. Tab revisit | Click another tab, then back to the same tab. Clear the Network tab first. | Seconds, requests — **does it show a loader again? (yes / no)** |
| E. Overview | Clear the Network tab, open **Overview**. | Seconds, requests |

**Results table (copy for each role):**

| Role: super-admin | Seconds | Requests | Transferred | Notes |
|---|---|---|---|---|
| A. Cold load | 8 | 84/224 | 6.4/8.9 | this is for the super-admin login dashboard, the sidebar is clickable, but the dashboard cards take time to load. |
| B. Warm load | 5.5 | 79/84 | 6.4/6.4 | |
| C. First tab open (tab: ____) | 4 | 12/108 | 74/74 | |
| D. Tab revisit | 4 | 12/13 | 73/73 | loader again? yes |
| E. Overview | 2 | 29/40 | | I did this by revisiting the dashboard tab again. |

Tip: do each step twice and write the slower one — the first try is sometimes unlucky.

---

## 3. Live database checks (optional, read-only — nothing is changed)

### 3a. Supabase advisors
Supabase dashboard → **Advisors** → **Performance** (and **Security**). Copy the list of warnings (or a screenshot).

### 3b. Which indexes really exist
Supabase dashboard → **SQL Editor** → paste and **Run**. This only **reads** the list of indexes.

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'tickets', 'dg_tariffs', 'diesel_readings', 'electricity_readings', 'notifications',
    'ppm_schedules', 'ppm_completion_reports', 'ppm_audit_reports',
    'organization_memberships', 'property_memberships'
  )
order by tablename, indexname;
```

Export the result (Download → CSV) and send it to me.

### 3c. How big the tables are (helps decide what matters)

```sql
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
    'tickets', 'dg_tariffs', 'diesel_readings', 'electricity_readings', 'notifications',
    'ppm_schedules', 'ppm_completion_reports', 'ppm_audit_reports',
    'organization_memberships', 'property_memberships'
  )
order by n_live_tup desc;
```

---

## 4. Results log

| Date | Phase | Bundle (Brotli) | Org admin cold load | Tab revisit (loader again?) | Notes |
|---|---|---|---|---|---|
| 2026-10-12 | 0 — baseline | 1,576 KB (69 files) | 8 s (super-admin), 84 requests, 6.4 MB | 4 s, 12 requests — **yes** | only the super-admin role measured |
| 2026-10-12 | 1 — load code per role / per tab (local build, not deployed) | shell 126 KB; per role: super-admin 217, property admin 180, MST 160, staff 160, others 130–435 KB | _to measure on localhost_ | _unchanged — Phase 2_ | Excel/PDF code now loads only with the tabs that use it |
| 2026-10-12 | 2 — remember tab data (local build) | unchanged | _to measure on localhost_ | _expected: no loader on revisit for Diesel, Electricity, Documents, Vendors, Stock report, PPM, Assets_ | caches cleared on user change; HR, Users, Visitors, Procurement, AI tickets deliberately not cached |
| 2026-10-13 | 1b — no extra tab spinner | _to re-measure_ | | | tab code is preloaded in the background after the dashboard shows (owner asked for no new spinner) |
| 2026-10-15 | 3 — stop unused work (local, not deployed) | _to re-measure_ | _expected: ~7 fewer requests on org dashboard open_ | unchanged | hidden old Overview panel and its data loading deleted from `OrgAdminDashboard.tsx`; unused Material Symbols stylesheet removed; 5 s guard added to the second chunk-reload path. See [DASHBOARD_PERFORMANCE_PLAN.md](DASHBOARD_PERFORMANCE_PLAN.md) |
| 2026-10-15 | build after Phases 1–4 | **shell 124 KB (15 files)**; org/super-admin 207 KB (was 217 before Phase 3), property admin 179, MST 159, staff 160 | _owner to measure with `npm run start`_ | | vs. 1,576 KB / 69 files before Phase 1 |
| 2026-10-15 | 8 — trim code loaded up front (local, not deployed) | **measured:** org admin 208 → 193 KB, property admin 180 → 155 KB, procurement 440 → 327 KB (Brotli, shell + role); shell 126 KB | | | PPM sub-tabs (Reports, AMC, Compliance, Vendors, Audit) load when PPM opens, preloaded in the background (Calendar, the default, unchanged); procurement SitePricingAdminTab loads with its tab; pop-ups in Org admin (Invite, Ticket create, Stock movement) and Property admin (Vendor export, Ticket create, Add member, Stock movement, Client QR, Vendor management) moved out of the dashboard file but stay mounted as before. FeedbackModal left (the always-loaded sidebar uses it). |
| 2026-10-15 | 6 — notification bell (local, not deployed) | unchanged | | | Background refreshes use the signed-in user from useAuth (auth server only as fallback); realtime events / window focus / app events are merged (0.5 s) and never overlap; clicks still refresh at once; each bell has its own channel names (fixes the two-bells clash). getUser left in the 3 click actions. |
| 2026-10-15 | 5 + 5b — fewer / faster requests (local, not deployed) | unchanged | _to measure_ | | **5:** one DG-tariff request per property (shared `pickActiveTariffs`, verified = `get_active_dg_tariff` on all 9 live generators × 4 dates); Diesel logger 30-day averages from the full list (falls back if the list may be capped); spreadsheet re-reads only on real generator changes; tickets-summary org totals = sum of per-property counts (verified equal, 28 checks); Diesel/Electricity analytics 4 period reads → 2. 5.4 (pass property to tabs) skipped: no time saved since Phase 4. **5b:** accounts + AOP paging in waves after the first page (180 offline cases identical to the old loop); AOP trend loads everything once (verified identical, 1,899/1,899 rows); electricity tracker, agents/runs, aop/summary, diesel-summary start independent reads together. Skipped: accounts aligner-name pre-start (negligible since Mumbai region). |
| 2026-10-15 | 5A — instant cards (local, not deployed) | unchanged | _to measure_ | | Card loader saves each successful answer per user (24 h, per app version, wiped on logout / user change; errors never saved) and shows it at once next visit while refreshing; Command Center requests start during "Loading your dashboard…" for org admins. 10 offline checks passed. Live before: tickets-summary 2.48 s, finance summary 2.03 s, others 0.2–0.45 s (after Mumbai region + Phases 3–4 deploy). |
| 2026-10-15 | data fix — property photos | unchanged | _to re-measure_ | | Cold-load trace showed `properties?select=*` = 6.4 MB (96% of data): 5 properties stored photos as base64 text in `image_url`. Owner re-saved them via Edit → Save (app uploads to `property-photos` storage and stores a link). Rows: ~8.3 MB → ~44 KB. Quess House (24 KB) and D Mafatlal (19 KB) still base64, optional. |
| 2026-10-16 | 7 — User Directory remembers its list (local, not deployed) | unchanged | | _expected: no "Loading users..." on return within 5 min_ | **7.1 only.** Last list per signed-in user + org/property scope kept in memory (5 min, emptied on user change / logout), shown at once, refreshed quietly; a failed or refused refresh shows the error as before and drops the copy; approve / reject / role edits kept in the copy. Same request count. 12 existing + 4 new offline browser checks pass. **7.2 HR tickets:** already cached by `hrDataCache.ts` (commit 27a1d56), not touched; gap reported: its sessionStorage copies are not tied to the user and survive logout in the same tab. **7.3 PPM Audit:** skipped (owner: ignore PPM). |
| 2026-10-15 | 4 — independent requests start together (local, not deployed) | unchanged | _to re-measure with production build_ | unchanged | 9 files: Diesel/Electricity staff + analytics, spreadsheet, Property Overview, tickets-summary, users list, accounts summary. Answers are still read in the original order, so errors and state updates are unchanged. Deviations from plan: Diesel analytics price loop left as is (it stops at the first price; Phase 5.1 replaces it); users-list permission checks left untouched (CLAUDE.md), only the reads after the check overlap. |

---

## 5. What the live checks showed (2026-10-12)

**Browser (super-admin only):** cold load 8 s / 84 requests / 6.4 MB; warm load 5.5 s; first tab open 4 s; going back to
a tab takes the same 4 s and 12 requests and **shows the loader again** — this confirms the audit's P0-C (tabs reload on
every visit). The sidebar works quickly; the dashboard cards are what keep the user waiting.

**Indexes (3b):**
- Already there, do **not** add: tickets `(property_id, status)` and `(property_id, status, created_at)`, tickets
  `(organization_id, property_id, status, created_at)`, DG tariffs `(generator_id, effective_from desc)`, diesel readings
  `(generator_id, reading_date)` (unique — already serves "latest reading per generator").
- Missing (candidates for Phase 8, only if measured): electricity readings `(meter_id, reading_date)`, notifications
  `(user_id, created_at)`, PPM schedules `(property_id, planned_date)`.
- Duplicates (same columns twice — they slow writes a little, harmless otherwise): tickets `idx_tickets_org` =
  `idx_tickets_org_id`; tickets `idx_tickets_property` = `idx_tickets_prop_id`; property memberships `(user_id, property_id)`
  exists three times. Removing them is a later, optional clean-up.
- `ppm_completion_reports` does **not** appear in the list. The PPM audit code queries that table for every schedule
  (`auditService.ts:41`, comment: "assuming table ppm_completion_reports"). If the table does not exist, every lookup fails
  silently and every schedule shows "no report" — a correctness bug, not just speed. (Owner: ignore for now.)

**Row counts (3c) look wrong:** tickets 2, memberships 0, readings 0. These come from Postgres statistics, which can be
empty or stale; they are not real counts.

**Security advisor (3a) — outside this plan (owner declined to act on it for now):**
- `public.users` has **row level security turned OFF**, although policies exist for it.
- 5 views run with the creator's rights (`SECURITY DEFINER`): `mst_workload`, `user_engagement_metrics`,
  `user_status_summary`, `module_usage_summary`, `v_oem_goal_progress`.
- No performance warnings were reported.
