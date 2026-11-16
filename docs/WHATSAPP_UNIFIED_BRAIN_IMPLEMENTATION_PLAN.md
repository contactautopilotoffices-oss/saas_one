# One Brain: phase-by-phase implementation plan, for approval

**Status:** proposal. Nothing starts until the approval block at the end is signed off.
**Written:** 2026-11-13.
**Architecture:** [WHATSAPP_UNIFIED_BRAIN_PLAN.md](WHATSAPP_UNIFIED_BRAIN_PLAN.md) (the design, guardrails G1 to G13,
memory, cost, decisions D1 to D11, and the Agent Spec Block in its section 12). This document says *what gets
built, in what order, by whom, and how each step is proven* before the next one starts.
**Doctrine:** [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md). The brain is one agent with one Spec Block (architecture plan,
section 12); it is copied verbatim into the header of the loop module when that file is created. Each phase below
names the laws it follows and the ones it knowingly breaks. Lifecycle follows [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md):
draft → shadow → live, enforced by the registry API, never skipped.

---

## Owner decisions of 2026-11-13 and 2026-11-14 (these override the sections below where they differ)

- **Three days, one deployment.** Everything is built first and deployed once, switched off. The week-by-week
  phases below become three build stages: (1) the brain core, offline; (2) channels, database and photo intake;
  (3) the Brain Console and the eval tools. The two-week shadow happens after deployment, for the pilot, not before.
- **Pilot:** the Tech team.
- **No WhatsApp message from any test.** Tests use a fake sender; the real sender refuses to run inside a test.
  A real send, if ever needed, goes only to the owner and only after asking.
- **Roles:** staff, clients (tenant, super tenant) and vendors each get only what their login allows, checked
  again at the moment an action runs.
- **Models are configurable:** Tech dashboard → Brain → AI models (moved from the Control Center on 2026-11-15).
- **Tasks stay with the Task Manager's own assistant.** The brain shows the person's tasks and attaches files;
  everything else about tasks is handed to that assistant unchanged.
- **No webhook secret** (the owner's decision of 2026-11-04 stands). D1 is withdrawn.
- **Default model order:** Claude Opus 5.5, then Sonnet 5.5, then Haiku 5.5, then GLM 5.3 Flash.
- **Two Claude keys for the brain only** (`CLAUDE_API_KEY`, `CLAUDE_API_KEY_2`); the task bot keeps its one key.
- **Recall of past actions uses keyword search**, not vector search, in this build.
- **Later phase (owner 2026-11-14): every model used anywhere in the application becomes configurable from the Tech
  dashboard**, the same way the Control Center's "AI models" screen works today for the Task Manager, Candidate
  Search and the brain. Not part of the three build stages below; `task-manager/ai/aiInventory.ts` already lists
  where each model is hard-coded and is the starting point.
- **The Brain Console is for the Tech team only:** a new tab in the Tech dashboard sidebar, not a page for org
  super admins.
- **The console never shows who a person is (owner 2026-11-14).** Messages and what the brain did with them are
  shown; names, phone numbers and user ids are not. Showing identity counts as a privacy violation.

### Build log

| Stage | Status | What exists |
|---|---|---|
| 1. Brain core, offline | **Built 2026-11-14.** 72 tests pass; typecheck and lint clean. Not connected to WhatsApp, the app or the database | `backend/lib/aiLayer/brain/`: settings and role rules, 17 skills, the turn loop, the grounding check, the thread, the Claude two-key pool and the backup-model adapter; `brain_turn` in the AI models catalog; migration `20261114000001` (not applied) |
| 2. Channels, database, photo intake | **Built 2026-11-14.** 196 AI-layer tests pass (101 of them new); an independent route review found no cross-organisation data path and its six failure-handling findings are fixed; typecheck and lint clean; a live check on Claude Haiku, Sonnet and Opus 5.5 answered all 9 cases. Switched off: nothing changes until the migrations are applied and an org is set to shadow or live | Migration `20261114000002` (seven `ai_brain_*` tables, not applied); `brain/server.ts` (real data, thread, staged files, trace); `brain/channels/` (photo intake, WhatsApp claimer, send guard); the claimer in the AiSensy webhook before the task importer; `app/api/brain/chat` and the in-app chat trying the brain first; `scripts/brain/smoke.ts` |
| 3. Brain Console (Tech dashboard tab), eval tools | **Built 2026-11-14.** 287 AI-layer tests pass (91 of them new); typecheck and lint clean; an independent route review found no cross-organisation path and its findings are fixed (see below). Test set of 56 messages scored on real models with fake data: 56/56 on Claude Haiku, Sonnet and Opus 5.5, 0 unsafe, reply quality 2.81 to 2.88 of 3 from a GLM grader (16 of 156 grades hand-checked by the coding assistant, 14 agreed; not yet checked by a person). Not verified: anything against the real database (migrations not applied), and the screens in a logged-in browser | Migration `20261114000003` (kind of login on a turn, `ai_brain_eval_cases`; not applied); `brain/console/` (what the screens read, anonymised) and `app/api/brain/console/` (three Tech-only routes); `frontend/components/brain/` and the "Brain" tab in `TechDashboard.tsx`; `brain/eval/` (test set, fixed scoring, grader rubric, last result) and `scripts/brain/eval.ts` |
| 4. Learning (owner 2026-11-14: "implement phase 4 safely") | **Built 2026-11-14, switched off.** Lessons, tested guidance, and the two older assistants' flagged messages in the Review screen (read only). 345 AI-layer tests pass (58 of them new); typecheck and lint clean; an independent review confirmed the access checks, the fake test world and the lesson handling, and its findings on the guidance test are fixed (below). Held back on purpose: nightly suggestions (they need real pilot data) and retiring the two old review screens (needs the owner's separate approval). Real-model safety run with fake data: the 56 test messages played with twelve lessons on hand, eight of them written to unlock something, plus a guidance note: 0 unsafe on Haiku, Sonnet and Opus 5.5; 55, 56 and 56 of 56 passed (the one miss asked an unneeded question before a booking card). Not verified: anything against the real database, and the guidance test from a logged-in browser | Migration `20261114000004` (`ai_brain_guidance`, `ai_brain_turns.learning`; not applied); `brain/learning/lessons.ts`; `brain/eval/gate.ts`, `run.ts`, `world.ts`; `brain/console/guidance.ts` and `app/api/brain/console/guidance`; the Guidance screen and the Learning card on Switches |
| 5. Every AI model configurable (owner 2026-11-15: "implement this safely, add it as a new tab in the brain tab, remove it from the control centre") | **Built 2026-11-15.** 19 more jobs can have their model chosen, on a new "AI models" screen in the Brain tab; the Control Centre's own "AI models" panel is removed. With nothing saved every job runs exactly the model it ran before. The model-settings test, 354 AI-layer tests, 342 HR and candidate tests, 19 invoice tests and 33 assistant-route tests pass; typecheck clean; an independent review found nothing of high severity and its findings are fixed (below). Not verified: a real save against the real database (migration not applied), any job on a model other than today's, and the screen in a logged-in browser | Migration `20261115000001` (allows the new job names; not applied); `task-manager/ai/aiCatalog.ts`, `AiModelSettings.ts`, `aiInventory.ts`; new `task-manager/ai/modelFor.ts` and `backend/lib/hr-assistant/modelChoice.ts`; 22 call sites; `frontend/components/brain/ModelsScreen.tsx` |
| 6. The rest of the learning loop (owner 2026-11-15) | **Built 2026-11-15, not rebuilt** (owner: "do not build"). One place to judge every assistant's mistakes: Brain → Review. The AI assistant's flagged messages can be taught or ignored there; the Task Manager's "Bot learning" panel moved there from the Control Centre and no longer sends who wrote a message to the screen. Guidance gains "Suggest words": one model call proposes a note from the answers judged wrong; it only fills the editor, and the note must still pass its test. 372 AI-layer tests pass (18 new); lint clean. Not verified: the screens in a browser (no rebuild), anything against the real database, a real-model suggestion | Migration `20261115000002` (`ai_brain_guidance_runs.kind`; not applied); `brain/console/suggest.ts` (with its Agent Spec Block); `judgeAiItem` in `brain/console/server.ts`; `reviewItemForScreen` in `task-manager/LearningLoop.ts`; Review and Guidance screens |
| 7. Tasks in the brain (owner 2026-11-15: "implement this safely … do not rebuild") | **Built 2026-11-15, switched off, not rebuilt.** The brain can add tasks (also for colleagues), mark them done, hand them over and send reminders itself, through the Task Manager's own checked functions, after the person's Yes to a card. Each of the four actions is off by default and goes off → test mode → live in the console, one at a time. While all four are off the brain's instructions and tool list are byte for byte as before. On WhatsApp the brain steps aside while the task assistant waits for that person's answer. Everything else about tasks (team progress, delete, rename, move) still goes to the task assistant. 389 AI-layer tests pass (17 new); typecheck and lint clean. Not verified: a real model on task messages (no task cases in the 56-message set yet), anything against the real database, the screens after a rebuild | `brain/skills/tasks.ts` (six skills, with its Agent Spec Block); task data functions in `brain/server.ts`; `SYSTEM_PROMPT_TASKS` in `loop/prompt.ts`; the step-aside rule in `channels/whatsapp.ts`; no migration |

**After stage 4 (owner 2026-11-14: no stage 5 as proposed; "just make the voice notes working for the overall bot"):**

- **Voice notes reach the brain.** The existing voice intake (`task-manager/voice/VoiceIntake.ts`, switch "Voice
  notes", off by default) turns a voice note into words. Those words are now offered to the Unified Brain first, as a
  typed message would be, with '🎙️ I heard: "…"' above its reply, so a spoken ticket or room request needs one Yes
  (the brain's card), not two. If the brain does not take them (off, not live for this person, a task request, an
  error) the Task Manager's Smart chat is offered them exactly as before, and failing that the "I heard … YES?"
  question remains. Unclear recordings still get that question first. Nothing changes for people the brain is not
  live for. Tested with fakes only: no real voice note or WhatsApp message was sent.
- The owner chose to keep voice transcripts of HR matters in the voice audit log, as that log does today.
- "Use these words as a new draft" is now also on the live guidance note.
- Dropped by the owner for now: new skills (visitors, reports, material requests), the skill builder, alerting a
  person, photo upload in the app chat, access per role in the console.

**How stage 6 is kept safe:**

- **A suggestion is only words in an editor.** Nothing is saved and nothing goes live; a person edits and saves a
  draft, and the draft must pass the 56-message test as before. Three a day per organisation, counted before the
  call. A suggestion that copies a person's words, names a phone number or email, or adds nothing is thrown away.
- **Not nightly.** A schedule is deployment configuration (`vercel.json`), which this work does not touch; a Tech
  member presses the button. A nightly run can be added by the owner later.
- **Judging the AI assistant's messages** uses that assistant's own answer check, inside this organisation only,
  and closes an item only if it is still open, so two reviewers cannot teach it twice.
- **The Task Manager's review screen no longer receives who wrote a message** (owner privacy rule): no phone, no
  WhatsApp id, no stored context; the sender's name is replaced by [name] in every text. The database rows, the
  summaries and the tests are unchanged. Known limit: a colleague named inside a message stays.
- **Left for the owner:** the AI assistant's own learning screen (Settings → AI access → Learning) is still there,
  because it belongs to org super admins and removing it changes who can teach. The Control Centre's "Bot learning"
  was Tech-only already, so moving it changed nobody's access.

**How stage 5 is kept safe:**

- **Each job keeps working out today's model itself** and hands it to one small helper. The helper swaps it only for
  a saved choice that is in the list, can do that kind of work (pictures, plain text), belongs to a provider that
  job's code can call, and has its key set. Anything else, including no table, a database error or a slow database
  (two seconds at most), gives today's model back.
- **A chosen model that fails costs one attempt.** The job is run once more on today's model, and the choice is
  rested for five minutes so one bad choice does not slow every request (review finding).
- **Twelve rows stay fixed, each with its reason on the screen:** the HR safety check (a different model could let
  an unsafe question through), HR policy search and candidate meaning search (their stored indexes were built with
  one model), call transcription (needs a time stamp per sentence), PI / invoice reading on Gemini, the comparison
  run of the WhatsApp bot, council personas and Ira reviewers (chosen per agent already), the council voice call
  and the Bolna voice agent (run inside those services), and the two separate programs (meeting agent, bug-fix
  orchestrator).
- **Stored labels name the model that really answered** (SOP photo scores, document and bill reading, the
  electricity explanation).
- **Open decision for the owner:** model choices are one set for the whole application, while the screen is open to
  the Tech role of any one organisation. With one Tech team today that is the same people; with a second
  organisation's Tech team it would not be. Left as it is: changing it is an access rule.
- **Known limits:** a chosen model that answers but answers badly is not detected (only failures are); the
  assistant-interpreter preview route and the cost page's price list do not know the new choices.

**How stage 4 is kept safe:**

- **Lessons are off until switched on** (Switches → Learning). A lesson is a turn a Tech member judged. It is shown
  to the model only for the same kind of login, only when it points at a skill that person already has, at most
  four at a time. The reviewer's note is never shown to the model.
- **A lesson is never a fact.** It is another person's message, so it is kept out of what the "nothing invented"
  check accepts, and a reply that repeats five of its words in a row is thrown away.
- **Lessons and guidance are words in the message, not tools.** Neither can add a skill, skip the confirmation
  card or widen what a login sees; those stay in code and are tested with hostile lessons.
- **Guidance goes live only through its test.** Every test message is played with and without the note on the
  real model with fake data; it passes only with nothing unsafe and no fewer passes. The server checks the stored
  result again at the moment of going live, against the words, the first model and the test set as they are then.
- **The test is bounded:** five tests a day per organisation, two dollars a test, a time budget per request, and
  none under the platform kill switch. Tests started are counted in their own log, so editing or discarding a
  draft does not give one back (review finding).
- **One step of a test at a time.** A step claims the draft before it spends anything and saves after every batch,
  each time only if nobody else has touched the draft. A second tab is refused, and an unsafe result can never be
  overwritten by a later pass from a stale copy (review finding).
- **Going live is all or nothing.** The draft is promoted only if it is still exactly the one that was checked; if
  not, the earlier note is put back and the message says what is in force (review finding).
- **The Task Manager's flagged messages carry no organisation**, so they are shown in the Review screen only while
  one organisation has a Tech team (review finding).
- **Known limits:** a reworded lesson is not caught by the repeat check (only the Tech team chooses lessons, and no
  name, number or reference from one can pass the "nothing invented" check); turning guidance off or on reaches
  other servers within about a minute; a model with no known price is bounded by the number of steps, not dollars.
- **Every turn records what was in view** (lesson ids, guidance version), so a wrong answer can be traced to it.
- **If learning cannot be loaded, the brain answers without it.**

**What the stage-3 test run and review changed in the brain itself (2026-11-14):**

- A question that named a date near today ("tomorrow, Thu 5 Nov") or a clock time in the other form ("15:00" for "3")
  was rejected as an invented fact and the person got "I couldn't put that answer together reliably". Dates within
  about a month back and two months ahead, and the same hour on the other clock, are now accepted; a far date, a
  count and a ticket number still have to come from a tool result.
- Choices the model made up on a question are dropped and the question is still asked (it used to be thrown away).
- Asking for a person now gets a plain "I can't connect you to a person here" with where to go. Nobody is alerted
  when the brain hands over to "human"; that is a known gap, not a feature.
- The same code-built answer from two look-ups is shown once.
- Privacy (owner rule, review finding): people from outside the Tech team can be in the audience five at a time or
  not at all, so a pilot of one cannot be used to see whose messages are being read. A test case loses its link to
  the turn it came from when that turn's words are cleared; its masked message is kept on purpose.
- Safety (review finding): an action skill cannot go from doing nothing to acting for real in one save, whether by
  its own switch or by the organisation's; access per role cannot be changed from the console yet.
- The change-log row is written before a settings save and removed if the save does not go through.

**The learning loop, as built:** flagged turns → a Tech reviewer marks right or wrong and what should have happened
→ the masked message becomes a test case (`scripts/brain/eval.ts --taught <orgId>`). It does not yet change the
prompt or the examples, and it does not yet include the Task Manager's or the AI assistant's review items; both are
the later phase.

## 0. How this plan works

**One phase, one branch, one approval.** Each phase is a branch named `feat/brain-phase-N`, a set of small PRs,
and a plain-language write-up at the end. Nothing in a phase is reachable by a user until a switch is turned on
by a person. Every phase ends with a gate, measured, before the next phase is approved.

**Rules I work under (CLAUDE.md), restated so the approval is informed:**

- I write migration files; a person applies them with the existing `scripts/apply_with_supabase.js`. I never run
  writes against the database.
- I never read, print or commit secrets. A person sets environment variables in Vercel and `.env.local`.
- I do not commit or push unless asked. Each PR is prepared; a person opens and merges it.
- I do not touch authentication, authorisation or permission logic except where this plan names it (Phase 0,
  identity for the brain path only) and approval of that phase is the explicit request.
- Existing tables are only added to. No legacy table is altered or dropped in Phases 0 to 4. Phase 5 removals
  are listed separately and need their own approval.
- Everything new lives under `backend/lib/aiLayer/` (brain), `app/api/brain/` (console API),
  `app/(dashboard)/[orgId]/brain/` and `frontend/components/brain/` (console UI), `tests/ai-layer/` and
  `scripts/brain/`. Existing files are modified only at the named insertion points.

**Rollback for every phase is the same:** switch OFF. Brain tables are additive and unused by the old chain, so
turning the switch off restores today's behaviour exactly. No data migration is reversed.

## 1. Phase map

| Phase | Weeks | Outcome a user can see | Gate to pass | Decisions it needs first |
|---|---|---|---|---|
| **0** Prerequisites and baseline | 1 | Nothing visible. Webhook signed, identity exact, both Claude keys working, golden set collected, numbers for today written down. Optional: caption-less photos stop getting lost | Golden set 200 labelled; baseline report; key 2 proven; secret enforced | D1, D2, D9, D11 |
| **1** Brain core in shadow | 2 to 3 | Nothing visible to users. The console shows what the brain *would* have done next to what the old chain did | Two weeks of shadow; section 9 gates met on the golden set; tier chosen | D3 (made at the end of this phase), D10 |
| **2** Brain first for the pilot | 1 | Pilot people get the brain: natural language across tasks, tickets, rooms; photos attached without re-sending; buttons; same assistant in the app | Two weeks live; apology, fallback-to-ticket and "send the photo again" rates below baseline; unsafe = 0 | D4, D7, D8 |
| **3** Long-term memory and learning | 2 | "Book my usual room", "what happened to my AC complaint from last week", "forget that"; fewer clarifying questions | Questions per completed request down against Phase 2; memory failure never blocks a turn | D5, D6 |
| **4** Breadth | 2 to 3 | Visitors, HR tickets, material requests, electricity, knowledge, team reports, voice notes, Hindi and Hinglish; admins compose simple skills in the console | Each module through shadow then live per org grid | none new |
| **5** Retire and expose | 1, after a quarter live | Old chain removed; skills exposed through MCP | Two weeks brain-only at or above the gates | separate approval |

The console (section 8) is built across Phases 1 to 4, each slice arriving when the team needs it to evaluate
that phase.

## 2. Phase 0: prerequisites and baseline

**Why first.** A tier-1 bot cannot sit behind an unsigned webhook or a fuzzy phone match (G1), cannot be
measured without a golden set (L2, L5), and cannot be budgeted without a working key pool (G8).

| # | Work package | Files | Human step |
|---|---|---|---|
| 0.1 | **Webhook secret (S1).** Verify the shared secret on the AiSensy webhook URL. Warn mode first (log a mismatch, still process), enforce after a few clean days | `app/api/webhooks/aisensy/route.ts` (one check at the top, behind `AISENSY_WEBHOOK_SECRET_MODE=warn\|enforce`) | Set the secret in Vercel; append it to the webhook URL in AiSensy; flip to enforce |
| 0.2 | **Exact identity (S3, S14).** One resolver: normalised E.164 phone → exactly one active membership; zero or several → refuse with the existing "contact your property manager" reply. Used by the brain path only; the legacy chain's lookup is not changed in this phase | new `backend/lib/aiLayer/identity.ts`; tests | Review the list of phones that match more than one person (report produced by 0.5) and clean them up in the app |
| 0.3 | **Claude key pool and spend ledger.** Second key name; empty-balance message treated as exhausted-until-cycle; active key = sooner cycle end; one switch per request, not round-robin; every response's `usage` priced and written | `task-manager/brain/llm.ts` (`BOT_ANTHROPIC_KEY_NAMES` gains `CLAUDE_API_KEY_2`); new `backend/lib/aiLayer/providers/claudePool.ts`; migration `ai_spend_ledger`; settings rows for the two cycle dates | Link each Max plan to its Console organisation; create a workspace named for the bot in each with a spend limit; create one key per workspace; set both env vars and both cycle dates |
| 0.4 | **Golden set collection.** Conversation memory on for the pilot group; export of real messages; labelling format (expected outcome, skill, args, language, tags: photo, injection, Hinglish); 200 cases, including 20 photo, 20 injection, 30 Hinglish | new `tests/ai-layer/golden/` (jsonl + README); `scripts/brain/export_candidates.mjs` (read-only) | Turn `conversationMemory` on for the pilot group in the Task Access panel; label the cases with me over two sessions |
| 0.5 | **Baseline report.** Route mix, fallback-to-ticket rate, menu rate, apology rate, duplicate-phone count, cost, from the inbound ledger, action log and bot health, for the last 30 days | `scripts/brain/baseline.mjs` (read-only); output `docs/brain/BASELINE_2026-11.md` | Read it; it is the number every later gate is measured against |
| 0.6 | **Rubric grader.** Gemini Flash (key exists), reasoning first, score 0 to 3, 5 percent manual audit list | new `backend/lib/aiLayer/eval/grader.ts`; tests with fixed cases | none |
| 0.7 | **Tool-call telemetry.** One row per tool call per run, under the existing run and step tables | migration `agent_run_tool_calls`; small extension to `backend/lib/agents/instrument.ts` | Apply the migration |
| 0.8 | **Photo stop-gap (optional, D11).** A caption-less photo is held in the existing session row for 30 minutes and attached to the next ticket the legacy flow creates | `backend/lib/whatsapp/processMessage.ts` (one hold, one attach); test | none |

**Tests.** `tests/ai-layer/identity.test.ts`, `providers/claudePool.test.ts` (rotation on 429, 401, 403, 5xx and on
the empty-balance 400, cycle switch, ledger rows), `eval/grader.test.ts`, `whatsapp-photo-stopgap.test.mjs`.
The key pool is also exercised once for real against a workspace whose spend limit is a few cents, to prove the
hand-over to key 2 happens.

**Gate.** Secret in enforce mode with no legitimate traffic rejected for three days. Zero duplicate-phone
memberships in the pilot group. Key 2 took over in the live test. Golden set of 200 labelled. Baseline report
written. Then Phase 1 is approved.

**Doctrine.** Follows L5 (measure before building), L6 (grader from a different family). Breaks nothing.

## 3. Phase 1: brain core, in shadow

**What exists at the end.** The webhook calls the brain *after* the inbound ledger and *before* the AI layer,
in shadow: the brain runs the full turn, writes the full trace and what it would have sent, and sends nothing.
The old chain answers exactly as today. The console shows the two side by side.

| # | Work package | Files |
|---|---|---|
| 1.1 | **Skill registry.** The `Skill` interface from the architecture plan, section 4; adapters that wrap existing catalog entries so nothing is re-implemented; modules: tasks (wraps the task brain's `DomainHandler` and `TaskGateway`), tickets (`tickets.mine`, `tickets.list`, `tickets.count`, `ticket.status`, `ticket.create`, `ticket.add_photo`), rooms (`rooms.availability`, `rooms.mine`, `room.book`), knowledge (`knowledge.search` over the org wiki), memory (thread only in this phase). Fixed sort, defer tail beyond 20, never-in-chat list | new `backend/lib/aiLayer/skills/{types,registry,handles}.ts`, `skills/{tasks,tickets,rooms,knowledge}/*.ts` |
| 1.2 | **Thread store.** One thread per membership; turns; pending ask or proposal with `op_id`; handles issued this thread; open attachments. Read by the brain path only; the four legacy stores are untouched | migrations `ai_threads`, `ai_thread_turns`, `ai_thread_attachments`; new `backend/lib/aiLayer/memory/thread.ts` |
| 1.3 | **The loop.** Anthropic SDK tool use: `tool_choice: auto`, `strict: true` schemas, adaptive thinking at effort `low`, frozen system prompt and tool list first so caching applies, `cache_read_input_tokens` logged per call, server-side refusal fallback on; at most 4 tool calls and 1 question; reads run in parallel when asked together; tool errors returned as text; final JSON outcome; a 60 s turn budget. Seven numbered prompt rules with the no-skip clause. OpenAI-compatible tool adapter for the Engy fallback | new `backend/lib/aiLayer/loop/{turn,policy,outcomes,prompt}.ts`, `providers/{anthropicTools,openaiTools}.ts` |
| 1.4 | **Policy step.** Strict args, zod re-parse, handles resolved, scope re-checked with the actor reloaded, grounding (`checkGrounding` reused), risk tier → confirmation rule, code-built card. In shadow the card is written to the trace, not sent | `loop/policy.ts`, `loop/cards.ts` |
| 1.5 | **Attachment intake and handles.** Download at the gate in deferred work, sniff bytes (reuse the sniffer), 10 MB cap, re-encode (reuse sharp settings), stage 24 h, row per file; handle list in the thread; image block to the model only on the arriving turn; Haiku one-line description stored on the row; `attachments` argument on `ticket.create`, `ticket.add_photo`, `task.create`, `task.progress`, `task.note` | new `backend/lib/aiLayer/channels/media.ts`; skill files above |
| 1.6 | **WhatsApp adapter and the shadow claimer.** Normalise inbound (text, media, button payload, quoted id, provider id); declared capabilities; `claimBrainShadow(input)` inserted in the webhook chain after the ledger and before `claimAiLayerWhatsApp`; runs inside `after()`; never changes the response or the route | new `channels/whatsapp.ts`, `whatsappBrain.ts`; one insertion in `app/api/webhooks/aisensy/route.ts` |
| 1.7 | **Tracing and registration.** `withAgentRun` with agent key `brain`, one run per turn, one step per model call and tool call, tool-call rows from 0.7, provider hops, tokens, cache hits, cost per key; the brain registered in `oem_agents` as `draft`, moved to `shadow` through the registry API | `loop/trace.ts`; registration script `scripts/brain/register.mjs` (prints the API call; a person runs it) |
| 1.8 | **Eval harness.** Runs the golden set against a tier or a route (Opus, Sonnet, Haiku, mixed), with the deterministic scorer (unsafe, missed question, wrong proposal), the rubric grader, tool-interaction scores (right skill, right args, call count) and efficiency (tokens, cost, latency); injection suite as a CI test; shadow diff export | `scripts/brain/eval.mjs`, `backend/lib/aiLayer/eval/{score,run}.ts`, `tests/ai-layer/injection.test.ts` |
| 1.9 | **Switch.** `brainShadow` added to `BOT_SWITCHES`, off by default, env override like the others | `task-manager/BotSwitches.ts` |
| 1.10 | **Brain Console v1** (section 8): Overview, Trace viewer, Shadow diff with one-click labelling into the golden set, Golden set manager, Eval runs and tier comparison, Switches and skill modes | `app/(dashboard)/[orgId]/brain/*`, `frontend/components/brain/*`, `app/api/brain/{runs,shadow,golden,eval,switches}/route.ts` |

**Model spend in this phase**, inside one month's included credit: golden set on all tiers about $35; two
weeks of shadow on Opus about $85 with a 10 percent sample on Sonnet. Phase 1 is the one time the brain runs
on Opus for every pilot message, because that is the most informative measurement and the month's credit
cannot be carried over.

**Tests.** Per skill: ten golden cases plus schema, `allowed`, and error-as-text tests. Loop: cap of 4,
single question, parallel reads, malformed tool input, refusal stop reason, provider hop, cache logging.
Policy: handle outside the thread, expired handle, scope changed between propose and confirm, grounding
failure, risk tiers. Media: sniff versus extension, oversize, re-encode, staging expiry, burst. Adapter:
normalisation fixtures from real AiSensy payloads (phone numbers masked). Shadow claimer: never changes the
route, never sends. Console API: role gating, no message text for excluded roles.

**Gate.** Shadow on pilot traffic for two weeks. On the golden set: unsafe 0, missed question 0, wrong proposal 0,
right skill at or above 95 percent, median 1 to 2 calls, overall at or above the task brain's current score on
its own cases. Shadow diff reviewed by a person: the brain's would-have-done is judged better or equal on the
weekly 30-reply read for both weeks. p50 under 6 s and p90 under 12 s in the trace. Tier chosen (D3) from the
comparison screen. Then Phase 2 is approved.

**Doctrine.** Follows L1 (workflow around a bounded agent step), L2 (shadow head-to-head), L3 (errors as text),
L4 (the path is judged, not just the answer), L5 (four axes), L8 (tool descriptions reviewed for when-not),
L10 (tier by false-positive cost), L12 (numbered prompt), L14 (full trace). Knowingly breaks L9 and L13 as
recorded in the Spec Block: skills in-process, no new framework.

## 4. Phase 2: brain first for the pilot

**What changes for a pilot user.** Their messages go to the brain first. Reads are answered directly; writes
arrive as a confirmation card with buttons; a photo sent before or after the words is attached without being
asked for again; the same assistant answers in the app on the same thread. Everyone outside the pilot sees no
change.

| # | Work package | Files |
|---|---|---|
| 2.1 | **Live claimer and fallback.** `claimBrain(input)` for people in the pilot list; the old chain runs only when the brain is unavailable or returns `handoff` with reason `outside skills`; the turn runs in the durable queue (`whatsapp_assistant_events`, new event kind) so a crash is retried; the never-silent watchdog covers brain turns | `whatsappBrain.ts`; `backend/lib/whatsapp/assistant/runtime.ts` (new kind); `task-manager/NeverSilentWatchdog.ts` (route label) |
| 2.2 | **Fast path and confirmations.** Yes, no, numbers, button payloads and exact commands resolved in code against the pending item; `op_id` per proposal; 10-minute cancel for tier 1; affected-person notice for tier 2; tier 3 returns a deep link to the app | `loop/fastPath.ts`, `loop/execute.ts` |
| 2.3 | **Execute through existing services.** `ticket.create` through the ticket path with `wa_assistant_request_id`; task writes through `TaskGateway`; `room.book` through the booking RPC; attachments finalised through the ticket photo path and `TaskAttachmentService`; staged rows marked consumed | skill `execute` functions; no new write path |
| 2.4 | **WhatsApp buttons (D8).** Interactive messages for asks and confirmations with up to 3 options; numbered list otherwise; button payload carries `op_id` | `backend/services/AiSensyService.ts` (one new send method) |
| 2.5 | **In-app chat on the same brain (D7).** The existing assistant chat posts to the brain with channel `app`; identity from the signed-in session; same thread as WhatsApp for the same membership | `frontend/components/ai-layer/AiAssistantChat.tsx` (endpoint), `app/api/brain/chat/route.ts`, `channels/app.ts` |
| 2.6 | **Retire the photo question for pilot people.** The task importer skips "task list or ticket?" when the brain is live for that person; the stop-gap from 0.8 is bypassed on the brain path | `task-manager/TaskImportInbound.ts` (one guard) |
| 2.7 | **Spend thresholds live.** Projected month-end spend across both keys; step down one tier when over; backups when both drained; weekly notice | `providers/claudePool.ts`, `backend/lib/aiLayer/settings.ts` |
| 2.8 | **Switch and pilot list.** `brainLive` switch; pilot memberships kept in the AI settings table with the existing per-person exception pattern | `task-manager/BotSwitches.ts`, `settings.ts` |
| 2.9 | **Brain Console v2:** Conversations (live threads, pending proposals, route taken), per-skill access grid and risk tiers, limits, model routing and fallback order display, keys and credit panel, pilot group editor, review queue linked to traces, alerts feed | console files as in 1.10 plus `app/api/brain/{threads,settings,credit,alerts}/route.ts` |

**Tests.** Fast path fixtures (yes in five languages, "2", button payload, stale `op_id`); double delivery runs
once; execute idempotency per skill; fallback when the brain is off, times out or declines; app and WhatsApp
sharing one thread; button rendering; threshold step-down.

**Gate.** Two weeks live for the pilot. Apology rate, fallback-to-ticket rate and "send the photo again"
replies below baseline. Unsafe actions 0 in the weekly read. No proposal executed without a confirmed `op_id`
(checked from the audit). Cache hit rate above 80 percent on the brain route. Then Phase 3 is approved.

**Doctrine.** Follows L1, L3, L11 (split by context: one brain, skills as data), L14. Same two known breaks.

## 5. Phase 3: long-term memory and learning

| # | Work package | Files |
|---|---|---|
| 3.1 | **Profile facts.** Closed key list; `memory.remember` rejects unknown keys and cross-scope keys; ask-once before a fact changes behaviour; source turn, confirmed by, last used on every row; 180 days unused expiry; offboarding purge | migration `ai_user_memory`; `memory/profile.ts`; skills `memory.remember`, `memory.forget`, `memory.what_do_you_know` |
| 3.2 | **Episodes.** Summary written when a thread closes (Haiku, async, off the hot path); pgvector embedding; `memory.recall` as a tool, used only when the person refers to the past; 90-day retention; HR and confidential threads never summarised | migration `ai_episodes` (pgvector); `memory/episodes.ts`; skill `memory.recall` |
| 3.3 | **Organisation memory.** Room names, nicknames, procedures from the org wiki and the Teach UI surfaced through `knowledge.search` with owner and expiry | `skills/knowledge` extension |
| 3.4 | **Learning loop wired to skills.** Review items, examples and prompt versions keyed by skill id; nightly auto-tune proposes, a person approves; cache-hit alerting | `backend/lib/aiLayer/learning.ts` (skill id), `app/api/cron/bot-autotune/route.ts` (reads brain traces) |
| 3.5 | **Memory failure isolation.** Any memory read or write error degrades to "no memory this turn" and is counted; never blocks a reply | `loop/turn.ts` |
| 3.6 | **Brain Console v3:** Memory screens (per person facts with edit and forget, organisation knowledge, episodes with retention), prompt versions with diff and approving eval run, teach integration, cost dashboards by org, module, skill, model and channel, cache hit rate | console files; `app/api/brain/{memory,prompts,cost}/route.ts` |

**Gate.** Clarifying questions per completed request down against Phase 2 for the pilot. A forced memory
outage in staging produces normal replies. "Forget that" verified end to end. Then Phase 4 is approved.

**Doctrine.** Follows L7 (memory only because the work repeats; scope-key rejection; measured by questions
removed), L6 (grader independent), L14.

## 6. Phase 4: breadth

| # | Work package | Files |
|---|---|---|
| 4.1 | **Modules.** Visitors (`visitors.today`, `visitors.find`, `visitor.invite`), HR ticket (`hr.my_tickets`, `hr.ticket.create`; Claude keys only, no backup provider, no memory), material request (`requests.mine`, `material.request`), electricity (`electricity.consumption`, meter reading write that exists), team reports (`reports.team`), knowledge FAQ | `skills/{visitors,hr,requests,electricity,reports}/*.ts` |
| 4.2 | **Voice notes.** The existing `VoiceIntake` transcript enters the same turn as text with an `A1 voice` handle | `channels/media.ts`, `task-manager/voice/VoiceIntake.ts` (hand-off point) |
| 4.3 | **Hindi and Hinglish.** Templates for every skill; one tone example per language; reply polish checked against facts | `backend/lib/aiLayer/language.ts` |
| 4.4 | **Mixed model route** if Phase 1 picked it: Opus for turns that read and propose, Haiku for the rest, decided by code before the first call | `loop/route.ts` |
| 4.5 | **Brain Console v4:** Skill builder for the no-code kinds (read over an existing query or report with allowed filters; write mapped to a registered service action; knowledge from a document), with description, when-not clause, examples, risk tier, roles, mode and golden cases; developer hand-off spec for the rest. Templates and languages editor. Channels panel. Playground | console files; `app/api/brain/{skills,templates,channels,playground}/route.ts` |

**Gate.** Each module through shadow on the golden cases written for it, then live per org grid. HR module
verified to never leave the Claude keys and never write memory. Then Phase 5 waits a quarter.

## 7. Phase 5: retire and expose (after a quarter live)

Separate approval, because it removes code: keyword `TaskMessageRouter` for chat (kept for commands if the
team wants them), the facility pilot, and the default-to-ticket fallback go behind one emergency switch for
two weeks, then are removed. The registry is exposed through the existing MCP catalog builder. Console gains
the audit export and the incident board polish. Gate: two weeks of brain-only traffic at or above every gate
above.

## 8. The Brain Console, slice by slice

| Area | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| Overview | counts, outcomes split, latency, cost today | credit per cycle, alerts | cache hit rate | |
| Skills | registry table, detail, modes | per-skill access grid, risk tiers | | builder, playground, templates |
| Configuration | switches | limits, routing, keys, pilot group, channels | | languages |
| Traces | turn viewer | conversations, pending proposals, attachments view | | |
| Shadow and eval | shadow diff with labelling, golden set manager, eval runs, tier comparison | release gates | | |
| Review and learning | | review queue linked to traces | teach, prompt versions, auto-tune approvals | |
| Memory | | | per person, organisation, episodes, retention | |
| Cost | | spend per key and cycle, projection | by org, module, skill, model, channel | |
| Alerts and incidents | | alerts feed, kill switch from the alert | incident board | |
| Audit | change log on every config write | | | export |

Access: org super admins and master admins. Message text, photos and HR content are shown only to roles the
privacy guardrail allows, and HR conversations are masked everywhere. Every configuration write is a versioned
row with revert. The console never runs a write skill directly and never lets a skill go draft to live.

## 9. Human-only steps, by phase

| Phase | Steps |
|---|---|
| 0 | Set the webhook secret and update the AiSensy URL; link both Max plans to Console organisations; create the two bot workspaces, spend limits and keys; set env vars and cycle dates; turn conversation memory on for the pilot group; apply three migrations; label the golden set with me; clean up duplicate phones |
| 1 | Apply three migrations; register the brain and move it to shadow through the registry; turn `brainShadow` on; read the weekly 30 replies; choose the tier |
| 2 | Apply no new migrations; set the pilot list; confirm AiSensy interactive messages on the current plan; turn `brainLive` on; read the weekly 30 replies |
| 3 | Apply two migrations (one enables pgvector if not already on); approve the first auto-tune proposals |
| 4 | Turn modules on per org in the grid; review new templates in Hindi and Hinglish |
| 5 | Approve removals; update the MCP client list |

## 10. Risks and what the plan does about them

| Risk | Mitigation |
|---|---|
| The brain is slower than the old chain | Reads in parallel, frozen prefix cached, effort low, 60 s budget; p50 and p90 are a Phase 1 gate, not a hope |
| Opus is the only tier that passes the gates and it does not fit $200 a month | The mixed route is scored in Phase 1 too; D9 decides purchased credit; the plan never assumes it |
| A wrong proposal slips through confirmation because the card is unclear | Cards are code-built from facts, tested per skill with fixtures, and read weekly; `title_source: photo` is marked on the card |
| Injection through ticket titles or wiki text | Data wrapping, link and length filter, injection suite in CI from Phase 1 |
| A photo is lost when the brain fails | Intake runs in code before the brain and even when the brain is off; staged 24 h |
| Memory remembers something wrong | Ask-once, provenance on the card, forget skill, admin edit, stale-fact replies scored as wrong proposals |
| Credit runs out mid-month | Projection and step-down in 2.7; backups and keyword bot never go away until Phase 5 |
| The pilot sees regressions | One switch back to the old chain; the old chain is untouched |

## 11. What approval of this plan authorises, and what it does not

Approving Phase 0 authorises me to: write the migration files named in section 2 (not apply them); add the
secret check in warn mode to the AiSensy webhook; add the identity resolver for the brain path; add the second
key name and the pool to the task brain's model module; write the golden set format, the export and baseline
scripts, the grader, and their tests; and, if D11 is yes, the photo stop-gap. Each later phase is approved on
its own after its gate.

It does not authorise commits, pushes, migrations, environment changes, or any change to production
configuration. Those remain a person's actions, listed in section 9.

## 12. Approval block

**Decisions** (defaults from the architecture plan; strike or change any):

| # | Decision | Default if unchanged |
|---|---|---|
| D1 | Enforce the webhook secret | Yes, warn then enforce |
| D2 | Pilot group | One Smart-chat department plus two property admins at one building |
| D3 | Model tier | Chosen at the end of Phase 1 from the comparison screen |
| D4 | Step-down rule | One tier down when projected month-end spend exceeds the credit |
| D5 | Memory consent and retention | Ask once; profile 180 days unused; episodes 90 days; forget always available |
| D6 | Providers per data class | Claude keys only for HR and confidential; backups allowed for tasks, tickets, rooms |
| D7 | In-app chat | Phase 2 |
| D8 | WhatsApp buttons | Yes, if the AiSensy plan supports interactive messages |
| D9 | Credit | Link both plans now; no purchased credit through Phase 2; revisit before Phase 4 |
| D10 | Photo alone | Propose a ticket when the fault is plain, card names the source; ask otherwise |
| D11 | Photo stop-gap in the legacy flow now | Yes |

**Phase approvals:**

- [ ] Phase 0 approved to start
- [ ] Phase 1 approved (after Phase 0 gate)
- [ ] Phase 2 approved (after Phase 1 gate and D3)
- [ ] Phase 3 approved (after Phase 2 gate)
- [ ] Phase 4 approved (after Phase 3 gate)
- [ ] Phase 5 approved (after a quarter live)
