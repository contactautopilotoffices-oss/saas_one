-- Add structured seat-count + move-in capture to CRM leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS move_in_timeline text;

-- Backfill seats from the [seats=N] token embedded in requirement by the Meta sync
UPDATE crm_leads
SET seats = (substring(requirement from '\[seats=(\d+)'))::int
WHERE requirement LIKE '[seats=%' AND seats IS NULL;

-- Backfill move_in_timeline from the requirement text
UPDATE crm_leads
SET move_in_timeline = trim(substring(requirement from 'Move-in:\s*([^|]+)'))
WHERE requirement LIKE '%Move-in:%' AND move_in_timeline IS NULL;

-- Strip the machine token out of requirement now that seats is a real column
UPDATE crm_leads
SET requirement = NULLIF(trim(regexp_replace(requirement, '^\[seats=\d+;bucket=[^\]]*\]\s*', '')), '')
WHERE requirement LIKE '[seats=%';

-- Index for fast range filtering
CREATE INDEX IF NOT EXISTS idx_crm_leads_seats ON crm_leads(seats);
