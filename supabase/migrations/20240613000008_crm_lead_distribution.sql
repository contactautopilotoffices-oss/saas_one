-- Lead distribution rules: assign campaigns to reps (exclusive or round-robin).
CREATE TABLE crm_lead_distribution_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (mode IN ('exclusive', 'round_robin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, campaign)
);

-- Which reps participate in a distribution rule.
CREATE TABLE crm_lead_distribution_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES crm_lead_distribution_rules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_assigned_at TIMESTAMPTZ,
    assigned_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, user_id)
);

CREATE INDEX idx_crm_dist_rules_org ON crm_lead_distribution_rules(organization_id);
CREATE INDEX idx_crm_dist_members_rule ON crm_lead_distribution_members(rule_id);
CREATE INDEX idx_crm_dist_members_user ON crm_lead_distribution_members(user_id);
