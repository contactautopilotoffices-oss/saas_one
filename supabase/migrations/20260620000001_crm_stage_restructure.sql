-- ===========================================
-- CRM Stage Restructure
-- New flow: MQL → Active (Ring 1-10) → Warm → Hot → Future → Cold → Lost → Disqualified → Won
-- Remove: Visit Pending, Visit Done, Layout Shared, LOI, Close, Loss
-- Add: Active, Lost, Disqualified, Won
-- Rename: Close → Won, Loss → Lost (if they exist)
-- ===========================================

-- Rename existing terminal stages
UPDATE crm_lead_statuses SET name = 'Won', color = '#22C55E' WHERE lower(name) = 'close';
UPDATE crm_lead_statuses SET name = 'Lost', color = '#64748B' WHERE lower(name) = 'loss';

-- Remove stages that are now timeline activities (only if no leads reference them)
-- If leads reference them, just mark inactive so data is not lost
UPDATE crm_lead_statuses SET is_active = false WHERE lower(name) IN ('visit pending', 'visit done', 'layout shared', 'loi');

-- Remove old statuses that don't fit new flow (mark inactive)
UPDATE crm_lead_statuses SET is_active = false WHERE lower(name) IN ('contacted', 'meeting scheduled', 'site visit scheduled', 'proposal shared', 'negotiation', 'dropped', 'on hold', 'new lead');

-- Insert new stages if they don't exist (org-scoped statuses may vary)
-- These are global defaults (organization_id IS NULL)
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Active', '#3B82F6', 2, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'active' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Disqualified', '#EF4444', 18, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'disqualified' AND organization_id IS NULL);

-- Ensure Won and Lost exist as terminal
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Won', '#22C55E', 19, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'won' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Lost', '#64748B', 17, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'lost' AND organization_id IS NULL);

-- Ensure Warm exists
INSERT INTO crm_lead_statuses (name, color, sort_order)
SELECT 'Warm', '#F59E0B', 13
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'warm' AND organization_id IS NULL);

-- Update sort orders for the new flow
UPDATE crm_lead_statuses SET sort_order = 1  WHERE lower(name) = 'mql' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 2  WHERE lower(name) = 'active' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 3  WHERE lower(name) = 'ring 1' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 4  WHERE lower(name) = 'ring 2' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 5  WHERE lower(name) = 'ring 3' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 6  WHERE lower(name) = 'ring 4' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 7  WHERE lower(name) = 'ring 5' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 8  WHERE lower(name) = 'ring 6' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 9  WHERE lower(name) = 'ring 7' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 10 WHERE lower(name) = 'ring 8' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 11 WHERE lower(name) = 'ring 9' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 12 WHERE lower(name) = 'ring 10' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 13 WHERE lower(name) = 'warm' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 14 WHERE lower(name) = 'hot' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 15 WHERE lower(name) = 'future' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 16 WHERE lower(name) = 'cold' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 17, is_terminal = true WHERE lower(name) = 'lost' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 18, is_terminal = true WHERE lower(name) = 'disqualified' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 19, is_terminal = true WHERE lower(name) = 'won' AND organization_id IS NULL;

-- Set MQL as default entry stage
UPDATE crm_lead_statuses SET is_default = true WHERE lower(name) = 'mql' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET is_default = false WHERE lower(name) != 'mql' AND organization_id IS NULL;
