-- Migration: Document Bank
-- Created: 2026-08-27
-- Description:
--   A DigiLocker-style document store for the Digital Audit module. Every AMC contract,
--   OEM manual, statutory certificate, calibration certificate, SLD, warranty card etc.
--   referenced by the DG/UPS/STP audit checklists (SS_Audit_Documentation_Checklist)
--   lands here as one row: the file, its validity window (valid_from/valid_to — the AMC
--   /certificate expiry the audit checklist keeps asking for), and whatever an OCR pass
--   could read off it. Search is a straight ILIKE across title/vendor/doc_number/ocr_text,
--   matching this repo's existing search convention (app/api/search/route.ts) — no new
--   tsvector/pg_trgm infra.
--
--   CONNECTION TO DIGITAL AUDIT: linked_master_item_id ties a document back to a row in
--   audit_master_items (sql/internal_audit_schema.sql), and the new document_id column on
--   property_audit_submissions lets an upload here also satisfy that checklist item — see
--   app/api/document-bank/route.ts, which upserts the submission when a link is supplied.
--
--   Files live in a PRIVATE storage bucket (created lazily by backend/lib/documentBank/storage.ts,
--   mirroring backend/lib/accounts/documents.ts) — unlike the public `amc-documents` bucket,
--   because AMC contracts and statutory certificates carry commercial/compliance terms that
--   shouldn't be a bare public URL. Every read goes through an API route that mints a
--   short-lived signed URL after checking the caller's org/property membership.

CREATE TABLE IF NOT EXISTS document_bank (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id uuid REFERENCES properties(id) ON DELETE CASCADE,

    category text NOT NULL CHECK (category IN (
        'amc_contract', 'warranty_certificate', 'calibration_certificate', 'statutory_certificate',
        'consent_approval', 'oem_manual', 'sld_drawing', 'load_schedule', 'sop',
        'training_record', 'insurance', 'kyc', 'invoice', 'test_report', 'other'
    )),
    equipment text, -- free text, e.g. 'DG Set', 'UPS', 'STP' — matches the audit checklist's Equipment column
    title text NOT NULL,
    vendor_name text,
    doc_number text,

    issue_date date,
    valid_from date,
    valid_to date, -- AMC / certificate expiry — what MissingItemsTracker-style expiry views key off

    linked_master_item_id uuid REFERENCES audit_master_items(id) ON DELETE SET NULL,
    linked_contract_id uuid REFERENCES amc_contracts(id) ON DELETE SET NULL,

    file_path text NOT NULL, -- storage object path, not a browsable URL — sign on read
    file_name text NOT NULL,
    file_type text,
    file_size_bytes bigint,

    ocr_status text NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processed', 'failed', 'not_applicable')),
    ocr_text text, -- extracted plain text, folded into search
    ocr_extracted jsonb DEFAULT '{}', -- structured model output: {doc_type, doc_number, vendor_name, issue_date, valid_from, valid_to, confidence}
    ocr_confidence numeric,

    tags text[] DEFAULT '{}',

    uploaded_by uuid REFERENCES auth.users(id),
    verified_by uuid REFERENCES auth.users(id),
    verified_at timestamptz,

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Lets an upload here double as proof for the existing 35-point checklist without
-- duplicating what property_audit_submissions already tracks (status/remark/verification).
ALTER TABLE property_audit_submissions ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES document_bank(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_bank_org ON document_bank(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_bank_property ON document_bank(property_id);
CREATE INDEX IF NOT EXISTS idx_document_bank_category ON document_bank(category);
CREATE INDEX IF NOT EXISTS idx_document_bank_valid_to ON document_bank(valid_to);
CREATE INDEX IF NOT EXISTS idx_document_bank_master_item ON document_bank(linked_master_item_id);
CREATE INDEX IF NOT EXISTS idx_document_bank_contract ON document_bank(linked_contract_id);
CREATE INDEX IF NOT EXISTS idx_document_bank_tags ON document_bank USING GIN(tags);

ALTER TABLE document_bank ENABLE ROW LEVEL SECURITY;

-- Real org/property scoping (not the blanket `auth.role() = 'authenticated'` the older
-- audit/AMC tables use) — same EXISTS-against-membership shape as
-- backend/db/migrations/20260404_ocr_schema.sql's ocr_audit_logs policies.
DROP POLICY IF EXISTS "document_bank_select_member" ON document_bank;
CREATE POLICY "document_bank_select_member" ON document_bank FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = document_bank.organization_id AND om.is_active)
    OR EXISTS (SELECT 1 FROM property_memberships pm
               WHERE pm.user_id = auth.uid() AND pm.property_id = document_bank.property_id AND pm.is_active)
);

-- Any active member can upload — mirrors property_audit_submissions, where SPOCs (not just
-- admins) submit checklist proof today.
DROP POLICY IF EXISTS "document_bank_insert_member" ON document_bank;
CREATE POLICY "document_bank_insert_member" ON document_bank FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = document_bank.organization_id AND om.is_active)
    OR EXISTS (SELECT 1 FROM property_memberships pm
               WHERE pm.user_id = auth.uid() AND pm.property_id = document_bank.property_id AND pm.is_active)
);

-- Edits (verify, correct OCR-suggested dates, relink) — the uploader or an admin.
DROP POLICY IF EXISTS "document_bank_update_owner_or_admin" ON document_bank;
CREATE POLICY "document_bank_update_owner_or_admin" ON document_bank FOR UPDATE USING (
    uploaded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM organization_memberships om
               WHERE om.user_id = auth.uid() AND om.organization_id = document_bank.organization_id AND om.is_active
                 AND om.role::text IN ('org_super_admin', 'org_admin', 'master_admin'))
    OR EXISTS (SELECT 1 FROM property_memberships pm
               WHERE pm.user_id = auth.uid() AND pm.property_id = document_bank.property_id AND pm.is_active
                 AND pm.role::text IN ('property_admin', 'PROPERTY_ADMIN', 'super_admin', 'SUPER_ADMIN'))
);

-- Deletion is admin-only, deliberately not the uploader — these are compliance records
-- (AMC contracts, statutory certificates); an accidental or disgruntled self-delete
-- shouldn't be able to erase audit evidence. Same restraint as oem_measurements'
-- "supersede, don't overwrite" comment in 20260825000002_oem_tenant_scoping_fix.sql.
DROP POLICY IF EXISTS "document_bank_delete_admin" ON document_bank;
CREATE POLICY "document_bank_delete_admin" ON document_bank FOR DELETE USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = document_bank.organization_id AND om.is_active
              AND om.role::text IN ('org_super_admin', 'org_admin', 'master_admin'))
    OR EXISTS (SELECT 1 FROM property_memberships pm
               WHERE pm.user_id = auth.uid() AND pm.property_id = document_bank.property_id AND pm.is_active
                 AND pm.role::text IN ('property_admin', 'PROPERTY_ADMIN', 'super_admin', 'SUPER_ADMIN'))
);
