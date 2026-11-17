# Agent Spec — Call Insights (candidate screening)

Built 2026-11-16 on `feat/hr-ats-update`. Plan: [RECRUITMENT_ATS_IMPLEMENTATION_PLAN.md](../RECRUITMENT_ATS_IMPLEMENTATION_PLAN.md) (P3 + P7).
Code: `backend/lib/callInsights/` (pipeline, transcribe, analyse, `contexts/candidateScreening.ts`),
`backend/lib/candidates/calls.ts`, `app/api/candidates/calls/*`, `frontend/components/candidates/CallsTab.tsx`.
Migrations (applied by a person): `20261116000001_call_analyses.sql`, `20261116000002_ai_models_call_jobs.sql`.

**1. Workflow or agent?** Workflow. The pathway is known ahead of time (claim → transcribe → read → save) and the edge
cases are few and named `[BAA p.104]`. Justification: N/A for an agent; the doctrine's default is a workflow `[BAA p.115]`.
Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists; recruiters kept notes by hand.

**2. Context** `[BAA p.112]`
It knows one call's transcript (stamped `[m:ss]` lines when transcribed, plain lines when pasted), the candidate's
record values (name, designation, company, location, current and expected in-hand, notice) so it can compare and not
repeat them as facts, and the linked position's title, location and JD. It knows nothing about other candidates or
about employees' pay.

**3. Cost of a false positive** `[BAA p.112]`
High: a wrong "negative / not interested" read sits next to a decision about a real person. → Model tier: **larger**,
job `call_analyse`, default Claude Opus 5.5 with Sonnet 5.5 as the backup (Brain → AI models). Mitigations: every
judgement carries an exact quote; facts not said are null; a person applies each fact by a click; no status ever
changes from a call. Transcription is job `call_transcribe` (Groq Whisper large-v3 → turbo, the voice notes' chain).

**4. Tools**
| tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
|---|---|---|---|---|
| none: one structured-output call, no tool use | N/A | N/A: the pipeline catches every failure and writes `status = failed` + a sentence HR can read | the transcript is cut to `CALL_ANALYSE_MAX_CHARS`, the answer re-checked by `CandidateScreeningSchema` (ranges, enums, "no quote, no concern") | N/A |

**5. Prompt** `[BAA pp.105, 114]`
Numbered ordered steps: yes (11). Explicit no-skip clause: yes ("Follow these steps in order. Do not skip any.").
Single-shot tone example: yes, one short stamped transcript → answer. Terminal state written to data:
`call_analyses.status = 'done'` with `result`, `model`, `tokens_in`, `tokens_out` `[BAA p.114]`.

**6. Memory** `[BAA pp.100–103]`
Does this workload repeat? No: each call is read on its own. → No write tool.

**7. Multi-agent?** `[BAA p.116]`
Single. Transcription is a non-LLM step. One prompt per context (`contexts/candidateScreening.ts`), tuned on its own,
so a later context (BD calls) cannot regress this one.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
- System: Whisper and LLM latency and error rate from the run traces (`oem_agent_runs`, agent key `call_insights`).
- Quality assurance: **not yet measured.** The plan: 15–20 real calls labelled by HR (sentiment, interest, facts),
  a rubric grader from a different model family, mid-tier, 0–3 with `reasoning` before `score`, and a manual audit of
  at least 10% `[BAA pp.96–98]`. Until then no accuracy number is claimed.
- Tool interaction: N/A, no tools `[BAA p.95]`.
- Agent efficiency: tokens per read call are stored on the row and the run; cost is not computed (no price table in
  the repo; `cost_usd` stays null rather than a guess) `[BAA p.119]`.

**9. Trace** `[BAA pp.119–120]`
Run/step telemetry wired: yes, `withAgentRun` around "Transcribing the recording" (tool) and "Reading the call" (llm),
with the provider's token counts; a failure is a failed run. Ad-hoc single-agent testing done before scale: **pending**
on real recordings (Hindi / English mixed; the phone recorder's quality) `[BAA p.116]`.

**10. Laws knowingly violated, and why:** none. L9 (MCP default) `[BAA pp.106–107]` does not apply yet: no agent calls
this as a tool. Deviations from the plan document, stated: the routes live under `/api/candidates/calls/*` (not
`/api/call-insights`) so they reuse Candidate Search's access check; the table keeps `subject_type` with a
`candidate_id` foreign key (cascade on delete) rather than a bare `subject_id`, so a purged candidate takes their calls
with them.

## Agent Spec change — rounds, interview reading and the CTC fix (2026-11-17)

Owner: "there will also be further rounds with the candidate ... we need some kind of action where we know which call
recording or transcript is for what stage in the pipeline", then "yes go ahead, also fix the CTC bug". Migration
`20261117000001_call_rounds.sql` (applied by a person): `call_analyses.call_round` = screening | round_1 | round_2 |
round_3 | hr_offer, chosen when the call is added (suggested from the candidate's stage in the position) and changeable.

**1. Workflow or agent?** unchanged: one fixed read per call `[BAA p.104]`. The round only picks which prompt runs.

**2. Context** `[BAA p.112]`: adds the round ("THE ROUND: Interview round 1") and the position's must-haves (its starred
keywords) to what the model reads. Nothing else is added; it still knows nothing about other candidates.

**3. Cost of a false positive** `[BAA p.112]`: unchanged (high; same job `call_analyse`, same chain). Interview reads add
a new false positive: a "weak" verdict on an answer that was fine. Mitigations: each verdict carries the candidate's
exact quote and time, so HR listens before acting; verdicts judge only what was said (relevance, specifics,
correctness), never delivery, which the prompt forbids in so many words (accent, fluency, grammar, nervousness,
confidence, tone, personality); nothing changes a stage by itself.

**4. Tools**: none, as before.

**5. Prompt** `[BAA pp.105, 114]`: two prompts now, one per context (doctrine L11 `[BAA p.116]`):
- `contexts/candidateScreening.ts` (screening, HR / offer discussion, calls with no round): step 7 is the shared
  `FACTS_STEP`. **The CTC fix**: the old step told the model that "9 LPA" was take-home (divide by 12), so "2.4 LPA"
  showed as ₹20K in-hand and could be applied to the in-hand field. Each pay fact now carries `pay_basis`
  (in_hand | ctc | unclear); a CTC figure is still the yearly figure / 12 but is never called take-home, and the model
  is told never to convert CTC to take-home itself. The worked example shows `pay_basis`.
- `contexts/candidateInterview.ts` (rounds 1–3): its own 10 numbered steps with the no-skip clause, the content-only
  rule, the shared facts step, and a short worked example for the three new lists: `answers` (topic, verdict
  clear | partial | weak, note, quote, time), `not_covered` (must-haves that never came up), `next_round_questions` (3–5).
- Schema: `pay_basis` is a plain enum (not nullable). Nullable keys: screening 14, interview 15, under Claude's 16
  (asserted in `calls.test.ts`).

**6. Memory**: none, as before.

**7. Multi-agent?** `[BAA p.116]`: still a single call; the second prompt is a second context, not a second agent.

**8. Evaluation** `[BAA pp.118–119]`: unit tests on both parsers, the prompt choice by round, the round in the user
message, the CTC basis ("2.4 LPA" → ctc; a missing basis reads as unclear, never in-hand) and the nullable-key counts.
Quality is **still not measured**: the interview verdicts need a labelled set of real rounds before any accuracy is
claimed. Efficiency: an interview read returns three more short lists, so its output is a little longer.

**9. Trace** `[BAA pp.119–120]`: unchanged (`withAgentRun`, agent key `call_insights`); the label says "call analyse
(interview)" on interview reads.

**On screen and in the record**: a CTC or unclear pay figure shows "CTC (2.4 LPA) · not in-hand" or "in-hand or CTC?";
Apply asks first ("Apply anyway" / Keep), Apply all leaves such figures out, and the history notes "said as CTC, not
in-hand" when one is applied. The round shows on each call, in its title and in the history ("Interview round 1 ·
Recording · …"); changing it keeps the old reading until HR clicks "Read it again".

**10. Laws knowingly violated, and why:** L5 / L6 quality axis for the interview verdicts: no labelled rounds and no
grader yet `[BAA pp.96–98]`; do not call the interview reading evaluated until both exist.
