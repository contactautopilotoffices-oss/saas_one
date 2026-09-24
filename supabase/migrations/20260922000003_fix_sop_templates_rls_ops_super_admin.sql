-- Migration: Fix RLS policies on sop_templates, sop_checklist_items, and sop_completions
-- Allow ops_super_admin, org_admin, admin, and property_admin to manage SOP templates

-- 1. Drop existing restrictive policies
DROP POLICY IF EXISTS "sop_templates_manage" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_read" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_items_manage" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_read" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_completions_delete" ON public.sop_completions;

-- 2. sop_templates READ policy:
-- Members of property, assigned users, or any org/property admin (including ops_super_admin) can view templates
CREATE POLICY "sop_templates_read" ON public.sop_templates FOR SELECT USING (
    public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
    OR (
        public.is_property_member_v2(property_id) AND (
            cardinality(assigned_to) = 0
            OR assigned_to @> ARRAY[auth.uid()::text]
            OR EXISTS (
                SELECT 1 FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                AND pm.property_id = sop_templates.property_id
                AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
        )
    )
);

-- 3. sop_templates MANAGE policy:
-- Allows admins (master_admin, ops_super_admin, org_admin, property_admin) to create, update, delete templates
CREATE POLICY "sop_templates_manage" ON public.sop_templates FOR ALL USING (
    public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_templates.property_id
        AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
)
WITH CHECK (
    public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_templates.property_id
        AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
);

-- 4. sop_checklist_items READ policy:
CREATE POLICY "sop_items_read" ON public.sop_checklist_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.sop_templates t
        WHERE t.id = sop_checklist_items.template_id
        AND (
            public.is_master_admin_v2()
            OR public.is_org_admin_v2(t.organization_id)
            OR EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
            OR (
                public.is_property_member_v2(t.property_id) AND (
                    cardinality(t.assigned_to) = 0
                    OR t.assigned_to @> ARRAY[auth.uid()::text]
                    OR EXISTS (
                        SELECT 1 FROM public.property_memberships pm
                        WHERE pm.user_id = auth.uid()
                        AND pm.property_id = t.property_id
                        AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
                    )
                )
            )
        )
    )
);

-- 5. sop_checklist_items MANAGE policy:
CREATE POLICY "sop_items_manage" ON public.sop_checklist_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.sop_templates t
        WHERE t.id = sop_checklist_items.template_id
        AND (
            public.is_master_admin_v2()
            OR public.is_org_admin_v2(t.organization_id)
            OR EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
            OR EXISTS (
                SELECT 1 FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                AND pm.property_id = t.property_id
                AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.sop_templates t
        WHERE t.id = sop_checklist_items.template_id
        AND (
            public.is_master_admin_v2()
            OR public.is_org_admin_v2(t.organization_id)
            OR EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
            OR EXISTS (
                SELECT 1 FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                AND pm.property_id = t.property_id
                AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
            )
        )
    )
);

-- 6. sop_completions DELETE policy:
CREATE POLICY "sop_completions_delete" ON public.sop_completions FOR DELETE USING (
    completed_by = auth.uid()
    OR public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role IN ('master_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = sop_completions.property_id
        AND pm.role IN ('property_admin', 'ops_super_admin', 'org_admin', 'admin')
    )
);
