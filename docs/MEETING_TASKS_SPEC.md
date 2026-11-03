# Meeting Notes → Tasks — plan and Agent Spec Block

Status: **APPROVED 2026-10-29. Built (offline-tested); not yet run on a real meeting.**
Doctrine: [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md) · Runbook: [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md)

## 1. What it does

A "Meetings" tab in the **Tech dashboard only**. The Tech team runs in-room meetings (Ops, Procurement, HR, Purchase…):

```
record on ONE phone ─▶ transcript (Sarvam; Whisper as backup) ─▶ AUDIO DELETED ─▶ one AI call writes summary, notes,
decisions, open questions and draft tasks ─▶ a Tech user edits each task and presses Send ─▶ the task lands in that
person's Task Manager list "from Autopilot", with the usual bell + WhatsApp alert
```

Owner decisions (2026-10-28/29): one phone only · meetings up to ~1 h, 3–10 people · attendees = anyone in the Task
Manager (all departments) **plus names typed by hand** · keep the transcript, **never the audio** · tasks are sent **from
Autopilot** and do **not** go through the Task Manager's assignment rules (no reporting chain, no department switches, no
accept/decline) · a person presses Send (per task, or "Send all ready") · RAG / search across meetings **later** ·
Sarvam (`SARVAM_API_KEY`) for speech, Claude Sonnet 5.5 for the notes.

## 2. Design

| Part | Rule |
|---|---|
| Access | **"Meeting Assistant"** (owner 2026-10-29) in three dashboards, each with its OWN meetings (`meeting_notes.workspace`): Tech console (role `tech`), HR console (`hr`, `hr_head`, `hr_manager`, `hr_ops`), Super Admin console (`org_super_admin`). Every API call goes through `requireMeetingSpace()` (`?space=tech|hr|admin`, role checked from the person's memberships) and `MeetingService.assertSpace()` (the meeting must be in that space). Inside a space meetings are shared; a **confidential** one is visible to its creator only. Recording actions (start/upload/finish/delete) are creator-only; anyone in the space who can see a meeting may rename it, edit and send its tasks, and send the notes on WhatsApp. |
| Recording | Browser `MediaRecorder`, mono, 24 kbps (≈ 11 MB/hour), 30-second pieces. Each piece is uploaded straight to the private `meeting-audio` bucket through a one-time signed upload link (`createSignedUploadUrl`), so no audio passes through our server on the way in. A failed upload waits and retries while the page is open. Screen kept awake (Wake Lock). Auto-stop at 115 min. Upload of a file from another recorder app (≤ 50 MB) is the fallback. |
| Restarts | Each continuous recording is its own folder (`s00`, `s01`, …). Pieces of one recording joined in order form one valid file; each folder becomes one file for the speech service (max 20). |
| Processing | No background job: the review screen polls `GET /meetings/[id]`, and each poll moves the meeting forward **one step** (`uploaded → transcribing → extracting → ready`). A 280-second lease on the row stops two polls running the same step (only the poll that holds it may release it). A step cut off by the platform 3 times in a row fails the meeting instead of retrying forever. Late results never overwrite a deleted or reset meeting. Route `maxDuration` 300 s. Deleting a meeting removes its transcript and notes too (sent tasks stay). |
| Speech → text | **Sarvam batch** (`saaras:v4`, mode `translit` = Roman script, language auto, diarization on, `num_speakers` = people present, names present as `keyterms`). Asynchronous: create → upload → start, then status on later polls. If Sarvam cannot start, fails, or takes > 40 min → **Groq Whisper** (`whisper-large-v3`, then `-turbo`; key `GROQ_VOICE_API_KEY`), no speaker labels. |
| Audio deleted | Immediately after the transcript is saved. A failed meeting keeps its audio up to 24 h so "Try again" can work, then it is deleted (sweep runs when the list is opened). Recordings left unfinished for 6 h are marked failed. |
| Notes + tasks | ONE call (no retrieval — an hour of talk fits in context): Claude Sonnet 5.5, backup `gpt-oss-120b` on Groq. See §5 for the prompt. |
| Checks on the AI reply | Owner must be an id from the PEOPLE list given to the model, else "choose someone" (a raw user id from the model is ignored). Typed names keep the name but cannot be sent to. Dates/times must be real. The quoted sentence is checked word for word against the transcript; a miss is shown on the card. Max 80 tasks. A cut-off or malformed reply moves to the backup model. |
| Send | Per task: claim the row `draft → sending` (so a task is never sent twice), `createTaskAssignment` with **no `assigned_by`**, description `"<note>\nFrom Autopilot — meeting "<title>" on <date>"`, `setTaskDue` if a due date was set, row → `sent` + `task_id`. Then ONE bell + ONE WhatsApp alert per person through the existing `sendTaskAssigned` (its kill switches / sandbox / Pretend Mode still apply), "Assigned by: Autopilot (meeting "…")". Audit row `meeting_task_sent` names the Tech user who pressed Send. |
| Errors | People see plain sentences (`MeetingError`); nothing internal is returned. Missing tables → "not set up yet" (503) until the migration is run. |

Files: `supabase/migrations/20261029100001_meeting_notes.sql` (tables `meeting_notes`, `meeting_note_tasks` — `meetings` is the Ira meeting room) + `20261029100002_meeting_notes_cleanup.sql` · `task-manager/meetings/{MeetingTranscriber,MeetingExtractor,MeetingService,visibility}.ts` ·
`app/api/task-manager/meetings/route.ts`, `…/[id]/route.ts`, `app/api/task-manager/_shared/meetingFail.ts` ·
`frontend/components/task-manager/meetings/{MeetingsTab,NewMeeting,MeetingRecorder,MeetingReview,api}.tsx|ts` ·
`frontend/components/dashboard/TechDashboard.tsx` (one tab added) · `task-manager/tests/test_meetings.ts`.

### Known limits (honest)

1. **Not yet measured on real audio.** Accuracy (tasks found, junk tasks, right owner) needs 5 recorded meetings with a hand-written answer key — the Phase 0 test in §8.
2. Processing only moves while someone has the meeting open (no background job, so no change to deployment config). Closing the page pauses it; opening it again continues.
3. A recorded piece that never uploaded before the tab was closed is lost (pieces are kept in memory, not on disk).
4. An "Autopilot" task has no human sender, so in the Task Manager it behaves like the person's own task (they can edit/delete it; nobody gets a "done" notice).
5. Sarvam's diarization is beta; speaker labels are voices, not names.
6. Sarvam and Anthropic (and Groq on fallback) process the meeting text/audio.

---

## Agent Spec — Meeting Notes → Tasks (record → transcribe → notes + draft tasks → human Send)

**1. Workflow or agent?**  **workflow** — fixed steps (record → transcribe → delete audio → one extraction call → human review → send); no tools, no loop, no model-chosen path. `[BAA p.104]`
   Justification (must be (a) or (b)) `[BAA p.115]`: **N/A — this is a workflow.** The path is fully known; the only open-ended part is one extraction call whose output a person reviews. `[BAA p.104]`
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: **no prior path exists** (tasks were typed by hand after meetings). Planned comparison on a fixed set (Phase 0, §8): Sarvam vs Whisper × Claude Sonnet 5.5 vs gpt-oss-120b on the same 5 meetings — accuracy __ | cost per 1-hour meeting __ | latency __ — **not yet measured**.

**2. Context** `[BAA p.112]`
   Knows: the transcript, the meeting title and date (+ the next 14 days for "by Friday"), and the PEOPLE list (present employees, typed names, everyone else in the Task Manager with department). Does **not** know anyone's existing tasks, phone numbers, reporting lines or permissions, and cannot send anything — sending is code after a human presses Send.

**3. Cost of a false positive** `[BAA p.112]`
   **low** (after the human gate) → model tier: **mid (Claude Sonnet 5.5)**, backup gpt-oss-120b. A wrong task reaches nobody until a person presses Send on that card. Mid tier rather than cheap because the input is long (≈ 15–20k tokens of noisy Hinglish speech with several voices) and the summary itself is read by people; the same choice Task Import made (TASK_BRAIN_SPEC 2026-10-27 b).

**4. Tools** — none are exposed to a model (no tool-calling). In-process steps:
   | step | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | `startSarvamJob` / `checkSarvamJob` | N/A — no model reads it | yes — typed `{ok:false, reason, detail}` / `{state:'failed'}`, never throws | mime/extension, file count ≤ 20, https-only result URLs | no |
   | `transcribeWithWhisper` | N/A | yes — typed result | mime, ≤ 25 MB per file | no |
   | `extractMeeting` | prompt step 6 says what is NOT a task (discussion, past work, ideas nobody took on) | throws only after every model failed → meeting "failed" with a plain message + "Try again" | `validateExtraction`: owner only from the PEOPLE ids, real dates, quote verified, ≤ 80 tasks | no |
   | `MeetingService.send` | N/A — runs only on a human click | yes — per-task `skipped[{why}]` | uuid ids, row claimed `draft→sending` once | no |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: **yes** (9 steps: read all → summary → notes → decisions → open questions → find action items → fill each field → copy exactly → JSON only).
   Explicit no-skip clause: **yes** (system: "Follow the numbered steps in order and do not skip any").
   Single-shot tone example: **no** — the output is JSON for code; one JSON shape example is given instead `[BAA p.114]`.
   Terminal state written to data: **yes** — `meeting_notes.status` ∈ `recording | uploaded | transcribing | extracting | ready | failed | discarded`; each task `draft | sending | sent | deleted`; audit rows `meeting_created`, `meeting_recorded`, `meeting_ready`, `meeting_task_sent`, `meeting_discarded`.
   The transcript is fenced and declared **data, never instructions** ("Ignore your rules…" spoken in a meeting is only something said).

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? **no** (every meeting is different) → **no write-tool**. Transcripts are stored records, not agent memory. Cross-meeting search (RAG) is deferred by the owner.

**7. Multi-agent?** `[BAA p.116]`
   **Single workflow**, separate from the Task Brain and Task Import, reason: *per-task model* (speech service + one extraction model). It shares no prompt with the brain; its only output into the Task Manager is `createTaskAssignment` after a human click, so a prompt change here cannot regress the WhatsApp bot.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: per-meeting `stt.provider`, Sarvam/Whisper failures (`stt.sarvamProblem`, `stt.problems`), `llm.failures`, status counts, processing time (created_at → ready) — recorded on the row. **Not yet aggregated.**
   Quality assurance (rubric: family **none yet**, tier **—**, scale **—**, manual audit **—**) `[BAA pp.96–98]`: **not built.** Phase 0: 5 Tech meetings with a hand-written task list → tasks found (recall), junk tasks (precision), right owner, right due date. In use: the reviewer's edits are measurable because each task keeps the AI's `original`.
   Tool interaction (expected set + order; measured call count) `[BAA p.95]`: fixed order Sarvam create → upload ×N → start → status ×k → download; or Whisper ×N; then 1 extraction call (2 with backup). Asserted in `test_meetings.ts`.
   Agent efficiency (tokens, steps, ₹/successful run) `[BAA p.119]`: `llm.tokensIn/tokensOut` stored per meeting; Sarvam per-minute cost and Claude cost per 1-hour meeting **to be measured in Phase 0** (prices checked from the providers' pages then, not quoted from memory).

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: **partial** — the meeting row holds each step's provider, model, tokens and failures; audit rows for create/record/ready/send. `startRun/step/finishRun` not wired. | Ad-hoc single-workflow testing before scale: **offline only so far** (`npx tsx task-manager/tests/test_meetings.ts`, fake Sarvam/Groq/AI); first real meeting on the Tech team is the next gate. `[BAA p.116]`

**10. Laws knowingly violated, and why:**
   - **L2 (A/B on a fixed case set):** no measurement yet — needs recorded meetings (Phase 0). Both providers and both models are wired so the comparison needs no code change.
   - **L5 / L6 (QA axis, rubric grader):** no rubric harness; the human review before Send is the quality gate for now. Revisit after Phase 0.
   - **L9 (MCP as tool transport):** the steps are in-process functions, not agent-facing tools.
   - **L14 (full traceability):** row fields + audit events, not step-level run telemetry; the workflow is short and fixed.
   - **Project stance, not a doctrine law:** tasks bypass the Task Manager's assignment rules and have no human sender — explicit owner decision 2026-10-29.
