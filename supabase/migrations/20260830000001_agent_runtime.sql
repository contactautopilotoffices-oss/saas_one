-- ============================================================================
-- AGENT RUNTIME  —  execution, trace, uptime, reinforcement, secrets
-- ============================================================================
-- WHAT WAS ALREADY THERE (20260825000001_org_efficiency_meter.sql +
-- 20260825000002_oem_tenant_scoping_fix.sql) — NOT recreated here:
--
--   oem_agents          IDENTITY.       Who the agent is, its department, its
--                                       status, its generated+versioned system
--                                       prompt. One row per (org, agent_key).
--   oem_agent_bundles   DATA BINDING.   The versioned containment list: the
--                                       only tables an agent may read/write.
--   oem_council_log     GOVERNANCE.     Every prompt / binding / bundle change.
--   oem_goals / oem_tasks / oem_measurements   INTENT and OUTCOME.
--   public.oem_is_org_member(uuid)      RLS helper used by every oem_* policy.
--
-- Those answer "who is this agent and what is it allowed to touch".
-- They do NOT answer "what did it actually DO, is it alive, was it any good,
-- and with whose API key". That is what this migration adds:
--
--   1. oem_agent_runs        EXECUTION.      One row per invocation. Ball by
--                                            ball. Carries the real LLM surface
--                                            (provider/model/temperature/top_p/
--                                            context_window/tokens/cache/cost)
--                                            plus provenance back to the exact
--                                            prompt_version + bundle_version
--                                            that produced it.
--   2. oem_agent_run_steps   TRACE.          The step-by-step feed the console
--                                            renders live: plan -> fetch -> llm
--                                            -> tool -> write -> notify.
--   3. oem_agent_heartbeats  UPTIME.         When it went down, and why.
--   4. oem_agent_feedback    REINFORCEMENT.  praise / reject / correction /
--                                            roi_flag + free-text guidance that
--                                            the next prompt version absorbs.
--   5. oem_agent_coin_ledger REWARD.         Autopilot coins as an auditable
--                                            ledger, not a mutable counter.
--   6. oem_agent_credentials SECRETS.        Per-agent LLM / voice / telephony
--                                            keys. Service role only.
--
--   + columns on oem_agents  (health_state, last_heartbeat_at,
--     reliability_score, coins_balance, runtime jsonb, model_config jsonb)
--   + view oem_agent_profile (30-day rollup: success, uptime, tokens, cost,
--     p50/p95 latency, coins, ROI flags, reliability score)
--
-- ADDITIVE AND IDEMPOTENT. Every statement is IF NOT EXISTS / OR REPLACE /
-- DROP-then-CREATE. Safe to run twice.
--
-- SECURITY NOTE — oem_agent_credentials:
--   * secret_enc is bytea holding pgcrypto pgp_sym_encrypt() output. pgcrypto
--     must be installed (Supabase ships it in the `extensions` schema). This
--     migration does NOT create the extension; it only warns if absent.
--   * The PREFERRED storage is secret_ref — the NAME of an environment
--     variable ('BOLNA_API_KEY'), so the secret never enters the database.
--   * RLS is ENABLED with NO permissive policy. anon and authenticated
--     therefore see zero rows. The service role bypasses RLS, so server code
--     still reads it while the browser cannot.
--   * The API MUST NEVER return secret_enc, or any decrypted value, to a
--     client. Return last4 and meta only.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Preconditions (warn, never fail)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
        RAISE NOTICE '[agent_runtime] pgcrypto is not installed. oem_agent_credentials.secret_enc cannot be written until it is. Use secret_ref (env var name) instead — it is the preferred path anyway.';
    END IF;
END $$;

-- The org-membership RLS helper normally arrives with 20260825000002. Create
-- it only if that migration has not run, so this file is standalone-safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'oem_is_org_member'
    ) THEN
        EXECUTE $fn$
            CREATE FUNCTION public.oem_is_org_member(org uuid)
            RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public
            AS $body$
                SELECT EXISTS (
                    SELECT 1 FROM public.organization_memberships om
                    WHERE om.organization_id = org AND om.user_id = auth.uid()
                );
            $body$;
        $fn$;
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. RUNS — one row per agent execution. The ball-by-ball record.
--    `module` is what powers per-module agent pulse ("there is movement on the
--    agentic employees bit" inside procurement, tickets, electricity, ...).
--    `run_key` is the idempotency key, and it is INSERT-OR-RETURN-EXISTING,
--    NOT an upsert: a retry with the same key gets the original row handed
--    back untouched (startRun in backend/lib/agents/runtime.ts). It never
--    re-opens a finished run, never resets its status/ended_at/cost/outcome,
--    and never extends its step trace. Section 10 is the other half of that
--    rule: a run row is an audit record, so UPDATE is service-role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,
    run_key          text,                                    -- idempotency key; NULL allowed for ad-hoc runs
    trigger          text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('cron','manual','webhook','shadow','replay')),
    module           text,                                    -- 'procurement','tickets','electricity','sop','roster','vendors','accounts',...
    status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','skipped','timeout')),

    started_at       timestamptz NOT NULL DEFAULT now(),
    ended_at         timestamptz,
    duration_ms      integer,                                 -- auto-filled from ended_at - started_at if left null

    -- ---- LLM engineering surface. Real inference parameters, not decoration.
    provider         text,                                    -- 'anthropic','openai','openrouter','bolna'
    model            text,                                    -- 'claude-opus-4','gpt-5',...
    temperature      numeric,                                 -- sampling temperature actually used
    top_p            numeric,                                 -- nucleus sampling cutoff actually used
    max_tokens       integer,                                 -- output cap requested
    context_window   integer,                                 -- model context window at run time
    tokens_in        integer,                                 -- prompt tokens billed
    tokens_out       integer,                                 -- completion tokens billed
    cached_tokens    integer,                                 -- prompt-cache / KV-cache hits (billed cheaper)
    cost_usd         numeric(12,6),
    cost_inr         numeric(12,4),

    -- ---- Provenance: WHICH configuration produced this run.
    prompt_version   integer,                                 -- oem_agents.system_prompt_version at run time
    bundle_version   integer,                                 -- oem_agent_bundles.version active at run time

    -- ---- Outcome
    outcome_summary  text,                                    -- one line the operator reads
    entity_ref       text,                                    -- id/URL of what it produced or touched
    error            text,
    error_class      text,                                    -- 'llm_timeout','rate_limited','bundle_violation','bad_json',...
    grounded         boolean,                                 -- did every claim trace to a bundle table row
    confidence       numeric,                                 -- 0..1 self-reported, calibrated against feedback

    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, agent_key, run_key)
);

CREATE INDEX IF NOT EXISTS idx_oem_runs_agent
    ON public.oem_agent_runs(organization_id, agent_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_oem_runs_module
    ON public.oem_agent_runs(organization_id, module, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_oem_runs_status
    ON public.oem_agent_runs(organization_id, status);
-- THE REAPER'S INDEX. reapStaleRuns() (backend/lib/agents/runtime.ts, called on
-- the agent-heartbeat sweep) scans ACROSS ALL ORGS:
--     WHERE status = 'running' AND started_at < cutoff ORDER BY started_at LIMIT n
-- Every index above leads with organization_id, so none of them can serve a query
-- with no org in the predicate — without this one the sweep degrades to a seq scan
-- of the whole run history, which grows without bound while the set it is actually
-- looking for stays tiny. Partial on status = 'running' so the index holds only
-- in-flight runs (a few rows at any moment, and each one is deleted from the index
-- the moment it is settled), and ordered on started_at so the reaper's oldest-first
-- ORDER BY ... LIMIT is a bounded index scan rather than a sort of the candidates.
CREATE INDEX IF NOT EXISTS idx_oem_runs_reaper
    ON public.oem_agent_runs(started_at)
    WHERE status = 'running';

COMMENT ON COLUMN public.oem_agent_runs.run_key IS
    'Idempotency key. UNIQUE with (organization_id, agent_key) so a cron retry INSERTS-OR-RETURNS-EXISTING rather than double-logging: the loser of the race catches 23505, re-selects the row and hands it back UNCHANGED. This is not an upsert and must never become one. A retry does not re-open a finished run, does not reset status, ended_at, cost_usd, outcome_summary or grounded, and does not extend the step trace — success_rate, uptime and the latency percentiles in oem_agent_profile are computed from these rows, so a rewritten run is rewritten history, not a correction. See startRun in backend/lib/agents/runtime.ts and section 10 (no UPDATE policy on this table).';
COMMENT ON COLUMN public.oem_agent_runs.cached_tokens IS
    'Prompt-cache / KV-cache hits. Subset of tokens_in that was served from cache and billed at the cached rate.';
COMMENT ON COLUMN public.oem_agent_runs.grounded IS
    'True when every factual claim in the output traced back to a row in a table listed in the active bundle.';


-- ---------------------------------------------------------------------------
-- 2. RUN STEPS — the live step trace. One row per step, ordered by seq.
--    Renders as: "Fetching open requisitions" -> "Calling model" ->
--    "Writing draft PO" -> "Notifying procurement". This is the feed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_run_steps (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           uuid NOT NULL REFERENCES public.oem_agent_runs(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    seq              integer NOT NULL,
    step_type        text NOT NULL DEFAULT 'think' CHECK (step_type IN ('plan','think','llm','tool','fetch','write','notify','decide','error')),
    label            text NOT NULL,                           -- 'Fetching open requisitions'
    detail           jsonb DEFAULT '{}'::jsonb,               -- tool args, row counts, snippet, model response head
    tokens_in        integer,
    tokens_out       integer,
    duration_ms      integer,
    status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed','skipped')),
    started_at       timestamptz NOT NULL DEFAULT now(),
    ended_at         timestamptz,
    UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_oem_run_steps_run ON public.oem_agent_run_steps(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_oem_run_steps_org ON public.oem_agent_run_steps(organization_id, started_at DESC);

COMMENT ON TABLE public.oem_agent_run_steps IS
    'Step-by-step execution trace rendered as a live activity feed. Append a row when a step starts, update it when it ends.';
COMMENT ON COLUMN public.oem_agent_run_steps.seq IS
    'Position in the trace, 1-based per run. UNIQUE (run_id, seq) is a CONCURRENCY constraint, not just a tidiness one, and the two writers are held to it differently on purpose. (1) THE IN-PROCESS RECORDER (makeStepRecorder in backend/lib/agents/runtime.ts) owns its trace: startRun only builds a recorder for a row it just inserted, so seq 1 is always free and a 23505 can only mean rows exist under a seq it never wrote — the trace is somebody else''s. It REFUSES to renumber, stops writing steps for the rest of the run and says so once. A short trace is a small loss; a trace that merges two executions is a lie about what the agent did. (2) THE HTTP APPEND PATH (insertSteps in app/api/agents/runs/[runId]/route.ts) serves several legitimate external writers on the same LIVE run, where an interleaving is ordinary rather than a fault: it catches 23505, re-reads max(seq), renumbers and retries, and after the last attempt answers HTTP 200 with appended:false, reason:''seq_conflict'' instead of a 500. A multi-row insert is atomic, so a rejected batch leaves no half-written trace and can be resent unchanged. BOTH PATHS AGREE ON THE LIMIT: nothing may be appended to a run whose status is terminal (succeeded/failed/skipped/timeout). That run is settled. The route refuses with 409; the table refuses by having no UPDATE policy at all and no UPDATE grant to anon/authenticated (section 10), so a step row, once written, is a fact about a moment that has passed.';


-- ---------------------------------------------------------------------------
-- 3. HEARTBEATS — uptime. "When they went down, and what the reason was."
--    The scheduler writes one beat per heartbeat_interval_sec per live agent.
--    `reason` is a machine slug so the console can group outages by cause.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_heartbeats (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,
    beat_at          timestamptz NOT NULL DEFAULT now(),
    state            text NOT NULL DEFAULT 'up' CHECK (state IN ('up','degraded','down')),
    reason           text,                                    -- 'ok','llm_key_missing','bolna_401','rate_limited','quiet_hours','timeout','no_schedule'
    latency_ms       integer,                                 -- probe round-trip
    detail           jsonb DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_heartbeats_agent
    ON public.oem_agent_heartbeats(organization_id, agent_key, beat_at DESC);
CREATE INDEX IF NOT EXISTS idx_oem_heartbeats_down
    ON public.oem_agent_heartbeats(organization_id, beat_at DESC) WHERE state <> 'up';

COMMENT ON COLUMN public.oem_agent_heartbeats.reason IS
    'Machine slug, not prose. Lets the console group outages by cause: llm_key_missing, bolna_401, rate_limited, quiet_hours, ok.';


-- ---------------------------------------------------------------------------
-- 4. FEEDBACK — reinforcement. Two signals, per the operating model:
--      (a) reward   — praise, worth coins
--      (b) ROI flag — "the job done is not in the ROI of the company"
--    `guidance` is the free-text natural-language correction the operator
--    typed. It is the raw material for the NEXT prompt version;
--    applied_to_prompt_version is NULL until a regeneration absorbs it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_feedback (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key                 text NOT NULL,
    run_id                    uuid REFERENCES public.oem_agent_runs(id) ON DELETE SET NULL,
    signal                    text NOT NULL CHECK (signal IN ('praise','reject','correction','roi_flag')),
    coins                     integer NOT NULL DEFAULT 0,     -- positive reward, or negative on reject
    roi_flag                  boolean NOT NULL DEFAULT false, -- work done outside the company's ROI
    reason                    text,                           -- short slug/label the operator picked
    guidance                  text,                           -- FREE TEXT correction, folded into the next prompt version
    applied_to_prompt_version integer,                        -- NULL = still pending, waiting to be absorbed
    created_by                uuid REFERENCES public.users(id),
    created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_feedback_agent
    ON public.oem_agent_feedback(organization_id, agent_key, created_at DESC);
-- Pending guidance: what the next prompt regeneration must read.
CREATE INDEX IF NOT EXISTS idx_oem_feedback_pending
    ON public.oem_agent_feedback(organization_id, agent_key)
    WHERE applied_to_prompt_version IS NULL;
CREATE INDEX IF NOT EXISTS idx_oem_feedback_run
    ON public.oem_agent_feedback(run_id);

COMMENT ON COLUMN public.oem_agent_feedback.guidance IS
    'Natural-language correction typed by an operator. Prompt regeneration reads every row where applied_to_prompt_version IS NULL, folds them in, then stamps them with the new version.';


-- ---------------------------------------------------------------------------
-- 5. COIN LEDGER — Autopilot coins as an append-only ledger. balance_after is
--    stored so any row is independently auditable; oem_agents.coins_balance is
--    a cache kept in sync by trigger below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_coin_ledger (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,
    delta            integer NOT NULL,
    balance_after    integer NOT NULL,
    reason           text,
    feedback_id      uuid REFERENCES public.oem_agent_feedback(id) ON DELETE SET NULL,
    run_id           uuid REFERENCES public.oem_agent_runs(id) ON DELETE SET NULL,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_coins_agent
    ON public.oem_agent_coin_ledger(organization_id, agent_key, created_at DESC);

COMMENT ON TABLE public.oem_agent_coin_ledger IS
    'Append-only. Never UPDATE a row to correct a balance — post a compensating delta.';


-- ---------------------------------------------------------------------------
-- 6. CREDENTIALS — per-agent secrets. SERVICE ROLE ONLY. See header.
--    One row per (org, agent, purpose): the LLM key, the voice key, the
--    WhatsApp key, the telephony key. meta holds the NON-secret settings the
--    UI may display: from_number, voice_id, provider agent_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_credentials (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,
    purpose          text NOT NULL CHECK (purpose IN ('llm','voice','whatsapp','telephony')),
    provider         text,                                    -- 'anthropic','openai','bolna','elevenlabs','wasender'
    secret_ref       text,                                    -- NAME of an env var, e.g. 'BOLNA_API_KEY'. PREFERRED.
    secret_enc       bytea,                                   -- pgcrypto pgp_sym_encrypt() output, only when pasted in the UI
    last4            text,                                    -- masked display only
    meta             jsonb DEFAULT '{}'::jsonb,               -- NON-secret: from_number, voice_id, agent_id, base_url
    updated_by       uuid REFERENCES public.users(id),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, agent_key, purpose)
);

CREATE INDEX IF NOT EXISTS idx_oem_credentials_agent
    ON public.oem_agent_credentials(organization_id, agent_key);

COMMENT ON TABLE public.oem_agent_credentials IS
    'SECRETS. RLS enabled with NO permissive policy: anon and authenticated see zero rows; only the service role reads it. The API must never return secret_enc or a decrypted value to a client — last4 and meta only. Prefer secret_ref (env var name) over secret_enc.';
COMMENT ON COLUMN public.oem_agent_credentials.secret_ref IS
    'Name of a server environment variable holding the secret. Preferred: the secret never enters the database.';
COMMENT ON COLUMN public.oem_agent_credentials.secret_enc IS
    'pgcrypto pgp_sym_encrypt(secret, key). Requires the pgcrypto extension. NEVER expose this column, or its decryption, through any client-facing API.';


-- ---------------------------------------------------------------------------
-- 7. COLUMNS ON oem_agents — live health, reward balance, and the two config
--    blobs the sandbox edits. Everything an operator changes at runtime lives
--    in `runtime` / `model_config`, so configuration is a UI act, not a deploy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.oem_agents
    ADD COLUMN IF NOT EXISTS health_state       text DEFAULT 'unknown' CHECK (health_state IN ('up','degraded','down','unknown')),
    ADD COLUMN IF NOT EXISTS last_heartbeat_at  timestamptz,
    ADD COLUMN IF NOT EXISTS reliability_score  numeric,
    ADD COLUMN IF NOT EXISTS coins_balance      integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS runtime            jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS model_config       jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.oem_agents.runtime IS
    'Operator-editable schedule + safety envelope: {schedule_cron, timezone, quiet_hours:{from,to}, heartbeat_interval_sec, max_runs_per_day, max_cost_inr_per_day, timeout_sec, autonomy:"suggest"|"act"}.';
COMMENT ON COLUMN public.oem_agents.model_config IS
    'Operator-editable inference settings: {provider, model, temperature, top_p, max_tokens, context_window}. Copied onto each oem_agent_runs row so a past run stays explainable after the config changes.';
COMMENT ON COLUMN public.oem_agents.reliability_score IS
    'Cached copy of oem_agent_profile.reliability_score. The view is the source of truth.';
COMMENT ON COLUMN public.oem_agents.coins_balance IS
    'Cache of the running total in oem_agent_coin_ledger, maintained by trigger. The ledger is the source of truth.';


-- ---------------------------------------------------------------------------
-- 8. TRIGGERS — keep the caches honest and the timings filled.
-- ---------------------------------------------------------------------------

-- 8a. duration_ms is derived; fill it whenever ended_at is set and it is null.
CREATE OR REPLACE FUNCTION public.oem_fill_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ended_at IS NOT NULL AND NEW.duration_ms IS NULL THEN
        NEW.duration_ms := GREATEST(0, (EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) * 1000)::integer);
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oem_runs_duration ON public.oem_agent_runs;
CREATE TRIGGER trg_oem_runs_duration
    BEFORE INSERT OR UPDATE ON public.oem_agent_runs
    FOR EACH ROW EXECUTE FUNCTION public.oem_fill_duration();

DROP TRIGGER IF EXISTS trg_oem_run_steps_duration ON public.oem_agent_run_steps;
CREATE TRIGGER trg_oem_run_steps_duration
    BEFORE INSERT OR UPDATE ON public.oem_agent_run_steps
    FOR EACH ROW EXECUTE FUNCTION public.oem_fill_duration();

-- 8b. A heartbeat is the freshest truth about liveness — push it onto the
--     registry row so a list query needs no join.
CREATE OR REPLACE FUNCTION public.oem_apply_heartbeat()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.oem_agents
       SET health_state      = NEW.state,
           last_heartbeat_at = NEW.beat_at
     WHERE organization_id = NEW.organization_id
       AND agent_key       = NEW.agent_key
       AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= NEW.beat_at);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oem_heartbeat_apply ON public.oem_agent_heartbeats;
CREATE TRIGGER trg_oem_heartbeat_apply
    AFTER INSERT ON public.oem_agent_heartbeats
    FOR EACH ROW EXECUTE FUNCTION public.oem_apply_heartbeat();

-- 8c. Ledger row lands -> registry cache follows.
CREATE OR REPLACE FUNCTION public.oem_apply_coin_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.oem_agents
       SET coins_balance = NEW.balance_after
     WHERE organization_id = NEW.organization_id
       AND agent_key       = NEW.agent_key;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oem_coin_ledger_apply ON public.oem_agent_coin_ledger;
CREATE TRIGGER trg_oem_coin_ledger_apply
    AFTER INSERT ON public.oem_agent_coin_ledger
    FOR EACH ROW EXECUTE FUNCTION public.oem_apply_coin_ledger();

-- 8d. updated_at on credentials (reuses the OEM touch function).
CREATE OR REPLACE FUNCTION public.oem_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oem_credentials_touch ON public.oem_agent_credentials;
CREATE TRIGGER trg_oem_credentials_touch
    BEFORE UPDATE ON public.oem_agent_credentials
    FOR EACH ROW EXECUTE FUNCTION public.oem_touch_updated_at();

-- 8e. Award coins atomically: serialises on (org, agent_key), reads the current
--     balance, appends the ledger row, returns the new balance. API code should
--     call this rather than computing balance_after itself.
--
--     LOCKING. The lock is a TRANSACTION-scoped advisory lock, taken
--     unconditionally as the first statement, and it is the only lock this
--     function relies on. That is deliberate:
--
--       * `SELECT ... FOR UPDATE` on oem_agents locks NOTHING when the agent is
--         not registered yet — there is no row to lock — so the unregistered
--         path (which falls back to SUM(delta) over the ledger) used to run with
--         no mutual exclusion at all. Two concurrent awards for an unregistered
--         agent both read the same running total and both write the same
--         balance_after, silently losing one award. The advisory lock covers
--         that path because it is keyed on the identity, not on a row.
--       * pg_advisory_xact_lock is released by the transaction ending — commit,
--         rollback, or an exception thrown anywhere below. There is no unlock
--         statement, so there is no early-return path that can skip one. Do not
--         replace it with pg_advisory_lock (session scope): that one DOES have
--         to be released by hand, and every RETURN below would become a leak.
--
--     The row lock is kept as well, so a concurrent UPDATE of oem_agents by
--     other code still serialises against the cache write the trigger performs.
CREATE OR REPLACE FUNCTION public.oem_award_coins(
    p_org        uuid,
    p_agent_key  text,
    p_delta      integer,
    p_reason     text     DEFAULT NULL,
    p_feedback   uuid     DEFAULT NULL,
    p_run        uuid     DEFAULT NULL,
    p_created_by uuid     DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_balance integer;
BEGIN
    -- Unconditional, transaction-scoped: held for every path below, released by
    -- the transaction ending. Namespaced on a constant so it cannot collide with
    -- another subsystem's advisory locks.
    PERFORM pg_advisory_xact_lock(
        hashtext('oem_agent_coins'),
        hashtext(p_org::text || ':' || p_agent_key)
    );

    SELECT coins_balance INTO v_balance
      FROM public.oem_agents
     WHERE organization_id = p_org AND agent_key = p_agent_key
     FOR UPDATE;

    IF v_balance IS NULL THEN
        -- Agent not registered yet: fall back to the ledger's own running total.
        -- Correct only because the advisory lock above is already held.
        SELECT COALESCE(SUM(delta), 0) INTO v_balance
          FROM public.oem_agent_coin_ledger
         WHERE organization_id = p_org AND agent_key = p_agent_key;
    END IF;

    v_balance := v_balance + p_delta;

    INSERT INTO public.oem_agent_coin_ledger
        (organization_id, agent_key, delta, balance_after, reason, feedback_id, run_id, created_by)
    VALUES
        (p_org, p_agent_key, p_delta, v_balance, p_reason, p_feedback, p_run, p_created_by);

    RETURN v_balance;
END $$;


-- ---------------------------------------------------------------------------
-- 9. PROFILE VIEW — the 30-day agent profile. One row per registered agent,
--    including agents that have never run (all metrics NULL/0, never an error).
--
--    RELIABILITY SCORE — documented, retunable weighted blend:
--
--        reliability_score =  0.50 * success_rate          (did the work finish)
--                           + 0.30 * uptime_pct            (was it even alive)
--                           + 0.20 * (100 - roi_flag_rate) (was the work worth doing)
--
--    Weights live in the CASE expression below; change the three literals to
--    retune. They must sum to 1.00.
--
--    SUCCESS RATE — ONE DEFINITION, SHARED WITH app/api/agents/runs/route.ts:
--
--        success_rate = 100 * succeeded / (succeeded + failed + timeout),
--                       counting only runs whose trigger is not 'shadow';
--                       NULL when that denominator is 0.
--
--    ONE FORMULA, TWO WINDOWS — AND THAT IS DELIBERATE.
--    Sharing the formula does NOT make the two surfaces print the same number,
--    and an earlier version of this file claimed it did ("must agree"). It
--    cannot: this view aggregates a fixed rolling 30 days, uncapped; the runs
--    endpoint aggregates whatever the caller filtered to (?agentKey, ?module,
--    ?status, ?from, ?to — unbounded by default) over at most the 5000 most
--    recent rows. Two different sets, so two different percentages, both right.
--    Forcing equality would mean either freezing the API's filters or windowing
--    this view to match a request it cannot see. So the invariant is legibility
--    instead: each surface DECLARES its scope in its own payload — here
--    stats_window_days / stats_row_cap, there totals.sampled / totals.truncated
--    — and any UI showing both must label them. A number without its window is
--    the actual bug; two labelled numbers are two answers, not a contradiction.
--
--      * A 'running' run is neither a success nor a failure. Dividing by every
--        row (as this view used to) meant one succeeded run + one in-flight run
--        scored 50.0 here while the Activity header — which already excluded
--        in-flight runs — read 100.0% off the SAME rows. Two numbers that
--        disagree side by side make both untrustworthy, and this one is
--        weighted 0.50 of reliability_score, so the disagreement propagated.
--      * A 'skipped' run did not attempt the work. Counting it as a non-success
--        punishes an agent for correctly deciding there was nothing to do.
--      * A 'shadow' run is a REHEARSAL. It exists to be watched before an agent
--        goes live and must never score the agent — so it is excluded from
--        success_rate, from roi_flag_rate, and therefore from reliability_score
--        entirely. Its tokens and cost are still counted; only the score is not.
--      * NULL, never 0.0, on an empty denominator. "No settled runs yet" is not
--        "0% success". Consumers must render NULL as "—".
--
--      uptime_pct    = 'up' beats       / total beats        * 100
--      roi_flag_rate = ROI-flagged runs / non-shadow runs    * 100, capped at 100
--    When one input has no data (no runs, or no beats) it is substituted with
--    the other rather than treated as zero, so a healthy agent is not punished
--    for a missing probe. With neither runs nor beats the score is NULL —
--    "not measured yet" is not the same as "unreliable".
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.oem_agent_profile;

CREATE VIEW public.oem_agent_profile
WITH (security_invoker = true) AS
WITH runs AS (
    SELECT
        organization_id,
        agent_key,
        count(*)                                                  AS runs_total,
        count(*) FILTER (WHERE status = 'succeeded')              AS runs_succeeded,
        count(*) FILTER (WHERE status = 'failed')                 AS runs_failed,
        count(*) FILTER (WHERE status = 'running')                AS runs_in_flight,
        -- ---- SCORING WINDOW. See the success_rate note in section 9's header.
        --      runs_scored is the ONLY denominator success_rate may use: settled
        --      (succeeded/failed/timeout) and not a rehearsal.
        count(*) FILTER (WHERE "trigger" = 'shadow')              AS runs_shadow,
        count(*) FILTER (WHERE "trigger" <> 'shadow')             AS runs_non_shadow,
        count(*) FILTER (WHERE "trigger" <> 'shadow'
                           AND status IN ('succeeded','failed','timeout'))
                                                                  AS runs_scored,
        count(*) FILTER (WHERE "trigger" <> 'shadow'
                           AND status = 'succeeded')              AS runs_scored_succeeded,
        COALESCE(sum(tokens_in), 0)                               AS tokens_in_total,
        COALESCE(sum(tokens_out), 0)                              AS tokens_out_total,
        COALESCE(sum(cached_tokens), 0)                           AS cached_tokens_total,
        COALESCE(sum(cost_usd), 0)                                AS cost_usd_total,
        COALESCE(sum(cost_inr), 0)                                AS cost_inr_total,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_duration_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
        max(started_at)                                           AS last_run_at
    FROM public.oem_agent_runs
    WHERE started_at >= now() - INTERVAL '30 days'
    GROUP BY organization_id, agent_key
),
beats AS (
    SELECT
        organization_id,
        agent_key,
        count(*)                                     AS beats_total,
        count(*) FILTER (WHERE state = 'up')         AS beats_up,
        count(*) FILTER (WHERE state = 'down')       AS beats_down,
        count(*) FILTER (WHERE state = 'degraded')   AS beats_degraded,
        avg(latency_ms)                              AS avg_latency_ms
    FROM public.oem_agent_heartbeats
    WHERE beat_at >= now() - INTERVAL '30 days'
    GROUP BY organization_id, agent_key
),
fb AS (
    SELECT
        organization_id,
        agent_key,
        count(*) FILTER (WHERE roi_flag)                                  AS roi_flags_30d,
        count(*) FILTER (WHERE signal = 'praise')                         AS praise_30d,
        count(*) FILTER (WHERE signal = 'reject')                         AS rejects_30d,
        count(*) FILTER (WHERE signal = 'correction')                     AS corrections_30d
    FROM public.oem_agent_feedback
    WHERE created_at >= now() - INTERVAL '30 days'
    GROUP BY organization_id, agent_key
),
-- Pending guidance is a STATE, not a window: corrections stay pending until a
-- prompt regeneration absorbs them, however old they are. No 30-day filter.
pend AS (
    SELECT organization_id, agent_key, count(*) AS pending_guidance
    FROM public.oem_agent_feedback
    WHERE applied_to_prompt_version IS NULL AND guidance IS NOT NULL
    GROUP BY organization_id, agent_key
),
base AS (
    SELECT
        a.organization_id,
        a.agent_key,
        a.display_name,
        a.department,
        a.status,
        a.health_state,
        a.last_heartbeat_at,
        a.coins_balance,
        a.system_prompt_version                                       AS prompt_version,
        COALESCE(r.runs_total, 0)::integer                            AS runs_total,
        COALESCE(r.runs_succeeded, 0)::integer                        AS runs_succeeded,
        COALESCE(r.runs_failed, 0)::integer                           AS runs_failed,
        COALESCE(r.runs_in_flight, 0)::integer                        AS runs_in_flight,
        COALESCE(r.runs_shadow, 0)::integer                           AS runs_shadow,
        COALESCE(r.runs_non_shadow, 0)::integer                       AS runs_non_shadow,
        COALESCE(r.runs_scored, 0)::integer                           AS runs_scored,
        COALESCE(r.runs_scored_succeeded, 0)::integer                 AS runs_scored_succeeded,
        COALESCE(r.tokens_in_total, 0)::bigint                        AS tokens_in_total,
        COALESCE(r.tokens_out_total, 0)::bigint                       AS tokens_out_total,
        COALESCE(r.cached_tokens_total, 0)::bigint                    AS cached_tokens_total,
        round(COALESCE(r.cost_usd_total, 0), 4)                       AS cost_usd_total,
        round(COALESCE(r.cost_inr_total, 0), 2)                       AS cost_inr_total,
        round(r.p50_duration_ms::numeric, 0)                          AS p50_duration_ms,
        round(r.p95_duration_ms::numeric, 0)                          AS p95_duration_ms,
        r.last_run_at,
        COALESCE(b.beats_total, 0)::integer                           AS beats_total,
        COALESCE(b.beats_up, 0)::integer                              AS beats_up,
        COALESCE(b.beats_down, 0)::integer                            AS beats_down,
        COALESCE(b.beats_degraded, 0)::integer                        AS beats_degraded,
        round(b.avg_latency_ms::numeric, 0)                           AS avg_latency_ms,
        COALESCE(f.roi_flags_30d, 0)::integer                         AS roi_flags_30d,
        COALESCE(f.praise_30d, 0)::integer                            AS praise_30d,
        COALESCE(f.rejects_30d, 0)::integer                           AS rejects_30d,
        COALESCE(f.corrections_30d, 0)::integer                       AS corrections_30d,
        COALESCE(g.pending_guidance, 0)::integer                      AS pending_guidance,
        -- ---- success_rate. THE definition, identical to app/api/agents/runs/route.ts:
        --      succeeded / (succeeded + failed + timeout), non-shadow runs only.
        --      NULL — not 0.0 — when nothing has settled: "no settled runs yet" is not
        --      "0% success", and a freshly registered agent must not read as failing.
        CASE WHEN COALESCE(r.runs_scored, 0) = 0 THEN NULL
             ELSE round(r.runs_scored_succeeded * 100.0 / r.runs_scored, 1) END AS success_rate,
        -- uptime_pct: NULL when no probe ever ran
        CASE WHEN COALESCE(b.beats_total, 0) = 0 THEN NULL
             ELSE round(b.beats_up * 100.0 / b.beats_total, 1) END             AS uptime_pct,
        -- ---- roi_flag_rate: share of runs the business judged not worth doing. Denominator
        --      is non-shadow runs of every status, because a flag can land on a run that is
        --      still going. Rehearsals are excluded here too — the whole reliability score is
        --      a judgement on real work.
        CASE WHEN COALESCE(r.runs_non_shadow, 0) = 0 THEN NULL
             ELSE LEAST(100, round(COALESCE(f.roi_flags_30d, 0) * 100.0 / r.runs_non_shadow, 1)) END AS roi_flag_rate
    FROM public.oem_agents a
    LEFT JOIN runs  r ON r.organization_id = a.organization_id AND r.agent_key = a.agent_key
    LEFT JOIN beats b ON b.organization_id = a.organization_id AND b.agent_key = a.agent_key
    LEFT JOIN fb    f ON f.organization_id = a.organization_id AND f.agent_key = a.agent_key
    LEFT JOIN pend  g ON g.organization_id = a.organization_id AND g.agent_key = a.agent_key
)
SELECT
    base.*,
    -- ---- RELIABILITY SCORE. Weights: 0.50 success, 0.30 uptime, 0.20 ROI.
    CASE
        WHEN success_rate IS NULL AND uptime_pct IS NULL THEN NULL
        ELSE GREATEST(0, LEAST(100, round(
              0.50 * COALESCE(success_rate, uptime_pct)
            + 0.30 * COALESCE(uptime_pct,  success_rate)
            + 0.20 * (100 - COALESCE(roi_flag_rate, 0))
        , 1)))
    END AS reliability_score,
    -- ---- THE WINDOW THIS ROW IS REPORTING, CARRIED IN THE ROW ITSELF.
    --      Every number above (except pending_guidance, which is a state) is a
    --      rolling 30-day, uncapped aggregate. GET /api/agents/runs computes the
    --      SAME FORMULAS over a DIFFERENT SET: whatever the caller filtered to,
    --      capped at the 5000 most recent rows. So the two surfaces can print
    --      different percentages for the same agent and both be correct — they
    --      are answering two different questions.
    --
    --      There is no way to force them equal without crippling one of them
    --      (the API must honour ?from/?to/?agentKey/?module/?status; the view
    --      must be a fixed, comparable rollup). The fix is therefore LEGIBILITY,
    --      not equality: each surface states its own window, so a UI showing
    --      both is obliged to label them and a reader sees two questions rather
    --      than a contradiction. The API side already ships totals.sampled and
    --      totals.truncated; these two columns are this side of that contract.
    --      Render them — "last 30 days" next to the number, always.
    30                       AS stats_window_days,
    NULL::integer            AS stats_row_cap
FROM base;

COMMENT ON VIEW public.oem_agent_profile IS
    'Per-agent 30-day rollup: throughput, token and cost totals, p50/p95 latency, uptime, coins, ROI flags, and a weighted reliability score (0.50 success_rate + 0.30 uptime_pct + 0.20 (100 - roi_flag_rate)). security_invoker: base-table RLS applies, so it is org-scoped for authenticated callers.';
COMMENT ON COLUMN public.oem_agent_profile.success_rate IS
    'succeeded / (succeeded + failed + timeout) * 100 over non-shadow runs STARTED IN THE LAST 30 DAYS, no row cap; NULL when that denominator is 0. In-flight and skipped runs are not in the denominator; shadow runs (rehearsals) are excluded from scoring entirely. NULL renders as an em dash, never 0. SAME FORMULA AS totals.success_rate IN GET /api/agents/runs, NOT THE SAME NUMBER: that endpoint applies the identical expression to the caller-filtered set (?agentKey/?module/?status/?from/?to, default unbounded) capped at the 5000 most recent runs, so the two legitimately differ. Do not treat a difference as a bug and do not render them as one figure — label each with its window (this one: stats_window_days, uncapped; the API: totals.sampled / totals.truncated). They coincide only when the caller asks for from = now() - 30 days, to = now(), no other filter, and gets truncated = false.';
COMMENT ON COLUMN public.oem_agent_profile.runs_scored IS
    'The success_rate denominator, exposed so a consumer can show its working (19/20) and can tell "no settled runs yet" from "0% success".';
COMMENT ON COLUMN public.oem_agent_profile.runs_shadow IS
    'Rehearsal runs in the window. Counted and costed, never scored.';
COMMENT ON COLUMN public.oem_agent_profile.stats_window_days IS
    'Constant 30. The rolling window every aggregate in this row is computed over, carried in the row so a consumer can print "last 30 days" beside the number instead of implying it is all-time. pending_guidance is the one exception: it is an open-item state with no window (see the pend CTE).';
COMMENT ON COLUMN public.oem_agent_profile.stats_row_cap IS
    'Constant NULL: this view aggregates every matching row in the window, uncapped. It exists so the pair (stats_window_days, stats_row_cap) states this surface''s scope in the same terms GET /api/agents/runs states its own (totals.sampled with a 5000-row AGGREGATE_CAP, totals.truncated). Two surfaces sharing a formula but not a scope must each declare the scope, or the same agent appears to have two success rates.';


-- ---------------------------------------------------------------------------
-- 10. RLS
--     Runs / steps / heartbeats / feedback / ledger: org-scoped like the rest
--     of the oem_* family, so the console can read them from the browser.
--
--     THE EXECUTION LOG IS AN AUDIT RECORD, NOT USER CONTENT, so the five
--     tables do not get the same verbs:
--
--       oem_agent_runs        SELECT + INSERT for org members. NO UPDATE POLICY.
--       oem_agent_run_steps   SELECT + INSERT for org members. NO UPDATE POLICY.
--       heartbeats / feedback / coin_ledger   SELECT + INSERT + UPDATE, as before.
--
--     These two used to carry "oem_update_org_member" ON UPDATE
--     USING (oem_is_org_member(organization_id)) — a membership test with no
--     role gate, i.e. ANY authenticated member of the org could rewrite ANY run
--     in it: take a run that succeeded yesterday back to status 'running', null
--     its outcome_summary, ended_at, cost_usd and grounded flag, then append
--     steps the agent never took. success_rate, uptime, cost and every latency
--     percentile in oem_agent_profile are computed from these rows, so that is
--     not an edit, it is a rewrite of history that has already been read and
--     billed. A step row is stricter still: it is never updatable by anyone,
--     because a step is a fact about a moment that has passed.
--
--     NO POLICY = SERVICE ROLE ONLY (service_role has BYPASSRLS), which is
--     exactly the set of writers that actually exists: startRun and
--     makeStepRecorder in backend/lib/agents/runtime.ts write through
--     supabaseAdmin, and so does the cron path of the runs API.
--
--     The repo does have a clean org-admin predicate — organization_memberships
--     om WHERE om.user_id = auth.uid() AND om.is_active AND om.role::text IN
--     ('org_super_admin','org_admin','master_admin'), as used by
--     document_bank_update_owner_or_admin in 20260827000001_document_bank.sql —
--     and it is DELIBERATELY NOT USED here. Nothing in the product edits a
--     finished run from the browser, and an audit log an admin can quietly
--     rewrite is still a rewritable audit log. If an admin-correction workflow
--     ever ships, add the predicate then, and have it write the correction as a
--     new row rather than over the old one (the same "supersede, don't
--     overwrite" restraint oem_measurements takes in 20260825000002).
--
--     CONSEQUENCE FOR SERVER CODE. A PATCH on a run through the
--     anon/authenticated client now raises 42501 against the REVOKE below (or,
--     if that grant is ever restored, affects zero rows). That is a PERMISSION.
--     It is not a missing table and it is not a server fault, and it must never
--     be flattened into a 500: the PATCH handler in
--     app/api/agents/runs/[runId]/route.ts answers 403 for it, and 409 for the
--     separate case of a run that is already terminal.
--
--     INSERT stays open to org members on purpose: POST /api/agents/runs is a
--     real browser path (the sandbox "run now") and already maps an RLS refusal
--     to 403. It opens NEW rows only — it cannot touch one already written.
--
--     There is deliberately NO DELETE policy on any of these tables. A run log a
--     member can erase is not a log. The consequence is that a DELETE issued
--     through the anon/authenticated client silently affects zero rows and
--     returns no error, so server code must never treat one as a rollback:
--     verify the delete returned a row, or use the service role, or say plainly
--     that the row is still there (see unwindPartialRun in
--     app/api/agents/runs/route.ts).
--     Credentials: RLS ON, NO POLICY. Service role only. See header.
-- ---------------------------------------------------------------------------
ALTER TABLE public.oem_agent_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_run_steps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_heartbeats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_coin_ledger ENABLE ROW LEVEL SECURITY;

-- (a) MEMBER-WRITABLE. Heartbeats are runtime-written but self-correcting, and
--     feedback and coins genuinely are user content: a thumbs-down on a run and
--     an awarded coin are things a person does, not things the log records.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'oem_agent_heartbeats','oem_agent_feedback','oem_agent_coin_ledger'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "oem_select_org_member" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_insert_org_member" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_update_org_member" ON public.%I', t);

        EXECUTE format(
            'CREATE POLICY "oem_select_org_member" ON public.%I FOR SELECT
             USING (public.oem_is_org_member(organization_id))', t);
        EXECUTE format(
            'CREATE POLICY "oem_insert_org_member" ON public.%I FOR INSERT
             WITH CHECK (public.oem_is_org_member(organization_id))', t);
        EXECUTE format(
            'CREATE POLICY "oem_update_org_member" ON public.%I FOR UPDATE
             USING (public.oem_is_org_member(organization_id))', t);
    END LOOP;
END $$;

-- (b) AUDIT RECORDS. SELECT + INSERT only. The UPDATE policy is DROPPED AND NOT
--     RECREATED — that drop is the fix, and it has to keep running so that an
--     earlier version of this migration, or a hand edit against a live database,
--     is undone rather than preserved. Read the note above before adding one back.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['oem_agent_runs','oem_agent_run_steps']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "oem_select_org_member" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_insert_org_member" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_update_org_member" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_update_authenticated" ON public.%I', t);

        EXECUTE format(
            'CREATE POLICY "oem_select_org_member" ON public.%I FOR SELECT
             USING (public.oem_is_org_member(organization_id))', t);
        EXECUTE format(
            'CREATE POLICY "oem_insert_org_member" ON public.%I FOR INSERT
             WITH CHECK (public.oem_is_org_member(organization_id))', t);
        -- No FOR UPDATE policy. Service role only, by construction.
    END LOOP;
END $$;

-- Second lock, the same one oem_agent_credentials uses below: withdraw the
-- table-level UPDATE grant from the two roles PostgREST runs as, so restoring
-- the hole takes two deliberate acts rather than one careless CREATE POLICY.
-- service_role keeps its own grant and BYPASSRLS, so the runtime is unaffected.
-- SELECT and INSERT are untouched; DELETE was never granted a policy.
REVOKE UPDATE ON public.oem_agent_runs      FROM anon, authenticated;
REVOKE UPDATE ON public.oem_agent_run_steps FROM anon, authenticated;

-- SECRETS. Row level security on, deliberately with no permissive policy:
-- anon and authenticated match nothing and read nothing. The service role
-- bypasses RLS and is the only way in. Do not add a policy here.
ALTER TABLE public.oem_agent_credentials ENABLE ROW LEVEL SECURITY;
-- Second lock: even the table-level grant is withdrawn from the two roles
-- PostgREST runs as. service_role has BYPASSRLS and its own grant, so server
-- code is unaffected. (FORCE ROW LEVEL SECURITY is deliberately NOT set — it
-- would lock the owning migration role out of its own table for no gain here.)
REVOKE ALL ON public.oem_agent_credentials FROM anon, authenticated;

-- Belt and braces: drop anything a previous run or a hand edit may have added.
DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'oem_agent_credentials'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.oem_agent_credentials', p.policyname);
    END LOOP;
END $$;

-- The coin-award helper runs as the caller; it must not become a privilege
-- escalation path for anon.
REVOKE ALL ON FUNCTION public.oem_award_coins(uuid, text, integer, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.oem_award_coins(uuid, text, integer, text, uuid, uuid, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11. Register the two agents the scheduled jobs actually write as.
--
-- WHY THIS EXISTS: oem_agent_runs.agent_key is free text with no foreign key,
-- and oem_agent_profile is `FROM oem_agents a LEFT JOIN runs r`. The five
-- instrumented crons write runs tagged 'ira' and 'pratiksha' roughly 1,750
-- times a day -- but nothing in the codebase ever inserts the oem_agents rows
-- those keys refer to. Verified against the live database on 2026-08-30:
-- oem_agents returned zero rows. Without this seed the run log fills up and
-- the console still renders empty, because the roster is driven by the agent
-- table, not the run table. That is GAP A re-opening one layer down.
--
-- Seeded as 'draft', deliberately. Draft agents do not act: an operator must
-- promote through 'shadow' before anything is allowed to reach a vendor, and
-- app/api/agents/registry refuses draft -> live directly. So this makes the
-- console populated and honest on first open without granting autonomy that
-- nobody asked for.
--
-- Idempotent: ON CONFLICT DO NOTHING against UNIQUE (organization_id,
-- agent_key), so re-running never disturbs an agent an operator has since
-- configured, renamed, promoted or paused.
-- ---------------------------------------------------------------------------
INSERT INTO public.oem_agents (organization_id, agent_key, display_name, department, role_description, status)
SELECT o.id, v.agent_key, v.display_name, v.department, v.role_description, 'draft'
  FROM public.organizations o
 CROSS JOIN (VALUES
    ('ira', 'Ira', 'procurement',
     'Chases material arrivals against requisitions, confirms quantity and condition with the site SPOC, and follows up on electricity bill disputes. Writes runs tagged procurement, vendors and electricity.'),
    ('pratiksha', 'Pratiksha', 'operations',
     'Enforces shift and checklist timing. Nudges before a slot is due, again at the due time, and escalates when it is missed. Writes runs tagged sop, ppm and comms.')
 ) AS v(agent_key, display_name, department, role_description)
    ON CONFLICT (organization_id, agent_key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 12. Tell PostgREST about the new shape.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
