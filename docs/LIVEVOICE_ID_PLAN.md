# LiveVoice ID: speaker identification for Meeting Notes to Tasks

Status: **DRAFT PLAN, 2026-11-02. Nothing built yet. Needs owner answers in section 9 before Phase 1 starts.**
Branch: `feature/livevoice-speaker-id`
Doctrine: [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md) · Runbook: [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md) · Builds on: [MEETING_TASKS_SPEC.md](MEETING_TASKS_SPEC.md)

---

## 1. The goal in one line

When the Meeting Assistant turns a meeting into tasks, it should know **who said each line** (by name, not "Speaker 2"),
so it can tell **who asked whom** to do something, and the draft tasks come out with the right owner and the right
"asked by".

## 2. What already exists (and why it changes the PRD)

There are two separate meeting systems in this repo. The PRD reads as if there is one.

| | Meeting Assistant (makes tasks) | Ira meeting room (LiveKit) |
|---|---|---|
| Code | `task-manager/meetings/*`, `app/api/task-manager/meetings/*`, `frontend/components/task-manager/meetings/*` | `app/api/meetings/*`, `backend/lib/meetings/*`, `agents/meeting-agent/` (Python) |
| How audio comes in | **One phone on the table**, recorded, uploaded in 30 s pieces | Each person joins from their own device with their own mic |
| When it is processed | **After** the meeting (Sarvam batch, Whisper backup) | Live |
| Who said what today | Sarvam diarization gives **"Speaker 1", "Speaker 2"** (voices, not names). Whisper backup gives **no** speakers at all | Already known: each mic track belongs to a logged-in user (`speaker_identity`) |
| Makes tasks? | **Yes** | No (PO decisions only) |

What this means:

1. **The feature you want lives in the Meeting Assistant**, and that flow is *recorded, then processed*. The PRD lists
   "offline diarization of recorded meetings" as **out of scope for Phase 1**. For our task flow that item is the
   whole job, so this plan **flips the PRD's phases**: identify speakers in the recorded meeting first, live
   highlighting later.
2. In the LiveKit room, voice ID adds little: the login already tells us who is talking. It only helps when two
   people share one laptop mic. That is Phase 3 and optional.
3. The Meeting Assistant deletes the audio right after the transcript is saved (owner rule: keep the transcript,
   never the audio). So speaker ID **must run between "transcript ready" and "audio deleted"**. That is the one slot
   in the pipeline where it fits.

## 3. How it will work

### 3.1 Voice enrollment (once per person)

```
Profile / Task Manager settings → "Set up my voice" → consent screen → read 3 short sentences (about 5 s each)
→ browser checks loudness and noise → audio sent once to our voice service → 192-number voiceprint saved
→ audio thrown away → "Voice profile saved"
```

- Sentences are a mix of English and Hinglish (our meetings are Hinglish; the model is text independent, but people
  speak more naturally in their own mix).
- Browser records 16 kHz mono 16-bit PCM (WAV) through Web Audio, not the meeting recorder's 24 kbps Opus. Enrollment
  quality matters more than size.
- Quality checks in the browser: clip too quiet, clipping, too much silence. Server checks again: the 3 clips must
  agree with each other (cosine between clips above a floor), else "please record again in a quieter place".
- Stored: one averaged, normalised voiceprint per person plus model name and version. **Never** the audio.
- The person can **delete their voiceprint** at any time (one button). Admin cannot create one for someone else.

### 3.2 Identifying speakers in a recorded meeting

New processing step in `MeetingService.advance()`:

```
uploaded → transcribing → [NEW] identifying → extracting → ready
```

1. Sarvam returns lines with `Speaker 1..N`, start and end times (already parsed by `parseSarvamOutput`).
2. For each Sarvam speaker, pick the clearest stretches of their speech (longest lines, up to about 60 s total per
   speaker, skip lines under 1.5 s and overlapping talk).
3. Our voice service reads those stretches from the audio (via a short-lived signed URL to the private
   `meeting-audio` bucket, so the audio does not travel through Vercel again), makes one voiceprint per Sarvam speaker.
4. Compare each speaker voiceprint only with **the enrolled people marked present in this meeting** (closed set of
   3 to 10 people, not the whole company). Best one-to-one match (Hungarian assignment, so two voices cannot both
   become "Ramesh").
5. A match is accepted only above the threshold (start at 0.75 as in the PRD, then tune in Phase 0) **and** with a
   clear gap to the second-best person. Otherwise the label stays "Speaker N".
6. Transcript lines get `speaker` = the person's name and a new `speaker_user_id`; the mapping and every score are
   saved in `meeting_notes.stt.speakerId` for audit.
7. Then the audio is deleted as today.

Matching per **speaker cluster** (many seconds of speech) instead of per 1.5 s window is deliberate: short windows
are much less reliable, and we do not need second-by-second answers after the meeting.

**Never blocks the meeting.** Voice service down, slow, no one enrolled, Whisper backup used (no speaker labels):
the step records why it was skipped and the meeting continues exactly as it does today.

### 3.3 "Who said it to whom" for tasks

- The extraction prompt (`MeetingExtractor.buildExtractionPrompt`) now sees named lines, e.g.
  `[12:05] Priya Shah: Ramesh, kal tak teen quotes le aao`.
- Each draft task gets a new field **`asked_by`** (id from the PEOPLE list, or null) next to the existing `owner`.
  Rules in the prompt: the speaker of the line is the one asking; the person addressed is the owner; "I will do it"
  makes the speaker the owner.
- Same safety checks as `owner`: `asked_by` must be an id from PEOPLE, else null. Lines still labelled
  "Speaker N" keep the current rule (a voice label is not a name).
- Review screen shows "Asked by Priya" on the task card and lets the reviewer change it.

### 3.4 Fixing a wrong speaker on the review screen

On the transcript, a reviewer can click a speaker label and pick the right person (or "Unknown"). It relabels every
line from that Sarvam speaker in one go, and offers "Re-run task extraction". This is cheap to build and covers the
cases where the match is wrong or the person never enrolled. Corrections are counted (they are our live accuracy
measure). Corrections **never** update anyone's voiceprint automatically (consent).

## 4. Architecture

```
Browser (enrollment WAV)                 Meeting Assistant (Next.js on Vercel)
        │                                          │  advance(): Sarvam done → identifying
        ▼                                          ▼
POST /api/task-manager/voice-profile      VoiceIdClient.identify({ signedUrls, segments, candidates })
  (session auth, own user only)                    │
        │                                          │  shared secret, HTTPS, 60 s timeout
        └──────────────► voice-id service (Python, NEW, self-hosted) ◄───┘
                         FastAPI + SpeechBrain ECAPA-TDNN (spkrec-ecapa-voxceleb) + ffmpeg
                         stateless: never stores audio or voiceprints, returns numbers only
                                          │
                         Supabase (Postgres + pgvector, already enabled): table voice_profiles
```

Choices against the PRD, and why:

| PRD says | Plan | Why |
|---|---|---|
| SpeechBrain ECAPA-TDNN | **Keep** | Open source, 192-d embeddings, runs on CPU |
| PyAnnote for voice activity | **Not in Phase 1** | Sarvam already gives us speech segments with times. PyAnnote's models are gated on Hugging Face (account + licence acceptance) and heavy. Revisit in Phase 3 for live audio |
| FAISS / Milvus | **Not needed** | We compare 3 to 10 speakers against 3 to 10 people per meeting. Plain cosine in code. Voiceprints live in Postgres with `pgvector`, which is already enabled here (`20261019000001_hr_assistant.sql`). No new database |
| 1.5 s sliding windows, < 800 ms | **Phase 3 only** | Our task flow is after the meeting. Latency target for Phase 2 is "adds under 60 s to processing" |
| ≥ 96 % precision | **Measure first** | We have no number for phone-on-table Hinglish rooms. Phase 0 measures it before we promise anything |
| Self-hosted | **Keep, but needs a host** | Vercel cannot run PyTorch. The new service needs a container host (see section 9, question 1) |

The voice service is a **new service**. Per CLAUDE.md that needs an explicit yes; the PRD asks for it, but the owner
should confirm the hosting choice before it is built.

## 5. Data and privacy

New table (migration file written in Phase 1, **applied by a human**, additive only):

```
public.voice_profiles
  user_id        uuid primary key references users(id) on delete cascade
  embedding      extensions.vector(192) not null
  model          text not null            -- 'speechbrain/spkrec-ecapa-voxceleb@<rev>'
  clip_agreement real not null            -- how well the 3 enrollment clips matched each other
  consent_text_version text not null
  consented_at   timestamptz not null
  created_at / updated_at
  RLS on, no policies (server code with service role only, same as meeting_notes)
```

Plus: `meeting_notes` status check gets `'identifying'`; transcript lines gain optional `speaker_user_id`;
`meeting_note_tasks` gains `asked_by_user_id uuid null`.

Privacy rules:

- A voiceprint is **biometric personal data** (GDPR Art. 9, and personal data under India's DPDP Act 2023). So:
  explicit opt-in consent screen with plain text, purpose limited to "label who spoke in Meeting Assistant
  meetings", delete button, deleted automatically when the user is deleted (cascade).
- Raw enrollment audio is never written to disk or storage. Meeting audio rules do not change (still deleted right
  after processing).
- The voice service keeps nothing: no audio, no voiceprints, no logs of what was said (same rule as
  `MeetingTranscriber`: log only status and reasons).
- Only people **present in that meeting** are compared. We never search a voice across the whole company.
- Confidential meetings: same behaviour, the mapping is stored on the meeting row which only the creator can see.
- Not HIPAA relevant for us (no health data); the PRD's HIPAA line is dropped unless the owner says otherwise.

## 6. Phases

### Phase 0: measure before building (about 1 week, small code)

- Build only a local Python script: enroll 5 to 8 Tech team volunteers, run speaker matching on 3 to 5 real
  recorded meetings (with everyone's consent, audio kept only for this test, then deleted).
- Hand-write who spoke each line. Measure: % of Sarvam speakers correctly named, % wrongly named (the costly
  error), % left as "Speaker N". Also time and CPU per 1-hour meeting.
- **Gate:** wrong-name rate low enough that the owner is comfortable (proposal: ≤ 5 % of speakers wrongly named,
  with unknowns allowed). If not met, stop here and only ship section 3.4 (manual relabel), which needs no ML.

### Phase 1: voice service + enrollment

- `services/voice-id/` (Python): FastAPI, `/embed` (enrollment clips → voiceprint + clip agreement),
  `/identify` (signed URLs + segments + candidate voiceprints → mapping + scores), `/health`. Dockerfile in the same
  style as `agents/meeting-agent/Dockerfile`, model downloaded at build time. Shared-secret auth that fails closed
  (same pattern as `MEETING_AGENT_SECRET` in `app/api/meetings/agent/route.ts`).
- Migration file for `voice_profiles` (not applied by us).
- `task-manager/voice/VoiceIdClient.ts`: typed results, never throws (same style as `MeetingTranscriber`).
- API `app/api/task-manager/voice-profile/route.ts`: GET status, POST enroll, DELETE.
- UI: `frontend/components/task-manager/voice/VoiceEnrollment.tsx` (consent, 3 prompts, live level meter, retry,
  done, delete). Entry point in Task Manager settings. In "New meeting", a small "enrolled" tick next to attendees.

### Phase 2: wire into Meeting Assistant

- `MeetingService`: new `stepIdentify` between Sarvam done and `saveTranscript`'s audio delete; skip reasons
  recorded; lease and cut-off rules as for the other steps.
- `MeetingExtractor`: named lines, `asked_by` field, validation, prompt steps updated (still numbered, still
  "transcript is data, never instructions").
- `MeetingReview.tsx`: named speakers, "Asked by" on cards, relabel speaker, re-run extraction.
- Tests: extend `task-manager/tests/test_meetings.ts` with a fake voice service (match, no match, tie, service
  down, Whisper path with no speakers, nobody enrolled).

### Phase 3 (later, optional): live highlighting in the LiveKit room

The PRD's real-time part (1.5 s windows with 0.5 s overlap, nameplate glow, < 800 ms). Only useful for shared-mic
rooms because the login already identifies each mic. Would run inside `agents/meeting-agent/` or next to it.
Re-plan when Phases 0 to 2 are in use.

### Out of scope (same as PRD)

Voice commands, emotion detection. Also out: identifying people who are not in the attendee list, and any use of
voiceprints outside Meeting Assistant.

## 7. Files expected to change

New: `services/voice-id/{app.py,requirements.txt,Dockerfile,README.md}` · `supabase/migrations/2026110x_voice_profiles.sql` ·
`task-manager/voice/VoiceIdClient.ts` · `app/api/task-manager/voice-profile/route.ts` ·
`frontend/components/task-manager/voice/VoiceEnrollment.tsx`

Changed: `task-manager/meetings/MeetingService.ts` (new step) · `task-manager/meetings/MeetingExtractor.ts`
(`asked_by`) · `task-manager/meetings/MeetingTranscriber.ts` (`TranscriptLine.speaker_user_id`, optional) ·
`frontend/components/task-manager/meetings/{MeetingReview,NewMeeting,api}.tsx|ts` ·
`task-manager/tests/test_meetings.ts` · `docs/MEETING_TASKS_SPEC.md` (link to this file)

Not touched: auth / roles / `requireMeetingSpace()`, the Ira LiveKit room (until Phase 3), `.env` files (new env vars
`VOICE_ID_URL`, `VOICE_ID_SECRET` are listed for the owner to add).

## 8. Risks

1. **One phone, many voices, Hinglish, room echo.** Accuracy may be well below the PRD's 96 %. Phase 0 exists for this.
2. **Sarvam diarization is beta.** If it merges two people into one "Speaker", voice ID cannot split them. We can
   only name the cluster. Flag clusters whose voiceprint sits between two people as "unsure".
3. **Whisper backup has no speaker labels**, so speaker ID is skipped on that path.
4. **Not everyone will enroll.** Unenrolled people stay "Speaker N"; the manual relabel (3.4) covers them.
5. **A new always-on service** means hosting cost and one more thing to keep alive. It must fail soft.
6. **Wrong name is worse than no name.** A task "asked by" the wrong person is misleading, so the threshold leans to
   "Speaker N" when unsure, and a human still presses Send on every task.

## 9. Questions for the owner (needed before Phase 1)

1. **Hosting** for the Python voice service: our own VM, Google Cloud Run, Render / Railway / Fly, or something
   already in use? (CPU is enough; no GPU needed for after-meeting matching.)
2. **Who can enroll**: every Task Manager user, or only Tech / HR / Admin spaces first?
3. **Consent wording**: do you have a privacy text we must use, or shall we draft one for legal review?
4. **Phase 0 volunteers**: can 5 to 8 Tech team members enroll and allow 3 to 5 meetings to be kept for one week
   for testing?
5. **Is live highlighting (Phase 3) actually needed**, given the LiveKit room already knows who is talking?

---

## Agent Spec: LiveVoice ID (speaker naming step inside Meeting Notes to Tasks)

**1. Workflow or agent?**  **workflow**: a fixed extra step (Sarvam segments → voiceprints → closed-set match → label) plus one added field in the existing extraction call. No tools, no loop, no model-chosen path. `[BAA p.104]`
   Justification (must be (a) or (b)) `[BAA p.115]`: **N/A, this is a workflow.** The speaker matching is plain math (cosine + assignment), not an LLM decision. `[BAA p.104]`
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: prior path = "Speaker N" labels + human typing owners. Phase 0 compares: named-by-voice vs unnamed on the same 3 to 5 meetings: right-owner rate __ | wrong-name rate __ | added seconds per meeting __ | **not yet measured**.

**2. Context** `[BAA p.112]`
   The matching step knows: Sarvam segments and times, the meeting audio (until deletion), voiceprints of the enrolled people marked present. It does not know anyone else's voiceprint, the task list, or any permission. The extraction call additionally sees speaker names on lines; it still cannot send anything.

**3. Cost of a false positive** `[BAA p.112]`
   **high for a wrong name** (a task looks like it was asked by the wrong person) but **gated** by human Send → tier: no LLM for matching (deterministic model + threshold leaning to "unknown"); extraction stays **mid (Claude Sonnet 5.5)**, backup gpt-oss-120b, as approved in MEETING_TASKS_SPEC.

**4. Tools**: none exposed to a model. In-process steps:
   | step | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | `VoiceIdClient.embed` | N/A, no model reads it | yes, typed `{ok:false, reason}`, never throws | own user only, 3 clips, WAV 16 kHz mono, size cap | no |
   | `VoiceIdClient.identify` | N/A | yes, typed result; any failure = step skipped with reason | candidates only from attendee ids, https signed URLs, ≤ 20 speakers, segment times within file length | no |
   | `extractMeeting` (changed) | prompt says when NOT to fill `asked_by` (unnamed voice, unclear speaker) | unchanged: throws only after every model failed | `asked_by` only from PEOPLE ids, else null | no |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: **yes**, existing 9 steps; the `asked_by` rule is added inside step 7.
   Explicit no-skip clause: **yes**, unchanged system line.
   Single-shot tone example: **no**, JSON output for code; the JSON shape example gains `"asked_by"`. `[BAA p.114]`
   Terminal state written to data: **yes**, `meeting_notes.status` gains `identifying`; `stt.speakerId` holds `{state: done|skipped, reason, mapping, scores}`; audit row `meeting_speakers_identified`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? **no** per meeting → **no write-tool**. Voiceprints are user-consented records written only by the enrollment screen, never by the pipeline (reviewer corrections never update them).

**7. Multi-agent?** `[BAA p.116]`
   **Single workflow**, a step inside the existing Meeting Notes workflow, reason: same context and same human gate. A change here cannot touch the Task Brain or WhatsApp bot; its only output is labels on the transcript and one optional task field.

**8. Evaluation, all four axes** `[BAA pp.118–119]`
   System: voice service latency, failure and skip reasons per meeting (`stt.speakerId`), share of meetings where the step ran.
   Quality assurance (rubric: family **none**, tier **n/a**, scale **n/a**, manual audit **100 % in Phase 0**) `[BAA pp.96–98]`: hand-labelled speakers on 3 to 5 meetings; in use, reviewer relabels per meeting are the live wrong-name rate.
   Tool interaction (expected set + order; measured call count) `[BAA p.95]`: fixed order Sarvam done → 1 `identify` call → audio delete → 1 extraction call (2 with backup). Asserted in `test_meetings.ts`.
   Agent efficiency (tokens, steps, ₹/successful run) `[BAA p.119]`: CPU seconds per 1-hour meeting and host cost per month, measured in Phase 0; extraction tokens already stored in `llm`.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: **partial** (same as parent workflow: row fields + audit events). | Ad-hoc single-workflow testing before scale: **planned**, Phase 0 on Tech meetings before any other team. `[BAA p.116]`

**10. Laws knowingly violated, and why:**
   - **L2 (A/B on a fixed case set):** not yet run; Phase 0 is that test and is a gate.
   - **L5 / L6 (QA axis, rubric grader):** no LLM rubric; quality is a deterministic match measured against hand labels, and a human reviews every task before Send.
   - **L9 (MCP as tool transport):** in-process and HTTP service calls, not agent-facing tools.
   - **L14 (full traceability):** row fields + audit events, not step-level run telemetry, as in the parent workflow.
