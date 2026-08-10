-- po_tracker_rows — one row per PO, the single source the shared Payment Tracker reads.
--
-- REQUIRES 20260805000001_payment_tracker_compliance.sql (vendor_profiles,
-- vendor_documents, po_documents, po_payments.percent_of_po). Apply that first.
--
-- WHY A VIEW AND NOT API-SIDE ASSEMBLY
-- The tracker sheet needs PO + payment rollup + vendor compliance + document readiness on
-- every row. Assembling that in TypeScript means four reads per page, each of which
-- PostgREST silently clamps at 1000 rows — the exact defect
-- 20260801000004_po_alignment_queue_view.sql was written to kill. Aggregating in SQL makes
-- .range() true pagination with an accurate exact count, over all 5k+ POs.
--
-- RELATIONSHIP TO po_alignment_queue: that view answers "what still needs a tranche".
-- This one answers "what is the whole state of this PO" — it is a superset in columns but
-- NOT a replacement; the queue view is what app/api/accounts/pos reads and stays as is.
--
-- NO SCORES. Every derived column is either a count, a boolean, or a named state. A
-- "readiness score" would be a number nobody can act on; `readiness` is one of three
-- explicit states and every input to it is exposed alongside so the UI can say WHY.

CREATE OR REPLACE VIEW public.po_tracker_rows
WITH (security_invoker = on) AS      -- client reads respect the underlying tables' RLS
SELECT
    -- ---------------------------------------------------------------- PO identity
    po.id                                           AS po_id,
    po.organization_id,
    po.po_number,
    po.vendor_name,
    po.vendor_id,                                   -- Zoho contact id (TEXT, nullable)
    po.zoho_po_id,
    po.po_amount,
    po.currency,
    po.po_date,
    po.delivery_date,
    po.department,
    po.project_name,
    po.property_id,
    po.category,
    po.source,
    po.status                                       AS po_status,   -- Zoho's raw string
    po.created_at                                   AS po_created_at,
    po.updated_at                                   AS po_updated_at,

    -- Zoho's status vocabulary normalised to the approval question the tracker asks:
    -- "may accounts act on this yet?". Anything unrecognised is NULL, never a guess —
    -- a PO wrongly labelled approved is a payment released against nothing.
    CASE
        WHEN po.status IS NULL THEN NULL
        WHEN lower(po.status) IN ('cancelled', 'void', 'rejected', 'declined') THEN 'cancelled'
        WHEN lower(po.status) = 'draft' THEN 'draft'
        WHEN lower(po.status) IN ('pending_approval', 'pending approval', 'submitted') THEN 'pending_approval'
        -- Zoho moves a PO to `open` on issue, which only happens post-approval; billed /
        -- partially_billed / closed are all downstream of that.
        WHEN lower(po.status) IN ('approved', 'open', 'issued', 'billed', 'partially_billed', 'closed')
            THEN 'approved'
        ELSE NULL
    END                                             AS po_approval_state,

    -- A cancelled or draft PO can never be paid. Same expression as po_alignment_queue's
    -- is_payable so the two screens cannot disagree. NULL status stays payable: manual and
    -- CSV rows routinely carry none.
    (po.status IS NULL OR lower(po.status) NOT IN ('cancelled', 'draft')) AS is_payable,

    -- ---------------------------------------------------------------- payment rollup
    COALESCE(pay.tranche_count, 0)::int             AS tranche_count,      -- excludes cancelled
    COALESCE(pay.to_align_count, 0)::int            AS to_align_count,
    COALESCE(pay.aligned_count, 0)::int             AS aligned_count,
    COALESCE(pay.completed_count, 0)::int           AS completed_count,
    COALESCE(pay.cancelled_count, 0)::int           AS cancelled_count,

    COALESCE(pay.requested_total, 0)::numeric(14,2) AS requested_total,    -- all live tranches
    COALESCE(pay.paid_total, 0)::numeric(14,2)      AS paid_total,         -- completed only

    -- TWO different "remaining" numbers, deliberately named apart. Collapsing them into one
    -- "outstanding" is how a tracker starts lying: money not yet tranched is procurement's
    -- problem, money tranched but unpaid is accounts'.
    GREATEST(0, po.po_amount - COALESCE(pay.requested_total, 0))::numeric(14,2)
                                                    AS unaligned_amount,   -- no tranche raised yet
    GREATEST(0, po.po_amount - COALESCE(pay.paid_total, 0))::numeric(14,2)
                                                    AS outstanding_amount, -- still owed the vendor

    -- Sum of the agreed shares on live tranches. NULL — not 0 — when no tranche records a
    -- percentage, because "nobody entered one" and "0%" are different facts.
    pay.percent_committed::numeric(6,2)             AS percent_committed,

    latest.status                                   AS latest_payment_status,
    latest.tranche_no                               AS latest_tranche_no,
    latest.requested_amount::numeric(14,2)          AS latest_requested_amount,
    latest.percent_of_po::numeric(5,2)              AS latest_percent_of_po,
    latest.updated_at                               AS latest_payment_updated_at,

    utr.utr_no                                      AS latest_utr,
    utr.payment_date                                AS latest_payment_date,
    utr.completed_at                                AS latest_completed_at,

    -- The UTR queue: a tranche sits in 'aligned' precisely until accounts pays it and
    -- captures the UTR. This is the "awaiting UTR" light on the sheet.
    (COALESCE(pay.aligned_count, 0) > 0)            AS awaiting_utr,

    -- One filterable state per PO. Precedence is deliberate and top-down: the earliest
    -- unfinished stage wins, because that is the stage somebody has to act on.
    CASE
        WHEN COALESCE(pay.tranche_count, 0) = 0 AND COALESCE(pay.cancelled_count, 0) > 0 THEN 'cancelled'
        WHEN COALESCE(pay.tranche_count, 0) = 0                        THEN 'not_requested'
        WHEN COALESCE(pay.to_align_count, 0) > 0                       THEN 'to_align'
        WHEN COALESCE(pay.aligned_count, 0) > 0                        THEN 'aligned'
        WHEN po.po_amount - COALESCE(pay.paid_total, 0) > 0.5          THEN 'partially_paid'
        ELSE 'paid'
    END                                             AS payment_state,

    -- ---------------------------------------------------------------- vendor compliance
    -- TEXT-to-TEXT join. zoho_purchase_orders.vendor_id is Zoho's own contact id and
    -- vendors.id is a uuid; there is no uuid path between a PO and a vendor profile (see
    -- the header of 20260805000001). btrim/nullif stops an empty string in either column
    -- from matching and attributing a profile to the wrong supplier.
    vp.id                                           AS vendor_profile_id,
    vp.compliance_status                            AS vendor_compliance_status,
    vp.gstin,
    vp.pan,
    vp.udyam_number,
    vp.msme_category,
    vp.verified_at                                  AS vendor_verified_at,
    -- The account number itself is not exposed on the shared sheet — the sheet only needs
    -- to know whether accounts can pay. The detail route serves the actual bank details.
    (vp.bank_account_number IS NOT NULL AND vp.bank_ifsc IS NOT NULL) AS vendor_has_bank_details,

    -- ---------------------------------------------------------------- document readiness
    -- THE REQUIRED SET IS DEFINED HERE, IN ONE PLACE: GST certificate, PAN card and a
    -- cancelled cheque. Udyam/MSME are conditional on the vendor claiming MSME status, and
    -- agreements/insurance are contract-specific, so none of them gate payment readiness.
    -- Change the list in both places below together.
    3::int                                          AS required_docs_total,
    COALESCE(vdoc.verified_count, 0)::int           AS required_docs_verified,
    -- Which ones are actually missing, so the UI names them instead of showing "2/3".
    CASE WHEN vp.id IS NULL THEN NULL ELSE ARRAY(
        SELECT t FROM unnest(ARRAY['gst_certificate', 'pan_card', 'cancelled_cheque']) t
        EXCEPT
        SELECT unnest(COALESCE(vdoc.verified_types, ARRAY[]::text[]))
        ORDER BY 1
    ) END                                           AS missing_required_docs,
    -- A verified-but-expired certificate is not compliance. Counted apart so the UI can say
    -- "expired", which is a different conversation with the vendor from "never sent".
    COALESCE(vdoc.expired_count, 0)::int            AS expired_docs_count,
    COALESCE(vdoc.rejected_count, 0)::int           AS rejected_docs_count,

    COALESCE(pdoc.document_count, 0)::int           AS po_document_count,
    (COALESCE(pdoc.tax_invoice_count, 0) > 0)       AS has_tax_invoice,
    (COALESCE(pdoc.tax_invoice_verified_count, 0) > 0) AS tax_invoice_verified,

    -- readiness — three explicit states, no score.
    --
    -- The tax invoice is deliberately NOT an input: advances are paid against a proforma
    -- before any tax invoice exists, so folding it in would mark every legitimate advance
    -- as blocked. It is exposed above as has_tax_invoice for the UI to show on its own.
    CASE
        WHEN vp.id IS NULL                            THEN 'blocked_no_vendor_profile'
        WHEN COALESCE(vdoc.verified_count, 0) < 3     THEN 'blocked_docs_missing'
        ELSE 'ready'
    END                                             AS readiness,

    -- ---------------------------------------------------------------- workflow flags
    COALESCE(w.is_critical, false)                  AS is_critical,
    w.critical_reason,
    w.critical_raised_at,
    w.assigned_spoc,

    act.last_activity_at

FROM public.zoho_purchase_orders po

-- Payment rollup. Cancelled tranches are excluded from every total but still counted, so
-- the UI can explain a PO whose only tranche was killed.
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE p.status <> 'cancelled')                                     AS tranche_count,
        count(*) FILTER (WHERE p.status = 'to_align')                                       AS to_align_count,
        count(*) FILTER (WHERE p.status = 'aligned')                                        AS aligned_count,
        count(*) FILTER (WHERE p.status = 'completed')                                      AS completed_count,
        count(*) FILTER (WHERE p.status = 'cancelled')                                      AS cancelled_count,
        COALESCE(SUM(p.requested_amount) FILTER (WHERE p.status <> 'cancelled'), 0)         AS requested_total,
        -- paid_amount may legitimately differ from requested_amount (rounding, part-payment
        -- on the day); it falls back to requested_amount only when the row never carried one.
        COALESCE(SUM(COALESCE(p.paid_amount, p.requested_amount)) FILTER (WHERE p.status = 'completed'), 0)
                                                                                            AS paid_total,
        SUM(p.percent_of_po) FILTER (WHERE p.status <> 'cancelled')                         AS percent_committed
    FROM public.po_payments p
    WHERE p.po_id = po.id
) pay ON TRUE

-- The tranche a viewer is looking at when they glance at the row.
LEFT JOIN LATERAL (
    SELECT p.status, p.tranche_no, p.requested_amount, p.percent_of_po, p.updated_at
    FROM public.po_payments p
    WHERE p.po_id = po.id AND p.status <> 'cancelled'
    ORDER BY p.tranche_no DESC, p.created_at DESC
    LIMIT 1
) latest ON TRUE

-- Latest UTR = the most recently completed tranche that actually carries one.
LEFT JOIN LATERAL (
    SELECT p.utr_no, p.payment_date, p.completed_at
    FROM public.po_payments p
    WHERE p.po_id = po.id AND p.status = 'completed' AND p.utr_no IS NOT NULL
    ORDER BY p.completed_at DESC NULLS LAST, p.tranche_no DESC
    LIMIT 1
) utr ON TRUE

LEFT JOIN public.vendor_profiles vp
       ON vp.organization_id = po.organization_id
      AND vp.zoho_vendor_id  = nullif(btrim(po.vendor_id), '')
      AND vp.is_active

-- Required-document tally, restricted to the required set so verified_count IS the
-- numerator of "verified vs required" with no second filter anywhere.
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE vd.status = 'verified'
                           AND (vd.expires_on IS NULL OR vd.expires_on >= CURRENT_DATE))    AS verified_count,
        count(*) FILTER (WHERE vd.status = 'verified' AND vd.expires_on < CURRENT_DATE)     AS expired_count,
        count(*) FILTER (WHERE vd.status = 'rejected')                                      AS rejected_count,
        array_remove(array_agg(vd.doc_type) FILTER (
            WHERE vd.status = 'verified' AND (vd.expires_on IS NULL OR vd.expires_on >= CURRENT_DATE)
        ), NULL)                                                                            AS verified_types
    FROM public.vendor_documents vd
    WHERE vd.vendor_profile_id = vp.id
      AND vd.doc_type = ANY (ARRAY['gst_certificate', 'pan_card', 'cancelled_cheque'])
) vdoc ON TRUE

LEFT JOIN LATERAL (
    SELECT
        count(*)                                                                            AS document_count,
        count(*) FILTER (WHERE pd.doc_type = 'tax_invoice' AND pd.status IN ('uploaded', 'verified'))
                                                                                            AS tax_invoice_count,
        count(*) FILTER (WHERE pd.doc_type = 'tax_invoice' AND pd.status = 'verified')      AS tax_invoice_verified_count
    FROM public.po_documents pd
    WHERE pd.po_id = po.id
) pdoc ON TRUE

LEFT JOIN LATERAL (
    SELECT max(a.created_at) AS last_activity_at
    FROM public.po_activity_log a
    WHERE a.po_id = po.id
) act ON TRUE

LEFT JOIN public.po_workflow_state w
       ON w.po_id = po.id
      AND w.organization_id = po.organization_id;

COMMENT ON VIEW public.po_tracker_rows IS
    'One row per purchase order: PO fields, payment rollup, vendor compliance, document '
    'readiness and workflow flags. Backs GET /api/accounts/tracker. readiness is one of '
    'blocked_no_vendor_profile | blocked_docs_missing | ready — never a score.';

-- ---------------------------------------------------------------------------
-- Indexes for the laterals above.
--
-- idx_pop_po_status (20260801000004) already serves the payment rollup. These cover the
-- three joins that migration could not have known about.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_po_documents_po_type
    ON public.po_documents (po_id, doc_type);

CREATE INDEX IF NOT EXISTS idx_vendor_documents_profile_type
    ON public.vendor_documents (vendor_profile_id, doc_type);

-- Drives both the vendor_profiles join and the DISTINCT (vendor_id, vendor_name) scan
-- behind POST /api/accounts/vendor-profiles/backfill over 5k+ POs.
CREATE INDEX IF NOT EXISTS idx_zpo_org_vendor_id
    ON public.zoho_purchase_orders (organization_id, vendor_id)
    WHERE vendor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Realtime completeness for the tables 20260805000001 put on the publication.
--
-- That migration adds po_documents and po_activity_log to supabase_realtime but leaves
-- them on the default REPLICA IDENTITY, which writes only the primary key into the WAL for
-- UPDATE/DELETE. Every other realtime table in this schema sets FULL
-- (20260723000003, 20260801000001) and the PO detail page subscribes with
-- `filter: po_id=eq.<id>` — a filter Realtime cannot evaluate on a delete payload that
-- contains nothing but an id, so those events are silently dropped.
-- ---------------------------------------------------------------------------
ALTER TABLE public.po_documents    REPLICA IDENTITY FULL;
ALTER TABLE public.po_activity_log REPLICA IDENTITY FULL;
