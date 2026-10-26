# Dashboard performance — safe implementation plan (Phases 3–8)

Written 2026-10-15. Sources: the Codex audit (*Project Performance Audit*, 11 Oct 2026), the earlier Claude audit
(*Dashboard Performance Diagnosis*, PDF), and a fresh read of the current code. Measurements and history live in
[DASHBOARD_PERFORMANCE_BASELINE.md](DASHBOARD_PERFORMANCE_BASELINE.md).

**Rules for every phase below**

- **No database changes.** No migrations, no new RPCs or views, no indexes, no RLS changes. Every fix here is code only.
- **Same screens, same numbers.** Each change must show exactly what the user sees today. Anything that would change a
  number, a list or a behaviour is listed separately under "Not in this plan".
- One phase at a time. Stop after each phase for the owner's approval. The owner makes all commits. No deploys.
- Check each phase with type-check + offline tests only, then measure on localhost (live DB, look only). No `next build`
  unless the owner asks.

---

## 1. What is already done

| Phase | What | Status |
|---|---|---|
| 0 | Baseline measured (69 JS files / 1,576 KB Brotli; 8 s cold load; tab revisit shows loader again) | done 2026-10-12 |
| 1 | Each role's dashboard and each tab load their own code (`next/dynamic`) | done 2026-10-12 |
| 1b | Tab code preloaded in the background after the dashboard shows (no extra spinner) | done 2026-10-13 |
| 2 | Tabs remember their last data (Diesel, Electricity, Documents, Vendors, Stock report, PPM, Assets) | done 2026-10-12 |

Still open from the audits: request waterfalls inside tabs, duplicate requests, the ticket-summary fan-out, the
notification bell, a few heavy modals still loaded up front, and uncached tabs.

---

## 2. New findings from today's code read (not in either audit)

1. **Org dashboard loads data for a panel nobody can see.** In `OrgAdminDashboard.tsx`, `fetchSummaries` (5 API calls +
   2 database queries, including the expensive `tickets-summary`) feeds the old `OverviewTab`. That tab only renders when
   the active tab is *not* Overview (`:1615`), and inside it is wrapped in `display: none` unless the tab *is* Overview
   (`:1719`). So it is never visible, yet `fetchSummaries` runs on every dashboard visit (`:844`), on every
   ticket/request created event (`:852`), and twice after creating a ticket from this screen (`:2198` + the event).
   The real Overview is the Command Center, which loads its own data.
2. **"Latest 100 diesel readings" downloads the full history.** `DieselStaffDashboard.tsx:124` asks for
   `diesel-readings?limit=100`, but the route has no `limit` support, so it returns every reading for the property (up to
   the database row cap), joined with generators and tariffs.
3. **The Material Symbols stylesheet is unused.** `app/layout.tsx:57-60` loads it from Google on every page and blocks
   rendering, but no code uses a Material Symbols icon.
4. **Two notification bells are mounted at once** on dashboard routes (mobile header + desktop context bar, one of them
   hidden by CSS). Both run the same refetches; the second one's realtime setup clashes with the first (same channel name).

---

## 3. The plan

Each item says **why it is safe** (why the screen stays identical). Risk: 🟢 very low · 🟡 low, needs careful checking.

### Phase 3 — Stop work nobody uses (smallest change, big win)

| # | Change | Files | Safe because | Risk |
|---|---|---|---|---|
| 3.1 | Stop calling `fetchSummaries` (keep the code, behind one `const LEGACY_OVERVIEW_ENABLED = false`) | `OrgAdminDashboard.tsx` `:844`, `:852`, `:2198` | Its results only feed a panel that is never visible (finding 1). Before the edit, re-check every reader of the summary state, including line `:3106`. | 🟢 |
| 3.2 | Remove the unused Material Symbols `<link>` | `app/layout.tsx:57-60` | No code uses it (searched `app`, `frontend`, `lib`, `public`). | 🟢 |
| 3.3 | Add the same 5-second guard to the chunk-error **promise** handler that the normal error handler already has | `app/layout.tsx:84-88` | Same recovery, but it can no longer reload endlessly. Normal loads are unaffected. | 🟢 |

Expected: org admin dashboard makes about **7 fewer requests**, incl. `11 + 7P` database calls from `tickets-summary`,
on every visit. The page also renders slightly earlier because nothing waits for a Google stylesheet.

### Phase 4 — Run independent requests at the same time

Requests that wait for each other for no reason are started together (`Promise.all`). Each request and every calculation
stays the same; only the order of waiting changes.

| # | Where | Today | After | Risk |
|---|---|---|---|---|
| 4.1 | `DieselStaffDashboard.tsx` fetchData `:97-207` | property → generators → readings → 30-day readings → tariffs, all one after another | property + generators together, then readings + tariffs together | 🟢 |
| 4.2 | `ElectricityStaffDashboard.tsx` fetchData `:131-295` | 8 calls one after another | 2 rounds: (property, meters, facility-meters), then (latest closings, 30-day, multipliers, tariff, retakes). Nothing uses meter IDs, only the meter count. | 🟢 |
| 4.3 | `DieselAnalyticsDashboard.tsx` `:98-218` | property → generators → tariff loop one generator at a time → readings | property, generators and readings together. Tariff calls all at once, still picking **the first generator in list order** with a price, so the same number. | 🟢 |
| 4.4 | `ElectricityAnalyticsDashboard.tsx` `:193-331` | property → meters → facility-meters → tariff → readings | first four together, then readings | 🟢 |
| 4.5 | `DieselSpreadsheetLogger.tsx` `:186-308` | two month reads one after another | together (keep the exact date strings, including the IST quirk at `:202`) | 🟢 |
| 4.6 | `PropertyAdminDashboard.tsx` Overview `:1550-1617` | batch 2 (electricity, diesel, VMS, vendors, SOP) waits for batch 1 (tickets) | one batch of 15. Batch 2 never used batch 1's results. | 🟢 |
| 4.7 | `api/organizations/[orgId]/tickets-summary` `:71-195` | per-property counts start only after the org-wide batch | both batches start together (`11 + 7P` stays for now, but 3 rounds become 2) | 🟢 |
| 4.8 | `api/users/list/route.ts` | master-admin check and property lookup in sequence; org and property memberships in sequence; profile and approver lookups in sequence | each pair together. **The permission check still finishes before any directory data is read.** | 🟡 |
| 4.9 | `api/accounts/summary/route.ts` `:185-196` | PO workflow flags fetched after the ledgers | fetched alongside them (errors still swallowed, as today) | 🟢 |

### Phase 5A — Instant cards (added 2026-10-15, before Phase 5)

Goal: the Command Center cards are already filled in when the dashboard opens. Two parts, both inside the existing card
loader `useWidgetData` (used by all 26 card data calls), with no new library and no database change.

**Part 1 — Remember the cards' last data in the browser**

| Today | After |
|---|---|
| Cards keep data in memory only; a reload or a new visit starts empty and waits ~0.5–2.5 s per card | When a card's data arrives it is also saved in the browser. Next visit, the card shows the saved copy at once, fetches fresh data in the background, and updates when it arrives |

Rules:
- **Tied to the signed-in user**: saved under that user's id; another user on the same browser can never read it.
- **Wiped** on logout and on user change (through the existing `clearSessionCaches`, Phase 2).
- **Max age 24 h**: older copies are ignored and deleted.
- **Tied to the app version** (Vercel commit id when available): after a deploy, the first load is fresh, so a card never
  receives data in an old shape.
- **Only successful answers are saved**; errors and "not allowed" (401/403) never are. If the background refresh fails or
  is refused, the card behaves exactly as today (the saved copy is replaced by the error), so a removed permission never
  keeps showing old data.
- Each card's existing "synced X ago" stamp shows the saved copy's real age until fresh data arrives.
- Size guard: an answer over 300 KB is not saved; every storage access is wrapped so a full or blocked storage just
  means "no saved copy".

No new exposure: the same browser profile already holds the user's login session, and the data is only what that user
already sees.

**Part 2 — Start the card requests during "Loading your dashboard…"**

When the session is known and the role is org super admin / org admin, `UnifiedDashboard` starts the Command Center's
card requests (all-properties view) while the org dashboard's code is still downloading. The cards then find those
requests already in flight or finished (the loader already shares requests by URL). The loading screen is **not**
held back. If the URL list ever drifts from what the cards use, the only cost is one unused request; nothing breaks.

**Files**
| File | Change |
|---|---|
| `frontend/lib/dashboard/useWidgetData.ts` | Save/restore successful answers per user (Part 1); new `prefetchWidgetData(urls)` (Part 2) |
| `frontend/context/DataCacheContext.tsx` | Tell the loader who is signed in (one call next to the existing user-change effect) |
| `frontend/components/dashboard/command-center/prefetchUrls.ts` (new, small) | The card URLs for one organisation, kept next to the cards |
| `frontend/components/dashboard/UnifiedDashboard.tsx` | Call the prefetch for org admin roles |

**Risk:** low. Worst cases: a card shows numbers up to 24 h old for 1–2 s, with its true "synced" age; or one unused
request.

**Test:** (1) first visit on a fresh browser loads as today; (2) reload → cards appear at once with an older "synced"
stamp, then update; (3) log out, log in as another user → no cards from the first user; (4) Network tab: card requests
start during the loading screen; (5) property-admin / staff dashboards unchanged.

### Phase 5 — Stop asking for the same data twice

Same results, fewer requests. Each item needs a careful side-by-side check of the numbers before and after.

| # | Change | Safe because | Risk |
|---|---|---|---|
| 5.1 | **One tariff request per property instead of one per generator.** Call `dg-tariffs` without `generatorId`, which returns all tariffs. Then pick each generator's active tariff in the browser with **the same rule as the database function**: `effective_from <= today` and (`effective_to` empty or `>= today`), newest first. Applies to Diesel staff, the spreadsheet logger and Diesel analytics. | The rule is copied exactly from `get_active_dg_tariff` (`utilities_v2_schema.sql:316-337`), using the same `today` string. That function follows the same access rules as the plain list. | 🟡 |
| 5.2 | **Diesel staff: drop the separate 30-day request.** Work out the averages from the full readings already downloaded by keeping rows with `reading_date >= monthAgo`. | The full list already contains every row the 30-day request returns, and both compare plain `YYYY-MM-DD` strings. **Do not** do the reverse (latest readings from the 30-day window): an idle generator's last reading can be older than 30 days. | 🟢 |
| 5.3 | **Spreadsheet logger: don't refetch tariffs when the parent passed an empty list.** Today `{}` (no tariffs set up) triggers N tariff calls again. Also re-run the month reads only when the generator **IDs** change, not every time the parent re-renders. | The parent already fetched the same data with the same date. | 🟢 |
| 5.4 | **Pass the property object down instead of each tab re-reading it.** Add an optional `property` prop to Diesel staff, Electricity staff, Diesel/Electricity/Water analytics and Stock. If it is given, skip the property query; if not, behave exactly as today. | Parents already hold the same row (`id, name, code`). Mst, Staff and Security render these tabs without `propertyId`, so pass it there too. Skip the property `'all'` pseudo-object. | 🟢 |
| 5.6 | **Diesel analytics: 4 period reads → 2.** Merge today + this month + last 30 days into one read starting at the **earliest** of their start dates (the same strings as today), then split in the browser. Previous month stays its own read. Do the same in Electricity analytics if it follows the same pattern. Not the audit's "use only the 30-day data" version: the month can start before the 30-day window (31-day months, and the IST quirk puts month start on the last day of the previous month). | The merged read returns exactly the rows of the larger existing read, so there's no new row-cap risk, and the split uses identical date strings. | 🟡 |
| 5.5 | **tickets-summary: drop 7 org-wide count queries** and add up the per-property counts instead. Keep the SLA, feature and trend queries. | Each ticket has exactly one property, so the org count equals the sum over its properties, with the same filters and statuses. Only possible difference: when one count query errors, both paths already treat it as 0. Saves 7 database calls per request. | 🟡 |

### Phase 6 — Notification bell: less background traffic

| # | Change | Safe because | Risk |
|---|---|---|---|
| 6.1 | Use `user.id` from `useAuth()` instead of calling `supabase.auth.getUser()` (a network call) before every refetch. Keep `getUser()` only as a fallback when `user` is not ready. | Same user ID, without the extra network call. | 🟢 |
| 6.2 | Combine bursts of refetches: if one is running, mark "refetch again when done"; wait ~500 ms after realtime events and window focus. | Same final data; ten triggers in a second cause one refetch, not ten. | 🟢 |
| 6.3 | Give each bell instance its own channel name (add a unique suffix) | Fixes the clash between the two mounted bells (finding 4). The subscriptions and filters are unchanged. | 🟢 |

Deliberately **not** done: adding a filter to the `hr_tickets` / comments subscriptions. Submitters, HR staff and
reassigned users all need updates, and getting that rule wrong would silently hide notifications.

### Phase 7 — Remember data for a few more tabs

Use the same `useDataCache` pattern as Phase 2: show the last data instantly, refresh in the background.

| # | Tab | Note | Risk |
|---|---|---|---|
| 7.1 | User Directory | It already has abort/request-id guards. Add show-then-refresh, keyed by user + org/property scope. | 🟢 |
| 7.2 | HR tickets | Cached copy is cleared on user change (already automatic). | 🟡 |
| 7.3 | PPM Audit | Add an abort guard so an older month's answer can't overwrite a newer one. **Owner decision:** each GET also writes an audit row today, so caching means fewer rows are written. The screen is unchanged. | 🟡 |

### Phase 8 — Trim code still loaded up front

| # | Change | Safe because | Risk |
|---|---|---|---|
| 8.1 | Load modals only when opened: Org admin's `InviteMemberModal`, `TicketCreateModal`, `StockMovementModal`; Property admin's `VendorExportModal`, `TicketCreateModal`, `AddMemberModal`, `StockMovementModal`, `ClientQRGeneratorModal` (pulls in `qrcode.react`), `VendorManagementModal`, `FeedbackModal` | Same pattern as Phase 1. Modals are closed when the page opens. | 🟢 |
| 8.2 | Inside PPM, load Reports / Compliance / Audit sub-tabs on demand (they pull in `xlsx` and `recharts`). Do the same for `SitePricingAdminTab` in Procurement (`xlsx`). | Same as above | 🟢 |
| 8.3 | Re-measure with `scripts/measure_dashboard_bundle.mjs` | — | — |

Not proposed: `optimizePackageImports` in `next.config.ts`. It is production config, so it needs the owner's explicit
OK first.

---

## 4. Not in this plan (and why)

| Item | Reason |
|---|---|
| One SQL function for ticket counts, latest-reading function, PPM join view | Database changes (owner rule) |
| Composite indexes (electricity, notifications, PPM) | Database changes. Baseline §5 shows the ticket and DG tariff indexes already exist. |
| RLS `(select auth.uid())` rewrite | Database + security change |
| Merging the two service workers | Touches push notifications (background display, click-through, FCM tokens). Needs its own plan and real-device testing. |
| Replacing the reload after login | Touches the login flow (auth is off-limits without an explicit request) |
| Merging analytics date windows into one request | A wider window can hit the 1,000-row cap and silently drop the oldest (previous-month) rows. Not identical. |
| Making "latest diesel reading" one small query per generator | Faster and *more* correct (today's full download is already capped), but properties with long histories may show different numbers. Owner call, later. |
| Batching the PPM audit report lookups | Owner said "ignore PPM for now". `ppm_completion_reports` may not exist in the live DB. |
| Narrowing `select('*')`, pagination, finance page waves | Changes response shapes or finance logic. Needs a per-endpoint contract first. |
| Font weight trimming | Small gain. Urbanist 300 looks unused, but there may be a CSS override of the font variables (`globals.css:109-110`); check in DevTools first. |

---

## 5. Bugs noticed (not performance — reported only, not fixed)

- `DieselAnalyticsDashboard.tsx:119` caches the old property name, not the freshly fetched one.
- `PropertyAdminDashboard.tsx:1469-1474`: the "fresh cache" path doesn't restore checklist stats or the validation flag.
- `AuditDashboard.tsx`: on an error the previous month's numbers stay on screen under the new month.
- PPM audit for a whole organisation probably always fails (it inserts a row with an empty `property_id` that is
  declared NOT NULL). The audit API route has no login check and uses the admin client — a **security** item for the owner.
- `tickets-summary` treats "validation enabled" differently in two places (`:117` vs `:183`).
- `NotificationSystem` reads the user once on page load, so if the user logs in later it never subscribes.

---

## 6. How each phase is checked

1. Type-check (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`) and the offline tests only.
2. Localhost, same role, before vs after: Network tab request count, and the **numbers on the cards are the same**.
   Phase 5 numbers are compared side by side for at least one property with several generators and meters.
3. Add a row to the results log in `DASHBOARD_PERFORMANCE_BASELINE.md` §4.

## 7. Suggested order

3 → 4 → 5 → 6 → 8 → 7. Phase 3 is the biggest saving for the smallest change; Phase 7 has owner decisions in it.
