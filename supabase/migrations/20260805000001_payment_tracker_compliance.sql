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
