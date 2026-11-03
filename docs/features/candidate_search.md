# Candidate Search

Owner request 2026-11-02. HR has ~3,000 candidate rows in Excel. They need to upload sheets, add / edit / delete
candidates in the portal, and search in plain English for the best top N (custom, max 30) for a role, with an
explanation per candidate. It is a tab in the **Tech console** for now (`frontend/components/dashboard/TechDashboard.tsx`).
Every HR login may use it: `hr`, `hr_head`, `hr_manager`, `hr_ops`, plus `org_super_admin`, `tech` and master admins
(`backend/lib/candidates/access.ts`).

## Decisions (owner, 2026-11-02)

| Question | Answer |
|---|---|
| Delete | Soft delete everywhere, restorable |
| Who can add / edit / delete | Every HR login |
| Re-uploading a sheet | Popup: **Replace** or **Merge** |
| "Same sheet" | Same file name, ignoring case and extension |
| Top N | Custom number, 1-30 |
| Salary columns | ₹ per month, in hand |
| `Role` column | The role the candidate was **sourced for** |

## Architecture

```
Excel / CSV ─► parse-sheet.ts (header matching, normalize.ts) ─► import.ts (dedupe by email / phone, new / replace / merge)
            ─► candidates (person) + candidate_applications (record) + candidate_sheet_rows (raw, audit)
            ─► indexing.ts (Gemini 768-dim embeddings, in the background)

Query ─► query-spec.ts (LLM → validated JSON: must / prefer / keywords)
      ─► hybrid_search_candidates() SQL: must-have filters → structured + keyword (FTS) + meaning (pgvector) → RRF
      ─► rerank.ts (LLM evidence-only scores + code-computed location / notice / salary) → top N
      ─► candidate_search_logs
```

- **One record = one retrieval unit** (one Excel row, never chunked). Its search text (`profile.ts`) holds no email,
  phone or salary.
- **Numbers are filtered in SQL, never by similarity.** A record missing a value that a must-have filters on is excluded.
- **Records vs people**: a person (deduplicated by valid email, then valid phone, per organisation) can have several
  records (sheets / roles). Name, contact, company, designation, location and total experience belong to the person;
  role, source, date, relevant experience, notice, salaries, remark and status belong to the record.
- **Replace** imports the new sheet first and soft-deletes the old one in the same transaction
  (`candidate_finish_sheet`), so a failed import never loses the old sheet. **Merge** updates the record with the same
  person + role in that sheet, adds the rest, and deletes nothing.
- Every step degrades instead of failing: no parse → text-only search with a warning; no embedding → filters +
  keywords; no rerank → search order without a match %.
- The models are picked in the **Control Center** (Tech login → Control Centre → AI models → "Candidate Search"), like the
  Task Manager's jobs (owner 2026-11-02): `candidate_parse` (reading the search) and `candidate_rank` (ranking
  candidates), each a main model plus up to 3 backups from any text model in the catalog (Claude, Engy, Groq, Gemini).
  Default: Claude Opus 5.5. Saved in `task_manager_ai_models` (needs `20261102000004_candidate_search_ai_models.sql`).
  `backend/lib/candidates/models.ts` runs the chain: Claude models through the official SDK with JSON-schema output and
  an effort setting (`CLAUDE_API_KEY`, the key the Control Center checks), other models through the Task Manager's
  shared transport. The next model is tried on an error, a timeout or a reply in the wrong shape, within a time budget
  per step. Which model answered is logged (`parse_model`, `rank_model`). Embeddings stay on Gemini (Claude has none).

## Files

| Area | Path |
|---|---|
| Migration (apply by hand) | `supabase/migrations/20261102000003_candidate_search.sql` |
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

## Known limits

- No skills data yet (the Excel has none): matching leans on role, designation, organisation and remarks. Resume
  parsing is the next big quality jump.
- Hard deletes / retention purge are not built (soft delete only).
- A **Merge** is not one database transaction (it runs as several REST writes). If it fails midway, part of the rows
  may be saved and the sheet shows "Last merge failed"; re-uploading with Merge again is safe. Edits that change both
  person and record fields are likewise two writes.
- Rate limits use the repo's in-memory limiter (per server instance), so on serverless they are soft.
- Backups are whatever the Control Center sets (none by default). If every model fails, times out or refuses, the
  search degrades (text-only search or search order without a match %) and says so. Claude's server-side refusal fallback needs a newer SDK than the
  installed 0.82 (dependency upgrades are out of scope).
- Search can take longer on Claude Opus 5.5 than on a fast model (the route allows 120 s; each step has a time budget: 35 s to read the search, 60 s to rank).
- Gemini embedding limits may pause indexing on a 3,000-row upload; "Index now" resumes it. Search works meanwhile.
