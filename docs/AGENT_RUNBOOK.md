# Agent Runbook — idea to live

Companion to [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md). The doctrine says what a good agent
*is*; this says which buttons to press, in what order, in this repo.

---

## Abstract

**An agent in this system is four separable things — and the console only builds three of them.**

| # | Part | Lives in | Built by |
|---|---|---|---|
| 1 | **Identity + prompt** — name, department, system prompt & version, lifecycle status | `oem_agents` | Console → *Describe it* |
| 2 | **Data bundle** — the closed set of real tables it may read | `oem_agent_bundles` | Console → *Configure* |
| 3 | **Runtime envelope** — schedule, autonomy, heartbeat, quiet hours, max runs/day, cost cap, timeout, model, temperature, top_p, context | `oem_agents.runtime` / `model_config` | Console → *Configure* |
| 4 | **Executor** — the code that actually does the work | `app/api/**/route.ts` | **You. In code.** |

The console is the **control plane**. The executor is the **data plane**. Creating an agent
in the UI creates a *described* agent, not a *running* one: nothing appears in Activity,
Uptime, Reliability or the coin ledger until some code runs under that `agent_key` inside
`withAgentRun(...)`.

This is deliberate and correct — it is doctrine **L1** `[BAA p.104]`: the work itself stays
a deterministic workflow you can read, test and cost; the agent record is the identity,
governance and telemetry wrapper around it.

### The lifecycle is enforced, not advisory

```
draft ──▶ shadow ──▶ live ──▶ paused
  │         │  ▲       │        │
  │         │  └───────┴────────┘
  └─────────┴──▶ retired ──▶ draft | shadow
```

`app/api/agents/registry/route.ts:152-156` is the whole law:

| from | may go to |
|---|---|
| `draft` | shadow, retired |
| `shadow` | **live**, paused, draft, retired |
| `live` | paused, shadow, retired |
| `paused` | live, shadow, retired |
| `retired` | draft, shadow |

**`draft → live` is refused by the API**, not just hidden in the UI. In shadow the agent runs
its full reasoning and writes its full trace but takes no action on the business — and
shadow runs are excluded from the success-rate denominator, so rehearsals never inflate a
scorecard. This is doctrine **L2** `[BAA pp.94-95]` given teeth.

---

## Step 0 — Unblock: the database is half-provisioned

**Diagnosis (2026-09-04).** The console's banner names `20260825000001_org_efficiency_meter`
because `/api/agents/bundles` got a missing-table error for **`oem_agent_bundles`**.

But `oem_agents` clearly *does* exist — Ira and Pratiksha render in the roster, and the
registry has no fallback seed. Those two tables are created **22 lines apart in the same
file** (`20260825000001`, lines 99 and 121).

> **`20260825000001_org_efficiency_meter.sql` was applied partially and stopped between
> line 99 and line 121.** And `20260830000001_agent_runtime.sql` — runs, run_steps,
> heartbeats, feedback, coin_ledger, credentials — has not been applied at all. That is why
> the header reads *Never probed · 0 coins · — reliability · no data*.

Every statement in both files is `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`,
so **re-running the base migration is idempotent** — it resumes from where it died.

Run these two, in this order:

```bash
node scripts/apply_with_supabase.js supabase/migrations/20260825000001_org_efficiency_meter.sql
```

```bash
node scripts/apply_with_supabase.js supabase/migrations/20260830000001_agent_runtime.sql
```

Then hit **Check again** in the panel. Nothing in the app needs a redeploy — every
`/api/agents/*` route probes at request time and fills in on its own.

---

## Step 1 — Describe it

Console → select agent → **Describe it**. One sentence, in operator language:

> "Every morning, look at the open electricity bills that have not been approved for 3 days
> and tell the property admin which ones are stuck."

`composeAgent()` (`backend/lib/agents/compose.ts`) returns identity, department, a written
system prompt, and a data bundle. Three guarantees worth knowing:

- **Closed-set grounding.** The model may only name tables the org actually has, and it is
  not trusted to obey — every proposed table is re-checked against the allowlist after
  parsing, and anything invented is dropped and reported.
- **Hard deny.** Credentials, secrets, tokens, keys, passwords, sessions, and the
  `auth`/`storage`/`vault` schemas are refused at catalog build, discovery *and* bundle
  write — not merely filtered from the list.
- **Nothing is saved.** Compose returns a proposal; you review and commit it.

Doctrine **L8** `[BAA p.107]` applies here: the bundle and the prompt *are* the tool
descriptions. Review them as carefully as code.

## Step 2 — Review the bundle

Configure tab → the table list. Ask of each table: does the job genuinely need it? A bundle
is a read surface; a smaller one is a smaller blast radius.

## Step 3 — Set the runtime envelope

Start at **`autonomy: suggest`** — the agent proposes and waits. `act` writes on its own.
Set `cost cap/day` and `max runs/day` before anything runs, not after. Set `timeout` above
the job's realistic worst case: `reapStaleRuns()` floors any threshold at 300s and marks
overruns `abandoned`, so a nonsense timeout produces phantom failures.

## Step 4 — Write the executor ← *the step no UI performs*

Wrap the real work in `withAgentRun`. Three lines of ceremony:

```ts
return withAgentRun(
    { orgId, agentKey: 'ira', module: 'procurement', trigger: 'cron',
      runKey: dailyRunKey('ira-daily-digest') },
    async (step) => {
        const s = await step('Reading open requisitions', 'fetch');
        const tasks = await getDailyTasks();
        await s.ok({ detail: { rows: tasks.length } });
        return { outcome: `${tasks.length} open tasks`, result: tasks };
    },
);
```

Rules the codebase already enforces, and doctrine agrees with:

- **Instrumentation must never change a job's outcome.** Recorder failures are swallowed;
  only the job's own throw is re-thrown after recording. (Doctrine **L3**, `[BAA p.94]`.)
- **Omitted is the honest default.** A job that makes no LLM call leaves the token fields
  alone — `null` reads "not measured", `0` would claim we measured and it was free.
- **`step_type`** is one of `plan | think | llm | tool | fetch | write | notify | decide | error`.
- **Pick `runKey` deliberately.** `dailyRunKey()` dedupes for the whole day — if the owning
  execution dies before `finishRun`, the retry that succeeds is deduped too and goes
  untraced. Pass no `runKey` for a job that should be traced on every attempt.

**Reference implementations already in the tree:**

| Executor | agent_key | module | trigger |
|---|---|---|---|
| `app/api/ira/daily-digest/route.ts` | `ira` | procurement | `shadow` (preview) / `cron`\|`manual` (send) |
| `app/api/ira/vendor-outreach/route.ts` | `ira` | vendors | — |
| `app/api/cron/electricity-chase/route.ts` | `ira` | electricity | cron |
| `app/api/cron/amc-expiry-alerts/route.ts` | `ira` | vendors | cron |
| `app/api/cron/ppm-reminders/route.ts` | `pratiksha` | ppm | cron |
| `app/api/cron/check-sop-reminders/route.ts` | `pratiksha` | sop | cron |
| `app/api/cron/whatsapp-reminders/route.ts` | `pratiksha` | comms | cron |

`module` must be a slug from `AGENT_MODULES` in `frontend/types/agentRuntime.ts`. The column
is free text with no CHECK, so a typo renders an empty pulse strip **forever, silently**.

## Step 5 — Move to shadow

`Move to shadow` in the header, or `POST /api/agents/registry action=set_status`. Now runs
record and traces render, and nothing touches the business.

## Step 6 — Watch

**Activity** (step-by-step trace) · **Uptime** (heartbeat buckets, `*/10 * * * *` via
`/api/cron/agent-heartbeat`) · **Profile** (success rate, cost/run) · **Reinforcement**.

Reliability = `0.50 × success_rate + 0.30 × uptime_pct + 0.20 × (100 − roi_flag_rate)`.
Efficiency scores ₹5/successful run → 100, ₹100 → 0.

> **Honest limit — doctrine §2.** These panels tell you *that* it ran, how long, and what it
> cost. They cannot yet tell you whether it called the **right tools** (**L4**, `[BAA p.95]`)
> or whether its answer was any **good** (**L6**, `[BAA pp.96-98]`). Those two axes have no
> instrumentation in `backend/lib/agents/`. Until they do, "watch a few shadow runs" means a
> human reads the traces.

## Step 7 — Promote

`shadow → live` once you have watched real shadow runs. If `autonomy` was `suggest`, this is
also where you decide whether it earns `act`.

## Step 8 — Reinforce

Operators leave `praise | reject | correction | roi_flag` on real runs. `foldGuidance()`
turns pending corrections into the **next prompt version** server-side, versioned and
auditable. You review the diff, then commit through the registry's `save_prompt`.

> **Trap:** pass `absorbed_feedback_ids`. The registry **ignores** the older
> `absorb_feedback: true` flag — a caller that sends only the flag saves the prompt and
> leaves every correction pending for ever.

---

## Fastest path to "see it working"

Ira and Pratiksha are **not empty drafts** — seven executors are already wired to them. The
only reason the console is blank is the missing tables.

1. Run the two migrations (Step 0).
2. Signed in, open **`/api/ira/daily-digest`** in the browser. It renders the digest and
   sends nothing — sending is POST-only behind `IRA_SEND_ENABLED` + `CRON_SECRET`.
3. It opens a run with `trigger: 'shadow'` under `agent_key: 'ira'`, module `procurement`.
4. Back to Agent Console → Ira → **Activity**. The trace is there.

That is one real run, end to end, with zero new code — and because it is a shadow trigger it
does not touch her scorecard.

*Caveat worth knowing:* `getDailyTasks()` still returns a **seed** list from
`backend/lib/ira/tasks.ts`, and the run is correctly reported `grounded: false`. When that
becomes a real query over `material_requests`, flip it to `true` — not before.

---

## Before you build a new one

Fill the **Agent Spec Block** (doctrine §3). Every line cited. No spec block, no merge.
