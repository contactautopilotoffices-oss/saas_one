# Command Center — KPI tiles plan

Written 2026-10-16. Status: **plan only, nothing built.** One phase at a time, owner checks each on localhost before the
next. No database changes (no migrations, indexes, RPCs or RLS). The owner makes all commits.

## What changes on screen

1. **Agent Activity becomes a KPI tile**: Agents live · Runs today · Failed today · Modules moved. The run list, "+N more"
   and coins line are removed. Clicking anywhere on the tile opens the Agent Console.
2. **A new "At a glance" band of KPI tiles**, in the "Ball by ball" section under the Alerts card. Every tile looks the
   same: icon, title, 2–4 numbers with labels, LIVE tag. Clicking a tile opens that module.
3. Rows follow the existing responsive grid (5 / 3 / 2 / 1 per row by available width).
4. A tile the viewer is not allowed to see is **not shown at all**. A tile whose data is not set up shows "Not set up".

## The tiles

| Tile | Numbers | Data | Who sees it |
|---|---|---|---|
| Agents | live · runs today · failed today · modules moved | existing `/api/agents/pulse` | as today |
| Requests | raised today · closed today · avg closing time (7 days) | `tickets` | Command Center roles |
| Tasks | due today · overdue · completed today · % on time this week | `tm_tasks` | org-level admins (not property admins: tasks have no building) |
| Visitors | checked in today · on site now · checked out | `visitor_logs` | Command Center roles, own buildings |
| Attendance | present · late · absent · coverage % | existing `/roster-coverage` | Command Center roles |
| Documents | expiring in 30 days · expired | `document_bank` | Command Center roles |
| AMC & assets | AMC contracts expiring in 30 days · assets under repair | `amc_contracts`, `assets` | Command Center roles |
| Stock | items below reorder level | `stock_items` (quantity < min_threshold, default 10) | Command Center roles |
| Grievances | open · past SLA · raised this week | `hr_tickets` | **super admins only** (existing HR rule) |
| Petty cash | pending approvals · amount awaiting approval · balance | `petty_cash_*` | **super admins only** (existing finance-separation rule) |
| Meeting rooms | bookings today · credits used this month · room use % | `meeting_room_*` | roles allowed to see all bookings today |

## How it is built (code only)

- **One new read-only route, `/api/command-center/kpis`**, behind the dashboard's access check
  (`resolveCommandCenterAccess`). Each section applies its module's narrower rule on top (HR, petty cash, meeting
  rooms). It never reads the purchase mailbox.
- **Counts, not rows**: exact count queries, so the 1,000-row limit can't cap a number.
- **Each section stands alone**: a missing table or an error marks that one tile "Not set up" / "Couldn't load"; the
  others still show.
- **New files**: the route, `KpiTile.tsx`, `KpiBand.tsx`. The only edits to existing files are mounting the band in
  `CommandCenter.tsx` and adding the URL to `prefetchUrls.ts`. Undo = one switch, `SHOW_KPI_BAND`, like the Alerts card.

## Phases

| Phase | What | Check |
|---|---|---|
| 1 | Agent tile + band + Requests, Visitors, Attendance | read-only script compares every number with direct database counts; type-check; screenshots at 4 widths |
| 2 | Tasks, Documents, AMC & assets, Stock | same |
| 3 | Grievances, Petty cash, Meeting rooms (the gated ones) | same, plus checking each role sees only what it should |

## Decisions

All five taken as suggested (owner, 2026-10-16: "use your own recommendations"). Phase 1 started the same day.

1. **"% on time" for tasks**: suggested = of tasks due this week (Mon–today), the share completed on or before the due date.
2. **Room use %**: needs opening hours as a baseline. Suggested 9:00–18:00, Monday–Saturday. Or leave it out.
3. **Grievances and petty cash for super admins only**, matching their existing rules. Confirm.
4. **Petty cash "balance"**: there is no organisation-wide wallet. Suggested: the report's balance (allocated − spent).
5. **Avg closing time**: suggested over the last 7 days, open to closed.

## Found while researching (not part of this plan — reported only)

- **Security**: `GET /api/amc/contracts` and `/api/vms/org/[orgId]` read data without checking who is logged in.
- `tickets-summary` returns `avg_resolution_hours` as a fixed 0.
- `visitor_logs`, `tickets`, `staff_rosters`, `meeting_room_*`, `amc_contracts`, `stock_items` were created outside
  `supabase/migrations`, so the route treats a missing table as "Not set up" rather than an error.
