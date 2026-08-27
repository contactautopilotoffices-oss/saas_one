-- Saved / custom "views" for the My Leads module.
--
-- A view is a named, persisted bundle of the filters the leads list already
-- supports (scope, status, source, city, campaign, seats, date period, sort).
-- Personal to the creator. Rendered as "subsheet" tabs above the leads table.
-- Persistent: only ever removed on an explicit user delete (soft delete via
-- is_active), never automatically.
--
-- Follows the same conventions as crm_lead_statuses: uuid PK, org scope,
-- sort_order, is_default, is_active soft-delete, created_at/updated_at.
-- Access is enforced app-side through the service-role client (the CRM does not
-- rely on RLS); owner-scoped RLS policies are added as defence-in-depth.

CREATE TABLE IF NOT EXISTS public.crm_saved_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
    name            TEXT NOT NULL,
    icon            TEXT,                                   -- optional emoji / lucide icon name
    color           TEXT,                                   -- optional hex accent (e.g. #F97316)
    filters         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { scope, search, status[], lead_source[], city[], campaign[], seats_range, period:{mode,preset,date_from,date_to,date_field}, sort_by, sort_order }
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_default      BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One list per user per org, ordered by their chosen tab order.
CREATE INDEX IF NOT EXISTS idx_crm_saved_views_owner
    ON public.crm_saved_views (organization_id, created_by, sort_order)
    WHERE is_active;

ALTER TABLE public.crm_saved_views ENABLE ROW LEVEL SECURITY;

-- Owner-only access (defence-in-depth; the API talks via the service role).
DROP POLICY IF EXISTS "Owners manage their views" ON public.crm_saved_views;
CREATE POLICY "Owners manage their views" ON public.crm_saved_views
    FOR ALL
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());
