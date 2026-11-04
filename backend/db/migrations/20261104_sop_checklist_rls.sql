-- Migration: SOP / Checklist RLS — authenticated read + ops_super_admin manage
-- Date: 2026-11-04
--
-- Two changes, in one script because migrations here are run by hand.
--
-- PART A  Any authenticated user may READ checklist data.
-- PART B  ops_super_admin may MANAGE it (create/edit/delete).
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE RUNNING PART A
--
--   Part A grants SELECT to the 'authenticated' role with USING (true) and no
--   organization or property filter. That is deliberate and was chosen
--   explicitly, but it means:
--
--     * every logged-in user of EVERY organization can read EVERY property's
--       templates, checklist items, completions and completion items;
--     * the per-template assigned_to restriction stops having any effect on
--       reads, because PostgreSQL ORs permissive policies together — a single
--       USING (true) policy makes the narrower ones moot for SELECT;
--     * this crosses the tenant boundary on these four tables. No other
--       module's tables are affected.
--
--   It does NOT grant writes. INSERT / UPDATE / DELETE remain governed by the
--   existing policies plus Part B.
--
--   To reverse Part A, drop the four *_authenticated_read policies at the
--   bottom of this comment block; the pre-existing policies are untouched and
--   will resume governing reads on their own:
--
--     DROP POLICY IF EXISTS "sop_templates_authenticated_read"        ON sop_templates;
--     DROP POLICY IF EXISTS "sop_checklist_items_authenticated_read"  ON sop_checklist_items;
--     DROP POLICY IF EXISTS "sop_completions_authenticated_read"      ON sop_completions;
--     DROP POLICY IF EXISTS "sop_completion_items_authenticated_read" ON sop_completion_items;
-- ---------------------------------------------------------------------------
--
-- Why this script ADDS policies instead of replacing the existing ones:
--   Production has not run every file in backend/db/migrations (confirmed:
--   property_members in 20260226_sop_satisfaction_rating.sql does not exist
--   live), and sop_templates_read / sop_items_read are each defined twice in
--   this repo. Live policy bodies therefore cannot be assumed to match any file
--   here, so nothing pre-existing is dropped. The only policies this script
--   drops are ones it created itself, which is what makes it safe to re-run.
--
-- Why Part B does not widen is_org_admin_v2():
--   That function has 28 call sites across 8 migration files, covering tables
--   far outside this module. Editing it would grant ops_super_admin org-admin
--   rights database-wide. A dedicated helper is used instead.
--
-- Safe to re-run.

BEGIN;

-- ===========================================================================
-- PART A — authenticated read
-- ===========================================================================

DROP POLICY IF EXISTS "sop_templates_authenticated_read" ON sop_templates;
CREATE POLICY "sop_templates_authenticated_read" ON sop_templates FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "sop_checklist_items_authenticated_read" ON sop_checklist_items;
CREATE POLICY "sop_checklist_items_authenticated_read" ON sop_checklist_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "sop_completions_authenticated_read" ON sop_completions;
CREATE POLICY "sop_completions_authenticated_read" ON sop_completions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "sop_completion_items_authenticated_read" ON sop_completion_items;
CREATE POLICY "sop_completion_items_authenticated_read" ON sop_completion_items FOR SELECT
  TO authenticated
  USING (true);

-- ===========================================================================
-- PART B — ops_super_admin manage
-- ===========================================================================

-- B1. Helper: is the caller an active ops_super_admin of this org?
--     Mirrors public.is_org_admin_v2 (v2_rls_architecture.sql) in shape.
CREATE OR REPLACE FUNCTION public.is_ops_super_admin_v2(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND lower(role) = 'ops_super_admin'
      -- tolerate NULL is_active, which existing rows may carry
      AND is_active IS DISTINCT FROM false
  );
END;
$$;

ALTER FUNCTION public.is_ops_super_admin_v2(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_ops_super_admin_v2(uuid) TO authenticated;

-- B2. sop_templates — full manage (Templates tab: create/edit/delete)
DROP POLICY IF EXISTS "sop_templates_ops_admin" ON sop_templates;
CREATE POLICY "sop_templates_ops_admin" ON sop_templates FOR ALL
  USING (public.is_ops_super_admin_v2(organization_id))
  WITH CHECK (public.is_ops_super_admin_v2(organization_id));

-- B3. sop_checklist_items — inherit template access
DROP POLICY IF EXISTS "sop_checklist_items_ops_admin" ON sop_checklist_items;
CREATE POLICY "sop_checklist_items_ops_admin" ON sop_checklist_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sop_templates t
      WHERE t.id = sop_checklist_items.template_id
        AND public.is_ops_super_admin_v2(t.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sop_templates t
      WHERE t.id = sop_checklist_items.template_id
        AND public.is_ops_super_admin_v2(t.organization_id)
    )
  );

-- B4. sop_completions — delete only (admin delete button in History).
--     Reads are covered by Part A. INSERT/UPDATE are deliberately not granted:
--     completions are created by the person performing the checklist, and the
--     approval/scoring paths run through API routes on the service-role
--     client, which bypasses RLS entirely.
DROP POLICY IF EXISTS "sop_completions_ops_admin_delete" ON sop_completions;
CREATE POLICY "sop_completions_ops_admin_delete" ON sop_completions FOR DELETE
  USING (public.is_ops_super_admin_v2(organization_id));

-- B5. Drop the ops-only read policies from the earlier draft of this migration.
--     Part A supersedes them. Safe if they were never created.
DROP POLICY IF EXISTS "sop_completions_ops_admin_read" ON sop_completions;
DROP POLICY IF EXISTS "sop_completion_items_ops_admin_read" ON sop_completion_items;

COMMIT;

-- ===========================================================================
-- Verification — expect 4 *_authenticated_read (SELECT) and
--                       3 *_ops_admin* (ALL / ALL / DELETE)
-- ===========================================================================
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND (policyname LIKE '%authenticated_read%' OR policyname LIKE '%ops_admin%')
ORDER BY tablename, policyname;
