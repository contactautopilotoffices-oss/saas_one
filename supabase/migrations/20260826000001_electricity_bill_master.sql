-- Electricity BILL MASTER — the bill as printed, not just the bill as payable.
--
-- WHAT WAS MISSING
-- electricity_bills has carried the money envelope since 20260802000002 (total, early,
-- after-due, the three dates) and the parser's headline consumption since 20260804000001
-- (billed_units). That is everything needed to PAY a bill and nothing needed to CHECK one.
-- The register could say "this month is Rs 3.1 lakh against Rs 1.6 lakh last month" and
-- could not say a single word about why.
--
-- WHY RECONCILIATION NEEDS THESE COLUMNS
--  1. meter_no — the only field on the bill that names the physical meter. Without it a
--     bill reconciles against a PROPERTY's readings (validate.ts joins via
--     billing_accounts.property_id), which is silently wrong at every site with more than
--     one connection: 3i - Crescent Solitaire alone has three Adani meters whose readings
--     currently all land in one pool. A variance computed against the wrong meter is worse
--     than no variance, because it looks like an answer.
--  2. billing_period_start/end — billing_month is a BUCKET, and boards do not bill calendar
--     months. The gap scan in validate.ts walks every day of the calendar month, so a bill
--     covering 18 Jun – 17 Jul reports ~14 phantom missing days and chases an MST who did
--     nothing wrong. Chasing people over an off-by-two-weeks window is how an automated
--     control loses the room.
--  3. previous_reading / current_reading / multiplying_factor — lets us recompute
--     (current - previous) x MF and check the board's OWN units figure before comparing it
--     to ours. Today billed_units is taken on faith; a board transcription error and a real
--     consumption jump are indistinguishable.
--  4. contract_demand_kva / recorded_demand_kva / power_factor — the numbers that move a
--     bill without consumption moving. A demand overshoot or a PF penalty is a fixable
--     operational fault, but only if it is visible as itself rather than as "units look fine,
--     amount is up".
--  5. The charge anatomy (energy / fixed / duty / tax / fuel surcharge / other /
--     adjustments / arrears / interest) — the single most common cause of a jumped bill is
--     arrears carried from an unpaid prior month, i.e. money we already owe rather than
--     money we newly spent. Booking that into AOP as this month's consumption cost
--     misstates the site's run rate and hides the actual failure (a missed payment).
--     Board-specific heads with no column here stay in
--     electricity_bill_documents.ocr_payload; other_charges is a residual, not an eraser.
--  6. consumer_name — the July source sheet tracks Managed vs Landlord connections. Who the
--     connection is registered to decides whether we pay it or recover it, and that cannot
--     be inferred from the amount.
--  7. variance_status / variance_pct — denormalised from the latest
--     electricity_bill_validations row so the register can filter and sort the check outcome
--     without a per-row subquery. The validations table stays the record of what was checked
--     and by whom; these two columns are a read cache of its latest verdict.
--
-- WHO WRITES THESE
-- The parser fills the printed columns: backend/lib/electricity/billOcr.ts extracts a
-- "master" block and ingest.ts writes it on the same upsert as the amounts. The two
-- reconciliation columns are backfilled below from validations already on record; keeping
-- them current on each run is validate.ts's job and is NOT wired here — until it is, they
-- read 'unchecked' for bills validated after this migration, which is a stale cache rather
-- than a wrong one.
--
-- ADDITIVE ONLY. Every column is nullable (or NOT NULL with a default), so existing rows,
-- the xlsx importer, the alerts view and the payment path are untouched: a bill that never
-- carries a meter number behaves exactly as it does today.

-- ---------------------------------------------------------------------------
-- 1. Identity of the connection, as printed on this bill
--
-- These live on the BILL and not on electricity_billing_accounts on purpose: they are what
-- the board asserted this month. A tariff reclassification or a load revision shows up as a
-- change between two bills, which is the evidence a dispute is argued from — an account-level
-- column would overwrite the history it needs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS bill_number         text,           -- board's own invoice number
    ADD COLUMN IF NOT EXISTS meter_no            text,           -- meter serial as printed
    ADD COLUMN IF NOT EXISTS consumer_name       text,           -- registered name on the connection
    ADD COLUMN IF NOT EXISTS tariff_category     text,           -- 'HT-2', 'LT-3', 'Commercial', …
    ADD COLUMN IF NOT EXISTS sanctioned_load_kw  numeric(12,3),
    ADD COLUMN IF NOT EXISTS contract_demand_kva numeric(12,3),
    ADD COLUMN IF NOT EXISTS recorded_demand_kva numeric(12,3),  -- max demand actually drawn
    ADD COLUMN IF NOT EXISTS power_factor        numeric(6,3);

-- ---------------------------------------------------------------------------
-- 2. The period this bill actually covers, and the readings it was raised on
--
-- billing_month stays the grain (the unique key and every existing query depend on it);
-- these columns record the true service window inside it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS billing_period_start  date,
    ADD COLUMN IF NOT EXISTS billing_period_end    date,
    ADD COLUMN IF NOT EXISTS previous_reading      numeric(14,3),
    ADD COLUMN IF NOT EXISTS current_reading       numeric(14,3),
    ADD COLUMN IF NOT EXISTS previous_reading_date date,
    ADD COLUMN IF NOT EXISTS current_reading_date  date,
    -- CT/PT ratio. 1 on a direct-connected LT meter; 200+ on an HT connection, where
    -- forgetting it under-reads consumption by two orders of magnitude.
    ADD COLUMN IF NOT EXISTS multiplying_factor    numeric(12,4);

-- A period that ends before it starts is a transcription error, not a bill. Cheap to
-- reject here; expensive to find later inside a variance nobody can explain.
DO $$
BEGIN
    ALTER TABLE public.electricity_bills
        ADD CONSTRAINT electricity_bills_period_ordered
        CHECK (billing_period_start IS NULL
            OR billing_period_end IS NULL
            OR billing_period_end >= billing_period_start);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Charge anatomy — what total_amount is made of
--
-- Signed on purpose: adjustments and other_charges are routinely credits, and storing a
-- credit as a positive "charge" is the kind of tidy-looking lie that survives review.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS energy_charges    numeric(14,2),  -- units x tariff
    ADD COLUMN IF NOT EXISTS fixed_charges     numeric(14,2),  -- demand / fixed component
    ADD COLUMN IF NOT EXISTS electricity_duty  numeric(14,2),
    ADD COLUMN IF NOT EXISTS tax_amount        numeric(14,2),  -- tax on sale of electricity, GST where levied
    ADD COLUMN IF NOT EXISTS fuel_surcharge    numeric(14,2),  -- FPPPA / FAC / FCA, board-dependent name
    ADD COLUMN IF NOT EXISTS other_charges     numeric(14,2),  -- residual heads, itemised in ocr_payload
    ADD COLUMN IF NOT EXISTS adjustments       numeric(14,2),  -- credits and debits carried in
    ADD COLUMN IF NOT EXISTS arrears           numeric(14,2),  -- prior unpaid balance rolled into this bill
    ADD COLUMN IF NOT EXISTS interest_charges  numeric(14,2);  -- DPC / late-payment interest

-- ---------------------------------------------------------------------------
-- 4. Reconciliation verdict, cached on the bill
--
-- Values mirror electricity_bill_validations.result exactly, plus 'unchecked' for a bill no
-- validation run has seen. Keeping the vocabulary identical means the register and the
-- checker's queue can never describe the same bill differently.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS variance_status text NOT NULL DEFAULT 'unchecked'
        CHECK (variance_status IN ('unchecked', 'pass', 'variance', 'incomplete_data', 'no_meter_link')),
    ADD COLUMN IF NOT EXISTS variance_pct numeric(8,3);

-- Seed the cache from the validations already on record, so the column is not born lying
-- about bills that have in fact been checked. Touches neither workflow_status nor
-- payment_status, so trg_elec_bills_record_event writes no events for this backfill —
-- a schema migration is not an audit-trail event.
WITH latest AS (
    SELECT DISTINCT ON (bill_id) bill_id, result, variance_pct
    FROM public.electricity_bill_validations
    ORDER BY bill_id, run_at DESC
)
UPDATE public.electricity_bills b
SET variance_status = latest.result,
    variance_pct    = latest.variance_pct
FROM latest
WHERE latest.bill_id = b.id
  AND b.variance_status = 'unchecked';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Meter-level reconciliation: "every bill ever raised on this meter", and the lookup that
-- attributes a newly parsed bill to a connection when the consumer number is unreadable.
CREATE INDEX IF NOT EXISTS idx_elec_bills_meter_no
    ON public.electricity_bills(organization_id, meter_no)
    WHERE meter_no IS NOT NULL;

-- The checker's working query: bills in one verdict state, newest first.
CREATE INDEX IF NOT EXISTS idx_elec_bills_variance_status
    ON public.electricity_bills(organization_id, variance_status, billing_month DESC);

NOTIFY pgrst, 'reload schema';
