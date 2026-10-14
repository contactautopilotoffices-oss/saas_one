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
