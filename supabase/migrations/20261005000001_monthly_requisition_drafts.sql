BEGIN;

-- Private work in progress, separate from submitted requisitions and their outbox.
CREATE TABLE public.monthly_requisition_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    requisition_month integer NOT NULL CHECK (requisition_month BETWEEN 1 AND 12),
    requisition_year integer NOT NULL CHECK (requisition_year BETWEEN 2000 AND 2200),
    floor_tag text NOT NULL CHECK (length(floor_tag) BETWEEN 1 AND 100),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, organization_id, property_id, requisition_month, requisition_year, floor_tag)
);

CREATE FUNCTION public.can_access_monthly_requisition_draft(p_org uuid, p_property uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM properties p
        WHERE p.id = p_property AND p.organization_id = p_org
        AND p.is_active AND p.deleted_at IS NULL
        AND (
            EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_master_admin)
            OR EXISTS (SELECT 1 FROM organization_memberships m
                WHERE m.user_id = auth.uid() AND m.organization_id = p_org AND m.is_active
                AND m.role::text IN ('org_super_admin', 'ops_super_admin', 'org_admin', 'owner', 'procurement'))
            OR EXISTS (SELECT 1 FROM property_memberships m
                WHERE m.user_id = auth.uid() AND m.property_id = p_property AND m.is_active)
        )
    );
$$;
REVOKE ALL ON FUNCTION public.can_access_monthly_requisition_draft(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_monthly_requisition_draft(uuid, uuid) TO authenticated;

ALTER TABLE public.monthly_requisition_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY monthly_requisition_draft_owner ON public.monthly_requisition_drafts
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND public.can_access_monthly_requisition_draft(organization_id, property_id))
    WITH CHECK (user_id = auth.uid() AND public.can_access_monthly_requisition_draft(organization_id, property_id));
REVOKE ALL ON public.monthly_requisition_drafts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_requisition_drafts TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
