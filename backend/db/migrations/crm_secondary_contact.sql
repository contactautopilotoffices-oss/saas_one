-- Add secondary contact number to crm_leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS secondary_contact_number TEXT;
