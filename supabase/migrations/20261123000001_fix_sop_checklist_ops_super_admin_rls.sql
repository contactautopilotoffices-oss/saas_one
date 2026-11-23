-- Migration: Allow any authenticated user to see checklists (no role restriction on SELECT)
-- + allow org admins, ops super admin, and property admins to manage templates
-- Date: 2026-11-23

BEGIN;

-- ============================================================================
-- 1. Helper function: check if caller is an active org admin or ops super admin
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_org_admin_or_ops_admin(p_org_id uuid)
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
      AND lower(role) IN ('org_super_admin', 'ops_super_admin', 'master_admin', 'org_admin', 'owner', 'admin')
      AND is_active IS DISTINCT FROM false
  );
END;
$$;

ALTER FUNCTION public.is_org_admin_or_ops_admin(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_org_admin_or_ops_admin(uuid) TO authenticated;

-- ============================================================================
-- 2. sop_templates RLS
-- ============================================================================
ALTER TABLE public.sop_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sop_templates_read" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_authenticated_read" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_authenticated_all" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_manage" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_ops_admin" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_admin_manage" ON public.sop_templates;

-- ANY authenticated user can see (SELECT) all checklist templates (no role restrictions)
CREATE POLICY "sop_templates_authenticated_read" ON public.sop_templates
    FOR SELECT TO authenticated
    USING (true);

-- Manage (INSERT / UPDATE / DELETE): Org admins / Ops Super Admin / Property Admin
CREATE POLICY "sop_templates_admin_manage" ON public.sop_templates
    FOR ALL TO authenticated
    USING (
        public.is_org_admin_or_ops_admin(organization_id)
        OR EXISTS (
            SELECT 1 FROM public.property_memberships pm
            WHERE pm.user_id = auth.uid()
            AND pm.property_id = sop_templates.property_id
            AND pm.role IN ('property_admin', 'admin')
            AND pm.is_active IS DISTINCT FROM false
        )
    )
    WITH CHECK (
        public.is_org_admin_or_ops_admin(organization_id)
        OR EXISTS (
            SELECT 1 FROM public.property_memberships pm
            WHERE pm.user_id = auth.uid()
            AND pm.property_id = sop_templates.property_id
            AND pm.role IN ('property_admin', 'admin')
            AND pm.is_active IS DISTINCT FROM false
        )
    );

-- ============================================================================
-- 3. sop_checklist_items RLS
-- ============================================================================
ALTER TABLE public.sop_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sop_items_read" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_checklist_items_authenticated_read" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_authenticated_all" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_manage" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_checklist_items_ops_admin" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_checklist_items_admin_manage" ON public.sop_checklist_items;

-- ANY authenticated user can see (SELECT) all checklist items (no role restrictions)
CREATE POLICY "sop_checklist_items_authenticated_read" ON public.sop_checklist_items
    FOR SELECT TO authenticated
    USING (true);

-- Manage items: Org admins / Ops Super Admin / Property Admin
CREATE POLICY "sop_checklist_items_admin_manage" ON public.sop_checklist_items
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.sop_templates t
            WHERE t.id = sop_checklist_items.template_id
            AND (
                public.is_org_admin_or_ops_admin(t.organization_id)
                OR EXISTS (
                    SELECT 1 FROM public.property_memberships pm
                    WHERE pm.user_id = auth.uid()
                    AND pm.property_id = t.property_id
                    AND pm.role IN ('property_admin', 'admin')
                    AND pm.is_active IS DISTINCT FROM false
                )
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sop_templates t
            WHERE t.id = sop_checklist_items.template_id
            AND (
                public.is_org_admin_or_ops_admin(t.organization_id)
                OR EXISTS (
                    SELECT 1 FROM public.property_memberships pm
                    WHERE pm.user_id = auth.uid()
                    AND pm.property_id = t.property_id
                    AND pm.role IN ('property_admin', 'admin')
                    AND pm.is_active IS DISTINCT FROM false
                )
            )
        )
    );

-- ============================================================================
-- 4. sop_completions RLS
-- ============================================================================
ALTER TABLE public.sop_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sop_completions_all_roles" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_read" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_authenticated_read" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_delete" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_ops_admin_delete" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_ops_admin_read" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_insert" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_update" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_authenticated_insert" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_authenticated_update" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_admin_delete" ON public.sop_completions;

-- ANY authenticated user can see (SELECT) all completions / history (no role restrictions)
CREATE POLICY "sop_completions_authenticated_read" ON public.sop_completions
    FOR SELECT TO authenticated
    USING (true);

-- Authenticated users can insert their own checklist runs
CREATE POLICY "sop_completions_authenticated_insert" ON public.sop_completions
    FOR INSERT TO authenticated
    WITH CHECK (completed_by = auth.uid());

-- Updating completion runs (by submitter or admins)
CREATE POLICY "sop_completions_authenticated_update" ON public.sop_completions
    FOR UPDATE TO authenticated
    USING (completed_by = auth.uid() OR public.is_org_admin_or_ops_admin(organization_id));

-- Deleting completions: Org admins / Ops Super Admin / Property Admin
CREATE POLICY "sop_completions_admin_delete" ON public.sop_completions
    FOR DELETE TO authenticated
    USING (
        public.is_org_admin_or_ops_admin(organization_id)
        OR EXISTS (
            SELECT 1 FROM public.property_memberships pm
            WHERE pm.user_id = auth.uid()
            AND pm.property_id = sop_completions.property_id
            AND pm.role IN ('property_admin', 'admin')
            AND pm.is_active IS DISTINCT FROM false
        )
    );

-- ============================================================================
-- 5. sop_completion_items RLS
-- ============================================================================
ALTER TABLE public.sop_completion_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sop_completion_items_manage" ON public.sop_completion_items;
DROP POLICY IF EXISTS "sop_completion_items_authenticated_read" ON public.sop_completion_items;
DROP POLICY IF EXISTS "sop_completion_items_read" ON public.sop_completion_items;
DROP POLICY IF EXISTS "sop_completion_items_ops_admin_read" ON public.sop_completion_items;
DROP POLICY IF EXISTS "sop_completion_items_authenticated_all" ON public.sop_completion_items;

-- ANY authenticated user can see (SELECT) completion items (no role restrictions)
CREATE POLICY "sop_completion_items_authenticated_read" ON public.sop_completion_items
    FOR SELECT TO authenticated
    USING (true);

-- Authenticated users can insert/update completion items for runs
CREATE POLICY "sop_completion_items_authenticated_all" ON public.sop_completion_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

COMMIT;
