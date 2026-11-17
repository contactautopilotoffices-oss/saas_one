-- Free-text seat requirement for CRM leads.
--
-- `seats` stays an integer so the seat-range filters, buckets and reports keep
-- working. Reps also need to record what the number is made of — e.g.
-- "70 workstations and 4 cabins" — which an integer column cannot hold, so the
-- text the rep actually types goes here and `seats` keeps the leading number.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS seats_detail text;

COMMENT ON COLUMN crm_leads.seats_detail IS
    'Seat requirement as the rep typed it (e.g. "70 workstations and 4 cabins"). crm_leads.seats holds the numeric part for filtering.';

-- Backfill: existing numeric-only requirements read the same either way.
UPDATE crm_leads
SET seats_detail = seats::text
WHERE seats IS NOT NULL AND seats_detail IS NULL;
