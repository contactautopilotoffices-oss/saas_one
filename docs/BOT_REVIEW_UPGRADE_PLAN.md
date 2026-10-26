# Bot Review Upgrade — build plan

**Status:** Phases 1–4 built 2026-10-14 (uncommitted). The migration `20261014000001_whatsapp_bot_review_upgrade.sql`
is written but NOT applied; until a human applies it, the bot and the console keep the old behaviour.

**Built differently from the plan:**
- `TaskMessagingService.ts` did not need a change: the 10-minute "recent" row is written by `observeTurn` and the
  existing cleanup only removes `provisional` rows.
- A bare "no" / "nahi" while the bot is waiting for an answer is treated as an answer, not a correction.
- Undo works for Ignore and Send to developer (while New). An approved test isn't undone from the screen.
- The summariser's prompt lists what the bot can already do (in `BotReviewSummary.ts`). Update it when a feature is added.
**Date:** 2026-10-13
**Design preview (sample data):** https://claude.ai/artifact/Jj3PkXeJ373EJcnXMNjqLM

## What we are building, in one paragraph

Today, labelling a bot mistake means answering five browser pop-ups (intent, outcome, a JSON block, two yes/no
questions) while seeing only the user's message. After this work, the admin sees the **user's message, the bot's
reply and the user's next message**, an **AI summary in plain words** (what the user wanted, what the bot did, the
fix, and who can fix it), and taps **✅ Correct**, **✏️ Fix** (one sentence) or **Ignore**. Mistakes the bot cannot
learn by itself go to a **"Needs a developer"** list. The whole Bot learning area becomes **one collapsible section**,
like "Reporting chain", and the **Prompt versions** text becomes large and readable.

## What stays exactly the same

- The nightly tuning, the safety test and the "Activate / Reject / Roll back" flow.
- The test saved when you approve is the same kind of test as today (same fields, same checks in
  `validateReviewLabel`). The AI only fills it in; you approve it.
- Bot health numbers and alert recipients.
- Every switch stays OFF by default. With "Learning loop" OFF, nothing new is saved and no AI is called.
- No new cron job. No new library.

---

## Phase 1 — Capture the right messages (and the bot's reply)

**Problem today**
- The bot's reply is never saved, so the card can't show it.
- When the user corrects the bot ("no, I meant…"), the saved message is the *correction*, not the message the bot
  got wrong. The test it produces replays the wrong message.
- Quiet mistakes are missed: the user simply asks again, or says "wrong".

**Change**
1. Save the bot's reply text with each saved message (`observeTurn` already has the reply at
   [live.ts:289](../task-manager/brain/live.ts#L289); today it is not stored).
2. Keep the **last answered message per user for 10 minutes** (status `recent`) instead of deleting it straight
   away. Today `observeTurn` and `clearAnsweredObservations` delete it.
3. If the **next** message is a correction, a rephrase or "wrong", move that kept message (the one the bot got wrong)
   to the review list, and attach the user's next message as the "follow-up" shown on the card.
4. New triggers:
   - **Asked again:** same user, within 2 minutes, and most of the words match the previous message
     (simple word-overlap check in code, no AI).
   - **"wrong" / "galat"**: added to the existing correction words.
   - **👎 reaction**: dropped (owner, 2026-10-13: users won't send emojis; "wrong / galat" is enough).
5. The 10-minute `recent` rows are removed by the existing nightly purge (`purgeReviewItems`) once expired.

**Files:** `task-manager/LearningLoop.ts`, `task-manager/BotLearningService.ts`, `task-manager/brain/live.ts`
(one extra field passed), `task-manager/TaskMessagingService.ts` (cleanup call changes from "delete" to "keep for
10 minutes").

**Database change (a human runs it, I only write the file):** new migration that **adds** columns, nothing removed:
- `whatsapp_bot_review_items`: `bot_reply TEXT`, `follow_up JSONB` (next message text + time),
  `ai_summary JSONB`, `fix_owner TEXT` (`learn` / `developer`), `dev_state TEXT` (`new` / `in_progress` / `fixed`).
- Status list gets two new values: `recent` and `developer`.
- `whatsapp_bot_label_review` function: also accepts items in `developer` status (so a fixed developer case can
  become a test).
- `developer` items are **not** deleted after 30 days (the purge only removes `provisional`, `waiting`, `ignored`
  and expired `recent`).

**Privacy note:** the bot's reply holds task titles and names, the same kind of data the context snapshot already
keeps. Phone numbers are redacted the same way. Kept 30 days unless approved, like the message itself.

---

## Phase 2 — The AI summary ("AI guesses, you approve")

**What it does:** for each item in the review list, one AI call reads the conversation (message, bot reply,
follow-up), what the bot understood, and the context snapshot. It returns:
- three plain sentences: **what the user wanted**, **what the bot did**, **the fix**;
- **who can fix it**: `learn` or `developer`, with a one-sentence reason;
- the exact test fields (intent, outcome, expected details, safety flags), checked by the existing
  `validateReviewLabel` before anything is shown. If the right answer can't be written with the allowed fields, the
  AI must say so and mark it `developer`. That usually means the bot is missing something.

**When it runs:** when the admin opens a card (and the next card is fetched in the background), so we never pay for
items that get ignored or expire. The result is saved in `ai_summary`, so each item costs one call. ✏️ Fix sends
your sentence and makes one more call that rewrites the whole summary.

**Model:** Gemini first (a different model family from the live bot, the same choice as the nightly drafting),
falling back to `glm-5.3-flash`. The model that wrote each summary is recorded.

**Safety:**
- The user's message is treated as data, never as instructions (same wording as the nightly drafter).
- Nothing is saved as a test until the admin taps ✅.
- If the AI is down, the card still shows the conversation, plus a "Try again" button.

**API:** two new actions on the existing guarded route `app/api/task-manager/bot-learning/route.ts`:
`summarize` (create or rewrite the summary) and `send_to_developer`, plus `set_dev_state`. Same admin guard as today.
Approving a `learn` item uses the existing `label` action unchanged.

**New file:** `task-manager/BotReviewSummary.ts` (prompt + call + checks), reusing `brain/llm.ts`,
`brain/geminiLlm.ts` and `extractJson`.

### Agent Spec — Review summariser

**1. Workflow or agent?** Workflow: one structured LLM call per item, no tools, fixed path. `[BAA p.104]`
   Justification (b): an easy task where a single prompt saves real development time compared with hand-coding
   intent/scope rules for free text. `[BAA p.115]`
   Head-to-head vs. deterministic path `[BAA pp.94–95, 99]`: no prior automated path exists (today a human fills
   the form by hand). The comparison we will run: the AI's fields vs. the admin's final approved fields, measured
   as "approved without edit" %.

**2. Context** `[BAA p.112]`
   It knows the full failed exchange (message, reply, follow-up) and the replay snapshot. The live bot never sees
   the follow-up or its own reply when deciding.

**3. Cost of a false positive** `[BAA p.112]`
   Low → mid-tier model (Gemini flash, falling back to glm-5.3-flash), because a human approves every summary
   before it becomes a test.

**4. Tools** — none. `[BAA p.107]` Not applicable. Errors (bad JSON, failed validation, AI down) are caught and
   shown as text on the card, never thrown to the page. `[BAA p.94]` The output is checked with
   `validateReviewLabel`. `[BAA p.93]` MCP: not applicable, since there are no tools. `[BAA p.106]`

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes. Explicit no-skip clause: yes ("Follow these steps in order. Do not skip any.").
   One worked example (the carry-forward case) for tone: yes. Terminal state written to data: `ai_summary` saved
   on the item with the model name.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Partly (similar mistakes recur). No write tool for now; grouping similar mistakes is
   a later idea.

**7. Multi-agent?** `[BAA p.116]`
   Single, and kept separate from the nightly drafter and the live bot (different context, different reviewer:
   the admin). A change to this prompt cannot change the live bot's behaviour.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: AI failure count per day, shown in the card's "Try again" state and in the audit log.
   Quality assurance `[BAA pp.96–98]`: rubric family none, tier none, scale none. The admin reviews 100% of
   outputs before they are used, and "approved without edit" % is recorded.
   Tool interaction `[BAA p.95]`: not applicable (no tools).
   Agent efficiency `[BAA p.119]`: one call per item (two if ✏️ Fix is used); tokens and cost logged per call.

**9. Trace** `[BAA pp.119–120]`
   Each call is logged to the audit log (item id, model, tokens, ok/failed). Ad-hoc testing on saved sample items
   before switching on. `[BAA p.116]`

**10. Laws knowingly violated, and why:**
   L6: no separate grading LLM. Every output is approved by a human before use, which is stronger than a rubric
   for this volume.

---

## Phase 3 — The new review screen + "Needs a developer" + dropdown

**Where:** Task Manager testing console, the existing Bot learning area below **Task Access**
(`TaskManagerTestingDashboard.tsx` → `BotLearningPanel`).

**Layout change**
- The whole Bot learning area becomes **one collapsible card**, built the same way as "Reporting chain"
  (`OrgHierarchyPanel.tsx`): icon, title **"Bot learning"**, a short line underneath, and a **"Show bot learning"**
  / **"Hide"** button, plus **Refresh** when open. Data loads only when you open it, which saves a request on every
  console visit.
- Inside, at the top: **Bot health** and **Prompt versions** side by side. Below them, at full width: **Review**.
- Review has two tabs, **To review** and **Needs a developer**, matching the preview.

**To review tab:** list on the left, card on the right (stacked on a phone). Each card shows:
- why it was caught;
- the conversation in WhatsApp style (message and bot reply outlined, follow-up underneath);
- the AI summary (wanted / did / fix / who can fix it, with a one-tap switch);
- ✅ Correct (or "✅ Correct – send to developer"), ✏️ Fix, Ignore, Undo;
- a folded "Exact test (for developers)" section.

Older items saved before Phase 1 show "Reply not saved (older message)" in place of the bot bubble.

**Needs a developer tab:** each case shows the user's words, what they wanted, what the bot did, what to build or
change, who it came from and when, and a status: **New → In progress → Fixed**. Setting it to **Fixed** turns it
into a test the bot must pass, through the same database function as approving. The nightly tuning ignores cases
that aren't fixed yet.

**Files:** `frontend/components/task-manager/BotLearningPanel.tsx` (rewritten review part plus the collapsible
wrapper). The review UI may be split into `BotReviewSection.tsx` if the file gets too long. No change to
`TaskManagerTestingDashboard.tsx` beyond what's already there.

---

## Phase 4 — Readable Prompt versions

**Problem today:** "Text diff and scores" opens a tiny 10px box, 160px tall, that mixes the text changes with raw
JSON scores.

**Change**
- Each version shows as a row: **version, status pill, date, who drafted it** (Gemini / glm / admin), and the
  one-line change summary in normal-size text.
- **"View changes"** opens a large panel (nearly full width, normal 14px text, scrolls inside), with two tabs:
  - **What changed:** only the changed lines, **green = added, red = removed**, with 2 unchanged lines around each
    change for context, plus a "Show full text" toggle. Uses the existing `promptSectionDiff`, so the logic doesn't
    change.
  - **Test results:** a small table, before vs. after: overall pass rate, safety failures (must be 0), and each
    test group (English, Hinglish, team, live). Drops are shown in red. No raw JSON. The JSON stays in a folded
    "Raw data" section for developers.
- Activate / Reject buttons sit in that panel too, so you decide while reading. **Roll back** stays at the top of
  the section, with a plain-words confirm step built into the page (no browser pop-ups).

**Files:** `BotLearningPanel.tsx` (or a small `PromptVersionsSection.tsx`). No API or database change.

---

## Order, approvals and testing

| Phase | What you get | Database change | Stop for approval |
|---|---|---|---|
| 1 | Right messages + bot reply captured | Yes (one additive migration, run by a human) | ✅ |
| 2 | AI summary behind the scenes | No (uses Phase 1 columns) | ✅ |
| 3 | New review screen, developer list, dropdown | No | ✅ |
| 4 | Readable prompt versions | No | ✅ |

Phase 4 doesn't depend on the others and can be done first if you prefer.

**Testing (each phase):**
- Offline tests only, no live database writes. Older task-manager tests write to the live DB, so each is checked
  before it runs.
- Type check with extra memory.
- No `next build` unless you ask.
- You check the screens on localhost against the live DB by looking only, with the switches as you choose.
- No commits or deploys by me. You commit.

**Owner decisions (2026-10-13)**
1. 👎 reactions: not needed; "wrong / galat" is enough.
2. Any Task Manager admin (anyone who can open the control centre) can set a developer case to **Fixed**.
3. Updated preview (version 3, with the dropdown and readable prompt versions) must be approved before building.
