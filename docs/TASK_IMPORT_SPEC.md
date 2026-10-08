## Agent Spec — Task Import (WhatsApp task-list reader)

Status: Stage 1 (parser), Stage 2 (preview + confirm) and Stage 3 (save) built and tested offline. Shipped OFF by default, controlled by one "Task import: ON/OFF" button per department in the Control Center (column `task_import_enabled`, migration `20261007000004`; fail-closed until the migration is run). A person can use it only if their department has it ON, they are unlocked for the Task Manager, and (while the sandbox is ON) they are a sandbox number. The save writes only after an explicit YES, only to the sender's own list, through the existing `createTaskAssignment`; duplicates (same person + date + title + site) are skipped; every created task gets a `task_assigned` audit row and the import's `task_import_confirmed` row lists the created ids.

**1. Workflow or agent?**  **workflow** — fixed pipeline: parse → structure → confirm → save. No tool-picking, no loop. `[BAA p.104]`
   Justification `[BAA p.115]`: **N/A — this is a workflow, so the agent justification (a)/(b) is not needed.** The pathway is known ahead of time and the edge cases are few (3 input types, 1 output shape), which is the book's case for a workflow. `[BAA p.104]`
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: **no prior path exists** (tasks were typed in by hand). Inside the workflow, rules are tried first and the model second; the measured result of that choice is in the Stage 1 findings (Excel with known headers and clean image tables need no second AI call).

**2. Context** `[BAA p.112]`
   Knows: the person's sent file/text only, plus today's date. Does **not** know the employee's existing tasks, other departments, or the assistant/ticket flows.

**3. Cost of a false positive** `[BAA p.112]`
   **low** → model tier: **small/cheap** (Engy `qwen3.8-27b`, fallback `glm-5.3-flash`) because a human confirms a numbered preview (YES / NO / remove N / date) before anything is kept. The irreversible step (save, Stage 3) is behind that confirmation, not behind a bigger model.

**4. Tools**  This workflow exposes **no tools to a model** (the model only reads a picture and returns JSON; code decides everything else). The two model calls are wrapped as follows:
   | call | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | image → text (Engy vision) | yes — prompt says reply `NO_TASKS` for non-task images (PO/invoice tables, photos) | yes — failure becomes a friendly message, never a throw | yes — https only, ≤10 MB, bytes sniffed (JPEG/PNG/WEBP/xlsx/PDF) | no (direct call; see 10) |
   | text → tasks JSON (Engy chat) | yes — rule 5 returns `{"tasks":[]}` for non-task text | yes | yes — output re-validated by `sanitizeTasks` (drops bad rows, caps 100, trims) | no (direct call; see 10) |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: **yes** (structuring prompt, 5 steps) | Explicit no-skip clause: **yes** ("follow in order and do not skip any") |
   Single-shot tone example: **no** (output is JSON for code, not prose; format matters less for structured tool input `[BAA p.114]`) |
   Terminal state written to data: **yes** — audit events `task_import_received / previewed / edited / confirmed / cancelled / failed`; state rows `IMPORT_AWAITING / PROCESSING / PREVIEW`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? **no** for the model (each list is read fresh) → **no write-tool**. (Per-conversation preview state is ordinary session state, not agent memory.)

**7. Multi-agent?** `[BAA p.116]`
   **Single workflow.** Image reading and structuring are separate *steps* with a shared code path, not separate agents. A prompt change to structuring cannot regress the image reader (separate prompts), and neither can touch the room/ticket flows (the import only claims messages when the switch is ON, the sender is unlocked, and the message is a document, a task-captioned image, or an explicit "add tasks" text).

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: Stage 1 measured latency (≈10 s clean table, 24–42 s with blank cells, up to 72 s on the secondary model) and fallback behaviour (stubbed). Live provider error rate: **not yet measured**.
   Quality assurance (rubric: family **none**, tier **none**, scale **none**, manual audit **n/a**): **not built.** Quality was scored against a hand-made answer key on 3 task images + 1 reject image (field accuracy 95–100%; errors were letter misreads in names, e.g. "Mafatlal"→"Mafatail"). `[BAA pp.96–98]` — see 10.
   Tool interaction: **n/a** (no model-selected tools). Measured model-call count per import: 1 (clean image table / Excel with headers: 0) or 2.
   Agent efficiency: ≈ 2–3k tokens per image; cost well under 0.1 US cent per import at published Engy rates; token-vs-tool trade: rules-first removes the second call when the table is clean. `[BAA p.119]`

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: **partial** — audit events per stage + model-fallback warnings in logs; the shared `startRun/step/finishRun` runtime is **not** wired. | Ad-hoc single-workflow testing before scale: **yes** — real images on Engy (Stage 1), offline conversation suite (Stage 2); live WhatsApp test on one sandbox number is the next gate. `[BAA p.116]`

**10. Laws knowingly violated, and why:**
   - **L6 (rubric grader) / L5 QA axis** — no second-LLM grader; accuracy is a hand-scored answer key on 4 images. Reason: the human YES/NO preview is the quality gate for now. Revisit before the Procurement rollout (needs a larger, messier sample set).
   - **L2 (A/B on a fixed case set)** — only 4 images; not a benchmark. Reason: small pilot; no prior automated path to compare against.
   - **L9 (MCP as tool transport)** — the two model calls are direct HTTP calls via the repo's existing Engy helpers (`visionExtract`, `resolveProvider`). Reason: no tools are exposed to a model, so there is no tool transport to standardise; reusing the existing helpers avoids a second integration.
   - **L14 (full traceability)** — audit events only, not step-level run telemetry. Reason: the workflow is short and fixed; revisit if it grows.
