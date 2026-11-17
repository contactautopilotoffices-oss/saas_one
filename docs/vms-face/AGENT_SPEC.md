# VMS Face — Host Approval voice agent

A Bolna voice agent that rings a visitor's host when reception checks the visitor in on the
Tech Team's **VMS Face (Testing)** tab, and asks one question: may this visitor come in?
Plan: [docs/VMS_BIOFRQ_PLAN.md](../VMS_BIOFRQ_PLAN.md) Phase 4.

| Piece | File |
|---|---|
| Prompt, welcome, variables, decision parser | `backend/lib/vms-face/hostCallPrompt.ts` |
| Place call, retry, WhatsApp fallback, apply result | `backend/lib/vms-face/hostCall.ts` |
| Webhook | `app/api/vms-face/bolna/route.ts` |
| Agent creation (run by a human) | `scripts/vms-face-create-bolna-agent.ts` |

**How a decision is read.** The agent must end with one fixed English sentence, `Entry approved.`
or `Entry rejected.`. The server reads only the agent's own lines and takes the last such sentence.
Anything else (no sentence, nobody spoke, wrong person) is `unclear` and never lets a visitor in:
the visit stays *Pending*, the host gets a WhatsApp (when a template is configured), and reception
decides. Reception can always approve or reject by hand.

## Agent Spec — VMS Face Host Approval

**1. Workflow or agent?**  Hybrid — a deterministic workflow around one narrow conversational step. `[BAA p.121]`
   Justification (must be (a) or (b)) `[BAA p.115]`: (b) — a spoken yes/no from a person on the phone,
   in Hindi or English, is easy for a system prompt on an existing voice stack (Bolna, already used by
   Ira and Meera) and would take far longer to build as a hand-coded IVR. Everything around the call —
   who to ring, retry once, WhatsApp fallback, reading the outcome — is plain code, per L1's default. `[BAA p.104]`
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`:
     no prior path exists (today reception approves by hand, which stays as the fallback). An A/B against a
     keypad IVR is pending; see item 10.

**2. Context** `[BAA p.112]`
   What this agent knows that its neighbours don't: only this one visit — host name, visitor name,
   company, purpose, building — passed as call variables. It has no tools, no database access, and no
   knowledge of other visitors, unlike Meera (vendor research) or Ira (procurement).

**3. Cost of a false positive** `[BAA p.112]`
   high (an unapproved person is let in) → model tier chosen: the existing Bolna default LLM
   (`BOLNA_LLM_MODEL`, mid-tier) because the model never decides on its own authority. A false positive needs
   the agent to speak the exact approval sentence, and the prompt allows it only after a clear "yes". Reception
   still sees every visit, and an unclear call never approves. The irreversible step (opening the door) stays
   with a human at reception. If the trial's audit shows a wrong approval, move to a larger model before
   rolling out further.

**4. Tools**
   | tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | none — the agent only talks; the server acts on its final sentence | N/A | N/A (server code never throws: `handleExecution` returns a status string, the webhook returns 500 for Bolna to retry) | N/A (call variables are built server-side from the visit row) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (4 steps)   Explicit no-skip clause: yes ("Follow these steps in order. Do not skip any step.")
   Single-shot tone example: yes (one approve call)   Terminal state written to data: yes — the fixed sentence becomes
   `approval_status` + `approved_via = 'voice_call'`, and `host_call_status` records answered / no_answer / failed.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat?  no — each call is one visit; nothing learned carries over.
   If no → no write-tool. If yes → write tool + scope-key rejection `[BAA p.101]`: N/A.

**7. Multi-agent?** `[BAA p.116]`
   If split, which of the three reasons: N/A
   If single, why one prompt change can't regress another area: it is a separate Bolna agent with its own id,
   webhook and token. Ira's and Meera's agents and prompts are untouched, and the webhook drops any execution whose
   `agent_id` is not this agent's.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: Bolna call status per visit (`host_call_status`, `host_call_attempts`, `host_call_updated_at`); a stuck
   call is caught by polling `GET /executions/{id}` after 3 minutes.
   Quality assurance (rubric: family __, tier __, scale __, manual audit __%) `[BAA pp.96–98]`: not yet. During the
   Phase 6 trial a human checks **100 %** of answered calls (stored transcript vs. the decision recorded). There's no
   rubric grader until the volume makes a full audit impractical. Claim no accuracy number before then.
   Tool interaction (expected tool set + order; measured call count) `[BAA p.95]`: N/A — no tools. The equivalent check is
   the decision parser, which reads the agent's lines only.
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`: per-call minutes and cost
   from Bolna's dashboard during the trial; calls are capped at 90 s, and there are at most 2 calls per visit.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: partial — transcript, status and attempts are stored on each visit row. The agent runtime's
   `startRun`/`step` instrumentation is not wired (the call runs on Bolna, not in our runtime).
   Ad-hoc single-agent testing done before scale: not yet — a team member's own number must be the host for the first calls `[BAA p.116]`.

**10. Laws knowingly violated, and why:**
   - **L2** (A/B against the deterministic path): no deterministic path exists to compare against yet. A keypad IVR is the
     natural baseline and should be tested before any rollout beyond the Tech Team trial.
   - **L6** (rubric): replaced by a 100 % manual audit for the small trial volume; a rubric is required before scale.
   - **L9** (MCP default): no tools, so no MCP server.
   - **L14** (full traceability): only partly met — the transcript and outcome are stored, but not in the agent runtime's
     step tables.
   - **Plan deviation — keypad `1#` / `2#`:** not built. Nothing in the repo uses Bolna DTMF today, and its webhook payload has
     no keypad field we could read safely. Voice only for the trial.
