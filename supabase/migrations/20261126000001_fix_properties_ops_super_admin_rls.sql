-- Allow ops_super_admin (and other elevated org admins with active or NULL is_active
-- memberships) to read organization properties via public.is_org_admin_or_ops_admin.
-- Leaves is_org_admin_v2 untouched so existing policies with 28+ callers remain unchanged.

DROP POLICY IF EXISTS "prop_read_org_or_ops_admin" ON public.properties;
CREATE POLICY "prop_read_org_or_ops_admin"
    ON public.properties
    FOR SELECT
    TO authenticated
    USING (public.is_org_admin_or_ops_admin(organization_id));
