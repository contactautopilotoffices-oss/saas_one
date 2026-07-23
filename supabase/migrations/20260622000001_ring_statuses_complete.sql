-- Insert Ring 1-10 as global statuses if they don't already exist globally.
-- Ring 1-3 may exist as org-specific rows; these global rows ensure every org
-- has the full Ring 1-10 ladder available in the stage pipeline.
DO $$
DECLARE
  n INT;
  sort INT;
BEGIN
  FOR n IN 1..10 LOOP
    sort := n + 2; -- sort_order: Ring 1 = 3, Ring 2 = 4 ... Ring 10 = 12
    INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal, is_won, is_lost)
    SELECT
      'Ring ' || n,
      '#FB923C',  -- orange
      sort,
      false,
      false,
      false
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_lead_statuses
      WHERE lower(name) = lower('Ring ' || n)
      AND organization_id IS NULL
    );
  END LOOP;
END $$;

-- Also add Visit Pending, Visit Done, Layout Shared, LOI as global activity statuses
-- if they don't exist (used by the stage pipeline activity buttons)
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Visit Pending', '#F59E0B', 20, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'visit pending' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Visit Done', '#10B981', 21, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'visit done' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Layout Shared', '#8B5CF6', 22, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'layout shared' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'LOI', '#3B82F6', 23, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'loi' AND organization_id IS NULL);
