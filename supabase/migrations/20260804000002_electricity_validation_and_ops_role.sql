-- Electricity bill validation engine + the `ops_super_admin` checker role.
--
-- Runs AFTER 20260804000001 (which adds electricity_bills.workflow_status). See
-- docs/ELECTRICITY_AUTOMATION_PLAN.md Phase 2.
--
-- WHY VALIDATIONS ARE A TABLE, NOT A STATUS
-- A validation is a computation with inputs (billed units, logged units, tolerance,
-- missing dates, readings excluded) that a human checker must be able to inspect and
-- sign off. Keeping one row per run — latest wins — means the review queue can show
-- both the outcome and the evidence that produced it, and re-runs never destroy the
-- audit trail of what the engine saw before readings were fixed.
--
-- NEW MEMBERSHIP ROLE: `ops_super_admin`
-- Membership roles on organization_memberships / property_memberships are free strings,
-- so this role needs no schema change — this comment block IS the documentation.
--   - Nature: org-scoped role (property_id = null in the invite flow), sits BELOW
--     org_super_admin. It is the checker in the electricity pipeline: signs off
--     validations (validated -> verified) and accepts/rejects dispute responses. It
--     must NOT inherit org-super-admin authority (checker vs accepter split,
--     plan §3) — payment scenario selection and run submission stay with
--     org_super_admin alone.
--   - Runtime guard: backend/lib/electricity/access.ts (ELECTRICITY_ROLES +
--     CHECKER_ROLES / isChecker). DB-side: has_electricity_access() below.

-- ---------------------------------------------------------------------------
-- The validation run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_bill_validations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    bill_id            uuid NOT NULL REFERENCES public.electricity_bills(id) ON DELETE CASCADE,

    run_at             timestamptz NOT NULL DEFAULT now(),
    method             text NOT NULL DEFAULT 'auto'
                       CHECK (method IN ('auto', 'manual')),

    billed_units       numeric(14,3),          -- kWh the board invoiced (bill.billed_units)
    logged_units       numeric(14,3),          -- kWh from electricity_monthly_consumption
    variance_pct       numeric(8,3),           -- (billed - logged) / logged * 100, signed
    tolerance_pct      numeric(6,3) NOT NULL DEFAULT 5,

    missing_dates      date[],                 -- days in the billing period with no reading
    readings_counted   integer,                -- anomaly-filtered count from the view
    readings_excluded  integer,                -- dropped by the anomaly filter (shown, not hidden)

    result             text NOT NULL
                       CHECK (result IN ('pass', 'variance', 'incomplete_data', 'no_meter_link')),

    -- Checker sign-off (ops_super_admin / org super admins). Set by the review queue PATCH.
    checked_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    checked_at         timestamptz,
    checker_note       text,

    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elec_bill_validations_bill
    ON public.electricity_bill_validations(bill_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_elec_bill_validations_org
    ON public.electricity_bill_validations(organization_id, run_at DESC);

-- ---------------------------------------------------------------------------
-- RLS helper — org/ops super admin roles only.
--
-- Deliberately NARROWER than has_aop_access (which also covers 'accounts' and, in the
-- electricity bills tables, procurement). The validation review queue is the checker's
-- workbench, not the spend register: the audience is ops_super_admin plus the org super
-- admins. Widening later is recoverable; quietly exposing check decisions is not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_electricity_access(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = target_org
          AND om.is_active
          AND om.role::text IN ('org_super_admin', 'master_admin', 'ops_super_admin')
    ) OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
          AND pm.organization_id = target_org
          AND pm.is_active
          AND pm.role::text IN ('org_super_admin', 'master_admin', 'ops_super_admin')
    );
$$;

ALTER TABLE public.electricity_bill_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "electricity access reads bill validations" ON public.electricity_bill_validations
    FOR SELECT USING (public.has_electricity_access(organization_id));

-- Writes are service-role only (validation engine + review-queue API), matching the
-- bills/AOP tables: checkers act through the API route, which enforces CHECKER_ROLES.
