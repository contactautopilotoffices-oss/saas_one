-- Vendor compliance: the fields Zoho Books already knows.
--
-- 20260805000001 created vendor_profiles as a place for a HUMAN to transcribe statutory
-- identity off a certificate. But the org's Zoho Books org (807372318) has been carrying
-- most of it all along — 767 vendors with gst_no, pan_no, udyam_reg_no, msme_type, a
-- Zoho-validated Udyam flag and billing addresses — and nothing has ever fetched it.
-- backend/services/zohoVendorSync.ts does that; these are the columns it lands in.
--
-- THE TABLE STAYS THE HUMAN'S. Zoho fills blanks, it does not overrule people:
--   * compliance_status is NOT touched by the sync. A GSTIN arriving from Zoho is not
--     evidence anybody looked at a certificate, and 'verified' means somebody did.
--   * udyam_verified is the ONE exception, because Zoho itself validated that number
--     against the Udyam registry (is_valid_udyam_no) — that is a real check, not a guess.
--   * a blank in Zoho never overwrites a filled field here. Absence of data is not a
--     correction.
--
-- WHY zoho_raw
-- The detail endpoint is one HTTP call per vendor and Zoho Books rate-limits at roughly
-- 100/min, so a full pass is ~8 throttled minutes spread over several cron batches. Keeping
-- the untouched contact payload means the NEXT field somebody wants (CIN, a new custom
-- field, the shipping address) is a SQL query over jsonb, not another 767-call crawl.

ALTER TABLE public.vendor_profiles
    -- Zoho `legal_name` — the name on the GST certificate, which is regularly not the
    -- trading name POs are raised against. Kept beside vendor_name rather than replacing
    -- it: staff search for the name they use.
    ADD COLUMN IF NOT EXISTS legal_name       text,

    -- Zoho `gst_treatment`: business_gst / business_none / overseas / consumer / sez / …
    -- Decides whether a GSTIN is even expected, so a NULL gstin on a business_none vendor
    -- reads as correct rather than as missing paperwork.
    ADD COLUMN IF NOT EXISTS gst_treatment    text,

    -- Zoho `place_of_contact` — the two-letter state code ("MH", "KA") that drives
    -- CGST/SGST vs IGST. NOT billing_address.state_code, which this org leaves empty.
    ADD COLUMN IF NOT EXISTS state_code       text,

    -- Zoho custom field `cf_vendor_code` — the internal supplier code accounts uses when
    -- talking to Zoho Books support or reconciling a statement.
    ADD COLUMN IF NOT EXISTS vendor_code      text,

    -- Zoho `is_valid_udyam_no` / `udyam_validated_time`: the registry check Zoho performed.
    -- The only trust this sync is allowed to import, and it is scoped to the Udyam number
    -- alone — it says nothing about GSTIN, PAN or bank details.
    --
    -- true  = Zoho validated the number against the Udyam registry.
    -- false = it did not. The API does NOT distinguish "registry rejected it" from "nobody
    --         ever ran the check", and on 2026-08-07 every sampled vendor holding a Udyam
    --         number came back false with a blank udyam_validated_time — i.e. unchecked.
    --         So false must be read as "not verified", never rendered as "invalid".
    -- NULL  = no Udyam number on file, so there was nothing to check.
    ADD COLUMN IF NOT EXISTS udyam_verified   boolean,
    ADD COLUMN IF NOT EXISTS udyam_verified_at timestamptz,

    -- Zoho `tds_tax_percentage`. numeric(5,2) covers 0.00–999.99; Indian TDS on vendor
    -- payments tops out at 30%, so the width is slack, not a guess.
    ADD COLUMN IF NOT EXISTS tds_percentage   numeric(5,2),

    -- Last time the PER-VENDOR DETAIL fetch (phase 2) completed for this row. Deliberately
    -- NOT stamped by the fast list pass (phase 1): phase 2 drains oldest-first and treats
    -- NULL as "never enriched", so letting phase 1 set it would make every vendor look
    -- done and the Udyam/MSME/address/bank columns would never fill.
    ADD COLUMN IF NOT EXISTS zoho_synced_at   timestamptz,

    -- The untouched Zoho contact payload — detail response once enriched, list row before
    -- that. Never read by application logic; it exists so a future field costs a query.
    ADD COLUMN IF NOT EXISTS zoho_raw         jsonb;

COMMENT ON COLUMN public.vendor_profiles.zoho_synced_at IS
    'Last successful per-vendor Zoho DETAIL fetch (phase 2). NULL = never enriched; phase 2 drains NULLS FIRST.';
COMMENT ON COLUMN public.vendor_profiles.udyam_verified IS
    'Zoho is_valid_udyam_no. true = Zoho validated the number against the registry; false = it did not (rejected or never checked — the API does not say); NULL = no number on file. Not a human verification: compliance_status still governs that.';
COMMENT ON COLUMN public.vendor_profiles.zoho_raw IS
    'Untouched Zoho Books contact payload, so a newly-wanted field never costs another 767-call crawl.';

-- The phase-2 work queue: "oldest enrichment first, never-enriched before everything".
-- Without it, every batch sorts the whole org's roster to find 25 rows.
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_zoho_sync
    ON public.vendor_profiles(organization_id, zoho_synced_at NULLS FIRST)
    WHERE zoho_vendor_id IS NOT NULL;

-- Compliance screens filter on "MSME suppliers" and "who is missing a GSTIN"; both scan
-- the org's whole roster today.
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_msme
    ON public.vendor_profiles(organization_id, msme_category)
    WHERE msme_category IS NOT NULL;
