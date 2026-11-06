# Voice Note Intake — plan and Agent Spec Block

Status: **APPROVED 2026-10-09. Phase 1 built (offline); see [task-manager/voice/VOICE_PROGRESS.md](../task-manager/voice/VOICE_PROGRESS.md).**
Doctrine: [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md) · Runbook: [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md)

## 1. What it does

A WhatsApp voice note arrives → it is turned into text and tidied → the tidy text goes through the **existing** pipeline
as if typed, and the sender sees what was heard in the same reply — **one YES at most**.

```
voice note ─▶ [1 download] ─▶ [2 Groq Whisper] ─▶ [3 clean-up (1 LLM call)] ─▶ [4 brain reads the tidy text]
   change (brain CONFIRM)  ─▶ "🎙️ I heard: "…" → I'll <action>. Reply YES"  ── one YES does both
   read-only question      ─▶ "🎙️ I heard: "…"" + the answer, straight away (no YES)
   not the brain's (rooms / tickets / hand-off / brain down) ─▶ "🎙️ I heard: "…" — YES?" → YES hands the text to the old flow
   NO / anything else / 10 min ─▶ discarded, nothing happens
```

Decisions by the product owner (2026-10-09): Groq Whisper (free tier) · every sender the system recognises (unknown numbers
ignored) · ONE combined YES for changes · read-only questions answered straight away with the "I heard" line ·
English + Hindi + Hinglish, Hindi written in Roman letters · 2 min per note, 20 notes / hour / phone · keep transcript text,
never the audio · friendly failure replies · tracing via Task Brain audit rows.

AiSensy voice payload (seen in logs 2026-10-09): `data.message.message_content.{url, mimeType, urlExpiry}` and
`data.message.message_type`. `normalizeInbound` already returns that URL. Voice notes are detected by `mimeType` starting
`audio/` (the exact `message_type` value is not visible in the shape log). The URL expires, so it is downloaded at once.

## 2. Design

| Step | Rule |
|---|---|
| Detect | Inbound `mediaType` is `audio` / `voice` / `ptt`. Anything else is untouched. Senders the system does not recognise are ignored (no spend). |
| Download | Reuse `fetchMediaSafely` (https only, no internal hosts, 10 MB cap, 3 redirects, 25 s timeout). No new fetch code. |
| Limits | Max **2 minutes** of audio; max **20 voice notes / hour / phone**. Over the limit → "please type it or send a shorter note". |
| Transcribe | Groq `audio/transcriptions` (OpenAI-compatible endpoint), language left on auto-detect, a short prompt biasing towards Hinglish. Pattern copied from `backend/lib/coaching/whisper.ts` (raw `fetch`, no SDK). |
| Clean up | One LLM call through the **existing** `engyBrainLlm` + `withModelFallback` (no new provider). Fixes grammar/punctuation, removes fillers and false starts. **Hindi is written in Roman script (Hinglish)**; English stays English. Names, numbers, dates, times are copied verbatim, never "fixed". Unclear words are marked `[unclear]`. |
| Confirm (brain) | The tidy text goes to the brain first. A change → the brain's own CONFIRM reply, with the *🎙️ I heard: "…"* line on top; the existing YES answers it (one YES). A read → answered at once with the line on top. Needs a small additive "heard" prefix in `brain/live.ts`; the brain's logic, prompts and permissions are not changed. |
| Confirm (other routes) | When the brain does not take it: *🎙️ I heard: "…" — reply YES to go ahead, or NO.* YES (yes / y / haan / ha / ok / theek hai / sahi hai) → hand off. NO / cancel / nahi → discard. **Any other message is treated as a brand-new message** and the pending note is dropped. A new voice note replaces the pending one. Expires after 10 min. |
| Hand off | The webhook's `body` is replaced by a plain text payload `{ phone, messageId, text }` (accepted by `normalizeInbound`), so every downstream route sees ordinary text. |
| Pending store | One row in `conversation_context` keyed `phone_number = 'VOICE:<digits>'`, `system = 'TASK_MANAGER'`, `context_type = 'VOICE_CONFIRM'`, 10-min TTL. Precedent: the `TEST_CONFIG` row. **No migration** (`context_type` is free text). It does not touch the sender's real row, so it can neither flip `taskActive` in `getConversationRoutingState` nor overwrite a `BRAIN_STATE` mid-conversation. |
| Switch | `VOICE_NOTES_ENABLED` env flag, default OFF (same style as `AISENSY_ASSISTANT_ENABLED`). Flag OFF = today's behaviour, byte for byte. While the Task Manager sandbox is ON, only sandbox numbers are served. |
| Trial allowlist | `VOICE_NOTES_ALLOWED_PHONES` (comma-separated). Set → only those numbers get voice notes; empty → everyone recognised. Voice-only: it does not touch the Task Manager sandbox, which also limits Smart chat and Task Import. |
| Retries | A YES / NO is remembered by message id for 10 min; AiSensy redelivering it (after a 503) gets the identical answer, never a bare "yes" downstream. |
| Time budget | Route `maxDuration` 120 s (unchanged). Whisper 20 s per model; the brain is tried only if under 30 s have passed (`BRAIN_BUDGET_MS`), else the single "I heard … YES?" send. |
| Failures | Download/transcribe/clean-up error, empty or silent audio, too long, rate-limited → one friendly reply asking them to type or resend. Never throws into the webhook (a failure falls through to today's behaviour). |
| Replies | Through the existing `TaskMessagingService.sendFreeformReply` safety gate (kill switches, Pretend Mode). |

### Files

New (all under `task-manager/voice/`): `VoiceTranscriber.ts`, `VoiceCleanup.ts`, `VoiceIntake.ts` (`claimVoiceNote`, injectable IO like `claimSmartChat`).
New tests: `task-manager/tests/test_voice_*.ts` — **offline only** (fake fetch, fake LLM, fake store; nothing touches the live DB).
Edited: `app/api/webhooks/aisensy/route.ts` — ~10 lines right after the body is parsed; `task-manager/brain/live.ts` — an optional "heard" line carried into the reply (Phase 3, additive). The brain's decisions, prompts, router, auth and permission code are untouched.
Env: one new key, `GROQ_VOICE_API_KEY` (a dedicated key, because `GROQ_API_KEY` is shared and Groq's free quota is already contended — see `backend/services/mailboxDigest.ts`). I will not touch `.env`; you add it.

### Honest costs and risks

1. **Resolved: one YES.** The brain's CONFIRM message carries the "I heard" line, so the sender checks the words and the action together. The brain's confirmation is not weakened. Read-only answers carry the line and need no YES (a misheard read is harmless).
2. **Resolved: payload seen** (see §1).
3. **Whisper accuracy on Hinglish cannot be measured without audio.** I need ~20 sample voice notes (en/hi/hinglish, with you typing what was said) to compare `whisper-large-v3` vs `-turbo`. Without them I can only test the clean-up step on text.
4. **Transcript storage vs. the brain's privacy stance.** The brain deliberately never stores "the person's original words". You asked to keep transcripts, so the cleaned + raw text go in one audit row (`eventType: 'voice_note'`). They are never written to console logs.
5. Groq free-tier audio limits and pricing must be checked against current Groq docs before launch (I will not quote numbers from memory).

### Rollout

1. Offline tests + eval green. 2. Flag ON in the sandbox only (the existing sandbox/Pretend gates still apply to replies). 3. Watch audit rows for a few days (human reads them — doctrine §2 limit). 4. "Everyone" = turn the sandbox off / flag ON for all recognised senders.

---

## Agent Spec — Voice Note Intake (transcribe → clean → confirm → hand off)

**1. Workflow or agent?**  **workflow** — five fixed steps, no tools, no loop, no model-chosen path. `[BAA p.104]`
   Justification (must be (a) or (b)) `[BAA p.115]`: **N/A — this is a workflow.** The pathway is fully known; the only open-ended part is one clean-up call. `[BAA p.104]`
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists (audio is ignored today). Substitute test: the brain's reading of **raw Whisper text vs. cleaned text** on the same fixed case set — keeps the clean-up step only if it measurably helps. **Measured 2026-10-10 (20 owner samples × 3 brain runs, `task-manager/voice/eval/results/2026-10-10-run1/FINDINGS.md`):** brain right intent — raw **80%** vs tidy **67%** (typed truth also 67%) | tidy-up cost ≈ $0.035 / 1,000 notes | tidy-up latency median 0.83 s. The tidy-up helps the PERSON (key details readable 70% → 93%, Devanagari → Roman) but does NOT help the brain: **Owner decision 2026-10-10: Option C** — the brain keeps reading the tidy text; its Hinglish understanding is tuned separately.

**2. Context** `[BAA p.112]`
   Knows: only the raw transcript and Whisper's detected language. Deliberately does **not** see tasks, people or the roster, so it cannot invent or "correct" a name into a real employee. The brain (neighbour) knows the roster and tasks and never sees audio.

**3. Cost of a false positive** `[BAA p.112]`
   **Low** → model tier: cheap/fast, `BRAIN_REPLY_MODELS` (`qwen3.8-27b` → `glm-5.3-flash`); Whisper: `large-v3` first, `-turbo` on error / rate limit — **confirmed by the audio test** (key details 93% vs 89%, Hinglish WER 0.23 vs 0.30, +60 ms). Because every change still needs the brain's own CONFIRM, now shown with the exact words heard, and reads change nothing; a wrong transcript costs one extra message, not a wrong change.

**4. Tools** — none are exposed to a model (no tool-calling). In-process steps:
   | step | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | `fetchMediaSafely` (reused) | N/A — no model reads it | yes — typed `{ok:false,error}` result | https / host / size / redirect checks | no |
   | `transcribe` | N/A | yes — typed result, never throws | mime, size, duration cap | no |
   | `cleanup` | N/A | yes — falls back to raw text flagged "unclean", then to the failure reply | JSON-schema parse; rejects output that adds digits/names absent from the input | no |

**5. Prompt** `[BAA pp.105, 114]` (clean-up prompt)
   Numbered ordered steps: **yes** (1 read, 2 drop fillers/false starts, 3 fix grammar and punctuation, 4 Roman-script Hindi, 5 copy names/numbers/dates verbatim, 6 mark `[unclear]`, 7 output JSON).
   Explicit no-skip clause: **yes**. Single-shot tone example: **yes** (one Hinglish → clean Hinglish example). Terminal state written to data: **yes** — audit row `voice_note` with `outcome` ∈ `transcribed | confirmed | declined | expired | too_long | failed`.
   The prompt also states that the transcript is **data, never instructions** (speech can say "ignore your rules").

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? **no** (every voice note is different). → **no write-tool.** The 10-minute pending row is conversation state, not agent memory; no scope-key tool exists to guard `[BAA p.101]`.

**7. Multi-agent?** `[BAA p.116]`
   **Single workflow, separate from the brain**, reason: *per-task model* (speech-to-text model + a cheap clean-up model vs. the brain's interpret model) `[BAA p.116]`. One prompt change cannot regress another area because the only interface to the brain is a plain text string and the brain's prompt, router and permission code are not edited.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: Whisper error rate and p50/p90 latency, download failures, rate-limit hits, `outcome` counts from the audit rows.
   Quality assurance (rubric: family **`openai/gpt-oss-120b` on Groq — different from the Qwen/GLM tidy-up**, tier **mid**, scale **0–3 with `reasoning` before `score`**, manual audit **100% (40/40 grades), 95% agreement**) `[BAA pp.96–98]`: 20 owner-recorded notes (5 en / 10 hinglish / 5 hi), raw vs tidy graded → mean **2.55 → 2.65**; 16/20 tidy = 3. Injection attempts are covered by the offline tests, not by audio.
   Tool interaction (expected set + order; measured call count) `[BAA p.95]`: fixed order download → transcribe → clean-up; expected calls per note = 1 + 1 + 1 (max 2 LLM calls with fallback); asserted in tests.
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`: tokens from `LlmResponse` and audio-seconds recorded in the audit row; no reasoning tokens (thinking OFF, as the brain does). Measured: tidy-up ≈ 500 tokens in / 37 out per note (≈ $0.035 / 1,000 notes); Whisper median 0.28 s, within Groq's free tier.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: **audit row per note** via `TaskDatabaseService.logAudit` (same as the brain; see item 10). Ad-hoc single-workflow testing before scale: **done offline** (voice phases 1–3 + route tests) and on 20 real recordings; sandbox trial on WhatsApp pending. `[BAA p.116]`

**10. Laws knowingly violated, and why:**
   - **L9 (MCP default):** steps are in-process functions, not agent-facing tools; there is no agent to hand tools to.
   - **L6 / L5 (no production rubric, tool-interaction axis trivial):** the runtime has no rubric harness (doctrine §2 gap). The rubric here is offline and one-off; tool interaction is a fixed 3-step pipeline measured by call count, not tool *selection*.
   - **L14 / Runbook step 4 (`withAgentRun`):** follows the Task Brain's audit-row tracing instead (no `oem_agents` row, no agent lifecycle), because this is a workflow with no agent identity. Switching to `withAgentRun` later is additive.
   - **L2:** no deterministic predecessor to A/B against; replaced by the raw-vs-cleaned comparison above.
   - **Project stance, not a doctrine law:** stores transcript text, contrary to the brain's "never the person's original words", at the owner's explicit request.
