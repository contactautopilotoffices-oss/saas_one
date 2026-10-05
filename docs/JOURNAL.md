## 2026-10-05 — Saas.one: Three Whitefield slides — what the floor earns, who else is opening, and where our price sits

**Three presentation slides for the Total Environment Whitefield "other half" deck, blending the founder's financial projection with the Whitefield Business Case Study: the money, the new competitors, and a price anchored between Simpliwork and 91springboard.**

- **Why:** The founder wants one consistent story for the 20,000 sq ft floor. The deal terms were in one document, the cost and margin maths in another, and the old price slide still showed a ₹12,500 to ₹16,000 plan that no longer matches the numbers.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/TE-Whitefield-Part2-Price-Slides/`, with the same page size, fonts and colours as the existing Part 2 deck. Nothing in the FMS app changed. The three slides are also merged into a new 22-page copy of the deck, `~/Downloads/TE-Whitefield-Part2-Who-Buys-It-v3.pdf`: they replace pages 6 and 9, and the financial slide is page 21 so no other page number changes. The original 21-page file is untouched.
  - Our price is set at ₹11,200 a seat, the figure the projection says is needed for a 20% margin (₹11,208). The alternative was to pick a price from the competitor ladder and see what margin fell out. We started from the margin because it is the number the business must hit, and the ladder turned out to have an empty slot at that price, between ₹10,000 and ₹12,000.
  - The old "Standard ₹12,500 / Blended ₹14,000 / Premium ₹16,000" lines were removed from the price slide. They belonged to the earlier 140-seat plan.
- **What works now:** A reader can see in three pages what the floor costs each month (₹35.87 L), what we must bill (₹44.83 L), what we keep (₹8.97 L, about ₹1.08 Cr a year), how full the floor must be (63% to cover running costs, 80% to cover everything, against 83 to 93% for settled rivals), and why ₹11,200 is competitive without looking cheap.
- **Left undone:**
  - Pages 2, 14, 15, 19, 20 and 21 of the deck still describe the earlier plan (140 seats, ₹8,570 a billable seat, ₹13,700 a desk). They now sit beside slides priced at ₹11,200, and are not rewritten because the price decision is the founder's.
  - No month-by-month ramp or loss scenarios. The founder cut those from the deck earlier, so only the break-even fill levels are shown.
  - One correction was made on the "more operators" slide: 2026 deals are about a fifth of the area's flex stock (9,500 of 45,700), not a sixth as the old slide said.
- **Open questions for the founder:**
  - The projection counts about 400 seats at one price of ₹11,208, anchor client included. Earlier work priced the Basilic deal at ₹8,570 per billable seat, with 1.6 billable seats per desk. If rivals' quotes are per desk and our 400 are billable seats, the like-for-like comparison changes. Which one do the 400 seats mean?
  - Rivals' prices are list prices and ours is the price we must actually achieve. If volume discounts of up to 12% are given, the margin drops (each 5% off costs about ₹2.2 L a month). Are discounts allowed on this floor?

## 2026-10-03 — Saas.one: "Invisible Excellence", a 62-second brand film for the website

**A premium, music-led film that descends from the clouds onto an Autopilot-branded office and down through five levels of the building, showing real people using the platform at each one.**

- **Why:** The founder wants a premium website hero that explains, without words or narration, why a building on Autopilot feels effortless: every layer, from the CEO to the electrical room, is run by the platform. The film will later be cut into frames for a scroll-driven page.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/fms-explainer/invisible-excellence/`, with the same video toolchain as the July explainer. Nothing in the FMS app changed.
  - Real-looking footage is AI-generated (Higgsfield). The first version used a stylised glass tower; the founder rejected it as unrealistic and unbranded. It was replaced by a photoreal Bengaluru tech-park building with AUTOPILOT signage on the roof. The drone shot was generated rising away from the building and played in reverse, so it lands exactly on the branded frame.
  - Each level shows a person mid-task (a CEO on a tablet, an employee raising a ticket, an admin dispatching on a radio, a technician closing a job, an engineer scanning a meter). The real FMS screens sit beside them and respond in step with their taps: typing, approvals, ticks and counters. The founder asked for people in action rather than static screens.
  - Music and sound effects only, no voice-over, so the silent scroll version tells the same story through on-screen text.
- **What works now:** A finished 62.5-second 1080p film, `renders/Invisible-Excellence.mp4`, in Autopilot's own colours and fonts, using real FMS components (Unified Dashboard, tenant app, Admin Console, Maintenance Portal, Command Center).
- **Left undone:**
  - The frame split for the scroll website. The film comes first, per the founder's instruction.
  - The AI clips are 768p, upscaled to 1080p, to fit the remaining Higgsfield credits. They're sharp enough on the half-screen layout but softer than true 1080p.
  - Numbers on screen (11 properties, 1,284 active people, 94.8% resolved and so on) are illustrative, not live data.
- **Open questions for the founder:**
  - Higgsfield credits are almost used up (about 9 left). Re-shooting any clip, or moving to 1080p, needs a top-up.
  - The rooftop sign renders the "A" as an outline triangle, not the solid block of the real logo. Is that close enough?

## 2026-10-03 — Saas.one: Satej becomes a live dashboard you can talk to

**The Satej page now shows what the agent is doing as it does it, lets the team edit a request after submitting it, and puts Satej in a chat panel with a voice call one click away.**

- **Why:** The procurement team asked to see who Satej is picking up while it works, to change a request after sending it, and to speak with Satej the way the Agent Council can be spoken with.
- **Structural decisions:**
  - Live progress is a small snapshot saved on the requirement while each stage runs (the queries, pages read, every vendor spotted, each call's state), and the page checks it every two and a half seconds while Satej is working. The alternative, the database's live-update feed, would have meant opening Satej's tables to browser reads, which are locked to the server on purpose.
  - Satej never changes anything from a conversation. Asked for a change in chat or on a call, it proposes one; a person presses Apply, and the same code as the page's own buttons runs it. Calls cost money and reach real businesses, so a sentence is not enough to dial them.
  - Editing before calls start re-plans from scratch; editing after calls starts a new round that skips every vendor already called, so no vendor is phoned twice for the same job.
  - The voice call runs on ElevenLabs, as the founder chose, using the existing key: a new ElevenLabs agent "Satej" with an Indian-English male voice (Amay). The Council's own call runs on OpenAI, which this server has no key for. The call's audio components are served from FMS itself so the site's security rules did not have to be loosened; only ElevenLabs' own address was added to them.
- **What works now:**
  - Each requirement shows a stage rail and a live board: queries ticking off, a pages-read bar, and a feed of vendors as they are spotted; then the call list with a remove button on each vendor; then every call's live state (in queue, ringing, on the call, spoke, no answer) with the vendor's own words; then a score leaderboard with the reason for every point.
  - Edit opens the request pre-filled and says plainly whether saving re-plans or starts a new round.
  - The Satej chat panel answers questions about the requirement, offers suggested questions for each stage, and shows proposed changes with Apply and Dismiss. The Call button opens a voice call with live captions; when it ends, the minutes appear in the chat.
  - Tested: all four stages and the edit dialog rendered in the browser with sample data and no errors; a real ElevenLabs session was opened with Satej's per-call prompt and Satej spoke its first line; the whole pipeline still passes its simulated end-to-end run. **Not tested:** a signed-in session against real data, and a full spoken conversation through a microphone.
- **Caller script and recordings (added the same day):** a new tab shows exactly what Meera says to vendors — her live greeting (and how a given vendor hears it), how she introduces Autopilot and runs the call — read straight from Bolna. Her calls from the last 30 days play as MP3s with transcripts (her 165-second test call from 24 September plays). The team can write feedback and get a revised script back with a list of what changed, then an org super admin publishes it to Meera; the script that was live is saved first so any publish can be undone. A script that uses a placeholder Satej does not fill is refused before it reaches a vendor. The command-line setup script now refuses to overwrite a script edited from the console.
- **Choose your own vendors and "call me first" (added the same day):** a requirement can now use Satej's web search, the team's own vendor list, or both. Vendors can be typed in, pasted as a rough list in any format, or imported from Excel, CSV or text; numbers are cleaned, duplicates and invalid numbers are skipped with a reason, and the team's own vendors survive an edit. Before any vendor is phoned, "Call me first" has Meera ring the team member's own phone with exactly what a vendor would hear for that requirement; the recording, transcript and Satej's read of the call appear on the page, test calls are never ranked, and one click takes the transcript to the Caller script tab to improve the script from it.
- **Left undone:**
  - Two more migrations, written and not applied: `20261003000001_satej_chat.sql` (chat) and `20261003000002_satej_voice_versions.sql` (script versions — publishing is switched off until it runs, so no publish is ever unrecoverable).
  - Before deploying, `SATEJ_ELEVENLABS_AGENT_ID` (and the ElevenLabs key, if missing) must be added in Vercel.
  - The multi-address fix on the Agent Console's Delivery tab is committed separately; it still has not been tried signed in.
- **Open questions for the founder:**
  - Is Amay the right voice for Satej, or should it match the team's preference?
  - ElevenLabs bills voice calls per minute on the pay-as-you-go plan. Should calls have a monthly cap?

## 2026-09-28 — Saas.one: Satej, the vendor discovery agent, and a voice caller that no longer sounds scripted

**Procurement can now hand a purchase requirement to an agent that finds local vendors, has them phoned, ranks them and sends the shortlist on WhatsApp — and the Agent Console now saves and shows an agent's workflow, names its failures, and knows Bolna calls and WhatsApp messages as tools.**

- **Why:** Finding vendors for a new requirement means a purchase executive searching the web and phoning businesses one by one. The founder wanted the procurement-agent plan (the "Procurement Agent Plan" document) built inside FMS as an agent called Satej, using what FMS already has, with the Bolna voice agent wired in. Two Bolna problems were raised along the way: how a spreadsheet of vendors reaches the voice agent column by column, and a voice that sounded like a machine to the vendors it called. Separately, the Agent Console was reporting builds as done while showing no workflow, with no explanation when something failed.
- **Structural decisions:**
  - Satej reuses FMS's own pieces instead of the plan's new ones: the council language-model connection (Engy) instead of a second one, the existing Supabase database instead of a separate database connection, AiSensy for WhatsApp instead of a new direct WhatsApp account, FMS login instead of a shared password, and the Agent Console's run recorder so every stage it runs is traced.
  - WhatsApp through AiSensy can only send pre-approved templates, so the team gets two short messages (a question or an approval is waiting; the shortlist is ready) with a button to the full ranked list in FMS. The plan's WhatsApp command channel (NEW, STATUS, ANSWER by chat) was left out for now; everything it did is on the Satej page.
  - A person approves every call list before anyone is phoned. The plan made this optional; calls reach real businesses and cost money, so it is on by default.
  - The existing Bolna agent **Meera** is the voice, as the founder chose, and she keeps her name. Her prompt, voice and settings now live in the codebase and are pushed to Bolna by one script, so the version that calls vendors is always the reviewed one.
  - Vendor pages are read by a faster, cheaper model than the rest. Measured today: the default model took 17 seconds per page and failed on a long directory page; the faster one took 3–25 seconds and found more vendors. The whole search has to fit inside one five-minute server run.
- **What works now:**
  - Procurement users have **Vendor Discovery (Satej)** in their sidebar, and org admins have it under Procurement. They raise a requirement; Satej asks a question only if the calls would be useless without the answer, searches the web, drops duplicates and irrelevant businesses, skips anyone called in the last 30 days, and waits for approval.
  - After approval, Meera phones each vendor inside calling hours (10:00–18:30, Monday to Saturday). The spreadsheet Satej sends has exactly the column names Meera's prompt uses, so each call is filled with its own vendor and requirement. That was the "how do we map the columns" problem, and the sync script now refuses a prompt that uses any name the spreadsheet does not supply.
  - Meera was made to sound like a person. Her real calls showed why she did not: she numbered her questions, used textbook Hindi, used a masculine verb form for herself, said "Wonderful", and would not tell a vendor what the job was. Her voice also changed to a different speaker when a vendor spoke English, announced "Let me connect you with who speaks English", and ended calls with "The call will now disconnect". All of that is fixed, and she has a quiet office sound behind her. She still answers honestly if a vendor asks directly whether she is an AI. Her old setup is saved in the repository.
  - Every call's recording and transcript, the score out of 100 with the reason for each point, and a copyable WhatsApp summary are on the Satej page. A **Run log** tab shows each step Satej took, how long it took, what it cost and what failed.
  - In the Agent Console: the workflow is saved with the agent and shown on its Configure tab. A model failure is named in red instead of being passed off as a plan. The flow builder opens full screen. Bolna voice calls and the WhatsApp webhook are tools an agent's flow can use. The root-cause write-up is `docs/agents/RCA-2026-09-28-agent-console-build.md`.
  - Tested: the whole Satej flow end to end with simulated search, calls and messages; the real Engy, Exa and planner connections once each; every new endpoint's security locally. **Not tested:** a real phone call, and the new screens while signed in.
- **Left undone:**
  - Satej's database tables are written as a migration (`20260928000001_satej_vendor_discovery.sql`) but not applied, per standing instruction. Until it runs, Satej says so on screen and its worker reports it every minute.
  - Two settings must be added in Vercel before deploying (`SATEJ_BOLNA_AGENT_ID`, `SATEJ_BOLNA_WEBHOOK_TOKEN`), and two WhatsApp templates must be created in AiSensy and approved by Meta. The exact text is in `WHATSAPP_META_TEMPLATES.md`, section 11.
  - Meera's webhook already points at the hosted site, where Satej is not deployed yet. Until it is, Bolna's call results for Meera get no answer there; Satej's five-minute catch-up covers any it misses once live.
  - No automatic grader checks the quality of Satej's call analyses yet. The plan is to hand-check the first 20 against their recordings first.
  - Three security gaps found in the Agent Console and Ira's Bolna webhook were not fixed here; they were started as separate tasks.
- **Open questions for the founder:**
  - Who is the first real test call to? It needs a team member's phone number, posing as a vendor, before any real vendor is dialled.
  - Should Satej call vendors in every city FMS operates in, or start with Mumbai? Web coverage in smaller cities has not been checked.
  - The company brief Meera uses to answer vendors' questions about Autopilot is still the plan's draft. Who signs it off?

## 2026-09-26 — Saas.one: Everything we learned, written down as a reusable engineering playbook

**The whole of what FMS taught us — schema, tenancy, security, dark mode, crons, email, agents — is now a portable skill stored outside this repo, and the exercise turned up several live security problems that need action today.**

- **Why:** We keep re-learning the same lessons on each new module, and the reasoning only lives in the head of whoever fixed it last. The founder asked for one consolidated playbook that can be carried to other projects. Writing it also meant reading our own code from the outside, which is what surfaced the problems below.
- **Structural decisions:**
  - The playbook lives in the founder's personal tools folder, not in this repository, so it survives the project. That was deliberate: the alternative — keeping it in `docs/` — is exactly what failed with our design research (see below).
  - Thirteen reviewers each read one area of the codebase and returned findings tied to specific files, rather than one reviewer writing general advice. Every rule in the playbook names the file that proves it, so none of it is generic commentary.
  - The playbook leads with the three patterns behind almost every incident we have had: silence being read as good news; a default value that hides the difference between "no data" and "the read failed"; and two code paths doing one job and drifting apart.
- **What works now:** Anyone starting a new project, or reviewing this one, has a single guide covering how to design the database, scope data per organisation and per site, keep roles honest, build the interface so light and dark mode both work, schedule background jobs that cannot fail silently, handle other companies' logins and secrets, and put AI agents on real data. It ships with a page of ready-to-run checks that find each class of problem in any codebase.
- **Recovered along the way:** Our 74 vendored design references and 8 commissioned research reports had disappeared from the project entirely, despite a note in the settings saying they would remain. They were rescued from an old backup branch and restored. The reasoning behind our card and glass styling cites those files by name.
- **Problems found that need a decision (in order of seriousness):**
  1. **Eight files in the repository contain a live master database password** (a Supabase `service_role` key, valid until 2036). Anyone who can read the repository can read and change every organisation's data, bypassing all permission rules. This key must be rotated, and it also has to be scrubbed from the project's history.
  2. **Vendor KYC documents — PAN cards, GST certificates, cancelled cheques — are in a storage area marked public**, on the written instruction of one of our own setup files. Those files are readable by anyone with the link and cannot be withdrawn. Eleven other storage areas are public for the same reason.
  3. **The global search box has no login check** and only filters by organisation if the caller chooses to. Search reads every table, so this is the one place a gap exposes everything at once.
  4. **Any report or list longer than 1,000 rows is silently cut off.** This already produced a false result: an annual plan chart showed a 45% collapse in May that never happened, because the data behind it was truncated.
  5. Several smaller items: HR tickets can be read without logging in by naming an organisation in the address; push-notification registration accepts someone else's identity; and 819 error logs are unfiltered while the tool that was built to redact them is imported by nothing.
- **Left undone:** None of the problems above were fixed. They are reported, not repaired — each is a decision about priority and downtime that is the founder's to make, and fixing the leaked key in particular touches every deployment at once. No application code was changed in this session.
- **Open questions for the founder:**
  - When do we rotate the database key? Everything deployed stops working until the new one is in place everywhere, so it needs a chosen moment.
  - Do the vendor KYC documents need to be made private immediately, or is that scheduled? This one has a legal dimension.
  - Should the playbook be pushed to a private repository? It currently exists on one machine only, which is the same fragility that lost the design references.

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
