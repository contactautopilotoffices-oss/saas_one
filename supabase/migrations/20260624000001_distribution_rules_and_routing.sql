-- ============================================================================
-- Lead distribution tables (were never applied) + micro-market routing rules.
-- Routes incoming Meta/LinkedIn leads to the right BD rep by city / micro-market.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_lead_distribution_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign TEXT NOT NULL,                 -- used as a keyword (e.g. 'andheri')
    mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (mode IN ('exclusive', 'round_robin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, campaign)
);

CREATE TABLE IF NOT EXISTS crm_lead_distribution_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES crm_lead_distribution_rules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_assigned_at TIMESTAMPTZ,
    assigned_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_dist_rules_org ON crm_lead_distribution_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_dist_members_rule ON crm_lead_distribution_members(rule_id);
CREATE INDEX IF NOT EXISTS idx_crm_dist_members_user ON crm_lead_distribution_members(user_id);

-- Micro-market routing rules (exclusive — one rep per market).
DO $$
DECLARE
    org UUID := '211e1330-ad83-446d-941f-dcea48396798';
    rule UUID;
    pairs TEXT[][] := ARRAY[
        ['andheri',     '3e793a4c-ba0c-4d33-8b16-f8dd416dc542'],  -- Shubham (Mumbai · Andheri)
        ['lower parel', 'fd1ea5b3-95d8-4975-8347-2a2b5221ca6d'],  -- Shravani (Mumbai · LP)
        ['mafatlal',    'fd1ea5b3-95d8-4975-8347-2a2b5221ca6d'],  -- Shravani (LP form variant)
        ['bengaluru',   'ecdf62fa-e141-4de3-942c-e9c069740410'],  -- Manjunath (BLR)
        ['bangalore',   'ecdf62fa-e141-4de3-942c-e9c069740410'],  -- Manjunath (BLR)
        ['noida',       'fbe0668a-d6b8-4dc8-89c8-32b472e07d3c'],  -- Madhvi (Noida)
        ['skymark',     'fbe0668a-d6b8-4dc8-89c8-32b472e07d3c']   -- Madhvi (F1 Skymark · Noida)
    ];
    p TEXT[];
BEGIN
    FOREACH p SLICE 1 IN ARRAY pairs LOOP
        INSERT INTO crm_lead_distribution_rules (organization_id, campaign, mode, is_active)
        VALUES (org, p[1], 'exclusive', true)
        ON CONFLICT (organization_id, campaign) DO UPDATE SET is_active = true, mode = 'exclusive'
        RETURNING id INTO rule;

        INSERT INTO crm_lead_distribution_members (rule_id, user_id, is_active)
        VALUES (rule, p[2]::uuid, true)
        ON CONFLICT (rule_id, user_id) DO UPDATE SET is_active = true;
    END LOOP;
END $$;
