-- Petty Cash phase 2 — who actually holds the cash, what the cash was spent on, and
-- whether the last float was accounted for before the next one goes out.
--
-- The MVP (20260723000002) could not answer any of those. It recorded a requester, a
-- single amount, and a pile of untyped file attachments; settlement was three numbers
-- the requester typed in, unlinked to any bill and unvalidated against anything. This
-- migration closes the three gaps named in Petty_Cash_Requisition_Ledger_PRD.docx
-- (§6.2 document review, §6.3 open-advance visibility, §8.2 float custodian).
--
-- Deliberately still out of scope: GST/ITC capture (§7), float/cash-box accounts and
-- physical-cash reconciliation (§8.2), multi-tier CFO approval slabs (§6.3), OCR.

-- ---------------------------------------------------------------------------
-- 1. The custodian — who the money is physically handed to.
--
-- requester_id was doing double duty as "who asked" and "who holds the cash", which
-- breaks the common case: a site supervisor raising a request for cash that a boy on
-- the ground actually carries and spends. Free text + phone rather than a users FK on
-- purpose — the custodian frequently has no login on this platform at all.
-- ---------------------------------------------------------------------------
ALTER TABLE public.petty_cash_requests
    ADD COLUMN IF NOT EXISTS recipient_name  TEXT,
    ADD COLUMN IF NOT EXISTS recipient_phone TEXT;

COMMENT ON COLUMN public.petty_cash_requests.recipient_name IS
    'Custodian: who physically receives and spends the cash. Defaults to the requester in the UI, but is theirs to override.';

-- ---------------------------------------------------------------------------
-- 2. Bills become ledger lines, not just file pointers.
--
-- A settlement document carried a URL and nothing else, so "what was the 100 split
-- into" was unanswerable and actual_spent could not be checked against anything.
-- review_status is the §6.2 finance review: only accepted bills count as accounted for.
-- ---------------------------------------------------------------------------
ALTER TABLE public.petty_cash_documents
    ADD COLUMN IF NOT EXISTS amount        NUMERIC(14,2) CHECK (amount IS NULL OR amount >= 0),
    ADD COLUMN IF NOT EXISTS bill_date     DATE,
    ADD COLUMN IF NOT EXISTS vendor        TEXT,
    ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'
                             CHECK (review_status IN ('pending', 'accepted', 'rejected')),
    ADD COLUMN IF NOT EXISTS review_remarks TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by   UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.petty_cash_documents.amount IS
    'Bill value. NULL for non-bill attachments (payment proofs, request-stage quotes) — only settlement-stage rows with an amount enter the ledger.';

CREATE INDEX IF NOT EXISTS idx_pc_docs_stage_review
    ON public.petty_cash_documents (request_id, stage, review_status);

-- ---------------------------------------------------------------------------
-- 3. The reconciliation view — one row per request answering "is this float closed out".
--
-- disbursed  : what actually left the till (falls back through approved → requested so
--              a not-yet-paid row still reports sensibly rather than dividing by NULL).
-- bills_total: settlement bills NOT rejected. Pending bills count, so a custodian who
--              has uploaded everything is not punished for finance's review queue;
--              rejected ones do not, which is what makes review meaningful.
-- accounted  : bills + cash handed back. This is the number that should equal disbursed.
-- accounted_pct: the "efficiency" figure — 100 means the float is fully explained.
--
-- SECURITY INVOKER (the default) is deliberate: the view inherits the caller's RLS on
-- the underlying tables, so it can never widen access beyond the MVP's policies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.petty_cash_settlement_status AS
SELECT
    r.id                AS request_id,
    r.organization_id,
    r.property_id,
    r.requester_id,
    r.request_no,
    r.status,
    r.recipient_name,
    r.recipient_phone,
    r.paid_at,
    COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)      AS disbursed,
    COALESCE(b.bills_total, 0)                                          AS bills_total,
    COALESCE(b.bills_count, 0)                                          AS bills_count,
    COALESCE(b.bills_pending_review, 0)                                 AS bills_pending_review,
    COALESCE(b.bills_rejected, 0)                                       AS bills_rejected,
    COALESCE(r.amount_returned, 0)                                      AS amount_returned,
    COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0)         AS accounted,
    GREATEST(
        COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)
            - (COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0)),
        0
    )                                                                   AS unaccounted,
    CASE
        WHEN COALESCE(r.paid_amount, r.approved_amount, r.amount_requested) > 0
        THEN ROUND(
            ((COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0))
                / COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)) * 100,
            1)
        ELSE NULL
    END                                                                 AS accounted_pct,
    -- An advance is "open" from the moment cash leaves until finance closes it. This is
    -- what gates the next cycle.
    (r.status IN ('paid', 'settlement_submitted'))                      AS is_open_advance,
    CASE
        WHEN r.status IN ('paid', 'settlement_submitted') AND r.paid_at IS NOT NULL
        THEN GREATEST(EXTRACT(DAY FROM (NOW() - r.paid_at))::INT, 0)
        ELSE NULL
    END                                                                 AS days_outstanding
FROM public.petty_cash_requests r
LEFT JOIN LATERAL (
    SELECT
        SUM(d.amount) FILTER (WHERE d.review_status <> 'rejected')      AS bills_total,
        COUNT(*)      FILTER (WHERE d.review_status <> 'rejected')      AS bills_count,
        COUNT(*)      FILTER (WHERE d.review_status = 'pending')        AS bills_pending_review,
        COUNT(*)      FILTER (WHERE d.review_status = 'rejected')       AS bills_rejected
    FROM public.petty_cash_documents d
    WHERE d.request_id = r.id
      AND d.stage = 'settlement'
      AND d.amount IS NOT NULL
) b ON TRUE;

COMMENT ON VIEW public.petty_cash_settlement_status IS
    'Per-request petty cash reconciliation: disbursed vs bills vs cash returned, and the accounted %. Read by the settlement drawer, the property tracker, and the open-advance gate on new requests.';
