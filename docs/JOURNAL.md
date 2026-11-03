## 2026-10-30 — FMS HR: proctored assessments brought onto main

**The proctored aptitude test module, built in September on a side branch, is merged with the current app so it can go live.**

- **Why:** The module (camera-watched tests with sections, two chances, a public candidate link and a report per attempt) was finished and tested on 23 September but never left its branch, so no one could use it in the live app.
- **Structural decisions:** No new design. The branch was merged with today's main. Where both sides had changed the same lines, both were kept: the public page list keeps the asset QR page and adds the test link; the HR sidebar keeps Task Manager and Meeting Assistant and adds Assessments after them; the Assessments tab follows main's newer pattern where a tab stays loaded once opened.
- **What works now (once this is merged and deployed):** HR logins (hr, hr_head, hr_manager, hr_ops) see an Assessments item in the HR sidebar. Admins, property admins, HR and directors can write tests and read results; other staff take tests at /proctor; outside candidates take a test from a /t/ link with no sign-in.
- **Left undone:**
  - Not clicked through in a browser after the merge; checks were a type-check (no errors) and lint (no new errors; the existing ones in the HR page and sidebar are already on main).
  - Whether the AI provider settings (COUNCIL_PROVIDER, COUNCIL_BASE_URL, COUNCIL_API_KEY) are set on Vercel was not checked. Without them tests still run but camera frames are not checked.
- **Open questions for the founder:** None new. The database tables and the private evidence bucket already exist in the live database.

## 2026-10-23 — FMS Invoice Control & Payment Tracker: one screen for every login, and a sweep of small bugs

**Accounts, Procurement and super admins now see the same Invoice Control and PO page, and about 40 small defects found in a review were fixed.**

- **Why:** The founder found the Accounts login showed a different invoice screen from Procurement, could not open or download a PO from some tabs, and kept hitting small problems: a replaced invoice still counted, rupee figures shown raw, a stuck "checking invoice" button, and so on.
- **Structural decisions:** Invoice Control is one component with one set of tabs for everyone; what a person can do still comes from their role on the server. It sits as a "Invoice Control" tab inside the Payment Tracker for every role, and the AOP Bounty has its own entry in the Accounts sidebar. The PO page is one shared drawer used from the tracker and from Invoice Control. The alternative, a separate Accounts-only invoice screen, was what caused the mismatch, so it was removed.
- **What works now:**
  - The PO page shows what was ordered (each line, quantity, rate, GST, amount) and the PO's terms, and has a PO PDF button.
  - Earlier files of the same document type stay visible on the PO page, with View and Remove, so a forgotten invoice no longer silently counts against the PO.
  - Aligned and Completed rows show whether the invoice matched at the time, open the PO, and link the PO PDF.
  - Align, Mark paid and uploads now work for master admins and people in more than one organisation; amounts keep their paise; Align warns when more than what is left is being aligned; a read that never finishes no longer locks Align.
  - The Live Sheet now pages through all POs instead of stopping at 50; searching with a comma or bracket no longer shows a false "nothing found"; load errors are shown instead of an empty table.
  - Invoice checks: dates use Indian time, the "nothing left on this PO" case reads plainly, the truncated-document check is visible and resolvable, the bell notification opens the invoice and clears when someone decides, and out-of-range policy values are refused with the field named.
  - Payment plan: a milestone marked due can be undone, GST rows use the PO's real GST, and Esc closes only the top window.
  - AOP Bounty: "assign for this line" is now remembered, day 31 stays in the month, ordinals read correctly, only the owner or an admin can reopen or set a billing pattern, and the "not set up" message names the right migration.
  - The approval watch no longer gives up on a PO when Zoho has a momentary error, so its vendor still gets the WhatsApp.
  - Finance emails escape anything a person typed.
- **Left undone:**
  - Directors can mark payments paid on the server but the screen does not offer it. This is a permission decision, so it was not changed.
  - Tax invoices uploaded on the PO page still go to the older public storage bucket, so anyone with the link can open them. Moving them to the private bucket is a separate, slightly larger change.
  - Removing a document shows in the PO timeline as "Commented"; a proper label needs a database change.
  - Nothing here was clicked through signed in; checks were type-check, lint, 105 automated tests and a production build.
- **Open questions for the founder:** Should directors be able to mark payments paid? Should PO-page invoices move to private storage now?

## 2026-10-23 — FMS CRM: website enquiries from the Total Environment landing page now become CRM leads

**A new public form endpoint turns every site-visit request on the TE Whitefield page into a CRM lead and emails Harshini and Saniel.**

- **Why:** The landing page's booking form only opened the visitor's own email app. A lead was lost every time the visitor did not press Send, and nothing reached the CRM.
- **Structural decisions:** One new public endpoint for website forms. It reuses the shape the Meta lead-ads webhook already uses: same lead fields, same default status, same round-robin rules and the same new-lead WhatsApp alert. The lead source is the existing "Website" source. The lead is owned by an org admin and belongs to the Autopilot organisation. There is no login, because website visitors have none. Instead the endpoint allows five submissions per minute per visitor, has a hidden trap field for bots, and checks every field. If saving to the CRM fails, the email still goes out with a note saying so, so no enquiry is lost. The alternative, a separate form tool such as a Google Sheet, lost because leads would sit outside the CRM.
- **What works now:** A visitor fills in name, company, seats, move-in timing and phone, then slides to book. The FMS creates a lead marked "TE Whitefield landing page". Leads wanting to move in immediately are marked High priority. Harshini and Saniel get an email with the details, and CRM admins get the usual new-lead alert. If the FMS cannot be reached, the page falls back to opening an email draft to both of them.
- **Left undone:** Not deployed. The route is committed on a clean branch, feat/website-lead-intake, but pushing to GitHub was refused because this machine is signed in as an account without write access to the saas_one repository. fms-dev-saas-one.vercel.app does not have the endpoint until someone with access pushes and merges it. No real lead was submitted in testing, because that would write to the live database and email both people. Only the reject, bot-trap and cross-site paths were tested. The landing page is not hosted anywhere public yet.
- **Open questions for the founder:** Who should own these leads by default? Today they follow the Lead Distribution rules, and stay unassigned if no rule matches "TE Whitefield landing page" or "Bengaluru". Is Saniel's address correct as worksquare.in?

## 2026-10-23 — FMS CRM: Lead Distribution screen could not load reps or rules

**Fixed the server request behind the Lead Distribution screen so rules and the rep picker load again.**

- **Why:** Admins could not create or see lead-routing rules. The screen showed "No distribution rules yet" and an empty "Assign To" list, so incoming Bangalore leads could not be pointed at Harshini. The request that loads rules was failing because the rule-members table is linked to the login table, not the profile table, and the database layer refused to join the two.
- **Structural decisions:** Kept the database as it is and changed the server code to look up rep names in a second small query instead of a join. The alternative, a migration adding a second link on the members table, would have needed a database change for a display-only problem.
- **What works now:** Lead Distribution lists existing rules with rep names, the rep picker fills, and Create Rule saves and returns the saved rule. Lead routing itself never used the broken join, so saved rules fire as before.
- **Left undone:** Not verified in the browser (no dev server running, local database key invalid). The seeded rules still point both "bengaluru" and "bangalore" at Manjunath unless an admin changes them; a rule for "bengaluru" may already have been switched to Harshini by a save attempt made before this fix. Both spellings need checking in the app.
- **Open questions for the founder:** Should Harshini take both the "bengaluru" and "bangalore" keywords, and should Manjunath's existing open leads also move to her?

## 2026-10-23 — Saas.one: AOP Bounty (first version) and the decision pack for the CEO review

**A new "AOP Bounty" inbox in the org super admin, ops super admin and Purchase logins lists, for the month, every AOP figure still missing, every invoice waiting on a decision, every urgent payment waiting on an approver, and every PO that cannot be filed, each with an owner and a deadline, and asks the owners until it has them. A decision pack with every open question was published for the 24 October review. Written and tested in code; the database change is not applied and the daily job is not deployed.**

- **Why:** The AOP sheet was filled at month end by chasing people over mail and WhatsApp from memory. The facts it needs already arrive in the app one by one; nothing tied "what is still missing" to a person and a clock. The founder asked for a bounty on every line item at every site, in a feed that reads like an inbox rather than a wall of totals.
- **Structural decisions:**
  - **A bounty is closed by its fact, never by hand-typing a number.** It closes when the actual lands on the cell, the invoice is decided, the fast-track is approved or rejected, the PO is classified, or the vendor message goes out. The owner may also answer it ("no spend this month", "will be in by the 25th", a note). It never writes an AOP figure itself.
  - **It waits before it asks.** Each site x line remembers the day the invoice is normally in by and the vendor's billing cadence (for example every 60 days from August). Before that day the bounty sits quiet; after it, the owner is asked at most every two days; past month end it is escalated to Operations once.
  - **Owners are a role group by default (Purchase, Accounts, Operations, Approver), overridable per line or per site by an admin,** and remembered for future months. Lines fed automatically (electricity, diesel, water, petty cash) never raise a bounty.
  - **The inbox shows comparisons, not totals:** each row carries the previous two months' figures, how many times it has been asked, and the due date, grouped Today / Yesterday / Last 7 days / Earlier like a mail client.
  - **Access is the Payment Tracker's rule:** org super admins, ops super admins, accounts and purchase. Property admins are not admitted.
- **What works now (once applied and deployed):** the AOP Bounty entry in the org-admin sidebar (ops super admins use the same shell) and in the Procurement sidebar; month navigation; Open / Mine / All; ask now, answer, set the vendor's billing pattern, assign an owner; a daily job that refreshes, asks and escalates; bell alerts and emails to the owners.
- **Left undone:**
  - **The database change is not applied** (`supabase/migrations/20261023000002_aop_bounty.sql`) and the daily job only runs once deployed with the new `vercel.json` entry.
  - **Not opened in a browser signed in.** Rules, grouping, cadence and the tables are tested; the screen is type-checked and linted only.
  - **No site mapping yet:** PO sites (Zoho names) are not yet linked to AOP sites, so a "figure" bounty cannot yet say which POs or invoices belong to it. That is the next piece, after the mapping decisions in the pack.
  - **WhatsApp pings are not built;** email and the in-app bell only. The template for the ambiguous-invoice question is drafted in the decision pack and needs Meta approval.
  - **The "actual" feed from paid invoices into the AOP is not built,** so today a figure bounty is closed by the existing manual or imported entry, or by the owner's answer.
- **Open questions for the founder:** all collected in the decision pack (sections A to E): approval limits, the invoice clock, who is told on an override, waivers, Live vendor messaging, the AOP amount/month/Capex rules, line owners and the roles of Shri and Rushabh, payment cadence policy, the integrations, the Purchase SPOC list, evidence on Align, Managed Ops sites, reminders, booking, bills@, the monthly close day, and the site mapping.

## 2026-10-23 — Saas.one: Live invoice progress and exact reasons on Align

**While an invoice is read and checked, the person who uploaded it now sees simple live steps. When it does not match, every screen that judges it says exactly what is wrong, in words and rupees, instead of check names. Written and tested in code; not yet seen signed in.**

- **Why:** The Align warning listed "po eligible, po balance check, line item mapping", which tells nobody what to fix. People also had no sign that an upload was being worked on.
- **Structural decisions:**
  - **One source of wording.** A single translator turns the stored check results into sentences with the real figures, for example "The invoice total ₹4,96,780 is ₹1,03,250 more than what is left on the PO (₹3,93,530)" and "2 lines on the invoice are not on the PO: "Floor surface grinding…", "Debris collection…"". The Align screen, the invoice screen and the PO's Documents tab all use it, so they cannot disagree. A check with no wording of its own falls back to the engine's own sentence, so nothing is dropped.
  - **Four plain steps, no detail:** Received, Reading the invoice, Checking against the PO, Done. They are worked out from existing fields, so no database change was needed.
  - **A misread GSTIN says it may be a misread,** rather than accusing the vendor of being wrong.
- **What works now:** Align shows the plain reasons and what to do next, waits with a spinner while the invoice is still being checked, and shows "No invoice attached" with the instruction to upload when there is none. The invoice screen shows the steps, then a green "Matches the PO" or an amber box with the reasons. A live line appears under the Tax invoice row on the PO's Documents tab.
- **Left undone:**
  - **Aligning despite a mismatch is stored and shown to Accounts only when they mark the payment paid.** It is not shown to super admins, is not in the aligned email, and is not in the PO's activity timeline. See the open questions.
  - **Older invoices keep their old stored result** until someone clicks Re-check, so an invoice checked before its PO was approved still says "PO not approved".
  - **Not seen signed in.**
- **Open questions for the founder:**
  - When Purchase aligns a payment against an invoice that does not match, who must be told, and where: super admins, Accounts, or both? (Today: nobody, until Accounts opens Mark paid.)
  - Should an aligned-without-invoice payment appear as a list for the founder to review?

## 2026-10-23 — Saas.one: Approval watcher, vendor WhatsApp on real approval, invoices uploaded on the PO page now checked

**When the founder approves a PO in Zoho, the system now notices within 10 minutes and WhatsApps the vendor the approved PO. Invoices uploaded on a PO's own page now go through the same reader and matcher, so the Align screen can judge them. Written and tested in code; the database change is not applied, the new job is not deployed, and nothing has been sent.**

- **Why:** Purchase raises POs, the founder approves them in Zoho, and the vendor should hear the moment that happens. Before this, only a test button did it. Separately, an invoice uploaded in the PO's own page was invisible to Invoice Control, so the Align screen said "no invoice" for a PO that had one, and a dummy file passed unchecked.
- **Structural decisions:**
  - **A 10-minute check, not a new service.** One small Vercel job asks Zoho which POs are waiting for approval and which were approved since the last look, then sends. With the switch off it does one database read and stops; with it on it makes at most three read-only Zoho calls. It was chosen as the cheapest way that does not need Zoho admin work. A Zoho webhook can be added later for instant delivery; the receiving endpoint is built and safe to run alongside the check.
  - **A watch list, not "every approved PO".** 3,455 POs are already approved. Only a PO the job saw waiting for approval, or one created after the switch was turned on, can ever be messaged. A test proves old approved POs are untouched.
  - **One automatic message per PO, ever,** enforced by the database, plus a claim before sending so two overlapping runs cannot both send.
  - **A three-position switch: Off, Test, Live,** set by a super admin in the Policy tab. It starts Off. Test sends real approvals to the test number; Live sends to the vendor's own number. You asked for real vendors straight away, so Live exists, but nothing is sent until someone chooses it.
  - **A vendor with no WhatsApp number is flagged on the PO row** ("Vendor has no WhatsApp number. Add it in Zoho, then click Send WhatsApp") and is not retried automatically. Only 345 of 851 vendors have a number in the app; the job also looks at the Zoho contact before giving up.
  - **Invoices uploaded on the PO page are copied into Invoice Control and read there.** The original document is untouched. A file that is not a PDF, JPEG or PNG is registered anyway and shows as "could not read", so it cannot slip through.
- **What works now (once applied and deployed):** real approvals trigger the vendor message with the PO PDF; the 48-hour invoice clock starts at approval and shows on the PO row; the row shows sent, no number, or failed; Purchase can resend once a number is added; the Policy tab shows the switch and the last check.
- **Left undone:**
  - **The database change is not applied** (`supabase/migrations/20261023000001_po_approval_watch.sql`), and the job only runs once deployed with the new `vercel.json` entry.
  - **Nothing has been sent.** The AiSensy campaign for the template must exist and be active.
  - **The Zoho webhook is not set up;** it needs a secret and a rule in Zoho.
  - **A PO raised and approved inside the same 10 minutes is only caught if it was created after the switch was turned on.**
  - **The Align prompt was built in a parallel piece of work** and is not changed here. It asks for a written reason when the invoice is missing or does not agree; it does not block.
  - **The 48-hour clock only shows on screen;** there is no reminder.
- **Open questions for the founder:**
  - When Live is switched on, any PO still waiting for approval at that moment will message its real vendor the moment it is approved, including POs raised weeks ago. Is that wanted, or should old waiting POs be excluded?
  - Should Purchase be able to add a missing vendor number inside the app, rather than only in Zoho?

## 2026-10-22 — Saas.one: Simulated PO approval and approved-PO WhatsApp

**A super admin can now simulate a PO's approval inside the app and send the approved-PO WhatsApp, with the PO as a PDF, to a test number. Written and tested in code; the database change is not applied and nothing has been sent yet.**

- **Why:** The five MVP POs cannot be approved in Zoho right now, but the whole flow (invoice upload, matching, payment milestones) waits for "approved". The WhatsApp template `po_approved_vendor_notification` is now approved by Meta and is the first message a vendor should get.
- **Structural decisions:**
  - **Simulation lives in this app only.** It is recorded in a new table and shown as SIMULATED. Zoho is never written to, and a real approval in Zoho takes over on the next sync. The alternative, editing the PO status in our copy of the data, was rejected because the Zoho sync overwrites it every two hours and nothing would record that it was simulated.
  - **The WhatsApp goes only to a test number a super admin sets.** There is no code path that reads a vendor's own phone number, and a test asserts that.
  - **The PO PDF is fetched from Zoho (read-only) and kept as our own private copy,** then shared with the WhatsApp provider through a link that works for one day.
  - **The value in the message is the tax-inclusive PO total, formatted in Indian grouping** (for example 1,47,500), with the rupee sign kept in the template text.
- **What works now (once applied):** a "Simulate approval" button on each PO waiting for approval (super admins only). It shows the exact message first, records the approval, starts a 48-hour invoice clock shown on the PO row, treats the PO as approved for invoices and the payment plan, and sends the WhatsApp. A failed send is recorded with its error and can be resent.
- **Left undone:**
  - **The database change is not applied** (`supabase/migrations/20261022000001_po_approval_simulation.sql`).
  - **Nothing has been sent.** The WhatsApp provider's campaign for this template must exist and be active in the provider dashboard; Meta approval alone is not enough. The first send will show whether it does.
  - **Real approvals do not trigger the message yet.** Only the simulate button does. Sending automatically when Zoho approves a PO is not built.
  - **Sending to real vendors is not built,** deliberately.
  - **The invoice-upload link is not in the message.** The approved template has none; the founder will add a template for that.
  - **The 48-hour clock only shows on screen.** There is no reminder, and it is a different clock from the 3-days-after-payment rule discussed on the call.
- **Open questions for the founder:**
  - Should the 48-hour invoice clock and the 3-days-after-payment rule be one rule or two?
  - When real vendors are switched on, who owns the vendor phone number: the Zoho vendor record, or the vendor profile in the app?

## 2026-10-20 — Saas.one: PO payment plan (payment terms turned into clickable milestones)

**Each PO's payment terms are now read into a plan of milestones that Purchase confirms, records progress against, and clicks when a payment falls due. Built and tested in code; the database change is written but not applied.**

- **Why:** Payments were being lined up as soon as a PO existed, with no view of what was actually agreed. Zoho's own "payment terms" field is unreliable: DL-PO-26/27-0086 is labelled "100% Advance" while its terms say 30%, 20%, 20% and 30% at four stages, and 676 of the first 1,000 POs are just "Custom". The real terms sit in free text.
- **Structural decisions:**
  - **Read from the text, by plain rules, not by a model.** It costs nothing, behaves the same every time, and can be tested. On a live sample of 400 POs, 93% read cleanly, 6.5% are flagged for a person, and 0.5% have no terms.
  - **A reading is only a proposal.** The percentages must add to 100 and any amount printed in the terms must match the percentage. Anything doubtful is flagged. Purchase confirms before anything counts. You chose this.
  - **Clicking a milestone marks it due and emails Accounts. It never creates a payment.** Accounts still raises and aligns it in the Payment Tracker. You chose this.
  - **Percentages are on the basic value (before GST), with GST as its own milestone,** because that is what these POs say. Where a PO is silent on GST, the percentage applies to the whole PO value and the screen says so.
- **What works now (once applied):**
  - A "Plan" button on each PO in Invoice Control shows the milestones as a timeline: percentage, amount, what makes it payable, and the date it was reached.
  - Purchase records "25% done on 12 Oct" or "material delivered", and each milestone waits for that evidence.
  - Purchase confirms, edits, or builds the plan from standard presets where the PO says nothing.
  - Marking a milestone due before its stage is recorded is allowed only with a written reason, and Accounts sees it flagged "marked early".
  - Accounts has a "Milestones due" list.
  - All five MVP POs read correctly. DL-0086 is flagged because one line names two triggers (delivery and 50% completion).
- **Left undone:**
  - **The database change is not applied** (`supabase/migrations/20261020000002_po_payment_schedule.sql`).
  - **Not opened in a browser signed in.** Parser, rules and tables were tested; the screens were type-checked and linted only.
  - **GST-portal status and "other" triggers are not tracked,** so those milestones show "not tracked automatically" and rely on Purchase's note.
  - **Site in-charge cannot record progress yet;** only Purchase can.
  - **The Payment Tracker does not yet show the milestone** against each tranche, and Accounts is told by email and a list, not inside the tracker row.
  - **A PO with history cannot be hard-deleted** (the logs are append-only). Nothing in the app deletes POs, so this only affects manual database deletes. I added a comment saying so to the already-applied invoice migration; the SQL is unchanged.
- **Open questions for the founder:**
  - For the 6.5% of POs the reader flags (for example "20% on delivery and 50% completion"), who decides: Purchase alone, or Purchase with the approver?
  - Should "payable within 30 days" count from the milestone date or from the invoice date?

## 2026-10-20 — Saas.one: Invoice Control (vendor invoice collection, PO matching, urgent-payment approval)

**Built end to end, tested in code, not yet switched on: one place to collect each vendor invoice, check it against the PO, and approve urgent payments that cannot wait for the invoice.**

- **Why:** Invoices arrive by mail and WhatsApp, are chased by hand, and are never compared to the PO line by line, so payments get lined up on trust. Urgent payments with no invoice had no controlled route.
- **Structural decisions:**
  - **Three separate tracks, never one status.** The invoice (read, matched, accepted), the payment exception (asked, approved, aligned), and the invoice chase (pending to reconciled). A payment can be aligned while its invoice is still missing, and approving one never marks the other done. The alternative, one status column, was rejected because it lets a missing invoice quietly turn into a verified one.
  - **Built inside the existing app, not as the separate service the PRD described.** The PRD asked for Supabase Edge Functions. The app already runs its own server routes with a tested access check, so the module reuses those. Nothing new to deploy or secure.
  - **Reuses what exists.** POs and PO lines come from the Zoho tables, vendor GSTIN from vendor profiles, and the actual payment still goes through the Payment Tracker. No second vendor or PO list.
  - **The system checks; people decide.** A model only reads the invoice. A plain rules engine decides if it matches, and a person must click Accept. A value that cannot be read counts as unknown, never as zero or a pass.
- **What works now (once the database change is applied):**
  - Purchase creates a one-time upload link for a PO, shares it by WhatsApp, and can revoke it. The vendor needs no account and sees only the PO number and an upload box.
  - Staff can attach an invoice that arrived another way. It is recorded as an internal upload by that person.
  - Each invoice is checked against the PO: vendor, quantity, rate, tax, totals, remaining PO value (so two part-invoices cannot overbill), duplicates, and extra charges. A person can correct a misread value or resolve an issue with a written reason. The original result is kept.
  - Purchase asks for a fast-track payment with a reason and evidence. Someone else approves it (never the requester, and only up to a limit unless a super admin). Accounts then aligns it in the Payment Tracker. The invoice stays on a chase list with a deadline, shown as overdue if missed.
  - Screens: Procurement tab "Invoice Control", Accounts tab "Invoices & Exceptions", and an Invoice Control link in the org admin sidebar. Super admins set the approval limit, who may approve, tolerances and deadlines.
- **Left undone:**
  - **The database change is written but not applied** (`supabase/migrations/20261020000001_invoice_control.sql`). Nothing works until a person runs it once.
  - **The invoice reader has never read a real invoice.** The reading model and prompt are untested on this company's invoices. Before trusting it, run about 30 real invoices and compare with a person.
  - **The signed-in screens have not been opened in a browser.** Only the vendor page, the public/blocked responses and the code checks were run.
  - **No reminders or email alerts yet.** Overdue invoices show on screen; nothing is sent. Reminders need a scheduled job, which means a change to the production schedule, so it was left for the founder to approve.
  - **Goods-received and credit notes are not used in matching,** and mail or WhatsApp intake was out of scope, as in the PRD.
  - **Link throttling is per server instance** (the real protection is the 256-bit link and the single use). A scanned-image invoice with many pages reads only the first 4 pages.
- **Open questions for the founder:**
  - Who counts as an approver, and what is the limit? The default is Accounts, org super admins and master admins, up to ₹1,00,000, with super admins above that. This is a setting in the Policy tab.
  - How many days should a vendor get to send the invoice after an urgent payment? Default 7.
  - Should reminders go by email, WhatsApp, or both, and to whom?
  - Is it acceptable that a super admin can waive a missing invoice by policy, with a written reason on record?

## 2026-10-16 — Saas.one: From wiki to organisational brain — stress test, five-lens review, explainer video

**The new wiki was tested with 11 hard questions and scored about 3 out of 12. A review from five angles (product, data, AI, operations, governance) agreed on what turns it into an organisational brain, and a 2-minute narrated video explains it.**

- **Why:** The founder asked for "an organization brain, not something I plumb every day", and asked to understand what exists today and what would unlock real intelligence.
- **What the test showed:**
  - 6 of 11 answers came back "not in the wiki".
  - One answer was confidently wrong: asked for "the most complex system", search pulled pages about key chains and face masks.
  - A question about the purchase team in September missed the September page, because that page says "2026-09".
- **Why it falls short:**
  - It searches words, not meaning.
  - It reads 4 sources out of about 230 tables, and ignores who raised and approved each PO, which is already synced for 5,761 POs.
  - It only answers when asked.
  - It has no memory of decisions.
- **Why it feels like plumbing:** every failure so far was found by the founder, never by an alarm. The purchase mail sync was dead for 57 days while reporting success.
- **The five unlocks agreed on:**
  1. **Push:** a price verdict on every new PO in Ira's daily mail.
  2. **Memory:** a record of decisions (what, who, why), with proposed versus verified.
  3. **Smarter reading:** sort questions by type, and read the whole journal for broad ones.
  4. **See more:** approvals, bills, tickets, energy, budgets and full mail.
  5. **Watches itself:** each source shows when its data last arrived, and a stale source alerts a named person within a day.
- **Proposed order:**
  - Week 1: watching itself, plus PO price verdicts.
  - Week 2: smarter reading and a test set.
  - Week 3: the decision memory.
- **What works now:** the video is at `~/Downloads/Org-Brain-Explained.mp4` (project in `~/Downloads/org-brain-video/`).
- **Left undone:** none of the five unlocks is built yet; this was diagnosis and planning only. The review also found risks that must be fixed before the brain is widened beyond super admins:
  - the leaked database key;
  - a chatbot database function that any signed-in user may be able to call;
  - PO notes that contain vendor bank details.
- **Open questions for the founder:**
  - Who owns applying database changes and shipping weekly?
  - Who receives alerts?
  - What should the staff notice and consent for the three archived mailboxes say?
  - Should Zoho bills and payments be readable?
  - When should the key be rotated?
  - Do your answers to open questions become binding facts in the brain?

## 2026-10-16 — Saas.one: An org wiki you can ask questions — purchase orders, mail and how FMS was built

**A new Wiki tab turns 5,764 purchase orders, 26,196 line items, the purchase@ digest and the development journal into about 2,200 linked pages, and answers questions from them with the source page cited on every claim.**

- **Why:** The founder asked for a "baseline to compare against" built from all purchase emails and POs (first raised 11 September and never built), and then for a wiki that can be asked questions directly. Until now every Ira scan re-read 5,000 POs and nothing kept what was learned.
- **Structural decisions:**
  - **Pages are compiled by code, not written by AI.** One page per vendor (801), site (34), item bought three or more times (1,300), month of POs (40), month of purchase@ mail (4) and journal entry (30), plus an overview (the index) and a red-flags page. A rebuild costs nothing and takes about 15 seconds. The alternative, having a model write each page (as in Karpathy's "LLM wiki" pattern this follows), lost because the pages are mostly figures that must be exact, and the founder asked that the weekly refresh burn no tokens.
  - **AI is used only to answer.** Search picks the six best pages, and one model call answers from them alone. If the answer is not in the pages, it says so instead of guessing.
  - **Good answers can be saved back as notes**, so the wiki grows from the questions people ask. A rebuild never touches notes.
  - **Item matching uses the same rules as Meera's rate checker**, so the two never disagree on what "the same item" is. A median needs at least three purchases (the floor proposed on 11 September).
  - **Super admins only.** The journal records security findings and the mail pages carry purchase@ snippets.
  - **Rebuilds every Monday at 06:00 IST**, plus a Rebuild button. The schedule line was added to `vercel.json` with the founder's approval.
- **What works now (once the migration is applied and deployed):** A super admin opens Wiki in the org dashboard and can:
  - ask "what did we last pay for TASKI R2" or "how much went to Metro Airconditioner this year" and get a short answer with links to the pages behind it;
  - browse vendors, sites, items, months, mail and journal entries;
  - see red flags: 123 POs pending approval worth ₹1.77 crore, drafts older than 30 days, same-amount POs to one vendor within a month, items up or down 25% year on year, and data gaps.
- **Tested:**
  - The compiler ran on the live data without saving anything: 2,211 pages, no broken links, 12 seconds.
  - The answer step was run live on real pages. "What did we pay BVG at SS Plaza" came back as ₹39,20,561 across 4 POs, with every figure linked; "which POs have waited longest for approval" came back as PO-26/27-0211 (Metro Airconditioner, 157 days); an off-topic question came back "not in the wiki".
  - Answers use a fast model: about 3 seconds and $0.0003 each. The default council model took 95 to 379 seconds for the same answer.
  - Found along the way: PO totals include tax while line items do not (BVG's ₹39.2 lakh in POs is ₹33.2 lakh before tax). Every page now says which figures include tax.
  - Type check and lint are clean.
- **Left undone:**
  - The migration `supabase/migrations/20261016000001_org_wiki.sql` is not applied, so the tab shows "not set up" until it is. The database search function has therefore never run.
  - Nobody has opened the tab in a signed-in browser.
  - Answers are not yet graded for quality (the doctrine's rubric step; see `backend/lib/wiki/AGENT_SPEC.md`).
  - The full mail archive is not included. Its migration is still unapplied, so mail pages carry subjects and opening lines only.
  - Bills, payments and approver names are not synced, so the wiki cannot answer questions about them.
  - Nothing committed.
- **Open questions for the founder:**
  - Should the purchase team get read access to the purchase pages only (vendors, items, sites), without the journal and mail?
  - Should the daily Ira scan start comparing each new PO against these item pages? That was the original "baseline" idea.

## 2026-10-16 — Saas.one: August costing filled to 84% automatically; September corrected

**The August tab of the costing sheet was filled from WorkDrive bills and from Zoho purchase orders that quote a vendor invoice. It reaches 84% of July's rupee total and 68% of July's line-by-site entries. September was corrected using what August taught us.**

- **Why:** The founder pointed out that September invoices only arrive in October, so September was a poor test. August is the fair one.
- **Structural decisions:**
  - **We learned the sheet's month rule from July instead of guessing.** July's figures match, to the rupee, the invoices dated in the first days of August. Examples: SS Plaza manpower ₹16,71,745 = BVG (4 Aug) + Salvus (6 Aug); Delhi ₹56,690 = Attollent + Perfection. So a month's cost is the invoices dated early the following month, and August = invoices dated early September.
  - **Purchase orders count only when they quote the vendor's invoice number.** Quotations and project orders were ignored. These figures are marked blue so they are not confused with bills (green) and estimates (amber).
  - **One workbook, both months.** `Costing For Sept'26n - AUTO-FILLED draft.xlsx` in Downloads holds both months, with a "sources" sheet for each that lists every figure and every gap. The original file is untouched.
- **What works now:**
  - August: 78 cells filled (₹1.05 crore).
  - Covered: manpower for 13 of 15 sites, electricity for 11, housekeeping material for 13, mineral water for all 13 that July had, plus pest control, tea and coffee, and vending.
  - September: 61 cells. Fixes made there:
    - "HO 1st/2nd floor" pest bills placed in D Wing and C Wing.
    - Bangalore material, diesel and Padcare moved to August.
    - The missing second Rabale 7th-floor meter flagged.
- **Left undone:** these are the lines with no source anywhere.
  - Petty cash (₹1.7 lakh a month).
  - Repairs.
  - AMCs.
  - The SS Plaza water tanker (₹1.7 lakh).
  - Rabale 2nd and 7th floor manpower (₹10 lakh).
  - Electricity for Delhi, Noida, Kolkata and B Wing.
  - Nothing was loaded into the AOP. Nothing committed.
- **Problems found in the bills:**
  - Noida pays two security vendors (ABN and Perfection).
  - D Wing security was billed 36 days in a 31-day month.
  - One worker appears on two sites' attendance at the same time.
  - Perfection's GST split is wrong, putting input credit at risk.
  - The SS Plaza electricity bill covers the whole building.
  - Several Mahir "change" invoices dated 6 August look like re-issued July bills.
- **Open questions for the founder:**
  - Who supplies Rabale's manpower, and where are those bills?
  - Is petty cash tracked anywhere?
  - Should the sheet be before or after GST?
  - Is the "FCB Kinnect" space at Mafatlal A Wing part of the C Wing column?

## 2026-10-15 — Saas.one: September costing sheet filled automatically from WorkDrive bills (draft)

**About 62 of the 465 cells in the September costing tab were filled from the purchase team's own WorkDrive bills, with a source note on every figure. The rest are listed with the reason they could not be filled.**

- **Why:** The founder asked us to try filling the monthly costing sheet without the site teams, and to show where an automatic fill gets stuck.
- **Structural decisions:**
  - **Bills first, purchase orders only when the invoice is dated September.** The purchase team files every bill under `My Folders / All Opex Bills / <category> / <month>` in WorkDrive. That folder is the source. Purchase orders raised in September turned out to be mostly for August invoices, so they were not used as September costs. The alternative, filling from POs, would have put August's Bangalore manpower into September.
  - **Amounts before GST.** Earlier tabs mix with-GST and without-GST figures. July's values match the before-GST amounts on the bills, so the fill uses before-GST throughout.
  - **Electricity is current-month charges only.** Arrears, security-deposit instalments and late fees are left out and noted.
  - **The original file is untouched.** The fill is a separate copy in Downloads: `Costing For Sept'26n - AUTO-FILLED draft.xlsx`. It has a "Fill sources" sheet with every figure, its bill, and every gap.
- **What works now:**
  - 55 cells come straight from bills (₹75.6 lakh) and 7 are marked as estimates (₹4.3 lakh, amber).
  - Covered: manpower for 10 sites, electricity for 10 sites, housekeeping material for 13, plus pest control, water, tea/coffee and vending.
  - The WorkDrive download now uses the endpoint the read-only token is allowed to use.
- **Problems found in the bills** (for the purchase team):
  - ETPL billed for 5 aroma-oil bottles more than its delivery note shows.
  - One C-wing housekeeping invoice is filed twice.
  - Noida has two security vendors in the same month, possibly overlapping.
  - ETPL electricity carries ₹12.6 lakh of unpaid arrears. Mafatlal D-wing has a disconnection notice expiring 17 October.
  - The ETPL drinking-water bill (₹83,050) has odd addresses and no delivery note.
- **Left undone:**
  - Manpower for SS Plaza, Delhi, Rabale (both floors) and ETPL. Their September invoices are not in WorkDrive yet.
  - Electricity for Delhi, Noida, Rupa and Kolkata.
  - All the AMC, repair, petty-cash and water-tanker lines. There are no September bills for these, and the app holds no petty-cash data.
  - Reading Zoho Books vendor bills, which needs a wider Zoho permission.
  - Nothing was loaded into the AOP. The dry run shows September would still be blocked by the missing budget and the Delhi mapping.
- **Open questions for the founder:**
  - How to split the shared Mafatlal A+B electricity bill.
  - Which site the "HO 1st/2nd floor" pest bills and the "FCB Connect" water bill belong to.
  - Whether the costing sheet should be before or after GST.
  - Whether to allow a Zoho Books "bills" read permission.

## 2026-10-15 — Saas.one: Ira listens only, Teams-style meeting room, LiveKit fixed

**Meetings now connect, Ira joins as a silent note-taker instead of a speaker, and the meeting room looks like a Teams call.**

- **Why:** Joining a meeting failed with "invalid token", Ira never joined, and the founder wants Ira to stop talking: people run the meeting, she only listens and writes things down.
- **Structural decisions:**
  - The LiveKit secret in the local settings did not belong to its key. A new key pair replaced it. The old settings file is backed up as `.env.bak.livekit`.
  - Ira has two modes. "Listen" is the new default: no voice and no spoken notice. She transcribes everyone, follows which PO is being discussed, and writes proposed decisions. "Speak" is the old behaviour where she chairs the meeting aloud, and it stays available. The alternative, deleting her voice, lost because a chaired meeting may still be wanted later.
  - Ira can now jump to whichever PO the room is discussing, instead of only following the agenda in order. An item skipped without a decision goes back into the queue rather than being marked parked.
  - The meeting room was rebuilt in three screens:
    - a lobby showing the transcription notice
    - a call screen: people as tiles, Ira as a "Listening · taking notes" tile, captions, a control dock, and a side panel with the agenda, Ira's notes and the transcript
    - a decision sheet once the meeting ends
- **What works now:** Joining a room works (LiveKit accepts the keys). Ira's worker runs on this laptop, is registered with LiveKit Cloud, and FMS accepts her key.
- **Left undone:**
  - No real meeting has been held with the new screen or listen mode. Nobody tested in a signed-in browser, and Ira's silent decision-taking has not been checked on real speech.
  - Ira runs only while this laptop's worker is running. For always-on use, deploy her to LiveKit Cloud (`agents/meeting-agent/README.md`).
  - The live Vercel site still needs the new LiveKit key and secret.
- **Open questions for the founder:**
  - The new LiveKit secret was pasted into chat. Rotate it once Ira is deployed?
  - Without the read-back, a misheard decision is caught only when an approver confirms the sheet. Is that acceptable?

## 2026-10-15 — Saas.one: Purchase team's Zoho WorkDrive — connection ready, waiting on one Zoho login

**The app can now list and download files from the purchase@worksquare.in WorkDrive as soon as that account approves read-only access.**

- **Why:** The founder wants to read the purchase team's WorkDrive files (costing sheets, AOP and purchase workbooks) before deciding the next steps for the AOP feed.
- **Structural decisions:**
  - **Same Zoho client as Mail and Books.** We confirmed that the existing Zoho client already signs in as purchase@worksquare.in (it reads that mailbox). WorkDrive gets its own token from the same client, read-only, and the Mail and Books connections are untouched. The alternative, a new Zoho app, would add three more secret values for no gain.
  - **Read-only scopes only.** The four scopes are for users, team, team folders and files, all READ. The app cannot create, change or delete anything in WorkDrive.
- **What works now:** `scripts/workdrive-browse.mjs` prints the full folder tree the purchase account can see (team folders and My Folders), with file names, sizes, last modified time and who modified it. `scripts/workdrive-fetch.mjs` downloads one chosen file for the AOP dry run.
- **Left undone:**
  - The token itself. It needs someone signed in to Zoho as purchase@ to approve access (steps given to the founder).
  - The browse script has not run against WorkDrive yet, so the exact API responses are unverified until the token exists.
  - Nothing committed.
- **Open questions for the founder:** Which WorkDrive folder is the official home of the monthly costing and AOP files?

## 2026-10-15 — Saas.one: Meetings moved into the main dashboard, simpler screen

**Meetings with Ira is now a tab of the org admin dashboard instead of a separate page, and the screen asks for one click instead of a form.**

- **Why:** The founder opened Meetings and found it outside the main dashboard, with a form that had to be read before anything could be done.
- **Structural decisions:** Meetings is a dashboard tab for org admins, like Document Bank. The old address still works: org admins are redirected into the tab, and other roles (property admin, procurement) keep the standalone page, since their dashboards have no such tab. The meeting room itself stays full-screen.
- **What works now:** One "Start review" button with sensible defaults (POs waiting 30+ days, up to 15). The settings sit under "Options". Live meetings show at the top with "Join now". Each meeting has a "Copy link" button for sharing. A three-step note explains the flow.
- **Left undone:** Not checked on screen yet, because the browser used for testing was signed out. Property admin and procurement dashboards still open Meetings as a separate page. The meeting agent worker was not started.
- **Open questions for the founder:** Should property admins and the procurement team also get Meetings inside their own dashboards?

## 2026-10-14 — Saas.one: AOP costing feed — WorkDrive connection prepared and first dry run

**The site teams' costing workbook was run through the planned AOP approval flow without writing anything, and the Zoho WorkDrive connection is ready apart from one login step.**

- **Why:** The AOP Budget-vs-Actual screen still stops at June. The site teams' monthly costing sheet (`Costing For Sept'26n.xlsx`) is the obvious feed for July onward. Before building the feed, the founder wanted to see where that sheet would break the planned checks and approvals.
- **Structural decisions:**
  - **Simulation before build.** A dry-run script (`scripts/aop_costing_dryrun.js`) reads the workbook and the live AOP tables, applies the planned rules and reports each finding as BLOCK, REVIEW, ROUTE or PASS, with an owner. It never writes. The same parsing will sit behind the real feed. The alternative, building the upload screen first, would have hidden these problems until data was already in.
  - **WorkDrive file is pinned by its id, not found by searching a folder.** Renamed or moved files still work, and copies like "Costing (1).xlsx" can never be picked up by mistake. Downloaded copies are named `AOP-costing-*.xlsx`, which git already ignores, so finance data cannot be committed by accident.
  - **WorkDrive reuses the existing Zoho Books login client.** One Zoho "Self Client" can issue a second token limited to reading WorkDrive files. The Books connection is not touched. The alternative was a separate Zoho app with three more secret values to manage.
- **What works now:**
  - Anyone can run the dry run on a costing workbook and get a report of where it would be blocked, which figures need review, and what the dashboards would show if it were loaded.
  - Once the WorkDrive login step is done, `scripts/workdrive-fetch.mjs` downloads the pinned workbook ready for the dry run.
- **What the dry run found (14 Oct file):**
  - Only July has figures for a month that is still open. June, August and September tabs are empty.
  - July cannot be submitted. The Mahindra Delhi column and the "Ceiling tiles" line have no AOP equivalent yet.
  - July cannot be closed. There is no July budget, and Mafatlal A Wing and Delhi sent nothing.
  - Loading July as it stands would make every dashboard show about ₹1.24 crore of false overspend across 14 sites, because July becomes the headline month with no budget. This confirms that the month-close gate is needed.
  - Eight figures need a second look, including Noida July manpower at 9× its earlier level, and SS Plaza May, where Excel's own total misses ₹14.7 lakh because some numbers were typed as text.
  - ETPL Tea & Coffee at ₹820 (budget ₹1.03 lakh) slipped past the outlier rule because of its ₹50,000 floor. The rule needs a budget-based check as well.
- **Left undone:**
  - The WorkDrive token. It needs a Zoho login and a grant code that only the founder or an admin can generate.
  - The real feed: the upload screen, approvals and month close. It waits on the ten open decisions in the plan.
  - Nothing was committed or pushed, per the repo rules.
- **Open questions for the founder:**
  - The ten decisions in the plan are still open. The most urgent are: where July–September budgets come from, whether Geebee and Mahindra are one Delhi site, and what to do with "Ceiling tiles" and "Mahindra Car Parking".
  - This office's internet provider (DNS 103.14.232.100) no longer resolves `*.supabase.co`, the app's database address. The dry run worked around it by asking public DNS. If customers or staff are on the same provider, the live app may fail for them too. This needs checking.

## 2026-10-14 — Saas.one: Grievance module explainer videos, AOP decision-layer video, and a reusable video-making skill

**Five short videos now exist: four explaining the HR grievance module, one for each lens (Employee, Manager, HR, Director), and one motion-graphics video of the AOP costing review. The method behind them is saved as a reusable skill called `motion-reel`.**

- **Why:** The founder wants to show staff and clients how the grievance module works from each person's point of view. Each video opens with the everyday problem and then shows the fix on the real screens. A separate written review of the AOP costing workflow needed to become a video the team can follow.
- **Structural decisions:**
  - **Real screens with made-up content.** The founder chose this. We filmed the live app, but every person, ticket and message on screen is fictional. The fictional data was fed to the browser only. All saves were blocked and the live-update connection was cut, so nothing was written to the live system and no WhatsApp or email went out. The other option was to rebuild the screens as drawings, which would no longer have been real frames.
  - **One login for all four lenses.** The founder signed in once, as themselves. The capture tool showed each lens by changing the role inside the browser copy only, never on the server. It also replaced the founder's real name and email with fictional ones. The saved login was deleted at the end.
  - **Videos built in code.** Each video is a web page rendered frame by frame, with the timing tied to the voiceover words. The voice is ElevenLabs "Alka S", about 1,500 characters used. Music and sound effects were generated in code, so nothing is licensed. The other option was a hosted video tool, which would not let us reuse the method.
  - **Video method saved as a skill.** It came from a YouTube walkthrough on making motion graphics with Claude and is saved at `~/.claude/skills/motion-reel/`. It covers real brand assets, a beat-by-beat shot list, sound locked to the beat, and a self-review loop that scores still frames.
  - **Exact turnaround times.** The videos use the times configured in the app. Grievances go to the Manager (3 days), then HR (7), then the HR Head (10), then the Director (12). Confidential feedback goes to the Director within 48 hours. Anonymous feedback goes to the Director through the ethics channel within 72 hours. HR queries start with HR within 0–2 days.
  - **Branch updated.** At the founder's request, this branch was brought up to date with main (49 commits). There were no conflicts, and the type check passes.
- **What works now:**
  - The four grievance videos are in `~/Downloads/grievance-videos/final/`, about 25 seconds each, 1080p.
  - The AOP video is in `~/Downloads/aop-intelligence-video/final/`, 72 seconds, motion graphics only with no voiceover.
  - Any future product video can be started with `/motion-reel`.
- **Left undone:**
  - Vertical (9:16) versions. They come from the same timeline but were not rendered.
  - A voiceover on the AOP video, which the founder asked to be motion only.
  - Some small text in the screen close-ups is hard to read on a phone. The videos are made for desktop and LinkedIn viewing.
- **Open questions for the founder:**
  - **Anonymity claim.** The module's plan promises that anonymous means the name is not stored at all. In the built module the name is stored and only hidden on screen. The fictional-data work found three related gaps:
    - The submitter's account is still attached to the ticket.
    - The ticket number shows the submitter's site.
    - The ticket can fall back to the submitter's own manager unless Admin Config sets an owner.

    The videos therefore say "identity masked", not "never stored". Should this be fixed before the module is marketed as anonymous?
  - **Unprotected HR data.** The HR ticket data can be read without logging in. Grievance attachments sit in a public storage folder. This was raised on 26 September and is still open.
  - **Working days.** The screens promise "3 working days", but the system counts calendar days.
  - **Automatic escalation.** It only runs when someone opens the HR ticket list, because its two scheduled jobs are not switched on. Should they be scheduled?

## 2026-10-13 — Saas.one: Total Environment Workcations landing page, first draft

**A one-page website for the Whitefield building: a hand-drawn sketchbook you turn page by page, a guide who says one true thing per page, a balcony you can touch, a folding map that opens the ATLAS study of the building's surroundings, and a slide-to-book visit form.**

- **Why:** The founder wants a landing page that feels like the Autopilot website at its best and sells the building with real facts, not adjectives. The brief named the ThreeUI sketchbook component, the ATLAS location study, the ui lab interaction library and an avatar studio as the ingredients.
- **Structural decisions:**
  - Built outside this repo at `~/Downloads/TE-Landing/`: plain HTML, no build step, one file plus assets. The ATLAS study sits in `atlas/` as its own static folder and is shown inside the page in a frame, as the ATLAS porting guide prescribes.
  - The nine sketchbook pages were generated on Higgsfield from Total Environment's own renders, so they depict the real building. Ten credits were spent. Each page was then fitted to one common book outline so halves of two pages line up mid-turn.
  - The sketchbook engine is ThreeUI's, used whole as the brief required; the three ui lab interactions (folding map, picture hotspots, slide to confirm) were ported from their MIT source into plain JavaScript because the page has no React.
  - The avatar studio the founder pointed to is AGPL-licensed, which would oblige us to publish the website's source. The guide character was drawn from scratch instead: an ink doodle whose eyes follow the cursor, blinks, and changes expression per page.
  - Every figure on the page and in the study carries a source: Atlas's evidence ledger (building footprint, metro walk, neighbours), Cushman and Wakefield, JLL and TomTom. Nothing without a source went on the page, so there are no bus stops and no rents for the building itself.
- **What works now:** Open `index.html` in a browser: the book riffles, pages turn with a drag, the loupe magnifies, the guide comments, the figures roll up, the balcony points open a card, the map unfolds into the ATLAS study, and the visit form opens a pre-filled email to Harshini. Checked in a headless browser at desktop and phone widths with no errors.
- **Left undone:**
  - No Mapbox token, so the map pane inside the ATLAS study says "Map unavailable" until a public token restricted to the site's domain is put in `atlas/config.js`.
  - The form has no backend; it opens the visitor's email client with the details filled in.
  - The ATLAS study was not run through the skill's headless checker, which needs Playwright installed globally.
- **Open questions for the founder:**
  - The brochure says Hoodi metro is 1.2 km away. Atlas's own measurement puts the nearest station at Pattandur Agrahara, 831 m on foot, with Hoodi about 2.1 km in a straight line. The page uses Atlas's figure. Which should the brochure say?
  - Total Environment's written permission is still needed for the renders the drawings were made from.
  - Where will the page live (which domain), so the Mapbox token can be restricted to it?

## 2026-10-08 — Saas.one: Satej, Meera calling and LiveKit meetings put on their own branch, up to date with main

**All the unpushed procurement-agent work is now on one new branch, `feat/satej-meera-livekit-meetings`, brought level with the latest main and pushed. Main itself was not touched.**

- **Why:** The Satej vendor-discovery agent, Meera's phone calling and the in-FMS meeting rooms (LiveKit) had only ever lived on one laptop. They needed to be on GitHub, and they needed to sit on top of the last 121 changes the team made to main so they can be reviewed without surprises.
- **Structural decisions:**
  - A new branch was cut instead of pushing the old working branch, and the latest main was merged into it. The alternative was to replay each commit on top of main one at a time. That would have meant resolving the same conflicts many times and testing code in a state nobody had run.
  - Five files clashed with main and were resolved by keeping both sides: the cron schedule list, two dashboards' icon lists, the procurement dashboard (Satej's vendor-discovery tab sits beside main's new task board, and the fix for tabs snapping back to Grievances is kept), and the dependency lock file (main's, plus the voice and meeting libraries added here). The merged code passes the type check.
- **What works now:** Anyone on the team can fetch the branch and open a pull request. Nothing is merged into main yet.
- **Left undone:**
  - No pull request was opened and nothing was merged into main, on the founder's instruction.
  - The database migrations in this branch are still not applied anywhere. Four of them share a date-and-sequence number with a migration from main (for example 20261006000001), as many older ones already do, so the apply order needs a look before they are run.
  - The branch also carries a handful of journal-only commits about other work (brochure, business cases). They change only this file.
- **Open questions for the founder:** Should this go to review as one pull request, or be split into Satej and calling, meeting rooms, and the mail archive?

## 2026-10-09 — Saas.one: Malad West decision paper (Interface 11), 16 pages

**The Malad West case is now in the same plain format as the Andheri decision paper: factual headlines, rent rises compounded every year, no anchor client, and every number marked sure or flagged.**

- **Why:** The founder asked for Malad "the same way" as the final 18-page Andheri paper.
- **Structural decisions:**
  - A new build at `~/Downloads/Malad-Simple-2026/` for the cover, building, price, break-even, market, ads, BCG, SWOT and "what gets missed" pages.
  - Seven pages come from the earlier Malad deck: connectivity, Mumbai flex, sector mix, occupiers, price ladder, positioning and the broker plan. They were re-rendered with the new page numbers and factual titles, then merged with pypdf.
  - **Same assumptions as Andheri:** fit-out ₹2,000 a sq ft (the team standard set on 9 Oct); running costs ₹75 a sq ft; 30% of fit-out is base build done before any client; the floor fills to 85% over 12 months.
  - The earlier Malad deck now also uses ₹2,000 a sq ft for fit-out.
  - The lock-in stays at the landlord's 36 months.
- **What the numbers say:**
  - 1,019 seats; MOS price ₹13,286 a seat (₹13,433 with marketing, ₹14,762 with brokerage too).
  - Break-even is 849 seats in year 1 and 970 by year 5.
  - ₹8.65 Cr is needed before any client signs.
  - The floor does not pay back within 60 months; it would at rent + CAM of about ₹190 (we are offered ₹208).
  - Bare-shell space in the same building is listed at ₹80–88.
  - No Malad ad campaign has run, and the CRM holds 1 Malad-area lead.
- **Left undone:**
  - Floor availability, grade and whether BFSI and consulting firms may use this IT/ITES building are unconfirmed.
  - No floor layout was supplied.
- **Open questions for the founder:**
  - What does the ₹200 rent include?
  - Is a phased take-up possible?

## 2026-10-09 — Saas.one: Andheri decision paper revised after team review (22 pages)

**Shravani's review comments are applied. The Andheri decision paper is now 22 pages, with factual headlines throughout.**

- **Why:** The team reviewed the 15-page paper overnight. They corrected the 723 Avenue fit-out and the lock-in, asked to drop the ad-data price, wanted seven pages of the 20-page deck kept, and pointed out that our clients' fit-out is spent only once a client signs. The founder asked for factual headlines with no hedging.
- **Structural decisions:**
  - Fit-out is ₹2,000 a sq ft for both buildings, so 723 Avenue's fit-out is now ₹2.59 Cr and its MOS price is ₹18,550 (was ₹18,410). The lock-in is 60 months for both.
  - **Fit-out is split in two:**
    - a base build (flooring and basic interiors), done before any client and assumed at 30% of fit-out — ₹0.92 Cr at Privilon, ₹0.78 Cr at 723 Avenue;
    - the client-specific 70%, spent only as each client signs.
    - The 30% share is our assumption and is flagged in the deck.
  - The separate price from our ad data was removed from page 6 and from the ads page.
  - The 20-page deck's layouts, connectivity, Mumbai flex, sector mix, occupiers, positioning and broker-plan pages were rendered with this deck's page numbers and merged in using pypdf.
- **What works now:** `~/Downloads/Andheri_Privilon_vs_723Avenue_Decision.pdf`, 22 pages, with these results:
  - **Cash before any client** (base build, 3 months of rent and the deposit): ₹6.24 Cr at Privilon, ₹4.53 Cr at 723 Avenue.
  - **Payback:** neither floor pays back within 60 months on today's terms.
  - **What would make it pay back:** rent + CAM about 10% lower (₹365 at Privilon, ₹181 at 723 Avenue), or 5 rent-free months with the floor 85% full in 6 months, which pays back in month 47.
- **Left undone:**
  - The real base-build share needs the projects team's number.
  - The seven merged pages keep their earlier layout; their page numbers are correct.
- **Open questions for the founder:**
  - What share of fit-out is base build in our Andheri projects?
  - Is the 5% escalation yearly?

## 2026-10-08 — Saas.one: Andheri decision paper, 15 simple pages (Privilon or 723 Avenue?)

**The Andheri case study was rewritten as a 15-page yes-or-no paper in plain words. It rebuilds the numbers from the new workbook, compounds the 5% rent rise every year, and assumes no anchor client.**

- **Why:** The founder found the earlier decks too long to decide from, and some numbers wrong or misplaced. For example, escalation was treated as simple (15% over three years) when it compounds. He asked for about 15 pages a ten-year-old could follow, charts with proper axes, a break-even analysis, a BCG matrix and a SWOT, data as of September 2026, and every doubtful number flagged.
- **Structural decisions:**
  - A new build at `~/Downloads/Andheri-Simple-2026/`. `model.py` traces each number to its source and `NUMBERS.md` lists them. The PDF is `~/Downloads/Andheri_Privilon_vs_723Avenue_Decision_15p.pdf`.
  - **Three pricing structures, from the workbook:** MOS (₹21,560 / ₹18,410); MOS + marketing (₹21,902 / ₹18,815); MOS + marketing + brokerage (₹24,058 / ₹20,656).
  - **A fourth, separate price from our own ad data:** read-only from the CRM tables that Meta and LinkedIn sync into. ₹12.58 L of office ads, Jan–Sep 2026, bought deals worth 200 seats, about ₹6,289 a seat. The existing prices are unchanged.
  - **Compounding:** rent rises are compounded each year, so year 5 is 21.6% above year 1, not 20%.
  - **Break-even:** a classic chart of costs against what members pay, by seats sold; a table by year; payback in cash; and the levers that would turn either floor into a yes.
  - **BCG matrix:** market growth against relative share, with labelled axes. Flex growth (+37%) puts both floors at Question Mark. Measured by all Andheri office take-up (−44%), they would be Dog.
  - **SWOT:** one page per building, led by strengths and weaknesses.
  - **Marks:** every number is marked ✓ (sure) or ⚑ (check).
- **What the numbers say:**
  - The workbook's 20% on cost means year-1 break-even is always 83% full. Rent compounding pushes it to 97–98% by year 5 if our price stays flat. Most rivals here run 75–80% full.
  - With no anchor client, a 3-month fit-out and a 12-month fill to 85%, neither floor pays back within 5 years. Deepest cash hole: ₹8.6 Cr (Privilon) and ₹6.3 Cr (723 Avenue), plus deposits.
  - Either floor works with rent + CAM about 11% lower (₹179 at 723 Avenue, ₹362 at Privilon), or with 5 rent-free months plus a fast fill.
  - Andheri–Kurla, Q3 2026 (data to 25 Sep): vacancy 11.5% (up from 10.3%), net take-up Jan–Sep down 44%, rent ₹170.73 (up 11%).
  - Our Andheri ads: ₹3.45 L spent, 288 leads, 18 hot or warm, no deal signed yet.
- **Left undone:**
  - Malad West in the same format; the founder asked for Andheri first.
  - The fill speed, fit-out time and member tenure are assumptions, flagged in the deck.
  - The CRM may be missing some signed deals.
  - Q2 FY27 results from listed operators are not out yet (late October).
- **Open questions for the founder:**
  - Is the 5% escalation really every year?
  - Will either landlord give rent-free months or a lower rent?
  - Is an anchor client in sight?

## 2026-10-08 — Saas.one: Malad West Business Case Study 2026 (Interface 11)

**A 19-page Malad West business case for the 3rd floor of Interface 11, Mindspace, in the same format as the Andheri deck. It includes all 13 sections of the founder's document.**

- **Why:** The founder is weighing a 35,674 sq ft carpet floor in Interface 11 and wanted the Andheri treatment: terms, financials, market, sectors, competitors, broker plan, risks and a decision.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/Malad-Business-Case-2026/`, reusing the Andheri page system and style. The PDF is `~/Downloads/Malad_West_Business_Case_Study_2026.pdf`. Nothing in the FMS app changed.
  - There is no costing workbook for Malad, so the financials use the Andheri costing method with two stated assumptions: fit-out at ₹1,800 a sq ft and running costs at ₹75 a sq ft. The result is 1,019 seats at ₹13,146 a seat, every cost covered at 83% full (849 seats), and ₹10.7 Cr of cash before opening.
  - The price ladder uses the Whitefield layout. The document's notes and cautions (for example "don't call Smartworks a 2025 launch") became deck wording.
  - Two background images were generated in Higgsfield (about 6 credits). Both are labelled as AI illustrations.
- **What works now:** One PDF the founder can read or share. Research added: competitor seat counts and positioning, Malad–Goregaon vacancy and rent, Metro Line 2A details, and a rent check against listings for the same building.
- **What the research found that changes the case:**
  - Broker listings for bare-shell space in Interface 11 itself ask ₹80–88 a sq ft of carpet (May 2026), against our ₹200 offer. At the listed rent the price needed would fall to about ₹8,442 a seat.
  - The building's grade is closer to B+ than Grade A: it was built in 2008 and no green rating was found.
  - The Western Suburbs flex figures come from CBRE, not Cushman & Wakefield, and the latest count is 25+ centres.
  - Love & Latte inside the building is a work café, not an office competitor.
  - Toutle Space's "Mindspace" listing is the same centre as its Aditya Industrial Estate one.
- **Left undone:** Fit-out and running costs are assumptions. Floor availability, the IT/ITES permission and the grade are not confirmed. No floor layout was supplied.
- **Open questions for the founder:**
  - What does the ₹200 rent include (furnished space, fit-out, services)? Listings in the same building ask ₹80–88 for bare shell.
  - Is an anchor client or a phased take-up possible for a 1,019-seat floor?
  - Can BFSI and consulting members sit in an IT/ITES building?

## 2026-10-08 — Saas.one: Andheri case study updated to the landlords' latest terms, cut to 20 pages

**The Andheri case study was rebuilt around the founder's updated document. All 14 of its sections stay, and the deck went from 33 pages to 20.**

- **Why:** The founder supplied updated landlord terms and new market, sector, competitor, broker-plan and risk content, with floor layouts. They asked to keep those 14 sections and cut the deck to 20 pages.
- **Structural decisions:**
  - The deck keeps the earlier style and build folder (`~/Downloads/Andheri-Business-Case-2026/`). Pages are now picked and ordered by one list, so content can be added or dropped without rewriting.
  - Only two of the earlier analysis pages survive: "what each floor must earn and how full it must be", and the one-page decision. Dividers, contents, infrastructure, the rent-history pages and the separate break-even and lever pages were cut to reach 20. Their key numbers were folded into the remaining pages.
  - The new terms split rent from CAM: Privilon ₹375 + ₹30 on carpet, 723 Avenue ₹190 + ₹10 on built-up. Each split adds up to the workbook's original rate, so the price we need per seat is unchanged (₹21,560 and ₹18,410). New figures come from the 36-month lock-in, the 6-month deposit and the 5% escalation: cash before opening is ₹6.52 Cr and ₹4.79 Cr, and the lock-in commits ₹22.4 Cr and ₹15.5 Cr.
  - The document asked for each rival's offer, positioning, price ladder and seat count. New research found seat counts for 27 of the 31 rival centres, about 17,000 seats in total. These are shown on a positioning chart and in the competitor table.
- **Revision (same day):** the price-ladder page now uses the Whitefield layout. Each price point is a row with a dot on the scale, centres charging the same price share a row, both of our prices are highlighted rows inside a shaded "our corridor" band, and three cards on the right cover our price, why that price, and supply next door. The data is unchanged.
- **What works now:** A 20-page PDF, `~/Downloads/Andheri_Business_Case_Study_2026_Updated.pdf`, that carries every section of the updated document plus the financials and a decision page with what to ask both landlords for.
- **Corrections to the updated document, shown in the deck:**
  - 91springboard LightHall opened at 23,000 sq ft, not the 40,000 announced.
  - Dextrus MINT launched in July 2026 at 25,000 sq ft, not September 2025 at 37,000.
  - The landlord says Privilon's occupancy certificate (OC) comes by end-December, but the RERA filing still shows completion on 31 Jan 2030. The deck says so on both Privilon pages.
- **Left undone:**
  - The RERA dates were read from property portals, not from MahaRERA directly.
  - Seat counts are listing figures, not audited.
  - The rent-history and infrastructure pages are still in the build and can be switched back on in the page list.
- **Open questions for the founder:**
  - Will both landlords write the OC and Fire NOC dates into the agreement?
  - Is the 5% escalation yearly or every three years?
  - Do we keep 35 sq ft a seat, or plan denser?

## 2026-10-07 — Saas.one: Andheri Business Case Study 2026 (Privilon vs 723 Avenue)

**A 33-page, Autopilot-branded business case for a managed office in Marol, Andheri East. It follows the Whitefield case study's structure and compares the two buildings in the Andheri costing workbook.**

- **Why:** The founder is weighing two Andheri East floors: Privilon (15,343 sq ft carpet) and 723 Avenue (12,950 sq ft carpet). The case needed the same depth as Whitefield: what each floor costs and must earn, the market, the rivals, and a recommendation.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/Andheri-Business-Case-2026/` (build.py, pages.py, research_pages.py, research.md). Same fonts, colours and section order as the Whitefield deck. The finished PDF is `~/Downloads/Andheri_Business_Case_Study_2026.pdf`. Nothing in the FMS app changed.
  - Every costing number reproduces the workbook's formulas exactly and is checked in code (₹21,560 a seat at Privilon, ₹18,410 at 723 Avenue).
  - Added pages the workbook implies but does not show: how full each floor must be to break even, profit or loss at 70–100% full, what each negotiating lever is worth per seat, and a one-page scorecard.
  - Background photographs were generated in Higgsfield (9 images, about 25 credits). Every page that shows one says "AI-generated illustration", because none of them shows either building.
  - The Knight Frank rent chart from the pasted slide is shown next to Cushman & Wakefield's area average. The research could not match the Knight Frank figures to any published Knight Frank series; they read like rents for the best buildings.
- **What works now:** One PDF the founder can read or share, with:
  - section 01: the two options, the costing line by line, break-even, and negotiation levers;
  - section 02: building facts and a metro map;
  - section 03: vacancy, rents, deals, flex demand, and named occupiers by sector;
  - sections 04–07: infrastructure, why Andheri East, sales pipelines and risks;
  - section 08: all 31 surveyed rivals, with prices and how full they are;
  - section 09: the decision on one page.
- **What the research found that changes the case:**
  - Privilon is still under construction. Its RERA completion date is 31 Jan 2030, and it is about 19% built.
  - 723 Avenue passed its RERA completion date (31 May 2026), and no occupancy certificate was found. RERA lists G + 8 floors against a marketed G + 14.
  - At the workbook's prices, both floors cover every cost only above 83% full. 14 of the 30 rival centres that shared figures run 75–80% full, and none runs above 85%.
  - IA Spaces already sells desks inside 723 Avenue at ₹18,000, and WeWork next door charges ₹26,500.
- **Left undone:**
  - The RERA facts come from property-portal copies. They were not checked on MahaRERA itself; the registration numbers are on page 11.
  - No real photographs or floor plans of either building were supplied, so there is no floor-plate page.
  - Rent escalation, deposit, CAM and GST are not in the workbook, so they are not in the numbers.
- **Open questions for the founder:**
  - Is Privilon meant as a pre-lease for 2029–30, or has the landlord offered an earlier handover?
  - Which floors at 723 Avenue would we take, and do they have an occupancy certificate?
  - Keep 35 sq ft of carpet a seat, or plan denser?

## 2026-10-07 — Saas.one: One-page brochure for Total Environment Workcations, Hoodi

**A one-page A4 brochure that puts the supplied copy together with Total Environment's own renders, branded Total Environment Workcations × Autopilot Offices.**

- **Why:** The sales team needs one sheet to send to prospects that sells the building and the 30 to 300+ seat offer, with two named contacts and a site-visit call to action.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/TE-Workcations-Brochure/`, as a single page in the same fonts and colours as the Whitefield decks. Nothing in the FMS app changed.
  - The pictures are the clean Total Environment renders already in the Part 2 deck (tower, garden lounge, workspace). The Business Case deck's copies were not used because they have "Artist's impression" printed into the image. The label is added by us on every picture instead.
- **What works now:** A finished PDF, `Total-Environment-Workcations-Brochure.pdf`, with all the supplied copy. The site-visit button opens an email to Harshini Ranganathan.
- **Left undone:** No web address was supplied, so the button is an email link. After review the Total Environment name is set in type ("Total Environment / Workcations / Pursuit of Rhapsody") because the founder said not to use their logo image, the brochure got the building spec 3B + G + 19, plainer wording, and the "major residential catchments" line was removed because the founder said the data was wrong.
- **Open questions for the founder:**
  - Total Environment's written permission is needed before this goes out, as with the earlier ad kit. Has it been given?
  - The two phone numbers are shown as 94946 08123 and 86553 59880, exactly as supplied. Please check them.

## 2026-10-06 — Saas.one: One name, Meera, for the procurement agent; quote requests from the purchase inbox go straight to her

**The vendor-discovery agent formerly called Satej is now Meera everywhere people see it. Its console also lists colleagues' quote-request emails from purchase@, and turns each one into a pre-filled request with one click.**

- **Why:** The founder found the names confusing. The agent was "Satej", her phone voice was "Meera", and Satej Sadhye is a real person on the purchase team whose mailbox is now being archived. The founder also asked what the newly connected purchase@ mailbox could teach the agent. The clearest finding was that colleagues already ask purchase@ for vendor quotes by email (for example: Digitide BOQ, Sion; Coimbatore renovation; pest control at Skymark, Noida). Someone then has to retype each one.
- **Structural decisions:**
  - **Only the visible names changed.** This covers screens, tabs, chat, the in-app voice call, WhatsApp text, activity messages and the Agent Console name. Code, database tables, web routes and settings keep the `satej` name. Renaming those would need database changes, new Vercel settings and a new Bolna webhook, and nobody would see any difference. A new `/meera` address opens the same console, and links already sent to `/satej` still work.
  - **The in-app voice call is now a woman's voice** (ElevenLabs "Alka"), to match the name. It was the male voice "Amay".
  - **Requests from email still need a person to submit them.** Meera drafts the form from the email (title, site, city, area, timeline) and a person checks and submits it. The purchase@ digest stores each message's opening lines, never full bodies or attachments, so a BOQ attached to the email is not read. The draft says so.
  - Two Agent Console rows renamed from "Satej" to "Meera" directly in the database; old values saved before the change.
- **What works now:** Requirements in the Meera console show "From the purchase inbox" with the asks of the last 30 days (7 found on the real inbox over 90 days). "Start with Meera" opens the request form already filled in, and the request remembers which email it came from. The FAQ payment draft now quotes the real milestone terms from an approval email.
- **Left undone:**
  - Matching vendors' emailed quotations back to Meera's calls (Fusion Furnish, KONE, Actis and others send quotes to purchase@). This needs full email text and attachments, which only arrive once the mail archive (`supabase/migrations/20261006000002_mail_archive.sql`) is applied. It is the natural next step.
  - Team price targets written in approval emails ("try to achieve Rs 650–700/KVA") are not yet fed to Meera's negotiation.
  - The new panel was type-checked and its route answers, but it was not seen in a signed-in browser.
- **Open questions for the founder:**
  - Should the WhatsApp template names also change from `satej_…` to `meera_…`? Only the AiSensy dashboard shows them. If the templates are not created yet, renaming now is free; once created, it means re-approval.

## 2026-10-06 — Saas.one: Meeting rooms inside FMS, with Ira running a review of stuck POs

**People can now meet inside FMS. Ira, our procurement agent, joins the room, reads each purchase order stuck at "pending approval", asks who owns it and what should happen, and writes the decision down for an approver to confirm.**

- **Why:** ₹1.32 crore of POs sit at "pending approval" in Zoho (123 POs; 64 of them, ₹53.6 lakh, older than 30 days), and nobody can tell which are stuck and which are dead. The founder wanted an agent in the room that asks the right people the right questions, so the answers come from conversation rather than from people adopting another screen.
- **Structural decisions:**
  - Meetings happen inside FMS, not in Google Meet. A bot in Google Meet needs either a paid bot service (Recall.ai) or our own always-running servers, and the open-source option the founder asked about (Vexa) cannot speak in a meeting yet. Inside FMS, the agent is a normal participant and every person is heard on their own microphone, so "who said what" comes from their login.
  - The audio relay and the agent run on LiveKit Cloud (free plan: 5,000 meeting minutes and 1,000 agent minutes a month). A live meeting cannot run on Vercel functions, which stop after 5 minutes. FMS owns the rooms, the screens, the agent's code and every record; LiveKit only carries the audio. LiveKit is open source, so moving to our own servers later is the same code.
  - Built generic, not purchase-only: a meeting names which of our agents runs it and its topic. The first topic is PO approvals with Ira. Other agents and topics are additions, not a new system.
  - Sarvam end to end: listening (Saaras), thinking (`sarvam-105b-conversations`) and speaking (Bulbul, voice "kavya"). It is the stack Meera already uses, it handles Hinglish, and it needs one key. The Groq key in the local setup was rejected as invalid, so it was not used.
  - Ira proposes, people decide. Every decision is read back aloud and lands as a proposal; an approver confirms or rejects each one on the decision sheet. Ira cannot approve or cancel anything in Zoho. Every number she says comes from the agenda FMS built from Zoho; she is told to quote nothing else.
  - Ira talks to FMS through one private endpoint with a shared secret, rather than holding the database's master key on another company's servers.
  - Nothing from the purchase@ mailbox goes on the agenda. Accounts, org admins and ops super admins can join meetings but are deliberately not allowed to read that mailbox, and Ira reads the agenda aloud to everyone in the room.
  - A code review of the new routes found no way across organisations and no way into the agent's endpoint without its secret. It did find seven real problems, all fixed before commit. The biggest: POs imported from spreadsheets as "Pending Approval" or "Submitted" would have been missed, and a meeting the host had ended could have been reopened for up to three hours by an old join link.
- **What works now (after the steps below):** An approver opens **Meetings (Ira)**, builds a review of the largest POs waiting 30+ days, and shares the link. People join from FMS with their microphone. They see the agenda move, a live transcript under each person's name, and decisions appear as they are made. After the meeting the same page is the decision sheet. Tested on 2026-10-06:
  - on the real model, a scripted seven-turn meeting: Ira stayed quiet during side talk, recorded "cancel · owner Vidya · Friday", moved on when confirmed, noted a stated rule, parked a PO nobody owned, and answered a direct question from the agenda only;
  - on a local LiveKit server, a full room: a scripted participant joined, Ira arrived automatically, gave the recording notice, presented the first PO, recorded the spoken decision and moved to the next PO. Ira starts replying about 3 seconds after a person stops talking.
- **Who sees it:** approvers (org super admins, ops super admins, master admins) start, end and confirm meetings. The purchase team, org admins and accounts can join. Links were added to the org admin, ops (property admin) and procurement dashboards; accounts join through the shared link.
- **Left undone:**
  - Not tried with real people on LiveKit Cloud, because there is no LiveKit account yet. The screens were type-checked and linted, not opened in a browser.
  - The agenda builder was not run against live data: Supabase stopped resolving from this machine's shell partway through the session. It is type-checked and its amount formatting was tested.
  - No WhatsApp follow-ups after the meeting yet (needs an approved AiSensy template). No "any meeting" mode yet (minutes and actions without an agenda). Meetings in Google Meet do not get the agent.
  - Confirmed rules are not yet fed back into Ira's instructions, and meetings do not yet show in the Agent Console's run log.
- **Open questions for the founder:**
  - Who should attend the first review, and should it start with the 18 POs older than 90 days?
  - Should audio be recorded, or is the transcript enough? Today only the transcript is kept.
  - Rushabh Shah's FMS login is `rushab@worksquare.in` (no "h"), named "Rushab shah", while his address is rushabh@worksquare.in. He can already host meetings (org super admin). Is the login a typo to correct, or is `rushab@` also his?

## 2026-10-06 — Saas.one: Mail archive sandbox — purchase@ and three of the purchase team

**FMS can now read every email in a chosen set of mailboxes, past and new, every 15 minutes, and keep each email once. The sandbox is purchase@, Vidya Pawar, Sahil Sitaprao and Satej Sadhye.**

- **Why:** This is the first step towards an "organisational brain" built from company email. Before building anything that understands mail, the founder wanted the plumbing proven: does history come in, how fast, how much space it takes, and does it stay current without anyone exporting files.
- **Structural decisions:**
  - Fully automatic through the Zoho API, with no manual exports. Each run reads new mail first, then walks backwards through history a page at a time and saves its place, so it never starts over. Zoho's admin export was not used. It is only needed for mail people have deleted, and it is a manual download.
  - Each email's text is kept once. The same email copied to four people is listed in each mailbox but fetched and stored only once. The alternative, a copy per mailbox, would have multiplied storage for a team that copies each other constantly.
  - Duplicates are matched on sender, Zoho's sent-time field and subject, not the email's standard ID, because fetching that ID costs an extra call per email. Zoho's sent-time is exactly 7 hours off (measured today), so it is used only for matching and never shown as a date. If it shifts when US daylight saving ends, a few emails may be stored twice. None are lost.
  - Spam, Trash, Drafts, Templates and Outbox are skipped. Newsletters and notifications keep their headers but not their text.
  - No AI at this stage. It is a fixed workflow, not an agent (agent doctrine law 1), so no agent spec block applies.
  - Only super admins can see the archive, and only as progress and counts. Nobody can read the stored mail through FMS yet. This is a deliberate change from the purchase digest, which never stored email text: personal work mailboxes are now being kept.
  - A mailbox is archived only if it is on the archive's own list. Connecting a mailbox for an agent does not enrol it.
  - Priyanka Pal's FMS login is purchase@worksquare.in, so her mail is covered by purchase@. "Sahil" was taken to mean Sahil Sitaprao in procurement, the one who appears on 285 purchase@ threads.
- **What works now (once the migration is applied and the branch deployed):** A "Mail archive · sandbox" panel under Agent Console → Delivery shows each mailbox: whether it is connected, how far back history has been read, how many emails are listed and how many have their text saved. Super admins can add or pause mailboxes there. Measured live on purchase@ (read-only): 200 emails list in about 0.7 seconds, 6 email texts fetch together in about 0.3 seconds, and purchase@ holds more than 30,000 emails going back past March 2024. Expect purchase@'s history to be listed within a few hours and its text saved within about a day. That is an estimate, not yet measured end to end.
- **Left undone:**
  - Not run end to end. The tables do not exist until the migration is applied. The Zoho reading was tested live; the database writes and the panel were checked only by type checks, not in a browser.
  - Vidya, Sahil and Satej must each connect their own mailbox, a Zoho sign-in as themselves. Until they do, the panel says "Waiting for the owner to connect this mailbox".
  - Attachments are flagged but not stored. No search, no AI, no question-answering yet; those come after the pipe has proved itself.
  - Zoho's rate limits are not published. The job stops for the run when asked to slow down and carries on next time.
- **Open questions for the founder:**
  - When someone deletes an email in Zoho, should it disappear from the archive too?
  - Have Vidya, Sahil and Satej been told their work mail is being archived? India's data protection law (DPDP Act 2023) expects staff to be informed.
  - Who besides super admins should eventually be able to ask the archive questions?

## 2026-10-06 — Saas.one: Meera moves to Sarvam, negotiates from our own purchase history, and answers vendors' real questions

**Meera, the AI caller who phones vendors for Satej, now speaks with an Indian voice model (Sarvam), asks every vendor for a rate and pushes back once using what we have actually paid in Zoho. She answers the questions vendors kept asking from a new FAQ page. A rate checker lets the team look up any item's usual price.**

- **Why:** Meera sounded scripted and dodged basic questions: "where are you calling from?", "how old is your company?", "where exactly is the site?". She refused to share job details, and once told a small vendor their turnover was too low. She never asked for a price, so the shortlist could not say who was cheap. The founder asked for her to sound human, to understand the requirement, the vendor and the cost, and to make the right bets. The founder also wanted a benchmark from the Zoho purchase history that refreshes itself every 10 days.
- **Structural decisions:**
  - **Bolna only dials; Sarvam does the talking.** Meera's voice (Bulbul "Priya"), hearing (Saaras) and thinking (sarvam-105b) are now all Sarvam. Calls still go out through Bolna on our own Plivo number. The alternative was to drop Bolna and dial Plivo ourselves. That would mean building and running an always-on audio server, which Vercel cannot host. Sarvam's own calling platform does not say how outbound numbers or call reports work. Sarvam's voice and hearing are already included in Bolna's flat per-minute price. Only the thinking model runs on our Sarvam key. Meera's replies now start in about 0.1 seconds instead of about 0.4.
  - **Hindi is written in Devanagari, English words in English.** A voice test showed Sarvam reads Hinglish more cleanly this way than in Roman letters.
  - **The benchmark is built from the product description, not the Zoho item name.** Zoho item names are accounting buckets. "Housekeeping Material (3402)" covers ₹25 urinal pads and ₹870 cleaning liquid. Spelling variants ("20 ltr jar", "water jar 20l") are pooled when looked up, and only within the same unit. Prices more than three times away from the usual are left out as pack or unit mistakes. It is all done in the database and rebuilds in about 3 seconds.
  - **Meera only gets two numbers:** a target (what we have managed to pay) and a ceiling (the usual price plus 5%). She pushes back once at most, never says where the numbers come from, and never agrees a final price. If the history is too thin (fewer than 3 past orders, or a different unit), she just asks for a rate.
  - **Price now counts for 20 of the 100 points** when vendors are ranked. The 20 points came from website (10 → 5), turnover (10 → 5), experience (15 → 10) and client list (20 → 15). Each summary now opens with Satej's pick and its reason, and a person still decides.
  - **FAQ answers must be approved.** Procurement can draft answers. Only org super admins and master admins can approve them and publish them to Meera. Each publish is saved as a version that can be undone.
- **What works now:**
  - The team can type any item into the **Rate checker** and see the usual price, the middle range, the last price paid and who sold it cheapest. They can also type a quoted rate and get a verdict. There are 11,880 products from 20,000+ purchase lines.
  - Each requirement shows the **price history** Satej matched and the target and ceiling Meera will use.
  - The ranked list shows each vendor's rate ("₹38 per jar, GST extra — in line with what we pay").
  - The **FAQ** tab holds 22 answers drawn from real calls and Zoho. 20 are ready; 2 drafts wait for the founder.
  - The live Meera has been switched to Sarvam with the new script. Bolna re-read the agent and confirmed every change.
- **Something found on the way:** On 3 October someone replaced Meera's script in Bolna's dashboard with a long older one. It used variables Satej never sends (`{project_work_type}`, `{project_city}`). Any Satej call after that would have had blanks where the job details should be. It has been replaced; the old version is kept in `docs/satej/`.
- **Left undone:**
  - The database change (`supabase/migrations/20261006000001_satej_rate_benchmark.sql`) is written and was tested on a local copy of the real purchase data, but is not applied. Until it is applied, the Rate checker and FAQ tabs show "not set up" and Meera calls without a target. Applying it builds the first benchmark and loads the FAQ.
  - Meera's FAQ section is empty until the migration is applied and someone presses **Publish to Meera**.
  - No real phone call has been made on the new Sarvam setup. Four conversation turns were tested against the model directly. Use "Call me first" before calling vendors. If anything misbehaves, one command puts the thinking back on Azure.
  - "Meera (graph)", the test-only agent, is still on the old ElevenLabs/Deepgram setup.
  - The new screens were type-checked, but not seen in a signed-in browser.
  - Satej does not yet keep a do-not-call list. Meera promises "you won't be called again", but the team must note it from the call log.
  - Some repeat services (pest control, manpower) vary a lot with scope, so their benchmark is a rough guide, not a price.
- **Open questions for the founder:**
  - Two FAQ drafts need your words. How long has the company been operating? And what may Meera say about advance payment? (Zoho shows 343 orders on "100% advance".)
  - Voice: Meera now uses "Priya". Five other voices are in `docs/satej/voice-samples/`. Pick another if you prefer it.
  - Should Meera ever negotiate on services like manpower or AMC, where scope changes the price? Today she negotiates whenever there are at least 3 comparable past orders.

## 2026-10-06 — Saas.one: Why the purchase@ mailbox stopped updating, and getting it back

**The live purchase@ mailbox sync has not run on its own since 10 August, because one setting was missing. Today's mail was pulled in by hand, and the sync now fails loudly instead of quietly.**

- **Why:** The founder asked why the purchase email was not connected. The Zoho login for purchase@worksquare.in works: a fresh token was issued and the mailbox is visible. But the hourly job that reads it needs to be told which organisation owns the inbox (`ZOHO_MAIL_ORG_ID`). That setting was added as a safety rule on 10 August and never filled in on the live site. Every hour since, the job stopped at that step and still reported success, so nobody noticed. The newest mail on the dashboard was from 1 August.
- **Structural decisions:**
  - The rule that the inbox must be pinned to one named organisation stays. The alternative was to guess the organisation from the database. That is safe while there is one organisation, but would copy one client's purchase mail into another's account the day a second one is added.
  - A missing pin now counts as a failure (shown red in Vercel's job log), not as "nothing to do". "Nothing to do" is now only used when no Zoho login is set at all.
  - The dashboard's mailbox card now shows when the mailbox was last actually read ("mailbox read 3h ago", in red after 3 hours), not when the card last loaded. Before, it said "synced just now" over two-month-old mail.
- **What works now:** The purchase team's digest has today's mail: 300 threads read, newest from this afternoon. 9 need a reply and 169 were never acted on, as judged by simple rules. The local setup has the organisation pinned, so the job runs end to end when started by hand.
- **Left undone:**
  - The live site still lacks `ZOHO_MAIL_ORG_ID`. Until it is added in Vercel and the site redeployed, today's mail is a one-off snapshot and will go stale again.
  - Ira's reply reader has a separate problem. It watches ira.mehta@autopilotoffices.com and lohitaksha.ranganathan@worksquare.in, and no connected Zoho login can read either one. Only purchase@ (with eb@ and purchase@autopilotoffices.com) is connected. So replies to Ira are not being seen. Fixing this needs the mailbox owner to sign in to Zoho; it cannot be done from code.
  - The dashboard card change was checked with type checks and a live call to the job, not in a signed-in browser.
- **Open questions for the founder:**
  - The AI sorting of purchase mail is switched off, so simple rules decide what counts as "never acted on". 169 of those looks high. Should AI sorting be turned on? It costs a little per run.
  - Should Ira read replies at her own address, or at purchase@? If purchase@, Ira's settings can point there and nothing new needs connecting.

## 2026-10-06 — Saas.one: "The Sensory Studio", three redesign directions for the Basilic Fly floor

**A 15-page PDF that re-imagines the four current Basilic Fly views in three directions (a calm grading room, a visible production pipeline, a warm film-set backlot), each designed around the five senses with an IoT layer behind it.**

- **Why:** The founder wants the Basilic Fly floor, a VFX-first studio, to look and feel like one. Today it reads as a good coworking space. The founder asked for something that "talks the walk", using sight, hearing, touch, smell and taste, with sensors and automation where they help.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/Basilic Fly Playbook/Sensory Studio/`, in the style of the existing Basilic Fly playbook (same size, fonts and logos). Nothing in the FMS app changed. I could not find a separate "Invesco brief" document, so the playbook was used as the template.
  - The renders are AI edits of the four existing views, not rebuilt from the CAD. The alternative was to rebuild each direction in 3D first. That would keep every desk exactly in place, but takes far longer, so it is offered as the step after the founder picks a direction. The PDF says this plainly on page 14.
  - Taste was added as the fifth sense, because the request named smell twice.
- **What works now:** The founder can compare today's floor against three clear options on the same four camera views, see what each does for each sense, and see the shared sensor-to-scene IoT layer and the privacy rules (no cameras, no recording, counts not names).
- **Left undone:**
  - Nothing is priced and no supplier is named. Sound, scent, touch and taste are described, not visible in the pictures; the PDF marks which is which.
  - Desk counts were not re-checked against drawing R05. In Direction B, the far wall in the centre-table view turned into a dark screen wall, which is more change than asked for.
  - The Higgsfield account balance changed from 9 to about 600 credits during the session (the plan shows as Pro). I did not make that change; the 12 renders and one redo cost roughly 7 credits.
- **Open questions for the founder:**
  - Which direction (or a mix of A and B)?
  - Does the studio have a real render system that can feed status screens? Without it, Direction B is decoration.
  - How far should scent and wearables go? Plain, clean air is the safe default.

## 2026-10-05 — Saas.one: Three Whitefield slides — what the floor earns, who else is opening, and where our price sits

**Three presentation slides for the Total Environment Whitefield "other half" deck, blending the founder's financial projection with the Whitefield Business Case Study: the money, the new competitors, and a price anchored between Simpliwork and 91springboard.**

- **Why:** The founder wants one consistent story for the 20,000 sq ft floor. The deal terms were in one document, the cost and margin maths in another, and the old price slide still showed a ₹12,500 to ₹16,000 plan that no longer matches the numbers.
- **Structural decisions:**
  - Built outside this repo, at `~/Downloads/TE-Whitefield-Part2-Price-Slides/`, with the same page size, fonts and colours as the existing Part 2 deck. Nothing in the FMS app changed. The slides were first merged into the Part 2 sales deck, which turned out to be the wrong property. They were then restyled in the Business Case Study's own fonts and colours and merged into that deck instead: `~/Downloads/Whitefield_Business_Case_Study_2026_v2_with_financials_supply_price.pdf` (26 pages). The financial slide is page 5, at the end of the commercial section; the supply and price-ladder slides are pages 24 and 25, at the end of the competitive section. Page numbers and the contents page were updated, and the original file is untouched.
  - Our price is set at ₹11,200 a seat, the figure the projection says is needed for a 20% margin (₹11,208). The alternative was to pick a price from the competitor ladder and see what margin fell out. We started from the margin because it is the number the business must hit, and the ladder turned out to have an empty slot at that price, between ₹10,000 and ₹12,000.
  - The old "Standard ₹12,500 / Blended ₹14,000 / Premium ₹16,000" lines were removed from the price slide. They belonged to the earlier 140-seat plan.
- **What works now:** A reader can see in three pages what the floor costs each month (₹35.87 L), what we must bill (₹44.83 L), what we keep (₹8.97 L, about ₹1.08 Cr a year), how full the floor must be (63% to cover running costs, 80% to cover everything, against 83 to 93% for settled rivals), and why ₹11,200 is competitive without looking cheap.
- **Left undone:**
  - The Part 2 sales deck still describes the earlier plan (140 seats, ₹8,570 a billable seat). It is a different property and was left alone.
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
## 2026-09-23 (later) — Saas.one: the reviewer's report, with the camera frames inside it

**Every attempt now has a one-page report — score, every answer, the full proctoring log, and the flagged camera frames embedded in the page itself — that prints or saves as a PDF without losing its evidence.**

- **Why:** "The AI flagged something" is worth little to a reviewer who cannot see what it saw. And a report that is forwarded or filed has to still make sense a month later.
- **Structural decisions:**
  - Frames are **embedded in the report as data URIs, not linked.** A signed storage link expires in an hour, so a saved or printed report would lose its evidence exactly when someone comes back to check it. That costs a few hundred KB per report and keeps it true on its own. Up to 40 frames per report.
  - The report is built by one function (`backend/lib/proctor/report.ts`) that the route wraps with the author check. That separation is what let it be tested against live data without a login.
  - A clean camera check never appears in the log. Only flags, voice notes and the reason the test ended.
- **What works now:** In Results, each attempt has a **Report** link. It opens the full report: outcome, score with a bar per section, the frames the camera kept with what the model saw, the proctoring log, and every question with what the candidate chose against the right answer. "Print / Save as PDF" gives a clean copy with the images inside it.
- **Verified against live data today:**
  - **The case that mattered is settled: a real person at a laptop is not flagged.** Six checks in a row on a live webcam came back "one person, facing the camera, no devices" — no false alarms on the candidate themselves.
  - **A second person is caught.** Four checks flagged "a second person partially visible at the right edge" while someone else was in the room.
  - **A phone is caught.** "Holding up a smartphone and looking down at it instead of the screen" was flagged as a phone and as looking away.
  - Both ways of leaving worked: switching tab closed one attempt, switching app closed the other.
  - The report itself was built end to end against the live database and the private bucket: the frame came back as an embedded image, the section scores and the right/wrong answer review were correct. The rows used for that check were deleted afterwards.
- **Fixed because that run exposed it:** a camera check that was still running when the attempt closed was recorded four seconds *after* the end. The check now re-reads the attempt before recording, so the log stops when the test does.
- **Left undone, deliberately:**
  - The earlier runs happened before the evidence bucket existed, so those phone and second-person flags have no frames saved. New attempts will have them.
  - Reports are per attempt. There is no comparison across candidates, and no shortlist view.
  - The print layout is the browser's; it has not been tuned past page breaks on the sections that matter.
- **Open questions for the founder:** unchanged from the entry below — how long camera frames are kept and who may open them, whether the public link should expire, and whether a closed attempt should keep costing a chance.

## 2026-09-23 — Saas.one: Assessments get a public link, AI-written questions, and a sharper camera

**HR can now describe a test and have AI draft it, read it as the candidate will, and send one link that works without any login — while the camera keeps evidence of a phone or a second person for the reviewer.**

- **Why:** The test only reached people who already had an account, which rules out the outside candidates it is mostly meant for. Writing 20 fair questions by hand is slow. And "the AI flagged something" is not worth much to a reviewer who cannot see what it saw.
- **Structural decisions:**
  - **A public link, `/t/<token>`.** No sign-in, no account. The candidate types their name and email, and from that moment the attempt is identified by a secret the server issues (`attempt_token`) rather than by a session. The same routes serve both kinds of taker: a signed-in member is recognised by their login, a candidate by that token. Chances for a candidate are counted per email address. Someone can type a different email to get another go — that is the honest price of no sign-in, and every attempt is still listed for the reviewer.
  - **Sections are now the author's**, like the sections of a form: title, description, and questions under it. A test starts with the four standard ones and they can be renamed, described, removed, or added to.
  - **Two different responses to what the camera sees**, deliberately. Not looking at the screen is a mistake worth correcting, so the candidate is told, and after three warnings (the author sets the number) the attempt closes. A phone or a second face is not a mistake, so **nothing is shown** — the frame is saved to a private bucket for the reviewer. Telling the candidate would only teach them what the camera catches.
  - **The microphone is on** and the page watches the sound level. A sustained voice is recorded for the reviewer, at most one note every 30 seconds. It cannot tell who spoke, so it reports "a voice was picked up", not "someone else was there".
  - **Evidence frames are private.** The bucket has no policies at all; the reviewer sees them through links that expire in an hour.
  - **AI drafts, a person decides.** "Draft with AI" fills the form and saves nothing. The author reads every question and presses Save, so a wrong question costs an edit, not a bad hire.
  - A standing line at the top of the test says the camera, microphone and screen activity go to the reviewer, so nobody is recorded without being told.
- **What works now:** HR describes the test in a sentence, presses Draft with AI, edits what came back, saves, opens **Preview** to read it exactly as the candidate will (with the answers marked), then **Copy link** and sends it. The candidate opens it on any laptop, types their name and email, allows camera and microphone, and takes the test in fullscreen. Results show the score by section, who came in from the public link, the camera warnings, the frames kept, and when a voice was heard.
- **Left undone, deliberately:**
  - The migration (`supabase/migrations/20260923000001_proctor_public_link_and_evidence.sql`) has not been applied.
  - Still not run end to end in a browser by a real candidate with a working camera. Type check, lint and the SQL linter pass, and the vision call is verified against live ENGY.
  - **Anyone with the link can start an attempt.** There is no per-candidate invite and no rate limit, so a leaked link could be used by strangers, or spammed. Every attempt is recorded with the name and email typed, which is the only check today.
  - Voice detection is a loudness threshold, not speech recognition. A noisy room, a fan or the candidate reading aloud will read the same as a second person talking. The measured level is stored so the threshold can be tuned.
  - A saved test still cannot be edited; make a new one.
  - Evidence frames are kept indefinitely. There is no deletion schedule, and no consent text beyond the notice on the test.
- **Open questions for the founder:**
  - How long should camera frames of a candidate be kept, and who besides HR may open them? This is personal data of people who may never join.
  - Should the public link expire, or be one link per candidate so it cannot be passed around?
  - Should a failed attempt (closed for looking away) count as one of the two chances, as it does today?

## 2026-09-22 — Saas.one: AI proctored assessments, inside the HR module

**HR can now give a candidate or employee a sectioned multiple-choice test on a locked page (camera on, fullscreen) with two chances, starting from a ready-made Ops Manager test.**

- **Why:** There was no way to check what someone knows or how they think (reasoning, job arithmetic, values, judgement on the floor) and trust that they answered alone. A form link can be answered with a second tab open or a colleague helping.
- **Structural decisions:**
  - It lives in the HR module as an **Assessments** tab (HR sidebar → Assessments), next to Requests & Grievances and the Employee Directory. There is no separate module. People without the HR sidebar see the tests open to them at `/proctor`, and the test link opens a standalone locked page, so fullscreen works cleanly.
  - Three tables (`proctor_tests`, `proctor_attempts`, `proctor_events`). Questions sit inside the test row as a list, each tagged with a section, instead of in a separate questions table.
  - **Four sections:** cognitive ability, aptitude, workplace culture, and situational judgement (plus "general"). Each attempt stores its score per section, so results show where someone is strong or weak, not just one number.
  - **Two chances by default** (HR can set 1–5 per test). Leaving the page uses a chance: switching tabs or apps, pressing Esc, exiting fullscreen, closing or refreshing, or turning the camera off. Opening the link again mid-test also counts. Submitting ends the test, so nobody retakes it to improve a score.
  - The AI camera check (one webcam frame every ~20 seconds) runs through the vision helper the document OCR already uses, so it rides the same provider the rest of the system is configured for — today ENGY (api.engy.ai, `glm-5.3-flash`) — rather than a second AI account with its own key. It only **flags** an attempt for the reviewer. It never uses up a chance, because a vision model can be wrong and a false alarm should not cost someone their attempt.
  - **Templates are code, not database rows.** The Ops Manager test loads into the New test form, HR edits it and saves it as their own. Nothing is seeded into any organisation's data.
- **What works now:** HR opens Assessments, clicks New test → Ops Manager template (20 questions, 5 per section, 30 minutes, 2 chances), adjusts anything, saves, and copies the link. The person opens the link, turns on the camera, presses Start, and answers section by section in fullscreen. If they leave, they see how many chances remain. HR sees each attempt: outcome, reason if closed, total score, score per section, and the AI flags with reasons.
- **Left undone, deliberately:**
  - The second migration (`supabase/migrations/20260922000002_proctor_attempts_and_sections.sql`: chances and section scores) has not been applied. The founder applied the first one on 2026-09-22. Until the second is applied, the new code will fail.
  - Nothing has been tested in a browser yet. It needs both migrations and a signed-in account. Code checks (type check, lint, SQL linter) pass.
  - The AI camera check is only half tested. It now runs live against ENGY: four stills were read correctly (a logo, a cartoon face and an empty building all came back "no face"; a building full of people came back as 12 faces, which is the "more than one person" flag), taking 2–4 seconds and about 500 tokens a frame — roughly ₹0.80 of AI for a 30-minute test. **The case that matters most is still untested: one real person at a laptop, who must NOT be flagged.** That needs a webcam and a real attempt.
  - The two Groq keys in the local `.env` are rejected by Groq ("Invalid API Key"), which also breaks SOP photo scoring locally. The proctor no longer depends on them, but that is worth fixing separately.
  - A saved test cannot be edited. To change one, start a new test (from the template or from scratch) and close the old one.
  - Questions appear in the same order on both chances, and the second chance shows the same questions.
  - In the culture and situational sections, the right answer is often the obviously sensible one. Real psychometric tests score every option and compare against a benchmark group. This template is a starting point for the team, not a validated instrument.
  - Camera frames are not saved, only the AI's verdict.
  - This is a deterrent, not a lockdown. A web page cannot see a second device or stop someone who disables its scripts.
  - Laptop or desktop only. Safari on iOS cannot lock the screen to one page.
  - Only HR users get the Assessments sidebar item. Org admins can author too, but reach it via `/proctor`.
- **Open questions for the founder:**
  - **Who takes the Ops Manager test: outside candidates or current staff?** Today it needs a login, so an outside candidate would first need an account (for example through the existing invite link). A no-login candidate link is a bigger change.
  - Should there be a pass mark (overall or per section), or does HR judge from the scores?
  - Should questions be shuffled, or should the second chance get different questions?
  - Should repeated AI flags ever end an attempt, and should flagged camera frames be kept as evidence?
