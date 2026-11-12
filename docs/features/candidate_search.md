# Candidate Search

Owner request 2026-11-02. HR has ~3,000 candidate rows in Excel. They need to upload sheets, add / edit / delete
candidates in the portal, and search in plain English for the best top N (custom, max 30) for a role, with an
explanation per candidate. It is a tab in the **Tech console** for now (`frontend/components/dashboard/TechDashboard.tsx`).
Every HR login may use it: `hr`, `hr_head`, `hr_manager`, `hr_ops`, plus `org_super_admin`, `tech` and master admins
(`backend/lib/candidates/access.ts`).

## Decisions (owner, 2026-11-02)

| Question | Answer |
|---|---|
| Delete | Soft delete everywhere, restorable. **Superseded 2026-11-03:** permanent delete added (below) |
| Who can add / edit / delete | Every HR login |
| Re-uploading a sheet | Popup: **Replace** or **Merge** |
| "Same sheet" | Same file name, ignoring case and extension |
| Top N | Custom number, 1-30 |
| Salary columns | ₹ per month, in hand |
| `Role` column | The role the candidate was **sourced for** |

## Decisions (owner, 2026-11-03)

| Question | Answer |
|---|---|
| Permanent delete | Yes. Deleting a sheet asks **Move to deleted** (restorable) or **Delete permanently** (sheet + records + people left with no record) |
| Clear the database | Yes: **Clear all candidate data** (Sheets tab) erases every sheet, record, person, uploaded row and AI fix log of the organisation. Search history is kept |
| Who can permanently delete / clear all | Every HR login (same as every other action here) |
| "Delete all matching" on the Candidates tab | Moves to deleted (restorable); permanent removal only from Show deleted or Clear all |
| Too many flagged rows | Routine readings are **fixed automatically** and no longer counted; the rest gets an **AI fix** that HR approves change by change |
| Embeddings | Chosen by the env var `EMBEDDING_PROVIDER`: **`gemini`** (default, free tier, `gemini-embedding-001`, key `GEMINI_API_KEY`) or `jina` (`jina-embeddings-v3`, key `JINA_API_KEY`, needs account credit). Both 768 dims. One provider at a time: no per-call fallback, because vectors of different models cannot be compared. (Owner 2026-11-03: Jina first, then back to Gemini when the Jina account had no balance; the background worker now hides Gemini's small free quota by pausing and continuing) |
| What HR sees while processing | Upload progress bar, then "Preparing NN%" per sheet. No "Index now", no indexing / rate-limit errors. Errors HR can fix (file type, size, no header row) are still shown in plain words |

Confirmation: permanent deletes need the typed word `DELETE`; Clear all needs `DELETE ALL` (checked by the server too).

## Decisions (owner, 2026-11-06): the filter panel

HR asked for Naukri-style filters (meeting with Roohi Idrishi, 5 Nov). Approved on a clickable mockup.

| Question | Answer |
|---|---|
| How search works | Keywords and filters change the list at once, straight from the database. AI is optional: it reads a job description into the filters, and ranks the current list when HR clicks **Rank with AI** |
| Compulsory keywords | Star a keyword. A record needs every starred keyword and at least one of the others. Exclude words leave records out |
| Filters live now | Keywords, exclude, location, experience (total or relevant), notice, salary (current or expected, lacs a year or ₹K a month), role, company, designation, status, sourced in |
| Resume filters (owner 2026-11-07, option A) | Education (UG / PG / PPG: any, specific, none; institute; type; degree year), industry, preferred location ("include candidates who would relocate", "change preferred location"), career break, defence background, "currently serving notice". Built and shown greyed out ("Available once resumes are added") until records hold that data; each switches on by itself once any record does. Data lives in migration `20261107000001` (its own view, `candidate_filter_records`); before it is applied the panel works without them |
| Gender, age, disability | Shown greyed out ("Needs HR and legal approval"). No column stores them: that data is not collected until HR / legal sign off |
| Blank fields | A filter hides a record blank on that field, and the page says how many, with a link to show them |
| Layout | Filters left of the list, sticky under the 64 px header, resizable (260-520 px), collapsible to a strip; a slide-over when the list would not fit beside them. Worked out from the space on the row, so the Tech console's collapsible sidebar counts |
| Sticky (owner 2026-11-07, fix B) | `<body>` has `overflow-x: hidden` app-wide, which stops `position: sticky` against the page. The Tech console therefore scrolls inside its own `<main id="main-scroll-container">` (the other consoles' pattern); the rest of the app is unchanged. The Escalation tab's drag now scrolls whatever really scrolls |
| Opening a candidate | A read-only panel first, so a click cannot change anything; **Edit details** opens the existing form |

Salary caution: the stored figure is monthly in hand, while Naukri's annual salary is usually CTC. "8 Lacs" here means about ₹66.7K in hand a month.

## Decisions (owner, 2026-11-07): resume files, phase 1

Meeting with Roohi Idrishi, 5 Nov: thousands of resumes sit in the Downloads folders of four laptops, and there is no
Excel of them. Phase 1 only gets the files into one place and builds the Excel from them; reading the resumes
(education, industry, skills) and matching them to candidates is phase 2.

| Question | Answer |
|---|---|
| How the files get off the laptops | A **Resumes** view in Candidate Search. Someone on each laptop picks the Downloads folder; the browser lists only PDF / Word files and pre-ticks the likely resumes; only ticked files leave the laptop. Nothing to install, the usual HR login. Rejected: a script per laptop (needs an upload token per machine, an auth change) and Claude on each laptop (varies per machine, and still needs a way in) |
| Which files are ticked | Downloaded between 1 January this year and today (the file's modified date on the laptop), a PDF / .doc / .docx, at most 15 MB, and not named like an invoice, ID proof or pay slip (`resume-pick.ts`). The dates can be changed; anything can be ticked or unticked |
| Where the files live | Supabase, private bucket `candidate-resumes`: any HR login can open them from the portal or the Excel, the server can read them in phase 2, and they are backed up. **Download all (ZIP)** gives a local copy whenever wanted. Check the Supabase plan's storage (free 1 GB, Pro 100 GB) before the upload day: 5,000 resumes are roughly 1-3 GB |
| Duplicates | The same file (same bytes, SHA-256) from any laptop is stored once; the run reports it as "already there". Running the same folder again, or after a dropped connection, is safe |
| Download date | Kept per file and used as the filter ("This year" by default) in the list, the Excel and the ZIP. A browser cannot read a file's true created date, only its modified date; for a file in Downloads that is the download day |
| Laptop | A name typed once per laptop ("Roohi's laptop"), remembered by that browser; a browser cannot read the machine's name. The Excel's Summary tab counts per laptop |
| Excel | Built from the database on demand (**Download Excel**): one row per file with an Open link back into the portal, plus a Summary tab per laptop. There is no sheet to upload: the sheet is the output |
| Background | The upload runs while the tab is open (a web page can only read the laptop's files while it is open); other tabs can be used meanwhile, and a closed tab just means running it again. Phase 2's reading runs on the server in the background, like sheet preparation |
| Who sees it | Every HR login: **Candidate Search** is in the HR sidebar (`/hr-tickets?tab=candidates`), marked **Beta**; the Tech console keeps its tab. Same access rule as before (`access.ts`) |
| Conflicts in phase 2 | Agreed now: a resume fills only a candidate's empty fields; what HR typed stays, and the panel shows the differences |
| AI | None in phase 1 (no model call anywhere in it), so no Agent Spec block here |

## Decisions (owner, 2026-11-10): resumes linked to candidates, phase 2

| Question | Answer |
|---|---|
| How a resume finds its candidate | Its text is read in the background (`unpdf`, `mammoth`; no AI) and the emails and 10-digit mobiles in it are kept. A file is linked to the candidate with the same email, else the same phone (the keys the sheet import de-duplicates by). **Either** matches, not both: resumes often carry one, and the panel says which matched. Name matching was dropped: too many wrong links |
| Both directions | New files are matched when read; new or edited candidates (a sheet import, an added or edited record) are matched against the stored files right away, and the cron catches anything left |
| By hand | **Attach a resume** in the candidate's panel searches the files not linked to anyone; **Detach** marks a wrong match, and a detached file is never matched again by itself |
| Where it shows | **Resume** / **No resume** on each search result, the files in the candidate's panel, a **Resume on file** filter (Any / Has / No), the sheet upload summary ("N of the sheet's candidates have a resume"), the Resumes list (Candidate and Text columns, "Linked or not" filter), the Excel (Candidate, Matched by, Text) |
| Reading `.docx` (option C) | A `.docx` opens as a page in the portal (mammoth → HTML, strict content security policy, nothing in the file can run); the original stays downloadable. A PDF opens in the browser's viewer. No conversion service: few resumes are Word files, and almost none the old `.doc` |
| Files with no text | Scanned PDFs and old `.doc` files are marked "Couldn't read" with the reason, listed under "Not linked yet", and attached by hand |
| AI | None in phase 2 either (reading text and comparing keys is code), so still no Agent Spec block; phase 4 (reading details with a model) ships with one |

## Decisions (owner, 2026-11-10): one-click re-upload per laptop, phase 3

| Question | Answer |
|---|---|
| One click | **Upload new resumes** reads the Downloads folder and uploads the likely resumes downloaded since this laptop's last upload (a day before the newest download already stored, `sinceLastUpload`; this year on a first run), with no review step. Files already stored are skipped anyway. **Review a folder** keeps the old pick-and-tick path |
| Remembering the folder | Chrome / Edge keep a handle to the chosen folder in this browser's IndexedDB (`folder-store.ts`, File System Access API); later runs read it straight away, after the browser's own "allow?" prompt. Other browsers get the folder dialog each time, then upload by themselves. Nothing about the folder reaches the server. "Forget the remembered folder" clears it |
| Per laptop | The summary's `lastUploadedAt` per laptop (`candidate_resume_summary` plus one small query per laptop; no migration). The page says "last uploaded on 9 Nov (212 files); files downloaded since 8 Nov are ticked" |
| Reminder | A small "N d" tag on **Candidate Search** in the HR sidebar when this laptop (the name typed in the Resumes tab) has not uploaded for `RESUME_REMIND_AFTER_DAYS` (7) days; cached half an hour per tab |
| Laptop names | A dropdown of the HR team (`RESUME_LAPTOPS`: Roohi Idrishi, Sanil Parab, Neeti Upadhyay, Shwetha Gowda, Srushti Madhani), not a typed name |

## Decisions (owner, 2026-11-10): files that are not resumes

A Downloads folder holds job descriptions, invoices and the like; the name check cannot catch them all.

| Question | Answer |
|---|---|
| What decides | After the text is read (phase 2), a deterministic check (`looksLikeResume`): contact details plus resume words (experience, education, skills, …), against job-description / invoice words (we are looking for, responsibilities, apply, GSTIN, total amount, …). No AI |
| What happens | **Removed automatically** (owner's choice over flagging): the bytes are deleted; the row stays with status `rejected` (migration `20261110000002`) and the reason, so the same file is skipped on the next upload and HR can see what went ("Removed as not resumes" in the list, a count in the header). A removed file never matches a candidate and stays out of the Excel |
| Wrong call | The check is conservative, but a one-page resume with no contact details and few of the usual headings can be removed. The row's reason says why. A removed file cannot be restored (its bytes are gone); it is still on the laptop. To upload the same file again, delete its row first (it would otherwise be skipped as already seen), then use "Review a folder" and tick it |
| Deleting by hand | Tick boxes on the list, "select all on this page", **Delete selected (N)** with one confirmation (`POST /api/candidates/resumes/delete`, up to 200 at once) |
| Name check | Also unticks `JD`, `job description`, `offer`, `ticket`, and names starting with a portal's long random code |

## Decisions (owner, 2026-11-11): production plan, step 1

| Question | Answer |
|---|---|
| Live progress | While files are being read, the Resumes page refreshes the counts and the list every 4 s and shows "Reading resumes … 330 of 450" with a bar; every 20 s it nudges the server for a short run (`POST /api/candidates/resumes/read`, 6 a minute per user), the Sheets page's pattern |
| Many workers | Each run reads 4 files at a time (`RESUME_TEXT_PARALLEL`). Runs happen side by side (the cron, a burst after every upload, the page's nudges) and never collide: a run claims its files in the database first, and a dead run's files come back after 10 min. Past `RESUME_TEXT_MAX_INFLIGHT` (80) files mid-read for an organisation, a new run stands aside, so a burst of uploads from four laptops cannot swamp storage or the database |
| Tabs | One page width for all four views, so the Search / Candidates / Sheets / Resumes bar stays put |
| Index | `20261111000001_candidate_search_vector_index.sql`: an HNSW index for meaning search. A trigram index for the keyword "contains" filter was considered and dropped: the text it searches is computed across two tables (the view's `lookup_text`), so no index applies, and a scan of 50,000 short rows takes well under 100 ms anyway |
| Vector buckets | Supabase's new vector buckets were reviewed and not used: private alpha, a separate store that would split the filters from the vectors (two round trips instead of one query), and far more scale than this needs. Revisit past ~1M vectors |

## Decisions (owner, 2026-11-11): details read from resumes, phase 4

Decided on the owner's 50-resume sample (47 readable, 46 with contacts; one real resume with letter-spaced headings
would have been removed and is now accepted; one designer's portfolio is kept as "other"; 3 scans).

| Question | Answer |
|---|---|
| What is read | One structured call per resume (Control Center job `candidate_extract`): name, employer, designation, city, total experience, industry, skills, education (UG / PG / PPG, institute, type, year), every employer with dates, preferred locations, career break, defence background, a two-sentence summary |
| Model | **Claude Haiku 5.5** by default, Sonnet 5.5 as backup, Opus selectable in the Control Center (owner's choice on the recommendation: the step fills empty fields only and HR reviews everything, so the fast tier first; one dropdown to change). Cost per resume at today's rates: Haiku ≈ ₹0.03, Opus ≈ ₹1.2 |
| What it changes | A linked candidate: **empty fields only**; what HR typed stays. Skills are merged. The summary and the resume's text are always set. An unmatched resume becomes a **new candidate** with source "Resume" (name from the resume, contacts from phase 2, sourcing date = download date) through the same `createRecord` the portal uses, so a person seen twice is still one candidate |
| Search | The resume's text joins keyword search (full-text, whole words, on `resume_fts`), skills and the summary join `lookup_text`, and both go into the profile text that is embedded, so meaning search sees them. Before migration `20261111000002` the panel falls back as before |
| Privacy | Emails and phone numbers are masked before the text goes to the model (the code already has them); the name is read because a new candidate needs one. Nothing else leaves |
| Scans | A scanned PDF has no text for this step to read (3 of 50 on the sample). Since 2026-11-11 the scan reader types it out first: see "scanned resumes" below |
| Portfolios | Kept as **other documents**: bytes stay, never matched, out of the Excel, own filter in the list |
| First real upload (2026-11-11, 50 files) | Two PDFs failed three times with Postgres "unsupported Unicode escape sequence": their text carried a NUL character. The reader now drops NULs before saving, and a file given up on leaves the extraction queue (`extract_status` 'skipped'); the summary's extraction count only looks at files whose text is ready. Before that, the two stuck rows held the progress bar at 98 of 100 forever. Three files were true scans (image-only PDFs): they need OCR or a PDF-to-model read, not built yet |
| Sample run (2026-11-11, Haiku 5.5, `scratch/resume-extract-sample.ts`) | 46 resumes sent: 43 read first time, 3 replies trimmed by the validator (too many skills / long lines; the validator now trims instead of refusing). ~3,200 tokens in and ~1,000 out per resume, **₹0.074 per resume** (₹3.18 for the run; 5,000 resumes ≈ ₹370), ~5 s per call. Read by hand: names, employers, designations and degrees right on every readable file; two names came back partial ("SUTAR", "Amith") where the resume itself abbreviates; total experience is often left null when dates are vague (correct per the prompt). Two of the API's schema rules learned the hard way: a nullable enum must be `anyOf`, and at most 16 nullable fields per schema |

## Agent Spec — Candidate Search resume reading (phase 4)

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the pathway is fixed (read text → mask contacts → one structured call → validate → fill
   empty fields or create the candidate → rebuild the profile text), so neither (a) nor (b) applies. No tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no deterministic path exists for reading free-text
   resumes; the deterministic steps (contacts, "is it a resume?") run first and this step only sees what they passed.
   Accuracy on the owner's 50-resume sample is measured by the sample run (`scratch/resume-extract-sample.ts`) and
   recorded in this doc's phase 4 decisions once run.

**2. Context** `[BAA p.112]`
   The masked resume text (≤ 12,000 characters) and nothing else: not the sheet row, not other resumes, not HR's edits.
   The merge with what HR typed happens in code, so the model cannot overwrite a human value.

**3. Cost of a false positive** `[BAA p.112]`
   Low: a wrong value lands only in an empty field, every value is re-validated in code (zod, ranges, enums), HR sees
   it in the panel and can edit it, and nothing is sent to a candidate. By L10 the fast tier → **Claude Haiku 5.5**,
   backup **Claude Sonnet 5.5** (job `candidate_extract`), effort low.

**4. Tools** — none. The model fills a JSON shape; the code executes.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: JSON-schema output, re-validated with zod; a bad reply goes to the next model, then the file waits for the next run (3 tries, then "failed") | yes (`parseExtractReply`, `applyExtraction` fills only empties) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (12). Explicit no-skip clause: yes. Single-shot tone example: yes (one shortened resume →
   one reply). Never-invent rule: yes (step 11). Terminal state written to data: the file row's `extract_status`
   (`done` / `failed` / `skipped`), the model's answer (`extracted`), `extract_model`, `tokens_in` / `tokens_out`,
   and the candidate's columns.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Each resume is read once; the same resume uploaded again is skipped by its hash, so there
   is nothing to learn across runs → no write tool.

**7. Multi-agent?** `[BAA p.116]` Its own Control Center job and prompt, apart from parse / rank / fix / suggest:
   different context, failure mode and model tier (per-task model).

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: per-file status and error on the row, model name, a server log line per file; a busy model (429 /
   overloaded) pauses the run instead of counting as a failure; stale claims recover after 10 min.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** The sample run gives field-fill rates and a by-hand read
   of the 50; a rubric grader must be a non-Claude family (L6). Proxy later: HR edits of a filled field.
   Tool interaction `[BAA p.95]`: N/A (no tools). Call count fixed: 1 per resume (+ backups on failure).
   Agent efficiency `[BAA p.119]`: one call per resume, text capped at 12,000 characters; **tokens are recorded per
   call** (`tokens_in` / `tokens_out`; `models.ts` now returns Claude's usage), so ₹ per resume is a query.

**9. Trace** `[BAA pp.119–120]`
   Run telemetry: the file row (status, attempts, error, model, tokens, time) and server logs; not the
   `backend/lib/agents` runtime. Ad-hoc testing `[BAA p.116]`: PGlite integration tests with a scripted model
   (`tests/candidates/resume-extract.test.ts`); the live sample run on 50 real resumes before the rest.

**10. Laws knowingly violated, and why**
   - **L6 / L5 quality axis**: no rubric grader yet; the sample run and HR's edits are the quality signal.
   - **L2**: no A/B against another model on a labelled set; the Control Center dropdown is the switch once one exists.

## Decisions (owner, 2026-11-11): scanned resumes, kept documents, the laptop name

Asked after the first real upload: "the files which have image-only scans need to go to claude as images which would
be scanned. but only the image only files", and "what is this other document? why does it not open?".

| Question | Answer |
|---|---|
| Which files go to the model as pictures | **Only a PDF in which the text reader finds no text.** It is set to `text_status` 'scan' instead of "couldn't be read". Every other file keeps the free path (no AI to read text). A Word file with no text stays "couldn't be read" |
| What the model does | One call per scan (`resume-scan.ts`, Control Center job `candidate_extract`, Haiku 5.5 then Sonnet 5.5; Claude models only, since the PDF pages are read as pictures). It types out what is on the pages and nothing else; a word it cannot read becomes `[unclear]`, and an email or phone is never guessed |
| What happens to the text | The same step as every other resume (`saveResumeText`): "is it a resume?" (a scanned invoice is removed, a scanned portfolio kept aside), emails and phones, the match to a candidate, then the details reader. So a scan costs two calls: typing out, then details |
| Limits | More than **6 pages**: not sent (a brochure or a book, not a resume), marked with the reason. Nothing readable on the pages: marked with the reason. Three failed tries: given up. A busy model pauses the run without using a try. A call is not started with under 20 s of the run left |
| Privacy | Unlike the details call, nothing can be masked: the email and phone are exactly what has to be read off the page. The scan goes to the same Claude API the details call uses, and to nothing else |
| When it runs | In the every-minute cron and in the Resumes page's nudge, after the text step and before the details step, inside the time those leave (about 3 scans a minute in the background, more while the page is open). Not in the burst right after an upload |
| Live check (2026-11-11, the 3 scans of the owner's 50, Haiku 5.5, `scratch/resume-scan-sample.ts`) | Two one-page scans: both typed out with the email and phone found, no `[unclear]`, both pass the resume check; **about ₹0.06 each** (2,464 tokens in, 790 to 1,151 out), 3.5 s and 6.5 s. The third is a 74-page scan: refused before any call |
| "Other document" would not open | A bug: Open and Download only served files with status 'ready'. A kept document ('other') still has its bytes and now opens and downloads like a resume; a removed one still does not |
| Laptop name | **Required** before an upload, in the page (buttons stay off until a name is chosen) and in the API (400 without it): the first real upload stored 50 files under "Not named", which breaks "since this laptop's last upload". Files already stored without a name keep the "Not named" filter |
| Database | Migration `20261111000003_candidate_resume_scans.sql` (two more `text_status` values, `scan_model`, `scan_tokens_in` / `scan_tokens_out`); it also puts the scans already marked unreadable back in the queue once. Before it is applied a scan is marked "couldn't be read", as before |

## Decisions (owner, 2026-11-11): the redesign, phase 1

Asked after the first use by the HR team: the module "looks too basic and dull", and it should feel like a product a
large company would use. Owner's rules for this phase: keep **every** existing feature (all filters, the keyword bar
with starred keywords and AI suggestions, Paste a job description, Rank with AI, the sticky filter panel), and take the
uploader's name from the login instead of a list. Mockups: claude.ai artifact "Candidate Search Redesign" (private).

| Area | What changed |
|---|---|
| Density | The app's `globals.css` redefines Tailwind's `.p-1…6` and `.gap-1…6` on an 8px scale (`p-4` = 32px, `gap-2` = 16px), so every screen here rendered about twice as loose as its code said. Inside `frontend/components/candidates/` the two-axis utilities (`px-`/`py-`, `gap-x-`/`gap-y-`), which `globals.css` does not touch, are used instead. Nothing global was changed |
| Tab bar | Each tab shows its count (candidates, sheets, resumes). Beside the tabs: "Reading N resumes" while the background readers work, and "N need attention"; both open the Resumes tab |
| Search | Unchanged: keyword bar, exclude keywords, AI suggested keywords, Paste a job description, every filter, the resizable sticky filter panel, sort, Rank with AI, "show more", blank details, the "remove a filter" hint. New: result cards at about two thirds of the height; **the lines of the resume around the keywords**, keywords marked (`snippet.ts`, no AI; without keywords, the resume's summary); a tag for where the record came from; tick boxes with **Set status** and **Export to Excel** (a CSV built in the browser, formula-safe); on a wide screen a **quick view** beside the list (Call / WhatsApp / Email links, "Why this match" when ranked, skills). "What the search understood" is one compact block |
| Candidate | Opening a candidate is a **workspace**: the resume's text on the left with the search keywords marked, the details on the right. The text is what the reader took out of the file (`?text=1` on the resume route); "Open original" still opens the file in a new tab. A resume typed out from a scan says so. The Candidates table opens the same workspace (the full record is fetched) |
| Why text, not the PDF | The site's security headers forbid framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`, no `frame-src`), and CLAUDE.md does not let a task loosen them unasked. Showing the PDF itself inside the page needs that header changed, or a PDF renderer library; neither was done |
| Candidates table | Columns: candidate, current role (designation, company, city), sourced for, relevant experience, notice, expected, status, **came from** (the sheet, "From resume" or "Added manually", with "Resume on file" under it), updated. A name opens the workspace. Ticked rows: Set status, Export to Excel, Delete. The source filter tells "Added manually" from "From resume" |
| Labels | "Added by hand" is now "Added manually"; a candidate the system created from a resume is "From resume" (`recordOrigin`, by `candidate_source = 'Resume'` and no sheet) |
| Edit form | Industry, institute, UG / PG / PPG, degree year, education type, skills and "would move to" can be corrected by hand (`PATCH /api/candidates/[id]`). A resume read later still only fills what is empty |
| Resumes | A hub: who is uploading comes **from the login** (`uploaderName`: the profile's name, else the email's first part; the browser's `device` is ignored); files can be dropped on the page; each team member's last upload; a four-stage strip (stored, text read, linked, details read); one **Needs attention** list (text or details that could not be read, and documents kept aside) with open / download / delete. The filters sit on one row (`INPUT` carried `w-full`, which beat `w-auto`: the new `FIELD` has no width) |
| Long scans | A scan over 6 pages is filed as an **other document** (kept, never matched) instead of "couldn't be read" |
| After an edit | The saved record comes back with its resume fields (`getFullRecord`), and the list merges it into what is on screen. Before, any edit or status change blanked the resume details of that card until the next search |

Checked by eye before hand-over with a local harness (`scratch/ui-harness`, git-ignored): the real components, sample
data behind a mocked `fetch`, the app's own CSS, screenshots in headless Chrome at 1707 px and 1800 px wide (the app
scales every desktop screen to about that width, `useAppZoom`) and at phone width. Not checked in the real app with a
login.

Not in phase 1 (need new tables; shown in the mockup): saved searches, shortlists and stages tied to requisitions,
notes and a timeline per candidate, the "where each value came from" tags, call / WhatsApp logging, duplicate merge.

## Decisions (owner, 2026-11-11): the redesign, second round

Seven points from the owner after using phase 1 in the real app.

| Point | What was done |
|---|---|
| 1. Needs attention | Each row has a tick box, with "select all", "Clear" and "Delete selected" (the existing bulk delete, at most 200 files). The list is about six rows tall and scrolls inside itself, so a long one does not push the library down. Up to 180 files are loaded into it; "Show all in the list" covers more. A long scan that an earlier version marked "couldn't be read" is refiled as an other document by the app itself (`refileLongScans`, on the summary route's turn) |
| 2. Quick view | Closed until a candidate's **card** is clicked (anywhere on it; the controls inside keep their own job), with a close button. Closed, the list has the full width. On a row too narrow for it, the name opens the full profile as before |
| 3. Blank details | Designation and company left empty by the reader are taken from the **latest employer** the resume lists, and total experience from the **months its employment dates cover** (overlaps counted once, gaps left out; `infer.ts`, no AI). Filled into empty fields only, for new resumes (`applyExtraction`) and for people read earlier (`inferMissingDetails`: the cron, and the summary route at most every 5 minutes per organisation). Each such value is marked **"worked out"** on the card, the quick view and the profile (migration `20261111000004`, `candidates.inferred_fields`); a value HR types loses the mark. **Never worked out: notice, salaries, role sourced for** (a resume does not state them). On the card a fact with no value is left out instead of shown as a dash; education and skills from the resume are shown |
| 4. Resume in the Open view | A structured page (`ResumeDocument`). First a profile with the same sections for every candidate (summary, experience with dates, education, skills), built from what the details reader found. Then the file's own text laid out by rule (`resume-format.ts`): known section headings set in bold in one style, lines the file broke mid-sentence joined, bullets kept, skill lists as labels, job lines with dates in bold; "Plain text" shows it as read. Checked on the owner's 50 files: 44 of 47 readable ones had at least one heading recognised |
| 5. Empty space | The module uses the page's full width (no 1440 px cap) |
| 6. Sort | Owner: "I meant by sort". Eight orders instead of three: Recently sourced, Recently added, Recently updated, Name A to Z, Most experience, Most relevant experience, Shortest notice, Lowest expected salary. A record with no value for the order comes last. **Not built: "Best keyword match"**: ordering by how well a resume matches needs a database function; Rank with AI does that job today |
| 7. Card readability | Text in the full text colour, values on the larger number scale, grey only for small labels; the module's small-label colour went from the tertiary to the secondary text colour (42% ink failed contrast) |

What rules cannot do (point 4): a PDF made from a two-column design template often comes out of the reader with its
lines out of order (seen on several of the owner's files), and no formatting rule can restore the order. For those
files the profile on top is the reliable part and "Open original" shows the file. Having the model write out the
whole resume in sections would fix it, at about twice the reading cost per resume; not done.

## Decisions (owner, 2026-11-11): the source folder, quicker suggestions, a steady upload panel

| Point | What was done |
|---|---|
| Source folder | Owner: "an option like a source which keeps the folder path selected and selectable … the user will just click on the upload button and it will automatically fetch the resumes from the selected folder from the previous upload date." The folder memory already existed (phase 3) but was invisible. The Resumes page now has a **Source folder** row: the folder's name, whether the browser will read it without asking ("Ready") or ask once ("Browser will ask to allow"), **Change** (the folder window, once) and **Forget**. "Upload new resumes" reads that folder and its sub-folders with no file window and sends what was downloaded since the day before this person's newest upload (unchanged rule, `sinceLastUpload`). Nothing about the folder reaches the server; it lives in the browser's IndexedDB (`folder-store.ts`) |
| Suggested keywords | Owner: "you dont need to first search and only then display the keywords. it should also quickly display the words that are not present in the corpus. the result search must be done after selecting the keywords." Three changes: (1) every term the model offers is shown the moment it answers, none dropped; (2) how many candidates have each term is asked in a second request and filled in beside it (0 = none yet); (3) while a keyword is still being typed (3 letters, 400 ms pause) its suggestions are already asked for, so they are usually there when Enter is pressed. The list still refreshes only when a keyword is picked (owner chose "A": no other change to searching). See the Agent Spec change below |
| Upload panel | Owner: "this tab is kind of glitching while uploading, like moving up down again and again." Cause: the line with the current file's name was removed and put back between files, so the panel changed height many times a second. The line now stays, at a fixed height, showing the last file named. "Uploaded" used to stay at 0 until a whole batch of 50 was confirmed; it now counts each file as it reaches storage and is corrected by the confirmation |

## Decisions (owner, 2026-11-12): going live

| Point | What was done |
|---|---|
| Resume routes missing on the deployed site | The ignore rule `resumes/` (for the sample resume folder) matched every folder of that name, so `app/api/candidates/resumes/` was never committed and the deployed Resumes page got a 404 on every call. The rule is now `/resumes/` (the top-level folder only) and the nine routes are committed |
| One upload button | Owner: "i want the upload new resumes button to behave the same way as before where the users can upload the downloads folder", then "can we combine these 2 buttons". The newer folder picker refuses Downloads ("contains system files"; Chrome, Edge and Brave all block it, a page cannot change that). So with no source folder set, **Upload new resumes** opens the ordinary folder window in every browser (it accepts Downloads) and the upload of what is new starts by itself. **Review a folder** is removed: it had become the same button. Reviewing before sending is what Choose files and dropping files are for |
| Source folder | Now optional, and the row says so: Downloads itself cannot be remembered; a folder inside it (a Resumes folder) can, and then the button reads it with no window |
| Several people uploading at once | Two people preparing the same file in the same instant both found no row and both inserted; the unique index (organisation + content hash) refused the second insert and that person's whole batch of up to 50 files failed (recoverable with Retry, but alarming). `prepareResumeUploads` now reads the rows again and goes round once more (at most 3 rounds), so the batch goes through and the file is stored once. Test: "two people preparing the same file in the same instant" in `tests/candidates/resume-files.test.ts`, which failed before the change |
| Meaning-search index switched off | Owner: "just remove that feature so that it does not cause confusion as the current search screen does not use this index." A 3,000-row sheet sat at "Preparing 16%" for hours although it was fully imported: the bar counted records sent to the embedding service, whose free quota had run out (`Gemini embeddings failed (429)`, four refusals, a 10-minute pause each time). The Search screen HR uses (keywords, filters, Rank with AI) never reads that index; only the older free-text route `/api/candidates/search` does, and no screen calls it. So the index is **off unless the environment variable `CANDIDATE_MEANING_INDEX` is `on`** (`meaningIndexOn` in `config.ts`): the cron, the after-upload run and the page's nudge send nothing to the embedding service, a sheet shows Ready as soon as it is imported, and the free-text route searches by filters and words only. Nothing is deleted: the stored vectors stay, and switching it on resumes where it stopped. Tests: `tests/candidates/meaning-index-off.test.ts` |
| View issues: many rows at once | Owner: "i want an option to mass upload mass discard and more. also these processes must [go on] even after i close the box", then "mass discard means deleting those rows which the AI could not fix." In "Rows with issues": every row has a tick box and "Select all" ticks the rows shown; the ticked rows can be **fixed with AI, applied, marked reviewed or deleted** together. The list can be narrowed to **one kind of issue** (`issue-kind.ts`: the same problem with different values is one kind) or to **what the AI said** (has a fix / could not fix / not asked yet). When the AI has no change to suggest for some rows, one line offers **"Delete these N rows"**. Deleting asks first, then moves the records those rows became to Deleted (restorable from the Candidates tab, Show deleted) and closes the rows' issues with the note "record deleted by HR", so they leave Needs review and the sheet's flagged count drops (`discardRows` in `ai-fix.ts`, route `sheets/[id]/discard`, the module's usual login check and delete limit). A row whose record was deleted earlier is closed too. **The work goes on after the box is closed**: asking, applying, marking and deleting live outside the box (`issue-jobs.ts`), the Sheets page shows the progress beside the sheet, a message appears when it ends, and the suggestions are still there when the box is opened again. The AI part is unchanged: same job (`candidate_fix`), prompt, context and model, so its Agent Spec stands as written; deleting involves no model |

## Agent Spec — Candidate Search scan reading

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the pathway is fixed (text reader finds no text → page count → one call with the PDF →
   validate → the same save step as any resume), so neither (a) nor (b) applies. No tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists. The deterministic alternative
   is an OCR library, which this repo does not have and CLAUDE.md does not let a task add unasked. The deterministic
   steps still run first and last: only files with no text layer get here, and the typed-out text goes through the
   same "is it a resume?" rules. Measured on the owner's scans: 2 of 2 one-page scans read with contacts found, about
   ₹0.06 and 3.5 to 6.5 s each.

**2. Context** `[BAA p.112]`
   The PDF's pages and nothing else: not the file name, not the sheet, not other resumes. It does not know what the
   text will be used for beyond "a recruitment team".

**3. Cost of a false positive** `[BAA p.112]`
   Low to medium. A mistyped word lands in searchable text HR can open the original against. The costly case is a
   wrong digit in an email or phone linking the file to the wrong candidate: the prompt forbids guessing those
   (`[unclear]` instead, which matches no one), the match is by exact key, and HR can detach. By L10 the fast tier →
   **Claude Haiku 5.5**, backup **Claude Sonnet 5.5** (job `candidate_extract`), effort low.

**4. Tools** — none. The model fills a JSON shape; the code executes.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: JSON-schema output, re-validated with zod; a bad reply goes to the next Claude model, then the file waits for the next run (3 tries, then "failed") | yes (`parseScanReply`; under 40 characters counts as nothing readable) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (10). Explicit no-skip clause: yes. Single-shot tone example: yes (one page → one
   reply). Never-invent rule: yes (steps 6 and 7). Pages-are-data rule: yes (step 8). Terminal state written to data:
   the file row's `text_status` (`ready` / `unreadable` / `failed`, or `status` `rejected` / `other`), `resume_text`,
   `scan_model`, `scan_tokens_in` / `scan_tokens_out`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Each scan is read once; the same file uploaded again is skipped by its hash → no write
   tool.

**7. Multi-agent?** `[BAA p.116]` Its own prompt and call, apart from the details reader: different input (pictures,
   not text), different failure mode, and it must not see what the details reader is told to extract (per-task
   model). It shares the Control Center job so HR has one dropdown for "reading resumes".

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: per-file status, tries and reason on the row; a server log line per scan; a busy model pauses the run;
   stale claims recover after 10 min; the page-count gate and the minimum-time gate are tested.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** The live check above was read by hand against the
   originals (2 files). Proxy later: scans whose text has `[unclear]`, and scans HR re-attaches to another candidate.
   Tool interaction `[BAA p.95]`: N/A (no tools). Call count fixed: 1 per scan (+ the backup model on failure).
   Agent efficiency `[BAA p.119]`: one call per scan, at most 6 pages, output capped at 12,000 tokens; **tokens are
   recorded per call** on the row, so ₹ per scan is a query.

**9. Trace** `[BAA pp.119–120]`
   Run telemetry: the file row (status, tries, error, model, tokens) and server logs; not the `backend/lib/agents`
   runtime. Ad-hoc testing `[BAA p.116]`: PGlite integration tests with a scripted model
   (`tests/candidates/resume-scans.test.ts`) and the live check on the owner's real scans before any upload uses it.

**10. Laws knowingly violated, and why**
   - **L2**: no head-to-head against an OCR path; none exists here and adding one was not asked for.
   - **L6 / L5 quality axis**: no rubric grader; two scans read by hand is the only quality evidence so far.

## Architecture

```
Excel / CSV ─► parse-sheet.ts (header matching, normalize.ts) ─► import.ts (dedupe by email / phone, new / replace / merge)
            ─► candidates (person) + candidate_applications (record) + candidate_sheet_rows (raw, audit)
            ─► indexing.ts (Gemini or Jina per EMBEDDING_PROVIDER, 768 dims, in the background: cron every minute + after upload)

Query ─► query-spec.ts (LLM → validated JSON: must / prefer / keywords)
      ─► hybrid_search_candidates() SQL: must-have filters → structured + keyword (FTS) + meaning (pgvector) → RRF
      ─► rerank.ts (LLM evidence-only scores + code-computed location / notice / salary) → top N
      ─► candidate_search_logs

Filter panel ─► filter-search.ts: filters on the candidate_records view, no AI and no embedding, no migration
   Rank with AI ─► search.ts rankFiltered: the first 45 in the visible order ─► rerank.ts ─► candidate_search_logs
   Paste a job description ─► query-spec.ts parseQuery ─► filters.ts filtersFromSpec ─► filters HR can change
   AI suggested keywords ─► keyword-suggest.ts: model proposes terms ─► shown at once ─► code counts each on the records

Resumes, phase 1 ─► ResumesView.tsx: folder picked in the browser ─► resume-pick.ts (which files are offered)
   ─► SHA-256 in the browser ─► POST /api/candidates/resumes (resumes.ts: upload links, duplicates skipped)
   ─► bytes straight to the private bucket candidate-resumes ─► /confirm (object checked) ─► candidate_resume_files
   list · summary · export (Excel, exceljs) · manifest + links (ZIP built in the browser, zip-store.ts) · open · delete

Resumes, phase 2 ─► resume-text.ts (cron /api/cron/candidate-indexing + after an upload): claim files ─► download ─► text
   ─► emails / phones ─► link to candidates.email_key / phone_key ─► candidate_resume_files.candidate_id + match_reason
   sheet import / record edit ─► linkUnmatched (existing files ─► new candidates)
   candidate_filter_records.has_resume ─► "Resume on file" filter, the Resume tag; PATCH /api/candidates/resumes/[id] attaches / detaches
   GET /api/candidates/resumes/[id]?inline=1 ─► PDF: the browser's viewer; .docx: mammoth page

Resumes, phase 4 ─► resume-extract.ts (same cron, after the text; after an upload; the page's nudge): claim files whose
   text is read ─► mask contacts ─► job candidate_extract (Haiku 5.5) ─► zod ─► applyExtraction: empty candidate fields,
   skills merged, summary + resume_text; unmatched ─► createRecord (source "Resume") + file linked 'resume'
   ─► refreshSearchText (summary + skills in search_text ─► re-embedded) ─► candidate_filter_records: skills, resume_fts
```

`POST /api/candidates/search` (the plain-English search with hybrid retrieval) stays in place and tested, but the screen no longer calls it.

- **One record = one retrieval unit** (one Excel row, never chunked). Its search text (`profile.ts`) holds no email,
  phone or salary.
- **Numbers are filtered in SQL, never by similarity.** A record missing a value that a must-have filters on is excluded.
- **Records vs people**: a person (deduplicated by valid email, then valid phone, per organisation) can have several
  records (sheets / roles). Name, contact, company, designation, location and total experience belong to the person;
  role, source, date, relevant experience, notice, salaries, remark and status belong to the record.
- **Replace** imports the new sheet first and soft-deletes the old one in the same transaction
  (`candidate_finish_sheet`), so a failed import never loses the old sheet. **Merge** updates the record with the same
  person + role in that sheet, adds the rest, and deletes nothing.
- **Two kinds of row problem** (`normalize.ts`, `FIXED_PREFIX`): an *issue* needs review and counts as flagged; a
  *note* (stored as `Fixed: …`) is a routine reading applied automatically and only shown. Automatic: "30 in hand" =
  ₹30,000; lakh / LPA = per year ÷ 12 (flagged under 1.5 lakh); "30% Hike" = current in-hand + 30%; "40 ctc" read as
  ₹40,000 with a CTC note; a last working day ("21st july - lwd", or an Excel date) = days from the sourcing date;
  "immedaite" = immediate; ranges; "a@@gmail.com" repaired; two phone numbers → the first, the rest in the remark;
  "Negotiable" / "As per company norms" / words in a number column → empty value, text appended to the remark (the
  status still comes from the remark as written). On the owner's 210-row sheet this took flagged rows from 94 to 9.
- **AI fix** (`ai-fix.ts`, spec below): HR opens *View issues* → *Needs review* → *Fix with AI* (one row) or *Fix all
  with AI* (batches of 15). Suggestions are shown as current → proposed with a reason; HR ticks what to keep and
  applies. Applying saves through `updateRecord` (same validation as a hand edit), rewrites the row's issues as
  `Fixed: … (AI fix approved by HR)` and recounts the sheet's flagged rows (`candidate_resolve_row_issues`). *Mark
  reviewed* resolves a row without changing it.
- **Permanent delete** runs in one SQL transaction each (`candidate_purge_sheet`, `candidate_purge_records`,
  `candidate_purge_org`, migration `20261103000001`). A person is erased only when no record of theirs is left.
- **Background preparation** (`indexing.ts`, migration `20261103000002`): the cron `/api/cron/candidate-indexing`
  (every minute, `vercel.json`), a run right after an upload / edit, and a quiet nudge from the Sheets page every
  20 s while a sheet shows "Preparing". A per-organisation lease stops two runs embedding the same records. A busy,
  down or unconfigured service pauses that organisation for 1, 2, 5, then 10 minutes and retries; nothing is shown to
  HR. A record whose text the service rejects 3 times (one try per run) is set aside and still found by filters and
  keywords; changing its text clears that. State and the last error are in `candidate_index_state` and the server logs.
- **One model at a time**: records embedded with another model (the old Gemini ones) count as "waiting" and are
  re-embedded automatically; meaning search compares only vectors of the current model (`p_embedding_model`), so
  a half-finished switch never gives wrong matches. The HR Policy Assistant keeps its own Gemini embeddings.
- Every step degrades instead of failing: no parse → text-only search with a warning; no embedding → filters +
  keywords; no rerank → search order without a match %.
- The models are picked in the **Control Center** (Tech login → Control Centre → AI models → "Candidate Search"), like the
  Task Manager's jobs (owner 2026-11-02): `candidate_parse` (reading the search) and `candidate_rank` (ranking
  candidates), each a main model plus up to 3 backups from any text model in the catalog (Claude, Engy, Groq, Gemini).
  Default: Claude Opus 5.5. Saved in `task_manager_ai_models` (needs `20261102000004_candidate_search_ai_models.sql`).
  `backend/lib/candidates/models.ts` runs the chain: Claude models through the official SDK with JSON-schema output and
  an effort setting (`CLAUDE_API_KEY`, the key the Control Center checks), other models through the Task Manager's
  shared transport. The next model is tried on an error, a timeout or a reply in the wrong shape, within a time budget
  per step. Which model answered is logged (`parse_model`, `rank_model`). Embeddings are Gemini or Jina (Claude has none; see above).

## Files

| Area | Path |
|---|---|
| Migration (apply by hand) | `supabase/migrations/20261102000003_candidate_search.sql`, then `…000004_candidate_search_ai_models.sql`, then `20261103000001_candidate_search_purge_and_ai_fix.sql`. `20261106000002_candidate_search_suggest_job.sql` is needed only to save a different model for keyword suggestions. `20261107000001_candidate_search_resume_fields.sql` adds the resume fields and the `candidate_filter_records` view (the resume filters stay greyed out without it). `20261107000002_candidate_resume_files.sql` adds the resume files table, its summary function and the private bucket. `20261110000001_candidate_resume_links.sql` (phase 2) adds the text, contacts and candidate link columns and recreates `candidate_filter_records` with `has_resume`; apply it right after the two before it, and **do not re-run `20261107000001` afterwards** (it would try to drop that column and fail). `20261110000002_candidate_resume_rejects.sql` lets a row keep status `rejected` (a file removed as not a resume). `20261111000001_candidate_search_vector_index.sql` adds the HNSW index for meaning search (optional until the records grow; not run in tests, PGlite has no HNSW). `20261111000002_candidate_resume_extraction.sql`, then `20261111000003_candidate_resume_scans.sql`, then `20261111000004_candidate_inferred_fields.sql` (phase 4) adds skills, past companies, summary and resume text on candidates, the reading state and tokens on the files, the `candidate_extract` job, 'other' files, and recreates the view again (**never re-run `20261107000001` or `20261110000001` after it**). The Resumes view answers "needs a database update first" until the resume migrations are applied |
| Server logic | `backend/lib/candidates/` |
| API | `app/api/candidates/` |
| UI | `frontend/components/candidates/` |
| Tests | `tests/candidates/` (`npm run test:candidates`) |

## Agent Spec — Candidate Search (query understanding + ranking)

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the pathway is known ahead of time (understand → filter → retrieve → rank), so an agent
   is not justified under (a) or (b); a workflow lets us bake in early exits and fallbacks `[BAA p.104]`.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists. The plan is to compare
   (1) SQL-only, (2) hybrid retrieval, (3) hybrid + rerank on the same labelled query set once HR supplies it (§8).

**2. Context** `[BAA p.112]`
   The parser sees only the request and today's date. The ranker sees the request, the parsed summary and up to 45
   records as work facts under short ids (c1…). Neither sees names, email or phone.

**3. Cost of a false positive** `[BAA p.112]`
   Low, because every result is reviewed by HR and nothing is sent, rejected or contacted automatically; must-have
   filters are enforced in SQL, not by the model. By L10 a smaller tier would do, but the owner chose Claude
   (2026-11-02): default Claude Opus 5.5 with effort kept low / medium. The Tech team can switch either step to a
   cheaper model (and set backups) in the Control Center; do that once the eval in §8 exists.

**4. Tools** — none. The models fill a JSON shape; the code executes. The model never writes SQL.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: JSON-schema output, re-validated with zod; invalid keys dropped, failures fall back | yes (schema + zod, `query-spec.ts`, `rerank.ts`) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (both prompts). Explicit no-skip clause: yes. Single-shot tone example: yes (one request →
   spec; one record → scored entry). Terminal state written to data: `candidate_search_logs` row per search (`ai_parsed`,
   `ai_ranked`, spec, result ids, per-step ms).

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Partly (similar role searches), but no write tool ships now: the gain only appears
   once enough repeated work accumulates `[BAA p.103]`, and there is no labelled data yet to show it pays. → no write tool.

**7. Multi-agent?** `[BAA p.116]` Two separate calls with different context and failure modes (parse vs rank), so each
   prompt can change without regressing the other — the per-task split the book describes `[BAA p.116]`.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: per-step latency logged (`parse_ms`, `retrieve_ms`, `rerank_ms`, `total_ms`); provider failures fall back
   and are visible as `ai_parsed` / `ai_ranked` = false.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** When built, the grader must be a non-Claude family
   (e.g. Gemini) per L6, since the agent is now Claude. Needs 30–50 real HR queries with recruiter-labelled
   relevant candidates; then Precision@10, Recall@10, nDCG@10, MRR, constraint-violation rate (the last is 0 by
   construction for must-haves, verified in `tests/candidates/migration.test.ts`).
   Tool interaction `[BAA p.95]`: N/A (no tools). Call count is fixed: 1 parse + 1 rank (+ backups on failure).
   Agent efficiency `[BAA p.119]`: two calls per search; ranking prompt is capped at 45 records. Token counts are not
   recorded yet (`response.usage` is available in `claude.ts` and is the place to add it).

**9. Trace** `[BAA pp.119–120]`
   Run telemetry: `candidate_search_logs` (not the `backend/lib/agents` runtime). Ad-hoc testing before scale
   `[BAA p.116]`: unit + PGlite integration tests with scripted model replies; **no live-model run yet** (needs the
   migration applied and real data).

**10. Laws knowingly violated, and why**
   - **L6 / L5 quality axis**: no rubric grader yet — blocked on HR's labelled query set. Do not call this module
     "evaluated" until it exists.
   - **L14 (full traceability)**: per-search log only; no per-call token trace yet (`claude.ts` has `response.usage`).
   - **L2**: the A/B (SQL-only vs hybrid vs hybrid + rerank) is designed but not run — same blocker as L6.

## Agent Spec — Candidate Search AI fix (flagged sheet rows)

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the pathway is fixed (read row → suggest values → code validates → HR approves → save),
   so neither (a) nor (b) applies. One structured call per batch; no tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: the deterministic path is the cleaning rules in
   `normalize.ts`, and it runs first. The AI only sees what the rules left as "needs review" (9 of 210 rows on the
   owner's sheet). No A/B on accuracy yet: the HR approval rate logged per call (below) is the first measurement.

**2. Context** `[BAA p.112]`
   Per row: the "needs review" issues, the cells as typed (minus the name and serial number; email / phone only when
   the issue is about them), and the values saved now. Not the candidate's name, other rows, or the search.

**3. Cost of a false positive** `[BAA p.112]`
   Low: nothing is saved until HR ticks and applies the change, and every value is re-validated in code. By L10 a
   faster, cheaper tier fits → default **Claude Haiku 5.5**, backup **Claude Sonnet 5.5** (Control Center job
   `candidate_fix`, changeable there), effort low.

**4. Tools** — none. The model fills a JSON shape; the code converts and validates.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: JSON-schema output (field is an enum of the 13 allowed fields), re-validated with zod + `validateInput`; invalid, unchanged or unknown-row suggestions are dropped, not errors | yes (`checkChange`, `convertValue`) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (5). Explicit no-skip clause: yes. Single-shot example: yes (a shifted-columns row → two
   changes). Never-invent / never-change-name rules: yes. Terminal state written to data: `candidate_fix_logs` row per
   call; on apply, the row's issues become `Fixed: … (AI fix approved by HR)` and the log gets `accepted_count`,
   `rejected_count`, `applied_at`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Partly (the same typing habits recur across sheets), but the repeating cases are better
   served by adding a rule to `normalize.ts` (deterministic, free). → no write tool.

**7. Multi-agent?** `[BAA p.116]` Its own Control Center job and prompt, apart from search parse / rank: different
   context and failure mode, and a different model tier (per-task model).

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: `fix_ms` and `error` per call in `candidate_fix_logs`; the model chain falls back on error / timeout / bad
   shape (`models.ts`).
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** Proxy available now: HR acceptance rate =
   `accepted_count / proposed_count` per call, plus `cannot_fix_count`. A rubric grader must be a non-Claude family (L6).
   Tool interaction `[BAA p.95]`: N/A (no tools). Call count fixed: 1 per batch of ≤ 15 rows (+ backups on failure).
   Agent efficiency `[BAA p.119]`: one call per batch; tokens are not recorded (same gap as search, see L14 below).

**9. Trace** `[BAA pp.119–120]`
   Run telemetry: `candidate_fix_logs` (rows asked, model, suggestions, time, error, what HR accepted). Ad-hoc testing:
   PGlite integration tests with a scripted model (`tests/candidates/purge-ai-fix.test.ts`); **no live-model run yet**
   (needs migration `20261103000001` applied).

**10. Laws knowingly violated, and why**
   - **L6 / L5 quality axis**: no rubric grader; HR's approve / reject is the only quality signal for now.
   - **L14**: no per-call token count (`models.ts` does not return `usage` yet).
   - **L2**: no A/B against an alternative; the deterministic rules run first and the AI only handles their leftovers.

## Agent Spec — Candidate Search keyword suggestions

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the pathway is fixed (read keywords → propose terms → show them → code counts each on
   the records → HR picks), so neither (a) nor (b) applies. One structured call; no tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: the deterministic path is the job titles beside the
   keyword on the records, and it runs when no model answers. No A/B yet: which of the two HR clicks more is not
   recorded, so L2 is listed below.

**2. Context** `[BAA p.112]`
   Only the keywords already in the search. A keyword that looks like a phone number or email is dropped first (search
   finds people by those). A typed name cannot be told from a skill, so it would be sent as a keyword.

**3. Cost of a false positive** `[BAA p.112]`
   Low: a wrong term is only an offer and HR chooses what to use. Since 2026-11-11 code no longer drops a term found
   on no record; it shows how many records carry it (change note below). By L10
   a fast tier fits, and the panel shows while HR types → default **Claude Haiku 5.5** (Control Center job
   `candidate_suggest`), effort low.

**4. Tools** — none. The model fills a JSON shape; the code decides what is shown.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: JSON-schema output, re-validated with zod; a bad reply goes to the next model, then the fallback | yes (`parseSuggestReply`) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (5). Explicit no-skip clause: yes. Single-shot example: yes (one keyword → terms). A rule
   against terms naming a person, gender, age, religion or caste: yes. Terminal state written to data: not to a table;
   a server log line per call (see 9).

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Yes (the same keywords recur), and an in-process cache answers repeats for six hours per
   keyword set (all organisations together: the terms come from the keywords alone), keeping only the model's answers. That is a cache of results, not a learning store → no
   write tool `[BAA p.101]`.

**7. Multi-agent?** `[BAA p.116]` Its own Control Center job and prompt, apart from parse / rank / fix: different context
   and a different model tier (per-task model).

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: a server log line per call (terms offered, model, ms); the chain falls back on error, timeout or
   bad shape (`models.ts`), then to the records.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** A proxy can be read off the page: the share of offered
   terms with a count above 0 (no longer in the log since 2026-11-11). A rubric grader must be a non-Claude family (L6).
   Tool interaction `[BAA p.95]`: N/A (no tools). Call count fixed: 1 per new keyword set (+ backups on failure).
   Agent efficiency `[BAA p.119]`: one call per new keyword set; the cache makes a repeat free. Tokens are not recorded
   (same gap as search, see L14 below).

**9. Trace** `[BAA pp.119–120]`
   Run telemetry: server log only, because a table would need a migration for a low-stakes step. Ad-hoc testing
   `[BAA p.116]`: PGlite integration tests with a scripted model (`tests/candidates/filter-search.test.ts`); **no
   live-model run yet**.

**10. Laws knowingly violated, and why**
   - **L6 / L5 quality axis**: no rubric grader; a wrong suggestion costs one ignored pill.
   - **L14**: no per-call token count and no table row, only a log line (`models.ts` does not return `usage` yet).
   - **L2**: no A/B against the record-based fallback; it needs click data the page does not record yet.

## Agent Spec change — keyword suggestions shown before they are counted (2026-11-11)

Same job (`candidate_suggest`), same prompt, same JSON shape, same model tier, same context (the keywords only)
`[BAA p.112]`. What changed is what the code does with the answer.

- **Before**: the model's terms were checked against the records and every term not found was dropped before anything
  was shown. In the server log that was 1.2 to 3.1 s per keyword set, with 0 to 2 of 16 terms kept on the owner's
  database of about 50 resumes: slow and nearly empty.
- **Now**: `suggestKeywords` returns every term (at most `SUGGEST_MAX`, 16) with `count: null`; the page shows them, then
  asks `countKeywords` (the same route, body `{ count: [...] }`, at most `SUGGEST_COUNT_MAX`, 20), which counts each term
  exactly as the list would match it as the only keyword. The page also asks ahead while a keyword is being typed.
- **Guardrail given up, knowingly (owner's request)**: "a click can never empty the results". A term on no record can
  now be clicked; alone or starred it shows no one. The count beside it (0) says so before the click. In L15's terms
  the code check went from a gate to a label; the code still removes duplicates, the keywords already searched and
  anything that looks like a phone number or email.
- **Cost** `[BAA p.119]`: asking ahead means a slowly typed keyword can cost two or three small calls instead of one,
  and each shown set costs one more request for the counts (no model). The per-person limit on the route went from 30
  to 90 requests a minute to make room. The model's answer is now cached for every organisation together, which is
  safe only because nothing of an organisation goes into the call; the record-based fallback is never cached.
- **Laws knowingly violated**: the three in the spec above (L6 / L5 quality, L14, L2), unchanged. One thing got weaker
  on the system axis of L5: the log line no longer carries the share of terms found on the records.
- **Tested** `[BAA p.116]`: PGlite tests with a scripted model in `tests/candidates/filter-search.test.ts` (every term
  offered, uncounted; the cap; the cache shared between organisations; counts equal to the list's own totals; counts
  scoped to the organisation; no phone number or email counted). **No live-model run.**

## Agent Spec change — ranking from the filter panel (2026-11-06)

The ranker's prompt, reply shape and model job (`candidate_rank`) are unchanged; only where its records come from is new.
`rankFiltered` hands it the first 45 filtered records in the order HR sees them, with no parse call and no embedding, so
line 1 of the Candidate Search spec still holds as a fixed workflow `[BAA p.104]`, one step shorter.
- **Context** `[BAA p.112]`: unchanged. Up to 45 records as work facts under short ids; no name, email or phone
  (asserted in `filter-search.test.ts`).
- **Cost of a false positive** `[BAA p.112]`: unchanged. HR reviews everything; must-haves are enforced by the filters.
- **Evaluation** `[BAA pp.118–119]`: logged in `candidate_search_logs` with `ai_parsed` false and `parse_ms` 0. Same gaps
  as above (no rubric, no tokens).
- **Limit**: with more than 45 matches, the ranker sees only the first 45 in the current order, and the page says so.
- **Laws knowingly violated**: as for Candidate Search (L6 / L5, L14, L2). Added to L2: filter order versus hybrid
  retrieval as the source of the ranking pool has not been compared.

`POST /api/candidates/understand` calls the existing parser unchanged, so that spec stands. Its one gap: the parser has no
"exclude these words" output, so a job description fills everything except Exclude.

## Known limits

- **The filter panel's keywords and Exclude see only sheet data** (name, contact details, company, designation, location,
  role, source, remark). A starred keyword hides anyone whose row does not say it, until resumes are added.
- The filter panel uses "contains" matching, not word forms: `manager` finds `Senior Manager`, `lease` does not find
  `leasing`. It also matches inside words: the keyword `MBA` finds everyone in **Mumbai**. For qualifications use the
  Education filter (exact), not a keyword.
- The resume fields (education, industry, skills) are filled by the details reader (phase 4) and can be corrected in
  the edit form (redesign, phase 1). A candidate with no resume has them only if someone types them in.
- **Resumes, phase 2**: a resume whose text cannot be read (an old `.doc`; a scan the scan reader gave up on) is only linked by hand. A resume that
  carries only an email or phone not on the sheet row (a personal address instead of the one HR noted) is not linked
  either; the panel's Attach fixes it. Matching is by exact key, so a candidate whose row has no email and no phone can
  only be attached by hand. Text reading runs ~20 s per cron minute plus a burst after each upload, so a few thousand
  files take a couple of hours to be read; the Resumes list shows "Reading soon" meanwhile. The Candidates tab does not
  show the Resume tag (it reads the plain `candidate_records` view); Search and the panel do.
- **Scanned resumes**: a scan is typed out by a model, so a poor photo or handwriting can come back with `[unclear]`
  words; an unclear email or phone means no automatic match (attach by hand). Scans over 6 pages are not read. The
  list does not mark which resumes were typed out from a scan (the row's `scan_model` does). The email and phone on a
  scan are sent to the model unmasked. About 3 scans a minute are read in the background, so a few hundred take a
  couple of hours. A kept "other document" opens and downloads but cannot be attached to a candidate yet.
- **Source folder**: a web page is told a folder's name, never its path on the disk, so the row shows "Downloads",
  not "C:\Users\…\Downloads". Keeping the folder needs the File System Access API: Chrome and Edge have it; Firefox
  and Safari do not; Brave ships with it switched off (`brave://flags`, "File System Access API"), and the page says
  so. Without it, and whenever no source folder is set, the ordinary folder window opens on every upload. **Downloads
  itself can never be the source folder** (the browser refuses it); only a folder inside it can. On a new visit the browser asks once whether the
  page may read the folder unless the person chose "Allow on every visit". The folder is remembered per browser
  profile, so each laptop chooses its own once.
- **View issues in the background**: the work runs in the browser tab. It goes on when the box is closed and while HR
  moves around the app, and stops if the tab is refreshed or closed (the browser asks first). What was already saved
  stays saved; AI suggestions not yet applied are lost with the tab and have to be asked for again. One job per sheet
  at a time. Surviving a closed browser would need a server-side job with its own table (not built).
- **Meaning search is off** (2026-11-12): every section of this document that describes embeddings, background
  indexing and the "Preparing" bar describes what happens only with `CANDIDATE_MEANING_INDEX=on`. Before turning it on
  for real use, give the embedding key a paid quota: the free one does not cover a 3,000-row sheet, and that key is
  shared with the HR Policy Assistant.
- **Uploading at volume**: the largest real run so far is 50 files from one laptop. Several people uploading
  thousands of files at once is designed for (files go straight to storage, duplicates are skipped, background runs
  claim their files in one step) but has not been run. Reading the details is the slow part: one model call per resume.
- **Suggested keywords**: a suggested term can be on no record (shown with 0). The counts arrive a moment after the
  terms; if that request fails the terms stay without numbers.
- **Redesign, second round**: a "worked out" total experience is the months the listed jobs cover, so it is too low
  when the resume leaves a job or its dates out, and a job with years only is counted from January to January. The
  "latest employer" may be one the person has since left. Both carry the mark, and Edit details corrects them. The
  quick view opens only on a row at least 1160 px wide. A resume from a design template can show its full text out
  of order (see the decision above).
- **Redesign, phase 1**: the candidate's workspace shows the resume's text, not its layout (see the decision above);
  "Open original" opens the file in a new tab. A keyword that matched only through word forms ("manage" for
  "managing") or only on the sheet row shows no resume lines on its card. Export to Excel covers the ticked candidates
  on screen, not every match. Call, WhatsApp and Email are plain links: nothing is logged. The uploader's name is the
  profile's name, so files uploaded before under a different spelling of it start "since your last upload" afresh
  (harmless: stored files are skipped), and two people sharing one login count as one uploader. A folder cannot be
  dropped on the page, only files; "Review a folder" reads a folder.
- **Resumes, phase 3**: "since the last upload" goes by the laptop's typed name, so a renamed laptop starts from this
  year again (harmless: stored files are skipped). The remembered folder is per browser profile, and the browser asks
  "allow reading?" on each new visit; that cannot be avoided. Only PDF / Word files up to three folders deep are read.
- **Resumes, phase 1**: the upload needs the tab open; a closed tab or a dropped connection means running it again
  (files already there are skipped). Old `.doc` (Word 97) files and scanned PDFs are stored, but the installed readers
  (`unpdf`, `mammoth`) cannot read their text, so phase 2 will list them as "couldn't read". Storage space is the real
  limit (Supabase free 1 GB, Pro 100 GB). The Open link in the Excel goes through the portal, so it needs an HR login.
  **Download all (ZIP)** is built in the browser: on Chrome / Edge it streams to a file chosen first (one save dialog);
  elsewhere it arrives in parts of up to 500 MB. More than 65,000 files or 3.5 GB also splits into parts. The list's
  date filter hides files with no download date (a file whose laptop date could not be read), like the blank-field rule.
- The typing dropdown counts from up to 1,000 rows per column per keystroke, so its counts are a guide on very large
  organisations. Spellings are not merged beyond case: "Thane" and "Thane West" are listed separately.
- Saving a different model for keyword suggestions needs migration `20261106000002`; without it they run on the default.
- No skills data yet (the Excel has none): matching leans on role, designation, organisation and remarks. Resume
  parsing is the next big quality jump.
- Permanent delete and Clear all need migration `20261103000001`; before it is applied they answer "needs a database
  update first". No automatic retention purge (deleted items stay in Show deleted until someone deletes them for good).
- The import summary and *View issues* split problems into "needs review" and "fixed automatically" only for uploads
  made after this change; older uploads show every old issue as "needs review" (they can be fixed with AI or marked
  reviewed).
- A **Merge** is not one database transaction (it runs as several REST writes). If it fails midway, part of the rows
  may be saved and the sheet shows "Last merge failed"; re-uploading with Merge again is safe. Edits that change both
  person and record fields are likewise two writes.
- Rate limits use the repo's in-memory limiter (per server instance), so on serverless they are soft.
- Backups are whatever the Control Center sets (none by default). If every model fails, times out or refuses, the
  search degrades (text-only search or search order without a match %) and says so. Claude's server-side refusal fallback needs a newer SDK than the
  installed 0.82 (dependency upgrades are out of scope).
- Search can take longer on Claude Opus 5.5 than on a fast model (the route allows 120 s; each step has a time budget: 35 s to read the search, 60 s to rank).
- Embedding needs the provider's key (`GEMINI_API_KEY` by default, `JINA_API_KEY` with `EMBEDDING_PROVIDER=jina`) and
  migration `20261103000002`. Without them, sheets stay at "Preparing" and the logs say why; search still works with
  filters and keywords. A key out of quota or credit (429 / 402 / 403) only pauses the work.
- Gemini's free-tier limits are not published (an unofficial figure is ~1,000 requests a day). The worker sends 50
  records per call, 2 s apart, and pauses on a 429, so a large sheet may take a day or more to be fully prepared;
  filters and keywords work meanwhile. Jina goes 100 per call, 0.6 s apart.
- The cron needs `CRON_SECRET` in the Vercel environment (the route refuses calls without it) and a plan that runs
  per-minute crons (the project already has several).
