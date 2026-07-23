-- Add followup_notes column to crm_leads for tracking follow-up context
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS followup_notes TEXT;
