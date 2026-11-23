-- Migration: Grant ops_super_admin and org-wide admins access to SOP Checklist tables
-- Date: 2026-11-23

-- 1. Helper function: is caller an active org-wide admin (including ops_super_admin)?
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

-- 2. sop_templates RLS
DROP POLICY IF EXISTS "sop_templates_read" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_manage" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_ops_admin" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_authenticated_all" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_authenticated_read" ON public.sop_templates;

-- READ: Org admins/Ops admins, property admins, or assigned property members
CREATE POLICY "sop_templates_read" ON public.sop_templates FOR SELECT USING (
    public.is_org_admin_or_ops_admin(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_templates.property_id
        AND pm.role IN ('property_admin', 'admin')
        AND pm.is_active IS DISTINCT FROM false
    )
    OR (
        EXISTS (
            SELECT 1 FROM public.property_memberships pm
            WHERE pm.user_id = auth.uid()
            AND pm.property_id = sop_templates.property_id
            AND pm.is_active IS DISTINCT FROM false
        )
        AND (
            cardinality(assigned_to) = 0
            OR assigned_to IS NULL
            OR assigned_to @> ARRAY[auth.uid()::text]
        )
    )
);

-- MANAGE (Insert/Update/Delete): Org admins/Ops admins, or Property Admin
CREATE POLICY "sop_templates_manage" ON public.sop_templates FOR ALL USING (
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

-- 3. sop_checklist_items RLS
DROP POLICY IF EXISTS "sop_items_read" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_manage" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_checklist_items_ops_admin" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_authenticated_all" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_checklist_items_authenticated_read" ON public.sop_checklist_items;

CREATE POLICY "sop_items_read" ON public.sop_checklist_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.sop_templates t
        WHERE t.id = sop_checklist_items.template_id
        AND (
            public.is_org_admin_or_ops_admin(t.organization_id)
            OR EXISTS (
                SELECT 1 FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                AND pm.property_id = t.property_id
                AND pm.is_active IS DISTINCT FROM false
            )
        )
    )
);

CREATE POLICY "sop_items_manage" ON public.sop_checklist_items FOR ALL USING (
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

-- 4. sop_completions RLS
DROP POLICY IF EXISTS "sop_completions_all_roles" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_read" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_delete" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_ops_admin_delete" ON public.sop_completions;
DROP POLICY IF EXISTS "sop_completions_authenticated_read" ON public.sop_completions;

CREATE POLICY "sop_completions_read" ON public.sop_completions FOR SELECT USING (
    completed_by = auth.uid()
    OR public.is_org_admin_or_ops_admin(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_completions.property_id
        AND pm.role IN ('property_admin', 'admin')
        AND pm.is_active IS DISTINCT FROM false
    )
);

CREATE POLICY "sop_completions_delete" ON public.sop_completions FOR DELETE USING (
    public.is_org_admin_or_ops_admin(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_completions.property_id
        AND pm.role IN ('property_admin', 'admin')
        AND pm.is_active IS DISTINCT FROM false
    )
);

-- 5. sop_completion_items RLS
DROP POLICY IF EXISTS "sop_completion_items_manage" ON public.sop_completion_items;
DROP POLICY IF EXISTS "sop_completion_items_authenticated_read" ON public.sop_completion_items;

CREATE POLICY "sop_completion_items_read" ON public.sop_completion_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.sop_completions c
        WHERE c.id = sop_completion_items.completion_id
        AND (
            c.completed_by = auth.uid()
            OR public.is_org_admin_or_ops_admin(c.organization_id)
            OR EXISTS (
                SELECT 1 FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                AND pm.property_id = c.property_id
                AND pm.is_active IS DISTINCT FROM false
            )
        )
    )
);
