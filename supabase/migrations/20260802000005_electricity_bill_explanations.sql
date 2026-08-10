-- Cache for the electricity tracker's AI "explain" assist.
--
-- The explain endpoint (app/api/electricity/tracker/explain/route.ts) answers "what
-- changed vs this account's own history" for one bill, or "why do the two spreadsheets
-- disagree" for one reconciliation month. Both are cheap to compute but must NEVER be
-- called on render — every screen paint would otherwise re-hit OpenAI for numbers that
-- have not changed since the last paint. This table is that cache.
--
-- `input_hash` is a hash of the aggregates actually sent to the model, not of the bill/
-- reconciliation row itself. A bill's payment_status changing invalidates the cache
-- automatically because the aggregate payload changes and the hash no longer matches;
-- an unrelated column changing does not force a needless re-explanation.

CREATE TABLE IF NOT EXISTS public.electricity_bill_explanations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- 'bill:<electricity_bills.id>' or 'reconciliation:<YYYY-MM>'. One column rather than
    -- a nullable subject_id + nullable subject_month pair — simpler uniqueness, and the
    -- two subject kinds never need to be queried against each other.
    subject_key        text NOT NULL,
    input_hash         text NOT NULL,

    explanation        text NOT NULL,
    model              text NOT NULL,
    cost_usd           numeric(10,6),

    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- One live cache entry per subject. A stale hash is overwritten (upsert), not kept
    -- alongside the fresh one — nobody reads a superseded explanation.
    CONSTRAINT electricity_bill_explanations_unique UNIQUE (organization_id, subject_key)
);

CREATE INDEX IF NOT EXISTS idx_electricity_bill_explanations_org
    ON public.electricity_bill_explanations(organization_id);

ALTER TABLE public.electricity_bill_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads bill explanations" ON public.electricity_bill_explanations
    FOR SELECT USING (public.has_aop_access(organization_id));

-- Writes are service-role only (the explain route), matching electricity_bills.
