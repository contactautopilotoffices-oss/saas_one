-- ============================================================================
-- OEM SECURITY FIX
-- 1. v_oem_goal_progress was created without security_invoker. On PG15+ a view
--    defaults to SECURITY DEFINER: it runs as the view OWNER and bypasses RLS
--    on its base tables entirely. Any authenticated user of any org could read
--    every org's goals and current values.
-- 2. The blanket `auth.role() = 'authenticated'` policies gave every
--    authenticated user cross-org read on individual performance data.
--    Scope all oem_* tables to the caller's org memberships.
-- ============================================================================

-- 1. Make the view respect base-table RLS.
DROP VIEW IF EXISTS public.v_oem_goal_progress;

CREATE VIEW public.v_oem_goal_progress
WITH (security_invoker = true) AS
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
    CASE
        WHEN l.value IS NULL OR g.baseline_value IS NULL OR g.target_value = g.baseline_value THEN NULL
        ELSE GREATEST(0, LEAST(100, round(
            ((l.value - g.baseline_value) / (g.target_value - g.baseline_value)) * 100, 1)))
    END AS progress_pct,
    CASE
        WHEN l.value IS NULL OR p.prev_value IS NULL THEN NULL
        WHEN g.direction = 'up'   THEN round(l.value - p.prev_value, 2)
        ELSE round(p.prev_value - l.value, 2)
    END AS actual_rate,
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

-- 2. Helper: is the caller a member of this org?
CREATE OR REPLACE FUNCTION public.oem_is_org_member(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = org AND om.user_id = auth.uid()
    );
$$;

-- 3. Replace the blanket authenticated policies with org-scoped ones.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['oem_goals','oem_tasks','oem_measurements','oem_agents','oem_agent_bundles','oem_council_log']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "oem_select_authenticated" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_insert_authenticated" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "oem_update_authenticated" ON public.%I', t);

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

-- 4. Measurements are the audit record behind every figure. Never silently
--    overwrite a published number — supersede it, with a stated reason.
ALTER TABLE public.oem_measurements
    ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.oem_measurements(id),
    ADD COLUMN IF NOT EXISTS restatement_reason text,
    ADD COLUMN IF NOT EXISTS row_ids uuid[];

COMMENT ON COLUMN public.oem_measurements.row_ids IS
    'The source record ids this figure was computed from. Drill-through evidence.';
COMMENT ON COLUMN public.oem_measurements.supersedes_id IS
    'Set when this row restates an earlier published figure. Corrections stay visible.';
