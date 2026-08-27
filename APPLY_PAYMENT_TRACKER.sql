-- ============================================================
-- Payment Tracker — combined migration, safe to re-run.
-- Paste this whole file into the Supabase SQL editor and Run.
--
-- The database is currently HALF-APPLIED: vendor_profiles and
-- vendor_documents exist but WITHOUT RLS. Running this completes
-- it and turns RLS on. Every statement is idempotent.
-- ============================================================

BEGIN;

-- Payment Tracker: vendor compliance, PO documents, and the shared activity timeline.
--
-- Turns the payment tracker from a status list into the single place a PO's whole life is
-- visible to procurement, accounts and super admins at once — the "everyone sees the same
-- sheet" model. Three additions:
--
--   1. vendor_profiles   — statutory identity (GSTIN, PAN, Udyam, MSME, bank) per vendor.
--   2. vendor_documents / po_documents — is the paperwork actually in hand?
--   3. po_activity_log   — the ticket-style timeline, so every stage is auditable.
--
-- WHY vendor_profiles IS A NEW TABLE RATHER THAN COLUMNS ON `vendors`
-- `vendors` (13 rows) models food-court/service vendors: vendor_name, shop_name,
-- commission_rate, payment_enabled. It is a different population from the ~hundreds of
-- purchase-order suppliers in zoho_purchase_orders, and the two are not joinable today:
-- zoho_purchase_orders.vendor_id is TEXT (Zoho's own id) while vendors.id is a uuid.
-- Bolting statutory fields onto `vendors` would leave every PO supplier unrepresented.
-- vendor_profiles keys on the Zoho id, and carries an OPTIONAL uuid link to `vendors` for
-- the minority that are both.

-- ---------------------------------------------------------------------------
-- 1. Vendor statutory profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_profiles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Identity. zoho_vendor_id is the join key back to zoho_purchase_orders.vendor_id.
    zoho_vendor_id      text,
    vendor_id           uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
    vendor_name         text NOT NULL,

    -- Statutory. Deliberately NOT constrained by regex: these are transcribed by humans
    -- from certificates and a rejected paste is worse than a flagged-for-review value.
    -- `*_status` below carries whether anyone has actually checked.
    gstin               text,
    pan                 text,
    udyam_number        text,
    msme_category       text CHECK (msme_category IN ('micro', 'small', 'medium', 'not_registered')),
    cin                 text,

    -- Banking, for the accounts team making the transfer.
    bank_account_name   text,
    bank_account_number text,
    bank_ifsc           text,

    contact_name        text,
    contact_email       text,
    contact_phone       text,
    address             text,

    -- Verification is a workflow, not a boolean: someone has to look at the certificate.
    compliance_status   text NOT NULL DEFAULT 'unverified'
                        CHECK (compliance_status IN ('unverified', 'in_review', 'verified', 'rejected', 'expired')),
    verified_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at         timestamptz,
    notes               text,

    is_active           boolean NOT NULL DEFAULT true,
    created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vendor_profiles_zoho_key UNIQUE (organization_id, zoho_vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_org  ON public.vendor_profiles(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_name ON public.vendor_profiles(organization_id, lower(vendor_name));

-- vendor_profiles_zoho_key cannot constrain rows with a NULL zoho_vendor_id, because NULLs
-- are distinct under UNIQUE. Without this, a vendor known only by name can be created any
-- number of times and the compliance list silently fills with duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_profiles_name_only
    ON public.vendor_profiles(organization_id, lower(vendor_name))
    WHERE zoho_vendor_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2a. Vendor-level documents (onboarding paperwork — filed once, reused per PO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    vendor_profile_id   uuid NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,

    doc_type            text NOT NULL CHECK (doc_type IN (
                            'gst_certificate', 'pan_card', 'udyam_certificate',
                            'msme_certificate', 'cancelled_cheque', 'agreement',
                            'insurance', 'other')),
    file_url            text,
    file_name           text,
    -- Certificates expire. A verified-but-expired document is not compliance.
    expires_on          date,

    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
    uploaded_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at         timestamptz,
    verified_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at         timestamptz,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vendor_documents_one_per_type UNIQUE (vendor_profile_id, doc_type),
    -- Only a POSITIVE claim needs a file behind it. 'rejected' must stay reachable for a
    -- document the vendor never sent — that is the most common reason to reject one.
    CONSTRAINT vendor_documents_has_file
        CHECK (status NOT IN ('uploaded', 'verified') OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vendor_documents_profile ON public.vendor_documents(vendor_profile_id);
CREATE INDEX IF NOT EXISTS idx_vendor_documents_expiring
    ON public.vendor_documents(organization_id, expires_on)
    WHERE status = 'verified' AND expires_on IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2b. PO-level documents (per transaction — tax invoice, challan, GRN)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.po_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id               uuid NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    payment_id          uuid REFERENCES public.po_payments(id) ON DELETE SET NULL,

    doc_type            text NOT NULL CHECK (doc_type IN (
                            'tax_invoice', 'proforma_invoice', 'delivery_challan',
                            'grn', 'work_completion', 'payment_proof', 'other')),
    file_url            text,
    file_name           text,

    -- Invoice particulars, so the tax invoice can be reconciled without opening the PDF.
    invoice_no          text,
    invoice_date        date,
    invoice_amount      numeric(14,2),
    gst_amount          numeric(14,2),

    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
    uploaded_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at         timestamptz,
    verified_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at         timestamptz,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT po_documents_has_file
        CHECK (status NOT IN ('uploaded', 'verified') OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_po_documents_po      ON public.po_documents(po_id);
CREATE INDEX IF NOT EXISTS idx_po_documents_payment ON public.po_documents(payment_id) WHERE payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Activity timeline — the ticketing-system replica
--
-- Every stage change, upload and comment lands here so the PO detail page can render one
-- chronological story. Modelled on ticket_activity_log, which the org already reads fluently.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.po_activity_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Nullable: 'vendor_updated' is an ORG-level event with no PO to attach to. Forcing a
    -- po_id there would either drop the entry or fabricate an association.
    po_id               uuid REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    vendor_profile_id   uuid REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
    payment_id          uuid REFERENCES public.po_payments(id) ON DELETE SET NULL,

    action              text NOT NULL CHECK (action IN (
                            'po_synced', 'payment_requested', 'aligned', 'completed',
                            'cancelled', 'utr_recorded', 'document_uploaded',
                            'document_verified', 'vendor_updated', 'critical_raised',
                            'critical_cleared', 'comment', 'email_sent', 'email_action')),
    from_status         text,
    to_status           text,

    -- Denormalised actor name/role: a log entry must stay readable after a user is
    -- deactivated or their role changes. The uuid alone would silently lose the story.
    actor_id            uuid REFERENCES public.users(id) ON DELETE SET NULL,
    actor_name          text,
    actor_role          text,
    -- 'email' when the change arrived through an action link rather than the UI.
    actor_channel       text NOT NULL DEFAULT 'app' CHECK (actor_channel IN ('app', 'email', 'system', 'cron')),

    note                text,
    detail              jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- An entry must belong to something, or it is unreachable from every view.
    CONSTRAINT po_activity_has_subject
        CHECK (po_id IS NOT NULL OR vendor_profile_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_po_activity_vendor
    ON public.po_activity_log(vendor_profile_id, created_at DESC)
    WHERE vendor_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_po_activity_po ON public.po_activity_log(po_id, created_at DESC) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_activity_org ON public.po_activity_log(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Part-payment percentage
--
-- Vendors are paid on differing upfront terms — 30% for some, 25% for others. The tracker
-- stored only an absolute requested_amount, which loses the intent: Rs 3,00,000 does not
-- say whether that was the agreed 30% or an ad-hoc figure.
--
-- Stored, not derived. A PO's value can be revised in Zoho after a tranche is agreed, and
-- recomputing the percentage from the current po_amount would silently rewrite history.
-- ---------------------------------------------------------------------------
ALTER TABLE public.po_payments
    ADD COLUMN IF NOT EXISTS percent_of_po numeric(5,2)
        CHECK (percent_of_po IS NULL OR (percent_of_po > 0 AND percent_of_po <= 100));

COMMENT ON COLUMN public.po_payments.percent_of_po IS
    'Agreed share of the PO this tranche represents (e.g. 30 for a 30% advance). Stored at '
    'the time of the request, never recomputed — the PO value may change afterwards.';

-- ---------------------------------------------------------------------------
-- 5. RLS — the shared sheet.
--
-- Procurement, accounts and org admins all READ the same rows; that shared visibility is
-- the entire point of the module. Writes go through the API routes (service role), which
-- apply the finer rule that only accounts and super admins may mark a payment complete.
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendor_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_activity_log   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_payment_tracker_access(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = target_org
          AND om.is_active
          AND om.role::text IN ('org_super_admin', 'org_admin', 'master_admin', 'accounts',
                                'purchase_manager', 'purchase_executive', 'procurement')
    ) OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
          AND pm.organization_id = target_org
          AND pm.is_active
          AND pm.role::text IN ('org_super_admin', 'org_admin', 'master_admin', 'accounts',
                                'purchase_manager', 'purchase_executive', 'procurement')
    );
$$;

DROP POLICY IF EXISTS "payment tracker reads vendor profiles" ON public.vendor_profiles;
CREATE POLICY "payment tracker reads vendor profiles"  ON public.vendor_profiles
    FOR SELECT USING (public.has_payment_tracker_access(organization_id));
DROP POLICY IF EXISTS "payment tracker reads vendor documents" ON public.vendor_documents;
CREATE POLICY "payment tracker reads vendor documents" ON public.vendor_documents
    FOR SELECT USING (public.has_payment_tracker_access(organization_id));
DROP POLICY IF EXISTS "payment tracker reads po documents" ON public.po_documents;
CREATE POLICY "payment tracker reads po documents"     ON public.po_documents
    FOR SELECT USING (public.has_payment_tracker_access(organization_id));
DROP POLICY IF EXISTS "payment tracker reads activity" ON public.po_activity_log;
CREATE POLICY "payment tracker reads activity"         ON public.po_activity_log
    FOR SELECT USING (public.has_payment_tracker_access(organization_id));

-- ---------------------------------------------------------------------------
-- 6. Realtime — the "live Google Sheet" behaviour.
--
-- Without these, one person's status change is invisible to everyone else until they
-- refresh, which is exactly the failure mode the module exists to fix.
-- ---------------------------------------------------------------------------
-- Realtime delete payloads carry only the replica identity. The detail page filters on
-- po_id=eq.X, which cannot be evaluated unless the full old row is published.
ALTER TABLE public.po_activity_log REPLICA IDENTITY FULL;
ALTER TABLE public.po_documents    REPLICA IDENTITY FULL;

-- po_payments was already added to the publication in 20260723000003; the handler below
-- absorbs the duplicate.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.po_payments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.po_activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.po_documents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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

COMMIT;
