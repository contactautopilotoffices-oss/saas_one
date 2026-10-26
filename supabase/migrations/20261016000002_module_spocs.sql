-- Migration: 20261016000002_module_spocs.sql
-- Description: Single point of contact (SPOC) per property and module, for the
-- Org Super Admin App Usage report. One SPOC per (property, module).
-- Read and written only by /api/reports/app-usage* through the service role, which
-- enforces org super admin access; RLS is on with no client policies.

BEGIN;

CREATE TABLE IF NOT EXISTS public.module_spocs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    module_key text NOT NULL CHECK (length(module_key) BETWEEN 1 AND 50),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_module_spocs_org ON public.module_spocs(organization_id);
CREATE INDEX IF NOT EXISTS idx_module_spocs_user ON public.module_spocs(user_id);

ALTER TABLE public.module_spocs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_spocs FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
