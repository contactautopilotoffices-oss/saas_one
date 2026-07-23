-- Rename "Warm" status to "MQL" across all organizations.
UPDATE crm_lead_statuses SET name = 'MQL' WHERE lower(name) = 'warm';
