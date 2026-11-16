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
