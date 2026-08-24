-- ============================================================================
-- ORG EFFICIENCY METER (OEM)
-- Skeleton the agent layer reads. Five levels: agent -> employee -> department
-- -> tech -> org. Goals chain upward via parent_goal_id. Tasks feed goals.
-- Measurements move the meter. Agent bundles contain what each agent may read.
-- The council log governs prompt / binding / bundle changes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. GOALS — one row per goal at any level. The chain IS parent_goal_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_goals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    parent_goal_id   uuid REFERENCES public.oem_goals(id) ON DELETE SET NULL,
    level            text NOT NULL CHECK (level IN ('agent','employee','department','tech','org')),
    title            text NOT NULL,
    description      text,
    owner_uid        uuid REFERENCES public.users(id),          -- person accountable (employee level)
    department       text,                                       -- e.g. 'procurement', 'crm', 'operations'
    agent_key        text,                                       -- e.g. 'ira', 'pratiksha' (agent level)
    cadence          text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('weekly','monthly','quarterly')),
    metric_key       text NOT NULL,                              -- e.g. 'procurement.tat_hours_p90'
    metric_source    jsonb DEFAULT '{}'::jsonb,                  -- { table, value_expr, filter, agg } read by the agent
    direction        text NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')), -- up = higher is better
    unit             text,                                       -- 'hours', '%', 'count', 'inr'
    baseline_value   numeric,                                    -- frozen at activation
    target_value     numeric NOT NULL,
    expected_rate    numeric,                                    -- expected improvement per cadence period
    guardrails       jsonb DEFAULT '[]'::jsonb,                  -- [{metric_key, must_not, threshold}]
    starts_on        date NOT NULL DEFAULT CURRENT_DATE,
    ends_on          date,
    status           text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','achieved','missed','archived')),
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_goals_org      ON public.oem_goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_oem_goals_parent   ON public.oem_goals(parent_goal_id);
CREATE INDEX IF NOT EXISTS idx_oem_goals_level    ON public.oem_goals(organization_id, level);
CREATE INDEX IF NOT EXISTS idx_oem_goals_owner    ON public.oem_goals(owner_uid);
CREATE INDEX IF NOT EXISTS idx_oem_goals_agent    ON public.oem_goals(agent_key);

-- ---------------------------------------------------------------------------
-- 2. TASKS — the task calendar. Each task belongs to a goal and a day.
--    proof_type: 'system' (timestamp exists), 'artifact' (file/link), 'claim'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_tasks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    goal_id          uuid NOT NULL REFERENCES public.oem_goals(id) ON DELETE CASCADE,
    title            text NOT NULL,
    owner_uid        uuid REFERENCES public.users(id),
    agent_key        text,                                       -- set when an agent generated / owns the task
    scheduled_on     date NOT NULL DEFAULT CURRENT_DATE,         -- calendar day
    due_at           timestamptz,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','missed','blocked','cancelled')),
    proof_type       text NOT NULL DEFAULT 'claim' CHECK (proof_type IN ('system','artifact','claim')),
    proof_ref        text,                                       -- entity id / URL / storage path substantiating completion
    completed_at     timestamptz,
    blocked_reason   text,
    source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent','recurring')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_tasks_org_day  ON public.oem_tasks(organization_id, scheduled_on);
CREATE INDEX IF NOT EXISTS idx_oem_tasks_goal     ON public.oem_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_oem_tasks_owner    ON public.oem_tasks(owner_uid, status);

-- ---------------------------------------------------------------------------
-- 3. MEASUREMENTS — the time series that moves the meter.
--    One row per goal per period. expected_value lets us compare
--    expected vs actual rate of improvement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_measurements (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    goal_id          uuid NOT NULL REFERENCES public.oem_goals(id) ON DELETE CASCADE,
    period_start     date NOT NULL,
    period_end       date NOT NULL,
    value            numeric NOT NULL,
    expected_value   numeric,                                    -- where the plan said we should be
    sample_size      integer,
    source           text NOT NULL DEFAULT 'system' CHECK (source IN ('system','agent','manual')),
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (goal_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_oem_meas_goal      ON public.oem_measurements(goal_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_oem_meas_org       ON public.oem_measurements(organization_id);

-- ---------------------------------------------------------------------------
-- 4. AGENT REGISTRY — every agent (Ira, Pratiksha, future ones) registers
--    here. system_prompt is GENERATED from bound goals + bundle, versioned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agents (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key            text NOT NULL,                          -- 'ira', 'pratiksha'
    display_name         text NOT NULL,
    department           text,
    role_description     text,                                   -- one paragraph: what this agent is for
    status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shadow','live','paused','retired')),
    system_prompt        text,                                   -- generated, never hand-edited
    system_prompt_version integer NOT NULL DEFAULT 0,
    prompt_generated_at  timestamptz,
    config               jsonb DEFAULT '{}'::jsonb,              -- budgets, quiet hours, escalation ladder
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, agent_key)
);

-- ---------------------------------------------------------------------------
-- 5. AGENT BUNDLES — the containment. The ONLY tables/views an agent may
--    read, as one versioned bundle. The agent runtime refuses anything
--    outside the active bundle, so an agent cannot fragment into other data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_bundles (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,
    version          integer NOT NULL DEFAULT 1,
    is_active        boolean NOT NULL DEFAULT true,
    -- { tables: [{ name, access: 'read'|'write', columns?: [] }], notes }
    bundle           jsonb NOT NULL DEFAULT '{"tables": []}'::jsonb,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, agent_key, version)
);

CREATE INDEX IF NOT EXISTS idx_oem_bundles_active ON public.oem_agent_bundles(organization_id, agent_key) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 6. COUNCIL LOG — the governing body's record. Every prompt regeneration,
--    goal binding, bundle change and performance review lands here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_council_log (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text,
    review_type      text NOT NULL CHECK (review_type IN ('prompt_change','goal_binding','bundle_change','performance_review','escalation','note')),
    summary          text NOT NULL,
    decision         text NOT NULL DEFAULT 'approved' CHECK (decision IN ('approved','rejected','needs_human')),
    decided_by       text NOT NULL DEFAULT 'human' CHECK (decided_by IN ('council','human')),
    details          jsonb DEFAULT '{}'::jsonb,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_council_org ON public.oem_council_log(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. PROGRESS VIEW — latest measurement per goal, progress %, actual vs
--    expected improvement rate, and whether data is flowing ("in the chain").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_oem_goal_progress AS
WITH latest AS (
    SELECT DISTINCT ON (goal_id)
        goal_id, value, expected_value, period_start, period_end, created_at
    FROM public.oem_measurements
    ORDER BY goal_id, period_end DESC
),
previous AS (
    SELECT DISTINCT ON (m.goal_id)
        m.goal_id, m.value AS prev_value, m.period_end AS prev_period_end
    FROM public.oem_measurements m
    JOIN latest l ON l.goal_id = m.goal_id AND m.period_end < l.period_end
    ORDER BY m.goal_id, m.period_end DESC
)
SELECT
    g.id AS goal_id,
    g.organization_id,
    g.level,
    g.title,
    g.owner_uid,
    g.department,
    g.agent_key,
    g.cadence,
    g.metric_key,
    g.direction,
    g.unit,
    g.baseline_value,
    g.target_value,
    g.expected_rate,
    g.status,
    l.value            AS current_value,
    l.expected_value   AS planned_value,
    l.period_end       AS last_measured_on,
    -- progress: 0..100 from baseline toward target, direction-aware
    CASE
        WHEN l.value IS NULL OR g.baseline_value IS NULL OR g.target_value = g.baseline_value THEN NULL
        ELSE GREATEST(0, LEAST(100, round(
            ((l.value - g.baseline_value) / (g.target_value - g.baseline_value)) * 100, 1)))
    END AS progress_pct,
    -- actual improvement in the latest period (direction-normalised: positive = improving)
    CASE
        WHEN l.value IS NULL OR p.prev_value IS NULL THEN NULL
        WHEN g.direction = 'up'   THEN round(l.value - p.prev_value, 2)
        ELSE round(p.prev_value - l.value, 2)
    END AS actual_rate,
    -- data freshness: measurement newer than one cadence period = in the chain
    CASE
        WHEN l.period_end IS NULL THEN false
        WHEN g.cadence = 'weekly'    THEN l.period_end >= CURRENT_DATE - INTERVAL '10 days'
        WHEN g.cadence = 'monthly'   THEN l.period_end >= CURRENT_DATE - INTERVAL '40 days'
        WHEN g.cadence = 'quarterly' THEN l.period_end >= CURRENT_DATE - INTERVAL '110 days'
    END AS data_in_chain
FROM public.oem_goals g
LEFT JOIN latest   l ON l.goal_id = g.id
LEFT JOIN previous p ON p.goal_id = g.id
WHERE g.status IN ('active','achieved','missed');

-- ---------------------------------------------------------------------------
-- 8. updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oem_goals_touch  ON public.oem_goals;
CREATE TRIGGER trg_oem_goals_touch  BEFORE UPDATE ON public.oem_goals  FOR EACH ROW EXECUTE FUNCTION public.oem_touch_updated_at();
DROP TRIGGER IF EXISTS trg_oem_tasks_touch  ON public.oem_tasks;
CREATE TRIGGER trg_oem_tasks_touch  BEFORE UPDATE ON public.oem_tasks  FOR EACH ROW EXECUTE FUNCTION public.oem_touch_updated_at();
DROP TRIGGER IF EXISTS trg_oem_agents_touch ON public.oem_agents;
CREATE TRIGGER trg_oem_agents_touch BEFORE UPDATE ON public.oem_agents FOR EACH ROW EXECUTE FUNCTION public.oem_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. RLS — repo convention: authenticated access; org_super_admin gating is
--    enforced at the API layer like the other org-admin modules.
-- ---------------------------------------------------------------------------
ALTER TABLE public.oem_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_council_log   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['oem_goals','oem_tasks','oem_measurements','oem_agents','oem_agent_bundles','oem_council_log']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "oem_select_authenticated" ON public.%I', t);
        EXECUTE format('CREATE POLICY "oem_select_authenticated" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_insert_authenticated" ON public.%I', t);
        EXECUTE format('CREATE POLICY "oem_insert_authenticated" ON public.%I FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_update_authenticated" ON public.%I', t);
        EXECUTE format('CREATE POLICY "oem_update_authenticated" ON public.%I FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    END LOOP;
END $$;
