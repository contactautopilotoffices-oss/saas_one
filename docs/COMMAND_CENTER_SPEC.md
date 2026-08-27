# Command Center — Super Admin Dashboard Revamp (SPEC, binding contract)

**Goal:** rebuild the super-admin dashboard (`OrgAdminDashboard`, roles
`org_super_admin`/`org_admin` ONLY) to match the target mock **1:1 visually**.
Data is wired where a fetch already exists; otherwise polished mock values are
acceptable — the user will reconcile data one by one later.

**Target image (read it first, keep it open):**
`docs/design-references/targets/superadmin-command-center.png` (1558×1010)

**Design grounding (cite, don't guess):**
`docs/DESIGN_AUDIT_OPS_BOARD.md`, `docs/design-references/research/glass-ambient.md`,
`design.md` (monopo — patient curve `cubic-bezier(0.19,1,0.22,1)`, label
discipline, restraint budget).

## Hard rules

1. **Scope:** super-admin only. All new code lives in
   `frontend/components/dashboard/command-center/` and ONE additive CSS block
   in `app/globals.css` prefixed `.cc-`. Do not modify `.w-*`, `.glass-card`,
   `--canvas-bg`, or any other role's component.
2. **Only the shell agent edits `app/globals.css`.** Everyone else consumes the
   `.cc-` contract below + Tailwind utilities.
3. **No new deps.** Recharts/d3 are NOT assumed; sparklines/donuts are inline
   SVG. lucide-react for icons. Fonts already loaded: Poppins
   (`--font-display`), Urbanist (`--font-body`).
4. **Dev server discipline:** `npm run dev` runs on :3000. globals.css does NOT
   hot-recompile — after editing it you MUST `pkill -f "next dev"; rm -rf
   .next; npm run dev &` and wait for 200. If you did not edit globals.css, do
   NOT restart the server.
5. **Verify visually.** `proxy.ts` whitelists `/cc-preview` (already done).
   Put your harness at `app/cc-preview/<your-name>/page.tsx`, screenshot with
   Playwright (repo root has `playwright`; see `scratch/preview_shot.js` —
   use `waitUntil: 'load'`, viewport 1558×1010, deviceScaleFactor 2), read the
   PNG, compare against the target, iterate. Leave the preview route in place
   when done (integration cleans up).

## Layout anatomy (from the target)

- **Backdrop:** deep desaturated teal-slate gradient filling the viewport;
  lighter haze top-left, darker bottom-right. Approx:
  `radial-gradient(1200px 800px at 15% -10%, rgba(122,150,160,.35), transparent 60%), linear-gradient(165deg,#46585f 0%, #2f3f47 45%, #212d34 100%)`.
- **Left rail (~208px):** translucent dark glass. Logo "AUTOPILOT" + caption
  "SUPER ADMIN CONSOLE". Grouped nav (section labels 10px uppercase, letterspaced):
  OVERVIEW — Command Center, AI Brief · OPERATIONS — Tickets, PPM Calendar,
  Roster Management, Material Requests, Purchase Orders, Purchase Mailbox ·
  UTILITIES — Electricity, Water, DG Monitoring, Waste Management · FINANCE —
  Budget vs Actual, Invoices, Payments · OTHER — Reports, Documents, Settings.
  Active item = soft white pill. Bottom: user card (avatar initials, name,
  email), Sign Out (red), "Customize Dashboard" outlined pill.
- **Header:** "Good Afternoon, Saniel 👋" (~28px white, 600), subtitle "Here's
  what's happening across your portfolio today." Right cluster: green dot +
  "Data synced" + "2 min ago" (two lines, tiny), bell with red badge 8,
  calendar icon, "+ Add Widget" dark pill button (white text, full radius).
- **Row 1 (3 cards, ~equal thirds):**
  - *Operations Health Score* — green heart chip, label, giant "94" + "/100",
    "↑ 3 pts vs yesterday" green chip, "Your portfolio is performing well",
    green area sparkline (dates along x). Bottom stat strip (4 cells, hairline
    dividers): red "4 / Buildings need attention" · "2 / Critical issues" ·
    teal "₹2.4L / Est. financial exposure" · green "18 / Positive updates".
  - *AI Brief* — purple sparkle chip, "Updated 10 min ago" right, 3 short
    prose paragraphs with colored key phrases (red "risen 18%", bold "₹1.8Cr",
    "₹12L overspend"), dark pill "View full brief".
  - *Portfolio Overview* — teal bank chip, "View All Buildings" link. 5 rows:
    status dot (red/green/amber), name + city (2 lines), right-aligned score
    (red/green/amber), mini sparkline.
- **Row 2 — PRIORITY ACTIONS** label + red count badge "5", right chevron.
  5 compact cards, each: alert icon chip (tinted), caps title, big red/colored
  figure + caption, small stat columns, bottom row = entity name + dark pill
  action ("Investigate", "View Budget", "Open Mailbox", "View Roster",
  "View All Tickets"). Cards: Electricity Alert (18%, red sparkline, "Started
  2:15 PM, Today"), Budget Health (amber donut 89% Utilized, Forecast 94%,
  Overspend ₹13.8L red), Purchase Mailbox (167 / 56 need action / 18 waiting,
  "Oldest unresolved 13 days" red), Workforce Coverage (96% / 8 late / 12
  absent, "BKC Center 3 technicians short tomorrow"), Tickets at Risk (5 / 2
  breached / 29 within SLA).
- **Row 3 — 5 intelligence cards:** Electricity Intelligence (green "Healthy"
  pill, ↓8%, 3,120 kWh, area chart, 3-col footer Projected Bill ₹8.7L / vs
  Last Month ₹9.3L / Savings ₹60K green, then Top Consumer HVAC (41%) /
  Confidence 97%), Water Intelligence (blue "Low Risk", ↓11%, 45,600 Ltrs,
  blue bars, Expected Bill ₹2.3L / ₹2.6L / ₹30K, Highest Use Area Kitchen
  (28%) / Leak Probability Low), PPM Compliance (blue donut 81% Completed,
  Due Today 14, Overdue 5 red, Target 95%, Next 7 Days 27, Most Critical Asset
  DG Generator / Last Serviced 62 days ago), Material Requests (99 / 21
  delayed amber / 8 critical red, Avg Fulfilment 2.7 days + amber sparkline,
  Top Pending Category Electrical / Vendor causing delay ABC Lighting),
  Purchase Orders (402 / 18 awaiting approval / 29 awaiting vendor, PO Value
  Pipeline ₹5.6Cr + green progress bar 72%, Completed This Month 355 /
  Cancelled 6).
- **Row 4 (3 cards, wide/wide/wider):** Budget vs Actual (legend Actual green
  / Budget grey / Forecast amber; green line chart with dashed forecast;
  right column Month Progress 72%, Forecast Utilization 94%, Projected
  Overspend ₹13.8L red; "View Full Report"), DG Monitoring ("All Generators
  Normal" + Running 2 / Standby 4 / Fault 0 with colored dots, generator
  photo/illustration, "View DG Dashboard"), Mail Digest ("TOP UNRESOLVED",
  "Synced 2 m ago" green dot; 4 rows: avatar, vendor name, issue, time,
  severity pill High=red / Medium=amber / Low=green; "Open Purchase Mailbox").

## The `.cc-` contract (shell agent implements; everyone consumes)

`.cc-canvas` (page backdrop) · `.cc-rail`, `.cc-rail-logo`, `.cc-rail-section`,
`.cc-rail-item`, `.is-active`, `.cc-user-card` · `.cc-header`, `.cc-greeting`,
`.cc-sync`, `.cc-iconbtn`, `.cc-addbtn` · `.cc-card` (light glass: ~rgba(255,
255,255,.94), blur 14px, radius 18px, 1px rgba(255,255,255,.55) border, soft
stacked shadow per Vercel ladder), `.cc-card-head`, `.cc-title` (11px caps
700, letterspacing), `.cc-chip` + `.cc-chip--{red,amber,green,teal,blue,purple}`
(10%-alpha tint icon square, 8px radius) · `.cc-metric` (Binance numeric:
700, -0.3px, tabular), `.cc-sub` · `.cc-pill` + `.cc-pill--{high,medium,low,ok}`
(severity pills, tinted bg + darker text) · `.cc-btn` (dark pill, white text),
`.cc-btn-ghost` (outlined pill) · `.cc-dot` + `--{red,amber,green}` ·
`.cc-badge` (red count badge) · `.cc-statstrip` (N cells + hairline dividers)
· `.cc-listrow` (avatar/name/sub/right-meta) · motion: patient curve, 300ms.

## Data wiring (integration pass)

Reuse fetch logic from `frontend/components/dashboard/widgets/*.tsx` and
`frontend/lib/dashboard/useWidgetData.ts` (tickets summary, mail digest, PO
stats, electricity, AOP spend, material requests, stock). Anything without an
honest source stays mock but is isolated in one `mockData.ts` per component
area so it can be swapped 1:1 later. Greeting name + user card come from the
auth session (`frontend/context/AuthContext.tsx`).
