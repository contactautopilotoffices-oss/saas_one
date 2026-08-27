-- Per-PO workflow state for the Payment Tracker (criticality + SPOC).
--
-- WHY A SEPARATE TABLE: zoho_purchase_orders is fully overwritten every 2 hours by the
-- Zoho Books sync (backend/services/zohoBooksSync.ts upserts whole rows on
-- organization_id,zoho_po_id). Any user-authored column added there would be silently
-- clobbered on the next sync, so all human workflow state lives here instead.
--
-- Alignment status itself stays derived (po_payments.status + pending amount):
--   To Align = pending amount > 0, Aligned = po_payments.status 'aligned',
--   Completed = po_payments.status 'completed'. This table only carries the flags
--   procurement raises on top of that, chiefly "needs alignment ASAP".

CREATE TABLE IF NOT EXISTS public.po_workflow_state (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- UNIQUE on its own: a PO belongs to exactly one org, so exactly one workflow row
    -- may ever exist for it — a mis-scoped write cannot fork the flag across orgs.
    po_id               UUID NOT NULL UNIQUE REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,

    is_critical         BOOLEAN NOT NULL DEFAULT false,
    critical_reason     TEXT,
    critical_raised_by  UUID REFERENCES users(id),
    critical_raised_at  TIMESTAMPTZ,

    assigned_spoc       UUID REFERENCES users(id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Conflict target for the API upsert (app/api/accounts/pos/[id]/route.ts).
    UNIQUE (organization_id, po_id)
);

-- Partial: only flagged rows are indexed, so the "critical first" queue on the To Align
-- tab stays cheap however many thousands of POs the org accumulates.
CREATE INDEX IF NOT EXISTS idx_pws_org_critical ON public.po_workflow_state (organization_id, is_critical)
    WHERE is_critical;
-- No separate po_id index: the UNIQUE constraint above already provides one.

-- ---------------------------------------------------------------------------
-- RLS — writes go through the service-role API (app/api/accounts/pos/[id]),
-- which enforces canAlign/isAdmin. SELECT exists only so realtime can deliver
-- flag changes to an open Payment Tracker; the dashboard itself reads the flags
-- over the service role (app/api/accounts/pos/workflow).
--
-- The policy is scoped BY ROLE, not by bare membership. VIEW_ROLES in
-- backend/lib/accounts/access.ts:17 is the authority on who may see the tracker,
-- and property_admin / tenant / security / staff / super_tenant are deliberately
-- excluded there — a membership-only policy would hand them critical_reason,
-- critical_raised_by and assigned_spoc straight from the browser client.
--
-- Both membership tables are consulted because an accounts role may live on either
-- (access.ts:82,85 merges them); resolving through organization_memberships alone
-- would let a property-membership procurement user write flags they can never read.
-- ---------------------------------------------------------------------------
ALTER TABLE public.po_workflow_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acct members read po workflow" ON public.po_workflow_state;
CREATE POLICY "acct members read po workflow" ON public.po_workflow_state FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = po_workflow_state.organization_id
              AND om.is_active
              AND om.role::text IN ('org_super_admin','org_admin','master_admin',
                                    'purchase_manager','purchase_executive','procurement','accounts'))
    OR EXISTS (SELECT 1 FROM property_memberships pm
            WHERE pm.user_id = auth.uid()
              AND pm.organization_id = po_workflow_state.organization_id
              AND pm.is_active
              AND pm.role::text IN ('org_super_admin','org_admin','master_admin',
                                    'purchase_manager','purchase_executive','procurement','accounts'))
);

-- ---------------------------------------------------------------------------
-- Realtime so a critical flag flipped by one user appears live for everyone else
-- ---------------------------------------------------------------------------
ALTER TABLE public.po_workflow_state REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='po_workflow_state') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.po_workflow_state;
    END IF;
END $$;
