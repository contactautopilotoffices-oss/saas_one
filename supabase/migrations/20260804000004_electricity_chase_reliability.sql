-- Electricity 3-touch chase engine + employee reliability ("CIBIL") score.
--
-- Runs AFTER 20260804000002 (electricity_bill_validations). See
-- docs/ELECTRICITY_AUTOMATION_PLAN.md Phase 4 and the §4/§5 summaries.
--
-- WHY RELIABILITY IS EVENTS + A VIEW, NOT A SCORE COLUMN
-- A score column drifts the first time a rule changes; an event log never does. Every
-- default / strike / recovery is an append-only row with its points, and the score is
-- computed over a rolling 12-month window in a view — so threshold or points changes
-- (plan §9 item 10, system_config keys) re-score history consistently, and the event
-- feed doubles as the audit trail the employee was informed about (employee_notified_at).

-- ---------------------------------------------------------------------------
-- The chase task — one per validation run that found missing readings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_chase_tasks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    bill_id          uuid NOT NULL REFERENCES public.electricity_bills(id) ON DELETE CASCADE,
    validation_id    uuid REFERENCES public.electricity_bill_validations(id) ON DELETE SET NULL,
    property_id      uuid REFERENCES public.properties(id) ON DELETE SET NULL,

    -- Resolved MST (property_memberships role='mst'); falls back to the property admin
    -- when the property has no active MST (plan §9 item 7).
    assignee_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,

    missing_dates    date[],                     -- snapshot from the validation that spawned this
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'touch1_sent', 'touch2_sent', 'touch3_called', 'completed', 'defaulted')),

    touch1_at        timestamptz,
    touch2_at        timestamptz,
    touch3_at        timestamptz,
    due_at           timestamptz,                -- when the NEXT touch fires (e.g. +24h)
    completed_at     timestamptz,

    -- Running total of per-touch costs (system_config keys, ₹0 defaults — plan §9 item 9).
    cost_incurred    numeric(14,2) NOT NULL DEFAULT 0,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elec_chase_tasks_bill
    ON public.electricity_chase_tasks(bill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elec_chase_tasks_due
    ON public.electricity_chase_tasks(due_at)
    WHERE status IN ('open', 'touch1_sent', 'touch2_sent', 'touch3_called');
CREATE INDEX IF NOT EXISTS idx_elec_chase_tasks_org
    ON public.electricity_chase_tasks(organization_id, status);

-- ---------------------------------------------------------------------------
-- The reliability event log — generic on purpose (source_type) so future modules
-- can score the same way without a schema change ('electricity_chase' is the first).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_reliability_events (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    source_type          text NOT NULL,          -- 'electricity_chase', future modules...
    source_id            uuid,                   -- e.g. electricity_chase_tasks.id

    kind                 text NOT NULL
                         CHECK (kind IN ('default', 'strike', 'recovered')),
    points               integer NOT NULL DEFAULT 0,   -- deducted from 100
    note                 text,

    created_at           timestamptz NOT NULL DEFAULT now(),
    -- The employee must be told when they are penalised (plan §4): set once the
    -- WhatsApp inform message has been enqueued.
    employee_notified_at timestamptz,
    notified_via         text                    -- 'whatsapp'
);

CREATE INDEX IF NOT EXISTS idx_reliability_events_user
    ON public.employee_reliability_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reliability_events_org
    ON public.employee_reliability_events(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- The score — 100 minus event points over a rolling 12-month window. Strikes expire
-- after 12 months (plan §9 item 10); "active" strikes are what the 3-strike ticket
-- rule counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.employee_reliability_scores
WITH (security_invoker = on) AS
SELECT
    e.user_id,
    e.organization_id,
    GREATEST(0, 100 - COALESCE(SUM(e.points) FILTER (
        WHERE e.created_at >= now() - interval '12 months'
    ), 0))::integer AS score,
    COUNT(*) FILTER (
        WHERE e.kind = 'strike'
          AND e.created_at >= now() - interval '12 months'
    )::integer AS strike_count,
    MAX(e.created_at) FILTER (WHERE e.kind = 'strike') AS last_strike_at
FROM public.employee_reliability_events e
GROUP BY e.user_id, e.organization_id;

-- ---------------------------------------------------------------------------
-- RLS — same audience as the rest of the electricity pipeline. Reliability events are
-- about identifiable employees, so they stay checker/super-admin only EXCEPT that an
-- employee may read their own events and their own score (the plan has the score
-- surfaced on the employee's own dashboard card, plan §4).
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_chase_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_reliability_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "electricity access reads chase tasks" ON public.electricity_chase_tasks
    FOR SELECT USING (public.has_electricity_access(organization_id));

-- A chase's assignee sees their own tasks too (the MST/property admin being chased).
CREATE POLICY "assignee reads own chase tasks" ON public.electricity_chase_tasks
    FOR SELECT USING (assignee_id = auth.uid());

CREATE POLICY "electricity access reads reliability events" ON public.employee_reliability_events
    FOR SELECT USING (public.has_electricity_access(organization_id));

CREATE POLICY "employee reads own reliability events" ON public.employee_reliability_events
    FOR SELECT USING (user_id = auth.uid());

-- Writes are service-role only (chase engine + cron), matching the bills/validations
-- tables: everything mutating goes through backend/lib/electricity/chase.ts.
