-- Electricity BILL tracker — distinct from electricity_readings (which is meter kWh).
--
-- This is the money side: what each electricity board invoiced, when it is due, and the
-- discount available for paying early. Source: "Electricity Tracker Excel.xlsx".
--
-- WHY THIS EARNS A DASHBOARD TILE
-- Most boards here offer an early-payment discount (BESCOM states 0.25%; the Maharashtra,
-- Adani and Tata connections show ~0.8–0.9% in practice) and charge a penalty after the due
-- date. Across the portfolio the sheet's own footer shows the saving realised: Rs 21,489 in
-- one month and Rs 21,863 the next, on ~Rs 4.7cr of billing. That money is won or lost
-- purely by noticing a date. Nobody can notice 17 dates a month by hand, which is exactly
-- what a dashboard is for.
--
-- GRAIN: one row per BILLING ACCOUNT per month, not per site. "3i - Crescent Solitaire"
-- has three separate Adani connections (consumer refs 301/302/303) with independent bills,
-- dates and amounts. Collapsing them to a site would make the due dates meaningless.

-- ---------------------------------------------------------------------------
-- The connection / consumer account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_billing_accounts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Soft links, both nullable: the sheet's site labels do not all correspond to a
    -- property row, and AOP sites are a different granularity again.
    property_id        uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    aop_site_id        uuid REFERENCES public.aop_sites(id) ON DELETE SET NULL,

    provider           text NOT NULL,   -- 'Adani Electricity Mumbai Limited'
    consumer_ref       text,            -- '302' — distinguishes connections at one site
    site_label         text NOT NULL,   -- '3i - Crescent Solitaire' (as written in the sheet)

    -- Documented discount, where the board publishes one (BESCOM = 0.25). Informational:
    -- the real saving is always computed from the bill's own amounts, never from this.
    early_payment_discount_pct numeric(6,3),

    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT elec_billing_accounts_unique
        UNIQUE (organization_id, provider, site_label, consumer_ref)
);

CREATE INDEX IF NOT EXISTS idx_elec_billing_accounts_org
    ON public.electricity_billing_accounts(organization_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- The monthly bill
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_bills (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    account_id             uuid NOT NULL REFERENCES public.electricity_billing_accounts(id) ON DELETE CASCADE,

    billing_month          date NOT NULL,   -- 1st of the month the bill belongs to
    bill_date              date,
    due_date               date,

    total_amount           numeric(14,2),   -- payable on/before the due date
    early_payment_date     date,            -- pay on/before this for the discount
    early_payment_amount   numeric(14,2),   -- discounted payable
    after_due_date_amount  numeric(14,2),   -- penalty amount if paid late

    payment_status         text NOT NULL DEFAULT 'pending'
                           CHECK (payment_status IN ('pending', 'paid', 'disputed')),
    payment_date           date,
    paid_amount            numeric(14,2),

    source                 text NOT NULL DEFAULT 'xlsx_import'
                           CHECK (source IN ('xlsx_import', 'manual', 'ocr')),
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT electricity_bills_unique_month UNIQUE (account_id, billing_month),
    CONSTRAINT electricity_bills_month_is_first
        CHECK (date_trunc('month', billing_month) = billing_month)
    -- Deliberately NOT constraining "paid implies payment_date is not null". The source
    -- sheet has genuine rows marked Done with the payment-date cell left blank (e.g. Sigma
    -- IT Park 701/703, March billing). Rejecting those would block the import over a
    -- missing audit field, and inventing a date to satisfy a constraint is worse than
    -- recording that we do not know it. Consumers must treat payment_date as optional.
);

CREATE INDEX IF NOT EXISTS idx_electricity_bills_org_month
    ON public.electricity_bills(organization_id, billing_month DESC);

-- Serves the dashboard tile: unpaid bills ordered by whichever deadline bites first.
CREATE INDEX IF NOT EXISTS idx_electricity_bills_open_deadlines
    ON public.electricity_bills(organization_id, early_payment_date, due_date)
    WHERE payment_status = 'pending';

-- ---------------------------------------------------------------------------
-- The tile's data source. Everything the UI needs to raise an alarm, computed in one place
-- so the API route, the cron reminder and any future email digest cannot drift apart.
--
-- discount_at_risk : money lost if the early-payment date slips past today, and only while
--                    it is still winnable (bill unpaid, date not yet gone).
-- penalty_exposure : extra owed once the due date passes.
-- urgency          : the severity ladder the dashboard renders. Ordered most severe first
--                    so the UI can sort on it directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.electricity_bill_alerts
WITH (security_invoker = on) AS
SELECT
    b.id,
    b.organization_id,
    b.account_id,
    a.site_label,
    a.provider,
    a.consumer_ref,
    a.property_id,
    b.billing_month,
    b.bill_date,
    b.due_date,
    b.total_amount,
    b.early_payment_date,
    b.early_payment_amount,
    b.after_due_date_amount,
    b.payment_status,
    b.payment_date,

    (b.early_payment_date - CURRENT_DATE) AS days_to_early_payment,
    (b.due_date           - CURRENT_DATE) AS days_to_due,

    CASE
        WHEN b.payment_status = 'pending'
         AND b.early_payment_date IS NOT NULL
         AND b.early_payment_date >= CURRENT_DATE
         AND b.total_amount IS NOT NULL
         AND b.early_payment_amount IS NOT NULL
         AND b.total_amount > b.early_payment_amount
        THEN b.total_amount - b.early_payment_amount
        ELSE 0
    END AS discount_at_risk,

    CASE
        WHEN b.payment_status = 'pending'
         AND b.after_due_date_amount IS NOT NULL
         AND b.total_amount IS NOT NULL
         AND b.after_due_date_amount > b.total_amount
        THEN b.after_due_date_amount - b.total_amount
        ELSE 0
    END AS penalty_exposure,

    CASE
        WHEN b.payment_status <> 'pending'                              THEN 'settled'
        WHEN b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE       THEN 'overdue'
        WHEN b.due_date IS NOT NULL AND b.due_date <= CURRENT_DATE + 3  THEN 'due_soon'
        WHEN b.early_payment_date IS NOT NULL
         AND b.early_payment_date >= CURRENT_DATE
         AND b.early_payment_date <= CURRENT_DATE + 3                   THEN 'discount_expiring'
        WHEN b.early_payment_date IS NOT NULL
         AND b.early_payment_date < CURRENT_DATE
         AND (b.due_date IS NULL OR b.due_date >= CURRENT_DATE)         THEN 'discount_missed'
        ELSE 'ok'
    END AS urgency
FROM public.electricity_bills b
JOIN public.electricity_billing_accounts a ON a.id = b.account_id;

-- ---------------------------------------------------------------------------
-- RLS — same audience as the AOP tracker: this is spend data.
-- has_aop_access() is defined in 20260802000001_aop_tracker.sql, which must run first.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electricity_bills            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads billing accounts" ON public.electricity_billing_accounts
    FOR SELECT USING (public.has_aop_access(organization_id));

CREATE POLICY "aop access reads electricity bills" ON public.electricity_bills
    FOR SELECT USING (public.has_aop_access(organization_id));

-- Writes are service-role only (importer + API routes), matching the AOP tables.
