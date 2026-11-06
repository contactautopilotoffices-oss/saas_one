# Org Wiki

The org wiki is a set of pages compiled by code from Zoho POs and line items, the purchase@ digest and `docs/JOURNAL.md`. Super admins can ask it questions in the dashboard's Wiki tab, and each answer cites the pages it came from.

The design follows Karpathy's "LLM wiki" pattern:

- The raw sources are never edited.
- A compiled, interlinked wiki sits between the sources and the reader. The `overview` page is its index, and the `flags` page is the lint pass.
- Good answers are filed back as `note` pages, so questions compound over time.

The pattern has a model write the pages. Here, code writes them, because they are mostly figures that must be exact and the weekly refresh should cost nothing.

| File | Role |
|---|---|
| `compile.ts` | Sources → pages. `buildWiki` is pure; `loadWikiSources` is the only database read |
| `store.ts` | Upserts pages and prunes stale compiled pages; `fileNote` saves answers as notes |
| `ask.ts` | Retrieves pages, makes one model call, records the question |
| `access.ts` | Super admins only (org_super_admin, master_admin) |
| `supabase/migrations/20261016000001_org_wiki.sql` | `wiki_pages`, `wiki_questions`, `wiki_search()`, and the `wiki` agent row |

## Agent Spec — Wiki

**1. Workflow or agent?** Workflow. `[BAA p.104]`

- The path is known ahead of time: search, read the top pages, answer. There is nothing for an agent to work out, so neither justification (a) nor (b) applies `[BAA p.115]`.
- An agent would spend tokens fetching context that the workflow is simply handed `[BAA p.99]`.
- Head-to-head against a deterministic path `[BAA pp.94–95, 99]`: no prior path exists. The closest one, Ira's `questionFactSheet` in `respond.ts`, only covers PO numbers and vendor names, so the comparison has not been run.

**2. Context** `[BAA p.112]`

The wiki holds four things its neighbours don't:

- Every vendor, site and item page.
- The year-on-year medians.
- The purchase@ thread index.
- The development journal.

Ira only knows today's findings. Meera only knows one requirement.

**3. Cost of a false positive** `[BAA p.112]`

The cost is low. The answer is read by a super admin, every claim links to its page, and the system takes no action. Model tier: the fast tier, `deepseek-v4-flash-0731` on Engy, overridable with `WIKI_MODEL`.

Measured 2026-10-16 on the same real pages:

| Model | Time per answer | Cost per answer | Facts |
|---|---|---|---|
| Council default (a reasoning model) | 95–379 s | about $0.002–0.007 | Same |
| deepseek-v4-flash-0731 | about 3 s | about $0.0003 | Same, once the prompt was tightened |

**4. Tools**

There are none. The model makes no tool calls: retrieval runs before the call, and the model receives the pages.

| Tool | When-not-to-use reviewed? `[BAA p.107]` | Errors returned as text? `[BAA p.94]` | Args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
|---|---|---|---|---|
| (none) | N/A | N/A. A search or LLM failure is caught and recorded as status `failed` with the error text | Question is 3–500 chars, checked in the route | N/A |

**5. Prompt** `[BAA pp.105, 114]`

`WIKI_SYSTEM_PROMPT` in `ask.ts`:

- Numbered ordered steps: yes, 7 of them.
- Explicit no-skip clause: yes ("Follow these steps in order. Do not skip any.").
- Single-shot tone example: yes, marked as invented figures.
- Terminal state written to data: yes. Each question is written to a `wiki_questions` row with `status`, `retrieved` and `cited`. A reply that starts "NOT IN WIKI:" is stored as `not_found`.

**6. Memory** `[BAA pp.100–103]`

Does this workload repeat? Yes: the same vendors, items and monthly questions come up again. The write path is "Save to wiki", which files a `note` page. A person presses it; the model never writes to the wiki itself.

Scope-key rejection `[BAA p.101]`: the org comes from the access guard, not from the request body, and cited slugs are filtered to `^[a-z0-9/-]+$`. Retrieval does the heavy lifting at the start, and notes pay off only as they accumulate `[BAA p.103]`.

**7. Multi-agent?** `[BAA p.116]`

No. It is one prompt with one job, and nothing else depends on it, so a prompt change cannot regress another area. The compiler is code, so it shares no prompt with the answerer.

**8. Evaluation, all four axes** `[BAA pp.118–119]`

- **System:** each question records `latency_ms`. Rebuild runs are traced, with step timings.
- **Quality assurance:** no rubric yet `[BAA pp.96–98]`. Proposed: a 0–3 rubric from a different model family than the answerer (for example qwen grading a glm answer), with `reasoning` before `score`, run over 30 real questions, and 5% audited by hand. Until then, the only quality signals are the `not_found` and `failed` rates and the citation count per answer.
- **Tool interaction:** N/A, since there are no tools. The analogue is retrieval, and the retrieved slugs are logged per question `[BAA p.95]`.
- **Agent efficiency:** one call per question, about 6 pages, at most 9,000 characters per page. `cost_usd` is stored per question. A rebuild uses 0 tokens `[BAA p.119]`.

**9. Trace** `[BAA pp.119–120]`

- Run and step telemetry: `withAgentRun` with agent key `wiki` covers both rebuilds and questions.
- Ad-hoc testing before scale `[BAA p.116]`:
  - The compiler was dry-run on live data: 2,211 pages, 0 broken links.
  - Five questions were run live on real pages with in-memory retrieval: BVG spend, longest-pending POs, and an off-topic question that correctly came back "not in wiki".
  - The first prompt let the fast model copy page headers into its citations, and made it say "not in wiki" on partial answers. Both were fixed (header format, step 5) and re-tested.
  - `wiki_search` has not run, because the migration is unapplied.

**10. Laws knowingly violated, and why:**

- **L6 (rubric):** answers are not graded yet. This is the first follow-up, stated in item 8.
- **L2 (A/B against an existing path):** there is no equivalent existing path to compare against.
- **L9 (MCP default):** no tools, so there is nothing to put behind MCP.
