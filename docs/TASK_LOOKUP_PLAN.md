# Flexible "look up tasks" — plan (2026-10-13) — BUILT 2026-10-13, uncommitted

Follows [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md). Part of the WhatsApp Task Manager bot
([WHATSAPP_BOT_PRODUCTION_PLAN.md](WHATSAPP_BOT_PRODUCTION_PLAN.md)).

## 1. The problem

Every new kind of question ("my carry forward tasks", "what did I finish yesterday", "what did Saniel give me") needed its
own fix, because the bot can only answer a fixed list of questions. Changes are fine as they are: a fixed list, checked by
code, confirmed with YES. **Questions** should be flexible.

## 2. The idea

One new read-only ability, `find_tasks`. The AI does not write a database query. It fills in a **fixed form of filters**;
code checks every field, applies the permission rule, runs one safe query and writes the answer from the real rows.

## 3. The filters

| Filter | Values | Example question |
|---|---|---|
| **whose** | me · a person · several people · my team · a department · everyone (superuser) | "what's Vidya and Harsh doing today?" |
| **given by** | anyone · me (work I gave out) · a person | "what did Saniel give me?", "what have I assigned to Lohit?" |
| **days** | today · yesterday · tomorrow · this / last week · this / last month · last N days · a date · from–to | "tasks from last week" |
| **status** | any · open · not started · in progress · done | "what's in progress?" |
| **carried over / overdue** | yes · no · at least N days old | "anything pending for more than 3 days?" |
| **finished when** | a day or range (uses the finish time) | "what did I finish yesterday?" |
| **kind** | any · fixed daily task · one-off | "my fixed tasks" |
| **words** | up to 5 words that must appear in the title or details | "anything about AMC?", "the Mafatlal tasks" |
| **show as** | list · count only · by person · by department · by day | "how many did Lohit finish this week?" |
| **sort** | oldest first · newest first · by person | — |
| **limit** | up to 25 lines (then "…and N more") | "top 5 oldest pending" |

The existing questions ("my tasks", "my team", a department, company overview, carry-forward) keep working exactly as
they do; `find_tasks` takes everything else. Later, the old read paths can move onto it.

## 4. What the bot replies (examples)

- "What did I finish yesterday?" → `You finished 3 tasks on Mon, 12 Oct: • Submit EOD report • …`
- "How many tasks did Lohit finish this week?" → `Lohit has finished 4 of 6 tasks this week.`
- "Anything about AMC pending?" → `2 open tasks mention AMC: 1. Kone Lift AMC Renewal (from 10 Oct) …`
- "What's overdue in Procurement?" (superuser) → grouped by person, oldest first.
- Nothing found → "No matching tasks found." The filters used are NOT shown to the person (owner, 2026-10-13); they only
  guide the one-line intro the AI writes.

On the person's **own open tasks**, the real list numbers are shown, so "done 2" still works. Other people's lists and
past days use bullets, never numbers, so "done 3" can never point at someone else's task.

## 5. Safety

1. **Read-only.** No change of any kind can come from `find_tasks`. Changes stay on the existing path (checked, YES).
2. **No database commands from the AI.** It only fills the form. Code builds one fixed, parameterised query.
3. **Every field checked.** Fixed choices only; dates within 92 days; names resolved by code against the people this
   person may see (unknown or two matches → the bot asks); words: max 5, max 30 characters each, matched as plain text.
4. **Permissions.** The same rule as today: your own tasks; people you may give work to; superusers see every active
   department. A person or department outside that → a polite "you can't see that". Departments with the Task Manager
   OFF are never included.
5. **Facts from code only.** Titles, counts, names and dates are inserted from the rows. The AI writes one short intro and
   the existing checker stops it from inventing numbers or names.
6. **Bounded.** One query, at most 500 rows read, at most 25 lines shown. Time-limited; a slow or failed lookup becomes
   "I couldn't look that up just now", never silence.
7. **Logged.** The audit row records the filters used and the row count, never the message text.

## 6. How it is built (small steps)

1. `TaskDatabaseService.searchAssignments(filters, allowedEmployeeIds)` — one parameterised select (no raw SQL).
2. A `find_tasks` intent and its strict form validator in the tasks domain.
3. Answer formatting: list / count / grouped, numbering only for the person's own open tasks.
4. Prompt: one intent line plus two examples (in the fixed part, so a tuned prompt cannot drop it).
5. Tests: offline (validator, permissions, every filter, formatting, safety) and 40 new labelled questions in the eval set
   run against the real AI, so accuracy is measured, not guessed.

Nothing new to set up: no table, no migration, no new service, no new key.

## 7. Agent Spec Block (delta for this change)

**1. Workflow or agent?** Still a **workflow**: `find_tasks` is one more closed intent; the AI fills a fixed form `[BAA p.104]`.
**2. Context** No new data reaches the AI; lookup results are inserted by code after the decision `[BAA p.112]`.
**3. Cost of a false positive** Low-to-medium (a wrong list is shown, nothing changes). The filters are not printed (owner
choice, 2026-10-13); the AI's one-line intro still names what was looked up `[BAA p.112]`.
**4. Tools** `find_tasks` (read): when-not-to-use stated in its description (never for changes) `[BAA p.107]`; errors
returned as plain text `[BAA p.94]`; every argument validated and re-checked against permissions `[BAA p.93]`; no MCP
(closed list, direct call) `[BAA p.106]`.
**5. Prompt** One intent line plus two single-shot examples in the fixed part `[BAA pp.105, 114]`.
**8. Evaluation** Tool interaction: 40 labelled lookups, scored on the right filters (expected arguments) `[BAA p.95]`;
efficiency: one query per question, measured in the `steps` timings `[BAA p.119]`.
**10. Laws knowingly violated** None new.

## 8. Result (2026-10-13)

Built as planned: `brain/findTasks.ts` (form, dates, answer), `find_tasks` in the tasks domain (permission rule),
`TaskDatabaseService.searchAssignments` (one read-only select), `ExecIO.findTasks` (permission checked again, active
departments only). "my team" only while the Team reports switch is ON. `view_tasks` is now "today only"; other days go
to `find_tasks` (the real AI otherwise answered "tomorrow" with today's list).
- Offline: `test_find_tasks.ts` 36/36.
- Real AI, synthetic data: 40 lookup questions **40/40, unsafe 0** (two runs). Two cases were adjusted after the first
  run: #29 reworded (the original was ambiguous), #38 also accepts asking first (a similar task already exists).
- Real AI, the existing 140-case set: **136/140 (97.1 %), unsafe 0, wrong proposal 0**. Previous record 98.6 % (older
  prompt). Remaining: three safe "asked instead of acting" cases (vary run to run) and one deliberate change:
  "assign Vidya and Harsh a task to review quotes" now previews one task for each (one YES) instead of "only one person
  at a time" — **owner confirmed 2026-10-13**; eval case create-28 updated to expect it.
