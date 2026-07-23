-- ===========================================
-- CRM Lead Status: add icon column
-- Lets each lifecycle stage carry a named icon key (rendered by
-- frontend/lib/crm/stages.ts). Schema-only, additive, safe to re-run.
-- ===========================================

ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS icon TEXT;
