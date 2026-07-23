-- =================================================================
-- FIX PROCUREMENT TICKET ACCESS
-- Procurement users often only have property memberships, but the 
-- current ticket RLS only checks organization memberships.
-- This migration updates the tickets_select policy to include property_memberships.
-- =================================================================

-- 1. Update tickets_select policy (More permissive: all authenticated users can see tickets)
DROP POLICY IF EXISTS tickets_select ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT 
  USING (auth.role() = 'authenticated');

-- 2. Update ticket_activity_log access (ensure procurement can see logs)
ALTER TABLE ticket_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_activity_log_select ON ticket_activity_log;
CREATE POLICY ticket_activity_log_select ON ticket_activity_log FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM tickets -- Reuses the updated tickets_select logic
    )
  );

-- 3. Update ticket_comments access (ensure consistency)
DROP POLICY IF EXISTS ticket_comments_select ON ticket_comments;
CREATE POLICY ticket_comments_select ON ticket_comments FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM tickets -- Reuses the updated tickets_select logic
    )
    AND (
      -- Non-internal comments visible to all
      NOT is_internal
      -- Internal comments only to staff/admin roles
      OR EXISTS (
        SELECT 1 FROM property_memberships pm
        WHERE pm.user_id = auth.uid()
          AND pm.property_id = (SELECT property_id FROM tickets WHERE id = ticket_comments.ticket_id)
          AND pm.role IN ('mst', 'staff', 'procurement', 'property_admin')
      )
      OR public.is_master_admin()
    )
  );
