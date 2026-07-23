-- =====================================================================
-- CRM: campaign-level territories
--
-- The brief scopes BD reps to a CAMPAIGN (Lower Parel, Andheri, Bangalore,
-- F1 Skymark…), but Lower Parel and Andheri are BOTH Mumbai — so a city-only
-- territory can't separate them. This makes crm_territories able to grant
-- EITHER a whole city (campaign NULL) OR a single campaign (campaign set).
-- Idempotent & additive.
-- =====================================================================

ALTER TABLE crm_territories ALTER COLUMN city DROP NOT NULL;
ALTER TABLE crm_territories ADD COLUMN IF NOT EXISTS campaign TEXT;

-- Old unique was UNIQUE(user_id, city); a campaign-scoped row may have NULL city,
-- so replace it with a coalesced composite unique that tolerates either grant type.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_territories_user_id_city_key') THEN
        ALTER TABLE crm_territories DROP CONSTRAINT crm_territories_user_id_city_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_territories_user_scope
    ON crm_territories (user_id, COALESCE(city, ''), COALESCE(campaign, ''));

CREATE INDEX IF NOT EXISTS idx_crm_territories_campaign ON crm_territories(lower(campaign));
