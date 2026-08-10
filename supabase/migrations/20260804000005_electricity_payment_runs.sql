-- Electricity 3-scenario payment runs (Phase 6 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
--
-- No new amount modelling — the three scenario amounts (early_payment_amount /
-- total_amount / after_due_date_amount) and the two dates already live on
-- electricity_bills. These tables only record the *selection*: which scenario the
-- org_super_admin picked per bill for a given month, and the run that carries those
-- picks to Accounts.
--
-- LIFECYCLE of a run:
--   draft       — org_super_admin is picking scenarios row by row
--   submitted   — handed to Accounts; bills move to workflow_status='sent_to_accounts'
--                 and get payment_run_id stamped (the register's denormalised pointer)
--   in_payment  — Accounts is working through the queue
--   completed   — every bill in the run is paid (aopSync has run per bill)

-- ---------------------------------------------------------------------------
-- The monthly run (one per org per month is a convention, not a constraint — a
-- re-run after a late bill is legitimate and must not be blocked by a UNIQUE).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_payment_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_month     date NOT NULL,   -- 1st of the month, same convention as electricity_bills.billing_month
    status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'in_payment', 'completed')),
    submitted_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    submitted_at     timestamptz,
    completed_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT electricity_payment_runs_month_is_first
        CHECK (date_trunc('month', period_month) = period_month)
);

CREATE INDEX IF NOT EXISTS idx_electricity_payment_runs_org_month
    ON public.electricity_payment_runs(organization_id, period_month DESC);

-- ---------------------------------------------------------------------------
-- One selection per bill per run. bill_id is UNIQUE across ALL runs, not per run:
-- a bill can only ever be in one run, so the register's payment_run_id pointer can
-- never disagree with the selections table.
--
-- pay_by_date is derived, never entered: early -> the bill's early_payment_date,
-- due -> its due_date, late -> NULL (no deadline to honour, the penalty already
-- applies). Deriving it at selection time keeps a later bill edit from silently
-- moving the deadline Accounts is working against.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_payment_selections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid NOT NULL REFERENCES public.electricity_payment_runs(id) ON DELETE CASCADE,
    bill_id         uuid NOT NULL UNIQUE REFERENCES public.electricity_bills(id) ON DELETE CASCADE,
    scenario        text NOT NULL CHECK (scenario IN ('early', 'due', 'late')),
    scenario_amount numeric(14,2) NOT NULL,
    pay_by_date     date,
    note            text,
    selected_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    selected_at     timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_electricity_payment_selections_run
    ON public.electricity_payment_selections(run_id);

-- ---------------------------------------------------------------------------
-- Denormalised pointer on the register so it can show "in payment run X" without a
-- join. NULL = not yet in any run.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS payment_run_id uuid
    REFERENCES public.electricity_payment_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_electricity_bills_payment_run
    ON public.electricity_bills(payment_run_id) WHERE payment_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS — same audience as the rest of the electricity module: has_aop_access() read,
-- service-role writes (route handlers via supabaseAdmin). See
-- 20260802000002_electricity_bills.sql for why this audience.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_payment_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electricity_payment_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads payment runs" ON public.electricity_payment_runs
    FOR SELECT USING (public.has_aop_access(organization_id));

CREATE POLICY "aop access reads payment selections" ON public.electricity_payment_selections
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.electricity_payment_runs r
            WHERE r.id = run_id AND public.has_aop_access(r.organization_id)
        )
    );

-- Writes are service-role only, matching the bills/AOP tables.
