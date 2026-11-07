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
   AI suggested keywords ─► keyword-suggest.ts: model proposes terms ─► code keeps those found on the records
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
| Migration (apply by hand) | `supabase/migrations/20261102000003_candidate_search.sql`, then `…000004_candidate_search_ai_models.sql`, then `20261103000001_candidate_search_purge_and_ai_fix.sql`. `20261106000002_candidate_search_suggest_job.sql` is needed only to save a different model for keyword suggestions. `20261107000001_candidate_search_resume_fields.sql` adds the resume fields and the `candidate_filter_records` view (the resume filters stay greyed out without it) |
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
   Justification `[BAA p.115]`: the pathway is fixed (read keywords → propose terms → code checks them against the
   records → HR picks), so neither (a) nor (b) applies. One structured call; no tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: the deterministic path is the job titles beside the
   keyword on the records, and it runs when no model answers. No A/B yet: which of the two HR clicks more is not
   recorded, so L2 is listed below.

**2. Context** `[BAA p.112]`
   Only the keywords already in the search. A keyword that looks like a phone number or email is dropped first (search
   finds people by those). A typed name cannot be told from a skill, so it would be sent as a keyword.

**3. Cost of a false positive** `[BAA p.112]`
   Low: a wrong term is only an offer, HR chooses what to use, and code drops every term not found on a record. By L10
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
   Does this workload repeat? Yes (the same keywords recur), and an in-process cache answers repeats for an hour per
   organisation and keyword set, keeping only complete answers. That is a cache of results, not a learning store → no
   write tool `[BAA p.101]`.

**7. Multi-agent?** `[BAA p.116]` Its own Control Center job and prompt, apart from parse / rank / fix: different context
   and a different model tier (per-task model).

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: a server log line per call (terms kept, terms proposed, model, ms); the chain falls back on error, timeout or
   bad shape (`models.ts`), then to the records.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** A proxy exists by construction: the share of proposed
   terms found on the records (in the log). A rubric grader must be a non-Claude family (L6).
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
- Nothing fills the resume fields yet: there is no resume import and the edit form does not have them. Until one of those
  exists, those filters stay greyed out.
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
