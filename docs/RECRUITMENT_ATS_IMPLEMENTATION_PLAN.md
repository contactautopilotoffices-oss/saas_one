# Recruitment Module (ATS): Implementation Plan

**Sources:**
- *Recruitment Module – Workflow & Build Specification* (HR, 12 Nov 2026), the full target system
- *ATS tracking system (HR) Meeting* (12 Nov 2026: Roohi, Sanil, Lohitaksha, Sahil), which set the build order

**Branch:** `feat/hr-ats-update`
**Status:** 15 Nov 2026. **Scope narrowed:** we are *not* building the full spec yet. We are building only the **Priority Track** in §3. The full spec stays as the roadmap in §6.

**Progress (15 Nov 2026).** Built on the branch, not yet merged: search fixes (phrase matching, dropdown counts = search counts, `/` alternative groups, typed AND / OR / NOT, "matched in" tags); JD upload and the reader's skill groups and conflicts; migration `20261115000002` (positions, insert-only history, blacklist, "Others", `keep_as_resume`) — **to be applied by a person**; remarks, "Others" and blacklisting; the Pipeline tab per position; Needs attention actions; the screens rebuilt to the approved mockup (header row, Positions tab, JD strip, compact cards, one-column candidate panel with the inline status change, pipeline board, Needs attention rows and the resume library table). Details and decisions: `docs/features/candidate_search.md`, "Decisions (owner, 2026-11-15)". Still to do: the accuracy run on the three sample JDs (P1).

**Progress (16 Nov 2026).** P3 + P7 built on the branch: the **Calls** tab on the candidate's panel (upload a recording or paste a transcript, for a position, with the consent tick), migration `20261116000001` (`call_analyses` + the private bucket `candidate-calls`) and `20261116000002` (the two model jobs), the pipeline in `backend/lib/callInsights/` (Groq Whisper with time stamps → one structured Claude call → sentiment, interest, the mood over the call, concerns, red flags, the facts heard with quotes), "Apply" per fact onto the record (history: `field_edit` from the call; the reason for change as a remark), playback, retry, delete. **Both migrations and the bucket are to be applied by a person.** Agent spec: `docs/agents/call-insights-spec.md`. Not built: the P7 evaluation baseline.

**Outreach (16 Nov 2026, owner: "ok to send WhatsApp messages for this demo").** Built: the WhatsApp update to the candidate after Shortlisted / Rejected (the pipeline's prompt and the panel's "Send update"), two Meta templates to approve (`docs/whatsapp_templates_hr.md` §1b), migration `20261116000003` (`candidate_outreach` + the `outreach_sent` history action, to be applied by a person), the checks (blacklist, phone, once per position, role) and the history entry. Candidates only receive; the footer says not to reply. Hiring-manager and recruiter notifications stay in §6.

**16 Nov 2026, later.** Owner asks after the first look: the module marked **Beta**; a **"Search for"** dropdown in Search (a saved position with its JD, or a role people were sourced for); and **"already in the database"** (owner: keep and flag, sheets too, the source dropdown optional): a vendor's resume or sheet row for a person the team already had is kept, flagged on the file / row and in the person's history with where the copy came from and how the person was first sourced, with a filter and an export for vendor disputes. Migration `20261116000004` (to be applied by a person) also fixes the permanent deletes, which the insert-only history had been refusing. Details: `docs/features/candidate_search.md`.

**16 Nov 2026, the position as a job record.** Owner, after pasting a long JD: "only 3 parameters were extracted … this is definitely not how a tier 1 company would work"; the reader had in fact found 11, but a position was only a saved search, with nowhere for the job's own details. Built (owner: "go ahead with the create position form, no approvals for now"): the **Create / Edit position form** with the JD, the basics, the requirements and a summary, filled from the JD by two readers and checked by HR; migration `20261116000005` (to be applied by a person). "Search for" now lists only the positions created there. Requisition approval (§6 Phase 1) stays out for now.

---

## 1. What the meeting decided (and how it shapes this plan)

| Meeting point | Effect on this plan |
|---|---|
| Build phase by phase, **JD and database matching first** | P1 (accuracy) and P2 (JD upload) come first |
| Until IVR exists, **call on a normal phone and upload the recording** for transcription and sentiment | P3 + P7: upload-based call analysis now, IVR webhook later |
| **Every shortlist, reject or hold carries a remark** | P4: remark is mandatory on these actions |
| Offer accepted but did not join, or bad behaviour → **blacklist / do-not-contact, never in search again** | P6 |
| HR starts using internal search now and gives feedback | P1 adds an in-app "relevant / not relevant" signal so the feedback is captured as data |
| Repeated queries should not re-scan every CV; about $100/month goes on AI ranking | P1 measures cost and adds caching where it pays |
| Public "small Naukri" platform, IVR, MCP tracker sync, vendor logins | **Not in this track** (see §5) |

**Monday 16 Nov demo** (meeting task 1): *add a position → search the database → demo call → recording → sentiment → shortlist / not-shortlist outreach.*
Today only **search** and **paste a JD** exist. Adding a position needs P2, the call and sentiment steps need P3 and P7, and outreach is not in this track. The demo should show the current search and walk through this plan for the rest.

---

## 2. What already exists (reuse, don't rebuild)

| Area | Already in the repo | Where |
|---|---|---|
| Candidate database | `candidates` (one row per person, deduplicated by `phone_key` / `email_key`) + `candidate_applications` (one sourcing record per sheet row or hand entry: role, source, experience, notice, ₹/month in hand, `remark`, `status`) | `supabase/migrations/20261102000003_candidate_search.sql` and later `*candidate*` migrations |
| Sheet import | Excel/CSV import with row issues, Replace/Merge, AI fix, soft delete and restore | `app/api/candidates/sheets/*`, `backend/lib/candidates/import.ts` |
| Search | Filters (SQL) + keyword (FTS) + meaning (vector), combined with RRF; plain-English query → filters | `app/api/candidates/search`, `filter`, `backend/lib/candidates/search.ts` |
| Paste a JD | `POST /api/candidates/understand` turns JD text into filters for HR to edit | `app/api/candidates/understand/route.ts` |
| AI ranking | `POST /api/candidates/rank` scores and explains matches against `jobText` | `app/api/candidates/rank/route.ts`, `rerank.ts` |
| Search logging | `candidate_search_logs`: query, parsed spec, `result_ids`, timings per step | same migration |
| Resumes | Upload (SHA-256 dedupe), text extraction, scan, LLM field extraction, auto-link by email/phone, **manual attach / detach** (`PATCH /api/candidates/resumes/[id]`) | `app/api/candidates/resumes/*`, `backend/lib/candidates/resume-*.ts` |
| AI model choice | Per-job model chain chosen in the Control Center (`candidate_parse`, `candidate_rank`) | `backend/lib/candidates/models.ts` |
| Access | HR roles, org super admin, Tech, master admin (module-only check) | `backend/lib/candidates/access.ts`, `app/api/candidates/_lib/auth.ts` |
| UI | `CandidateSearchTab` (Search, Records, Sheets, Resumes views; `CandidateDetails` panel), mounted in the Tech dashboard and HR Tickets | `frontend/components/candidates/*` |
| Call transcription | OpenAI Whisper client with segment timestamps (used by CRM call coaching) | `backend/lib/coaching/whisper.ts`, `pipeline.ts` |
| Call analysis pattern | Transcript → structured facts with evidence quotes (SATEJ vendor calls) | `backend/lib/satej/prompts/callAnalyst.ts` |
| Agent tracing | `withAgentRun` (run/step telemetry, tokens, cost) | `backend/lib/agents/instrument.ts` |
| Tests | `tests/candidates/*.test.ts` | |

**Not there yet:** a blacklist or do-not-contact flag, a per-action remark history (only one `remark` field that gets overwritten), JD file upload, saved positions, recording or transcript upload for candidates, and sentiment analysis.

---

## 3. Priority Track

Build order is in §4. Each item lists **goal → reuse → build → rules → done when**.

### P1: Test query accuracy on the ~3,000 profiles

**Goal:** know, with numbers, how well real HR requirements find the right people. Then decide how to handle must-have skills when CVs don't contain the keyword.

**Reuse:** the existing search modes, `candidate_search_logs` (timings, result IDs), and the `rank` endpoint.

**Build:**
1. **Data-quality audit** (read-only script): the share of the ~3,000 records that have phone/email, skills, total and relevant experience, notice period, CTC, an attached resume, and extracted resume text. This explains *why* some searches miss.
2. **Gold set:** 20–30 real queries from HR's current and recent open positions. For each one, HR labels the top results as relevant or not, and names any "must-find" people they know are in the database.
3. **In-app feedback:** a 👍 / 👎 "relevant?" control on each result card, with an optional note. It is stored in a new `candidate_search_feedback` table (search_log_id, application_id, relevant, note, user, at). This captures HR's feedback as data and keeps the gold set growing.
4. **Eval script** (`scripts/candidates/eval-search.ts`, read-only): runs every gold query in four modes: *filters only*, *+ keyword*, *+ meaning (hybrid)*, and *+ AI rank*. It reports:
   - precision@10 and recall of must-find people
   - median latency
   - AI cost per query
5. **Must-have experiment:** compare a *hard filter* against a *strong boost* for must-have skills, with and without inferred skills (`candidates.inferred_fields`) and resume text.
6. **Caching:** cache AI-rank results by (normalised query spec + record-set version), so a repeated query costs nothing. Indexing already avoids re-reading CVs at search time.

**Output:** `docs/CANDIDATE_SEARCH_ACCURACY_REPORT.md` with the baseline numbers, the must-have decision, and the next fixes.

**Rules:** the eval and audit scripts only read the database (CLAUDE.md).

**Done when:** the baseline numbers are published, HR agrees a target (for example, at least 7 of the top 10 relevant on the gold set), and the must-have rule is chosen from data, not opinion.

---

### P2: JD upload option

**Goal:** HR uploads a JD file, the system turns it into editable filters, and HR searches and ranks the database against it. The JD is saved so it can be reused.

**Reuse:** resume text extraction (PDF/DOCX → text) from `backend/lib/candidates/resume-text.ts`; the `understand` endpoint (JD text → filters); the `rank` endpoint (`jobText`).

**Build:**
- **Data:** `candidate_positions`: a light "open position" holding its JD (title, department, location, `jd_text`, `jd_file_path`, `jd_file_name`, `filters` jsonb as last confirmed by HR, `status` open|closed, created_by, timestamps, `deleted_at`). The file goes in private storage, like resumes.
- **API:**
  - `POST /api/candidates/positions` (create with a file or pasted text)
  - `GET` (list)
  - `PATCH` (edit / close)
  - `POST /api/candidates/positions/[id]/search` (runs the saved filters, optionally with AI rank)
- **UI:** an "Upload JD" button next to the existing paste box. After upload: the parsed text, then the filters (editable), then the results. A **Positions** list in the tab to reopen a saved JD and re-run it.

**Rules:**
- The JD → filters step only *suggests*; HR confirms the filters.
- The size limit and file types (PDF, DOCX, TXT) match resume upload.
- If long JDs need a change to the `understand` prompt, that prompt change needs an Agent Spec Block (see [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md)).

**Done when:**
- A PDF and a DOCX JD each upload, parse, produce sensible filters and return results.
- The position is saved and can be re-run.
- Tests cover parsing and the positions API.

---

### P3: First outreach call by phone (record → upload → analyse)

**Goal:** the recruiter's first call to a candidate is captured and analysed automatically: transcript, summary, screening facts and sentiment.

**Now (no IVR):** the recruiter calls on a normal phone, records it, and uploads the recording from the candidate's panel. Optionally they link it to a position from P2.

**Later (IVR, meeting task 8):** the IVR provider posts each finished recording to a webhook, which feeds the same pipeline. Only the input changes.

**Build:**
- A **"Calls" section** in `CandidateDetails`: upload a recording (or a transcript, see P7), pick the position (optional), then see the analysis when it is ready.
- On upload, the system creates a P7 analysis with `subject_type = 'candidate'`.
- **Suggested field updates:** facts heard on the call (current CTC, expected CTC, notice period, location, reason for change) are shown next to the current values with an evidence quote. **HR clicks to apply each one. Nothing is overwritten automatically.**
- Every call is logged as a P4 action (`call_logged`).

**Rules:** **candidate consent to recording** (see open questions). Recordings are private, and only HR roles can play them.

**Done when:** a real recorded call uploads and the transcript, summary, sentiment and suggested facts appear on the candidate. Applying a fact updates the record and shows in the timeline.

---

### P4: Remarks on every action (per candidate)

**Goal:** every decision on a candidate carries a reason, and the full history is visible. Today a single `remark` field gets overwritten.

**Build:**
- **Data:** `candidate_actions`, which is **insert-only** (a trigger blocks UPDATE and DELETE). Fields:
  - `id`, `organization_id`, `candidate_id`
  - `application_id` (the record, if any), `position_id` (if any)
  - `action`: `status_change` · `shortlist` · `reject` · `hold` · `blacklist` · `unblacklist` · `resume_attached` · `resume_forced` · `call_logged` · `note`
  - `from_status`, `to_status`, `remark`, `meta` jsonb
  - `created_by`, `created_at`
- **API:** the status change (`PATCH /api/candidates/[id]`) writes an action row in the same request. A new `POST /api/candidates/[id]/actions` adds a plain note.
- **UI:**
  - Changing status opens a small dialog with a remark box.
  - A **History** timeline in `CandidateDetails` (who, what, when, remark).
  - The latest remark shows on the result card.

**Rules:**
- **The remark is mandatory for shortlist, reject, hold and blacklist** (meeting decision). The server rejects the change without one, not just the UI.
- The existing `remark` column stays as "latest note" for import compatibility.

**Done when:**
- Shortlist, reject and hold without a remark are refused by the API.
- With a remark, they are saved and appear in the timeline in order.
- Tests cover the remark rule and that the history cannot be edited.

---

### P5: Force-upload a resume for a candidate

**Goal:** HR can attach a resume to a specific candidate directly, even when the automatic email/phone match didn't link it or linked the wrong file.

**Reuse:** the existing upload flow and `PATCH /api/candidates/resumes/[id]` (attach / detach).

**Build:**
- An **"Upload resume"** button in the candidate's Resume section. It uploads the file through the existing path with a `candidateId` and attaches it straight away (`match_reason = 'manual'`), skipping auto-matching.
- **Conflicts:**
  - If the same file (by SHA-256) is already attached to *another* candidate, show who it is attached to and ask for confirmation before moving it.
  - If the candidate already has resumes, the new one is added as the latest version. **Older versions are kept.**
- Each attach writes a P4 action (`resume_forced`, with the file name and any previous owner in `meta`).

**Rules:** extraction runs as usual on the new file. Check during build that extraction **does not overwrite fields HR entered by hand**. If it does, show those values as suggestions instead.

**Done when:**
- A resume can be attached to a candidate who has no match.
- Moving a file from another candidate asks first and is logged.
- Old versions are still downloadable.

---

### P6: Candidate blacklisting

**Goal:** people who accepted an offer and didn't join, who behaved badly, or who asked not to be contacted **never appear in search again**, and the team can see why.

**Build:**
- **Data** (per person, on `candidates`, an additive migration): `blacklisted_at`, `blacklisted_by`, `blacklist_reason` (fixed list: *offer accepted, did not join* · *misconduct* · *false information / documents* · *asked not to be contacted* · *other*), and `blacklist_remark`. Unblacklisting clears the fields. Both actions are kept in `candidate_actions`.
- **Effects:**
  - **Hidden** from search, filters, AI rank, positions search and exports.
  - **Shown** in the Records view with a red badge, behind a "show blacklisted" toggle.
  - **Import and resume upload:** a sheet row or resume that matches a blacklisted person by phone or email is flagged in the import issues ("blacklisted: \<reason\>") instead of quietly bringing them back.
- **UI:** a "Blacklist" action in `CandidateDetails` (reason + mandatory remark), and an "Unblacklist" action (mandatory remark).

**Rules:**
- Blacklisting is per **person**, so it applies to all of that person's records.
- The remark must be factual (it is personal data about someone outside the company).
- Who may unblacklist is an open question.

**Done when:**
- A blacklisted person is missing from every search path, including AI rank and export.
- A re-import of their row is flagged.
- Unblacklisting restores them.
- Tests cover each search path.

---

### P7: Call sentiment analysis module ("Call Insights")

**Goal:** a reusable module. You upload a call **recording** or a call **transcript** (later an IVR posts it automatically) and get an interpretation of the other person's sentiment, plus a summary and key facts. Candidates are the first use (P3). The design allows other subjects later (for example BD calls).

**Inputs:**
- Audio (mp3, m4a, wav, ogg) → Whisper transcription, reusing `backend/lib/coaching/whisper.ts`
- A transcript as pasted text or a file (.txt, .docx, .vtt, .srt) → used as is
- Later: an IVR webhook delivering audio plus call metadata

**Output** (structured JSON; every judgement carries a short evidence quote from the transcript):

| Field | Meaning |
|---|---|
| `overall_sentiment` | positive · neutral · negative, with a confidence level |
| `interest_level` | high · medium · low (interest in the role / proposal) |
| `sentiment_timeline` | sentiment per segment, to show where the call turned |
| `concerns` | what the person worried about (salary, location, notice, shift…) |
| `red_flags` | concrete concerns only, each with a quote |
| `facts` | current CTC, expected CTC, notice period, location, reason for change. Each value is null when not said, never guessed |
| `summary` | 2–3 sentences a recruiter can read in 10 seconds |
| `suggested_next_step` | advisory text only |

**Build:**
- **Code:** `backend/lib/callInsights/`: `transcribe.ts` (wraps the existing Whisper client), `analyse.ts` (one structured LLM call per context), `contexts/candidateScreening.ts` (prompt and schema), and `pipeline.ts` (idempotent, wrapped in `withAgentRun` for tracing).
- **Data:** `call_analyses`. Fields:
  - `id`, `organization_id`
  - `subject_type` ('candidate'), `subject_id`, `position_id`
  - `input_kind` (audio | transcript), `storage_path`, `file_name`
  - `transcript_text`, `segments` jsonb
  - `status` (uploaded → transcribing → analysing → done | failed), `error`
  - `result` jsonb, `model`, `tokens_in`, `tokens_out`, `cost`
  - `created_by`, `created_at`, `deleted_at`
- **Storage:** a new private bucket for call audio. A person creates it, like other infra changes.
- **API:**
  - `POST /api/call-insights` (upload + start)
  - `GET /api/call-insights/[id]` (status + result)
  - `POST /api/call-insights/[id]/retry`
  - `GET /api/call-insights?subjectType=&subjectId=` (list)
- **UI:** the Calls section in `CandidateDetails` (P3) and a **Calls** view in the Candidate Search tab (all analyses, filters by sentiment and position, upload a transcript not yet linked to a candidate).
- **Model:** a new `call_analyse` job in the existing Control Center "AI models" chain, so the model can be changed without a release.

**Rules:**
- **Advisory only.** Sentiment never changes a candidate's status and never rejects anyone. A person decides (spec rule "Human decides").
- Facts are never invented. A missing value is null.
- Transcripts and audio are personal data: private storage, HR-only access, soft delete.
- Language: calls will often be Hindi/English mixed. Test transcription quality on real calls before relying on it.

**Done when:**
- An audio file and a pasted transcript both produce a result.
- Failures show a clear error and can be retried.
- The P7 evaluation below has a baseline.

#### Agent Spec: Call Insights (candidate screening)

**1. Workflow or agent?** Workflow. The pathway is known ahead of time (transcribe → analyse → store) and has few edge cases `[BAA p.104]`.
   Justification: N/A for an agent. The doctrine's default is a workflow `[BAA p.115]`.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists. Today recruiters only keep notes by hand.

**2. Context** `[BAA p.112]`
   It knows: one call transcript, the linked position's JD (if any), and that candidate's current record fields. It knows nothing about other candidates, nor about employees' salaries.

**3. Cost of a false positive** `[BAA p.112]`
   High. A wrong "negative / not interested" read can bias a recruiter against a real person. → Model tier: **larger** (via the `call_analyse` chain), because the output is shown next to a decision about a person. This is mitigated by evidence quotes and by a human making every decision.

**4. Tools**
   | tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | none: one structured-output call, no tool use | N/A | N/A (pipeline catches errors and stores `status = failed` + `error`) | input validated before the call `[BAA p.93]` | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes. Explicit no-skip clause: yes (the same style as `satej/prompts/callAnalyst.ts`).
   Single-shot tone example: one worked transcript → result. Terminal state written to data: `call_analyses.status = 'done'` with `result` `[BAA p.114]`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? No. Each call is independent. → No write tool.

**7. Multi-agent?** `[BAA p.116]`
   Single. Transcription is a non-LLM step. The one analysis prompt per context is tuned on its own, so changing the candidate prompt cannot regress another context.

**8. Evaluation: all four axes** `[BAA pp.118–119]`
   - **System:** Whisper and LLM latency and error rate from the run traces.
   - **Quality assurance:** 15–20 real calls labelled by HR (sentiment, interest, facts). A rubric grader from a different model family, mid-tier, scoring 0–3 with reasoning before the score, plus a manual audit of at least 10% `[BAA pp.96–98]`.
   - **Tool interaction:** N/A, no tools `[BAA p.95]`.
   - **Agent efficiency:** tokens and ₹ per analysed call, and audio minutes transcribed `[BAA p.119]`.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry: `withAgentRun` around the transcribe and analyse steps. Ad-hoc testing on about 10 real calls before HR uses it `[BAA p.116]`.

**10. Laws knowingly violated, and why:** none. L9 (MCP default) `[BAA pp.106–107]` does not apply yet, because no agent calls this as a tool. If the Brain or MCP needs it later, it gets exposed then.

---

## 4. Build order

| Step | Item | Why this order |
|---|---|---|
| 0 | **P1 audit + gold set** (starts now, alongside the rest) | Needs HR time to label; the numbers guide P2 |
| 1 | **P4** remarks / `candidate_actions` | P3, P5 and P6 all write into it |
| 2 | **P6** blacklisting | Small; touches every search path, so do it before more paths are added |
| 3 | **P5** force-upload resume | Small; builds on existing attach |
| 4 | **P2** JD upload + positions | Gives P1 and P3 a position to link to |
| 5 | **P7** Call Insights module | Self-contained; then wire it in |
| 6 | **P3** call upload on the candidate | Thin UI over P7 |
| 7 | **P1** eval run + accuracy report + caching | Run once P2 positions exist; report to HR |

Each step is one small PR with its migration file (rollback block included, **applied by a person**), tests, type check and lint.

---

## 5. Not in this track (from the meeting and the spec)

- Public candidate platform / reach campaign (meeting: later phase; budget question for Nirupam)
- Cloud IVR (meeting task 8: demos first; P3 is designed so IVR is only a new input)
- Connecting Zoho / Google Sheets / Excel trackers via MCP (meeting task 6)
- Candidate shortlist / reject notifications. The meeting wants polite rejections with feedback; the spec says these are sent manually from templates. Planned with §6 notifications.
- Vendor and hiring-manager logins
- Everything in §6

---

## 6. Later: the full specification roadmap

These become the next phases once the Priority Track is in use. P4, P6 and P7 are designed to fold into them: `candidate_actions` becomes the stage history, the blacklist becomes the spec's do-not-contact, and `call_analyses` feeds the screening stage.

| Phase | Contents |
|---|---|
| Phase 1 (spec "must have") | Requisition form, tracker and approval chain (HR Head → Director, no self-approval) · per-position pipeline board with stage events · interview scheduling and panel scorecards (blind until submitted) · offer approval, band variance, letter with placeholder check · automations A01–A22 and templates T01–T17 · recruitment roles and append-only audit log · dashboards Today / Roles / Funnel · the spec's 27 acceptance scenarios |
| Phase 2 | Calendar integration · Qandle write-back on joining · WhatsApp inbound · consultant login · source effectiveness and cost per hire · e-signature · A23 retention review, A24 on-hold chaser |
| Phase 3 | Candidate self-service portal · portal API resume pull · background verification · assessment tests · referral programme |

Design notes for when we get there:
- New pipeline tables use a `rec_` prefix (`rec_requisitions`, `rec_applications`, …). The existing `candidate_applications` means a *sourcing record*, not the spec's candidate-applies-to-requisition "application".
- Recruitment roles go in a module-only table, following the `backend/lib/candidates/access.ts` pattern. **This still needs explicit approval because it is access control.**
- Salary is stored as ₹/month in hand today. The spec uses annual CTC. Decide before offers are built.

---

## 7. Open questions for this track

| # | Question | For | Blocks |
|---|---|---|---|
| Q1 | Who labels the P1 gold set, and how many queries (20–30 suggested)? | HR (Roohi / Shwetha) | P1 |
| Q2 | Should must-have skills be a hard filter or a strong boost? (Decide from P1 data) | HR + Tech | P1 |
| Q3 | Is a remark mandatory only for shortlist / reject / hold / blacklist, or for every status change? | HR | P4 |
| Q4 | Who may blacklist, and who may unblacklist? Is the reason list above right? | HR Head | P6 |
| Q5 | Do candidates need to be told the call is recorded (script line / SMS)? How long are recordings kept? | HR + compliance | P3, P7 |
| Q6 | Which languages are calls in? Are recordings from the phone's built-in recorder good enough? | HR | P7 |
| Q7 | Is the OpenAI key used for CRM coaching approved for candidate call audio too? | Tech | P7 |
| Q8 | Does a shortlist belong to a position (needs a candidate-position link) or stay a status on the record, as today? | HR | P2, P4 |
| Q9 | When will the CSV of numbers that failed to go through be shared? Is Shwetha required to fill the standard tracker? (From the meeting) | HR | — |

---

## 8. Working rules

- Small PRs, one per step in §4, from `feat/hr-ats-update` or its sub-branches. No commits or pushes without being asked.
- Migrations are **additive** files with a rollback block, applied by a person. Scripts against real data are **read-only**.
- Existing Candidate Search behaviour, auth and roles are unchanged, except where an item above says so explicitly.
- Every AI step stays advisory and is traced. A prompt change to an existing AI job (`candidate_parse`, `candidate_rank`) needs its own Agent Spec Block.
- Type check, lint and `tests/candidates` must pass on every step; results are reported as they are.
