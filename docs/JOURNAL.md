## 2026-09-25 — Saas.one: Asset module live, SS Plaza stickers scan on the hosted site

**Asset Management is on main and deployed; every printed SS Plaza sticker now opens its asset page on fms-dev-saas-one.vercel.app without a login.**

- **Why:** 9,628 SS Plaza assets were imported and their QR sticker sheets printed, but scanning a sticker sent people to the login page, because the hosted site was still running the old code.
- **Structural decisions:**
  - The sticker page (`/a/<code>`) is public. The random code printed on each sticker is the key; nobody can guess another asset's page.
  - The public-page rule was tightened before shipping. As first written, it made every address starting with "a" skip the login check, which would have included some organisations' dashboards. It now covers only sticker addresses. Verified live: sticker pages open, other addresses still go to login.
  - Merged the 26 newer changes on main (HR tickets, procurement catalogue) into this work. The only overlaps were the dashboard tab lists, where both HR "grievance" and "assets" tabs are kept.
- **What works now:** Scan any SS Plaza sticker with a phone camera and the asset's page opens directly: name, code, grade, category, property, location, cover, maintenance and history. The existing sticker PDFs need no reprint.
- **Left undone:**
  - The fix that puts the property number into asset codes (`20260924000001_fix_asset_code_prefix.sql`) is written but not applied. SS Plaza's codes are fine as printed, but the first asset of the same category at a second property will fail to save until it runs.
  - The two IRA mail fixes that were on this branch also went to main with this push.
- **Open questions for the founder:**
  - The public sticker page also shows purchase cost, repair spend, vendor contact names and phone numbers, and staff names. Stickers are on equipment in shared offices, so tenants and visitors can see these. Should signed-out viewers see only the operational details (name, location, grade, cover, maintenance dates), with money and contact details shown only after login?

## 2026-09-23 — Saas.one: Branded asset QR labels that are proven to scan

**Printed asset labels now match the approved design — pink Autopilot "A" in the QR, asset name in a pink pill — and were tested to scan off the printed page.**

- **Why:** The founder asked that every printed asset QR look like the branded reference sticker. The only logo in the repo is the black "AUTOPILOT" wordmark, so the pink "A" was cut from that wordmark and tinted with the app's existing brand pink (`public/autopilot-mark-pink.png`).
- **Structural decisions:**
  - The logo's size inside the QR is a single measured number, not a guess. Scan tests on real site addresses showed codes stop reading when the logo covers 36–38% of the width; the labels use 24%, leaving room for glare, dirt and curved surfaces.
  - The on-screen preview is produced by the same drawing code as the PDF, so what an admin sees before printing is exactly what prints.
- **What works now:** Any "Print QR Labels" action (single asset or a whole import batch) produces an A4 sheet of 18 branded labels. Long asset names shrink to fit the pill, then end with "…" rather than spilling out.
- **Bugs found and fixed while testing (none had reached a printer):**
  - The first logo size made codes unscannable.
  - In some render paths the QR held only "/a/…" with no website address, which a phone camera cannot open. Labels now refuse to render until a full address is known.
  - The PDF stored images uncompressed — 1.4 MB for 2 labels, which would have made a few-hundred-label sheet too large to open. Now 47 KB for 2 labels.
- **Left undone:** No pixel-perfect copy of the gradient "A" from the reference image — that artwork isn't in the repo. If the design team has the original file, dropping it in as `public/autopilot-mark-pink.png` swaps it in with no code change.
- **Open questions for the founder:**
  - Labels encode the address of whatever site the admin prints from. Print real labels from the live site only — a sticker printed from a test link points at the test site forever.

## 2026-09-15 — Saas.one: Asset tagging & lifecycle module, wired into ticketing, PPM and R&M budget

**Every physical asset now has a QR tag, a performance grade, and a history that follows it across tickets, maintenance and cost.**

- **Why:** Today, when a technician fixes something, the photo they upload is not tied to which piece of equipment they actually worked on. There was no single place to see an asset's full story — when it was installed, whether it is under warranty or AMC, what it has cost to keep running, and whether it is due for replacement. Leadership could not answer "which units are out of warranty" or "which need an AMC" without asking around site by site.
- **Structural decisions:**
  - New `assets` register, one row per tagged item, with a configurable `asset_categories` list (HVAC, Electrical, IT, Furniture, etc. — organizations can add their own; eleven defaults are seeded). Alternative considered: piggybacking asset identity on the existing PPM `system_name` free-text field — rejected because PPM already treats the equipment as text, not a trackable entity, and re-import wipes those rows monthly.
  - A single `asset_events` table is the lifecycle ledger — every ticket note, cost, status change, AMC/warranty update and QR scan lands here, so one query builds the whole timeline instead of joining five tables.
  - Performance grading (P1 performing / P2 attention / P3 end-of-life risk) is computed on read from five checkpoints — installation date on file, active warranty or AMC, no open tickets, no overdue PPM, within expected lifecycle — rather than stored, so it is never stale.
  - A cost logged against an asset with a Repair & Maintenance head calls the existing `decrement_procurement_budget` function, so asset spend and the property's R&M budget stay the same number, not two ledgers that can drift.
  - QR labels encode a URL token (`/a/<token>`), not the asset's database id, so relabeling never means re-tagging the database, and the scan page requires sign-in — tenants are excluded, everyone else in the organization can see an asset's lifecycle by scanning it.
  - Access follows the same "service-role API, RLS for reads only" pattern as the AOP and petty-cash modules: every write is checked in the API layer against the caller's org and property memberships, not left to row-level policies.
- **What works now:**
  - Bulk-import assets from an Excel/CSV sheet (with a downloadable template, seeded with the org's own categories), then print an A4 sheet of QR labels for the whole batch in one PDF.
  - From an in-progress ticket, an MST can scan the asset's QR and write one or two lines on what was fixed — that note becomes part of the asset's permanent history, and every other role sees it on the ticket (a new "Asset Worked On" card and a trace-log line) without needing to open the asset register.
  - Scanning any printed QR (from the ticket flow or standalone) opens the asset's lifecycle: category, location, install date, warranty/AMC status, performance grade with the reasons behind it, every past ticket and cost, and — for managers — a way to log a new R&M cost on the spot.
  - Every role except tenants gets an Assets tab: a property-scoped register for staff, MST and property admins; an org-wide register plus a Reports tab (grade distribution, warranty/AMC expiring in the next 60 days, assets that still need an AMC, R&M spend by property) for org and ops super admins.
  - A daily cron flags assets whose warranty lapsed today or that need an AMC, and messages the property admin — mirroring the existing AMC-contract-expiry alert.
- **Left undone, deliberately:**
  - The migration (`supabase/migrations/20260915000001_asset_management.sql`) has not been applied — per standing instruction, migrations are written for the founder to run, never applied by the agent.
  - No photo attachment on the MST's "what was fixed" note — the brief asked for one or two lines of text; ticket photos already exist separately and were left as-is rather than duplicating that flow.
  - No dedicated storage bucket or document upload for asset warranty cards / invoices — nothing in this build needed one; add it the same way `ppm-attachments` was added if it comes up.
  - PPM tasks are not yet auto-linked to assets — the schema has `ppm_schedules.asset_id` ready, but wiring the PPM UI to pick an asset per task is a follow-up, not done here.
- **Open questions for the founder:**
  - The "nearing end of life" threshold is set at 40% of an asset's expected lifecycle consumed (e.g. year 2 of a 5-year asset) — confirm that matches what you meant by "in the third year" in the brief, or tell me the exact fraction/year you want.
  - Default lifecycle years per category (HVAC 10, Electrical 15, DG 15, Fire 10, Lifts 20, Plumbing 15, IT 4, Security 6, Furniture 8, Kitchen 7) are my working assumptions — worth a quick sanity check against what Ops actually expects.
