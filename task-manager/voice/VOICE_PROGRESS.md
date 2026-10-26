# Voice notes — progress log

Plan and Agent Spec Block: [docs/VOICE_NOTE_INTAKE_PLAN.md](../../docs/VOICE_NOTE_INTAKE_PLAN.md).
Rule: after each phase, stop and wait for approval before the next one.

| Phase | What | Status |
|---|---|---|
| 1 | Speech to text (Groq Whisper) + tidy-up step, offline tests | Done 2026-10-09 — approved |
| 2 | Read voice notes from AiSensy, download, limits, pending store, failure replies | Done 2026-10-09 — approved |
| 3 | One YES: "I heard … → I'll do … YES?" through the brain; reads answered straight away | Done 2026-10-09 — approved |
| 4 | Webhook wiring behind `VOICE_NOTES_ENABLED` (OFF by default), audit rows, sandbox trial | Code done 2026-10-09; sandbox trial pending |
| 5 | Measuring: 20 real recordings, grader, raw vs tidy text | Done 2026-10-10 — Option C chosen |

---

## Phase 5 — done 2026-10-10

**In simple words:** your 20 recordings were run through the real pipeline (Groq Whisper, the tidy-up, a grader AI, and
the brain's understanding step). Full findings: [eval/results/2026-10-10-run1/FINDINGS.md](eval/results/2026-10-10-run1/FINDINGS.md).

- **English: perfect.** Every name, number and time kept, in all 5.
- **Hinglish: very good.** 97% of key details kept after tidy-up; no grade below 2.
- **Hindi: good but weakest.** 78%. Whisper itself mishears some Hindi words: "Pankaj" → "Pankar", "Somwar" → "सुम्मार", "audit" → "order".
- **Whisper writes Hindi in Devanagari half the time.** The tidy-up turns it into English letters, as you decided.
- **large-v3 beats turbo** (93% vs 89%), for about 60 ms more. Kept as first choice.
- **One tidy-up mistake:** it turned the misheard "सुम्मार" into "summary" (a real English word). A one-line prompt fix is proposed, not applied.
- **Surprise (honest):** the brain understands **raw Whisper (80%) better than tidy Roman text (67%)**. Perfectly typed Roman Hinglish also only gets 67%. So the gap is the brain's Hinglish understanding, not the voice pipeline. Decision needed (FINDINGS, last section).
- **Grader check:** I read all 40 grades myself and agree with 38 (95%).
- **Speed and cost:** ~1.1 s per note before the brain; tidy-up about $0.035 per 1,000 notes; Whisper inside Groq's free tier.

**Follow-up (same day):**
- **Your decision: Option C.** The brain keeps reading the tidy text.
- **The "write it as it sounds" rule** is now in the tidy-up prompt, as a general rule. The fallback AI follows it (it fixed "summary" → "Somvaar"). The main AI ignores it for that one word, and nothing else got worse. The "I heard" line still catches it.
- **New trial switch `VOICE_NOTES_ALLOWED_PHONES`:** only these numbers get voice notes. The live sandbox is OFF, and turning it ON would also limit Smart chat and Task Import for everyone.

**New files (manual tools, not part of the normal test run):** `eval/cases.ts`, `eval/metrics.ts`,
`eval/run_voice_eval.ts`, `eval/summarize.ts`; offline test `tests/test_voice_eval_metrics.ts` (16/16). The results
folder holds the transcripts of your recordings. Keep it local / out of git if they are private.

---

## Phase 4 — code done 2026-10-09

**In simple words:** voice notes are now connected to WhatsApp, behind a switch that is **OFF**. With the switch OFF, nothing changes for anyone.

**The webhook** (`app/api/webhooks/aisensy/route.ts`, +9 lines): voice is checked first.
- A voice note → answered "OK" to AiSensy at once; the transcribing happens straight after.
- A YES to "🎙️ I heard …" → carries on as the transcript text, exactly as if typed. It keeps the same project and time, so it takes the same route as the typed words would.
- Anything else → untouched.

**A review found three real problems. All three are fixed and tested:**
1. **A repeated YES.** When the webhook asks AiSensy to "try again" (it does that on some errors), the same YES arrived a second time with the note already used. The bare word "yes" then reached the brain, and could have confirmed a change the person never saw. Now each YES/NO is remembered by its message id for 10 minutes, and a repeat gets exactly the same answer.
2. **Sandbox.** While the Task Manager sandbox is ON, only the sandbox numbers get voice notes, the same as Smart chat and Task Import. Sandbox OFF → everyone the system recognises (your decision).
3. **Time limit.** The webhook has 120 seconds. The brain is now only tried if the note was ready within 30 s (it was 45 s). Otherwise the simple "I heard … YES?" goes out. Normal notes take a few seconds.

Also fixed: if the "I heard … YES?" message could not be sent (send gate blocked), no YES is waited for, so the person's next "yes" is not captured by mistake. Audit errors can no longer escape.

**Changed existing files:** the webhook route (+9 lines). Two existing webhook test files each got a "not a voice note" stub next to their other stubs, the same way `claimSmartChat` was added before, plus 3 new route tests.

**Tested (offline):**
- Voice: phase 1 46/46, phase 2 63/63, phase 3 29/29.
- Brain: core, shadow, smart chat live (69/69) all pass.
- Webhook route tests 23/23, task compatibility 7/7, and every other WhatsApp test file passes when run on its own.
- Type check (route + voice + brain) and lint → no errors.
- `npm run test:whatsapp` as one run fails on this PC. The cause is `whatsapp-interpreter-user-picker` needing a browser at `/usr/bin/chromium` (a Linux path). That crash takes the shared run down. It was like that before this work.

**Known limits (reviewed, not fixed):**
- Two copies of the same message arriving at the very same instant can both pass the read-then-write checks. The effect is a note transcribed twice, or a YES answered twice (both safe; the brain still asks before any change). Fixing it fully needs a database-side lock (a migration).
- For 10 minutes after "I heard … YES?", a bare yes/no from that phone is taken as the answer, even if it was meant for a reminder the bot sent in between.
- Any audio file (not only voice notes) is treated as a voice note.
- An unanswered note's text stays in its row after it expires (it is ignored, and the audit row keeps the text anyway).
- **Already like this before this work:** the webhook has no signature check, so a forged message with a known phone number could make the server download audio and spend Groq quota (capped at 20/hour/phone). Worth adding a shared secret with AiSensy.

**What you do for the sandbox trial:**
1. Add `GROQ_VOICE_API_KEY` (your Groq key) and `VOICE_NOTES_ENABLED=true` to the environment (local `.env.local` and/or the deployment).
2. Keep the sandbox ON, so only sandbox numbers are affected.
3. **Pretend Mode:** it is ON unless switched off in the Control Center. While ON, replies are only logged, not sent, so you would see nothing on the phone. Switch it off for the test numbers' trial, or watch the Pretend log.
4. Send a voice note from a sandbox number: a question, then a task change, then a Hindi or Hinglish one. Check the replies and the `voice_note` audit rows.

---

## Phase 3 — done 2026-10-09

**In simple words:** a voice note now needs **at most one YES**. Still not connected to the webhook (Phase 4).

- **A question** ("what are my tasks?") → answered straight away:
  > 🎙️ I heard: "Show my tasks."
  > *(the answer)*
- **A change** ("give Lohit a task to review the RFID rollout") → ONE message, ONE YES:
  > 🎙️ I heard: "Give Lohit a task to review the RFID rollout."
  > *(the brain's normal "is this right?" question)*
  The person checks the words and the action together. One "yes" does it. "no" cancels.
- **Not the brain's job, or not safe to skip the check** → the Phase 2 "🎙️ I heard … Reply YES" first. This happens when it's a room or ticket request, the AI is down, Smart chat is off for their department, a facility conversation is open, some words were unclear, or the tidy-up failed.

**The one existing file changed:** `task-manager/brain/live.ts` (+16 / −5 lines). The brain got one optional setting:
"put this line above your reply" (and note "via: voice" in the audit row). When the setting is not given, the brain behaves
exactly as before. Its decisions, prompts, permissions and confirm rules are untouched. The "I heard" line is not stored
in the brain's short memory.

**Tested (all offline — the real voice code and the real brain, with a fake AI, fake data, and a recorder instead of WhatsApp):**
- `npx tsx task-manager/tests/test_voice_phase3.ts` → **25 / 25 checks passed**, including the full journey "voice note → I heard + question → yes → task created", checked to need only one YES.
- Earlier tests rerun: voice phase 1 (46/46), voice phase 2 (53/53), and the brain's own suites (core, shadow, smart chat live) → all pass.
- Type check (voice files, `live.ts` and its tests) → no errors. Lint: voice files clean; `live.ts` has the same 3 old lint errors it had before, and no new ones.

**Not done / known limits:**
- Still not connected to the webhook (Phase 4).
- If the brain takes the note but writes no reply (rare, the same as for a typed message), the person sees nothing.
- **Seen, not fixed (outside this task):** the brain's own logs can quote part of a broken AI reply (for example `"I am a cha"... is not valid JSON`). This is the same leak fixed for voice in Phase 1. Worth a small separate fix.

---

## Phase 2 — done 2026-10-09

**In simple words:** the WhatsApp side of voice notes, in one new file, `VoiceIntake.ts`. Still not connected to the webhook
(that is Phase 4), so nothing changes for anyone yet. When it is connected, it does this:

1. **Spots a voice note** in the AiSensy message. It looks at the file type (`audio/...`), so it works whatever name AiSensy gives the message type. Images, PDFs and text are left alone.
2. **Only for people the system knows** — a registered employee or an approved WhatsApp user. Unknown numbers: ignored, nothing spent.
3. **Limits:** 20 voice notes per hour per phone (the 21st gets "please type your message for now"); 2 minutes and 10 MB per note.
4. **Same note delivered twice** (AiSensy retries): done only once.
5. **Downloads at once** (the link expires), turns it into text (Phase 1), tidies it (Phase 1).
6. **Replies:** 🎙️ I heard: "…" — Reply *YES* to go ahead, or *NO* to cancel. If the tidy-up failed or some words were unclear, it also says "If this is wrong, reply NO and type it instead."
7. **The answer:**
   - **YES** (also haan, ha, ok, theek hai, sahi hai, ji…) → the tidy text carries on **as if they had typed it**.
   - **NO** (also nahi, cancel, galat…) → "Okay, cancelled."
   - **Anything else** → treated as a new message; the voice note is dropped.
   - After **10 minutes** the voice note is forgotten.
8. **Something goes wrong** (link expired, silence, too long, Groq busy, AI down) → one friendly reply asking them to try again or type. It never crashes.
9. **Audit row** (`voice_note`) for every outcome: transcribed / confirmed / declined / dropped / too_long / silent / hourly_limit / failed. The raw and tidy text are stored (your decision); the audio never is.

**Where the "waiting for YES" is kept:** one row in the existing `conversation_context` table, named `VOICE:<phone>`. It is separate from the person's normal row, so it cannot interfere with the Task Manager or the brain. There is no new table and no migration. The same trick is already used by the `TEST_CONFIG` row.

**Tested (all offline — fake WhatsApp, fake database client, no internet):**
- `npx tsx task-manager/tests/test_voice_phase2.ts` → **53 / 53 checks passed**, including the real AiSensy voice-note shape from your server log.
- Phase 1 tests rerun → 46 / 46 still pass.
- Type check and lint of all voice files → no errors.

**Reused, not rebuilt:** the shared WhatsApp parser (`normalizeInbound`), the safe downloader (`fetchMediaSafely`), the YES/NO reader (`parseConfirmAnswer`, plus Hindi words on top), the WhatsApp send gate with kill switches and Pretend Mode (`sendFreeformReply`), and audit logging (`logAudit`).

**Not done / known limits:**
- Not connected to the webhook yet (Phase 4). The brain path ("I heard … → I'll do … YES", reads answered straight away) is Phase 3. Today every voice note would get the simple "I heard … YES?".
- When the switch is ON, every incoming text message costs one small database read (to check for a waiting voice note). When it is OFF, nothing at all is loaded.
- If someone sends a second voice note and types YES before the second one is ready, the YES applies to the first one.

---

## Phase 1 — done 2026-10-09

**In simple words:** two new building blocks. Nothing is connected to WhatsApp yet, so nothing changes for anyone.

1. **`VoiceTranscriber.ts` — turns a voice note into text.**
   - Sends the audio to Groq Whisper. Tries `whisper-large-v3` first (better for Hindi); if that is busy or broken, tries `whisper-large-v3-turbo`.
   - Uses its own key, `GROQ_VOICE_API_KEY` (not added yet — you add it in Phase 4).
   - Says "no" **before** spending any quota when: there is no key, the file type is not audio Groq can read, the file is empty or over 10 MB, or the voice note is over 2 minutes (it reads the length straight from the file).
   - Spots silence: empty text, "no speech" from Whisper, or Whisper's well-known made-up lines like "Thank you." on silence.
   - Never crashes: every problem comes back as a clear reason (`no_key`, `too_long`, `silent`, `rate_limited`, `failed`, …).

2. **`VoiceCleanup.ts` — tidies the text.**
   - One AI call (same AI and fallback the brain already uses; no new provider).
   - Removes "um / uh / matlab", repeated words and false starts; fixes grammar; writes Hindi in English letters (Hinglish).
   - Copies names, numbers, dates and times exactly. It is never shown the employee list, so it cannot "correct" a misheard name into a real person.
   - Treats the voice note as words to tidy, never as orders (someone saying "ignore your rules" is just tidied).
   - Checks the AI's answer and refuses it if: it has Hindi letters (Devanagari), a number nobody said, words nobody said, or it is far longer than what was said. Then the other model tries; if both fail, the **original text is kept** and marked "not tidied". It never invents a version.

**Tested (all offline — fake Groq, fake AI, no internet, no database):**
- `npx tsx task-manager/tests/test_voice_phase1.ts` → **46 / 46 checks passed**.
- Type check of the new files (project settings) → no errors.
- Lint of the new files → no errors.

**Fixed along the way:** if the AI sent back broken JSON, Node's error message quoted part of the reply — the person's words — into the server logs. Now it says only "reply is not valid JSON". A test checks no spoken words reach the logs.

**Not done / known limits:**
- Never called the real Groq — needs the key and real voice notes (Phase 4 / 5).
- How well Whisper understands Hinglish is unknown until we test with real samples.
- The length check before sending works for WhatsApp's normal voice format (Ogg Opus). For other formats, the length is checked from Groq's answer instead (after the call).
