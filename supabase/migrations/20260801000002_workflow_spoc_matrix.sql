-- Workflow SPOC matrix — a modular, domain-agnostic "who owns this stage at level N"
-- layer that sits BESIDE the existing FMS escalation matrix, not on top of it.
--
-- What already exists (backend/db/migrations/20260311_escalation_hierarchy.sql):
--   escalation_hierarchies (org/property scoped, trigger_after_minutes, is_default)
--     -> escalation_levels (level_number >= 1, employee_id, escalation_time_minutes)
--     -> ticket_escalation_logs (audit)
--   and tickets.hierarchy_id / current_escalation_level / escalation_paused, driven by
--   app/api/cron/check-escalation/route.ts. That chain stays the owner of TICKET timing.
--
-- Why a second table rather than more columns there: escalation_levels is keyed by
-- hierarchy_id and can only name a concrete employee, so it cannot answer
-- "who is the SPOC for petty_cash / approved / level 2?" without inventing a hierarchy
-- per stage per domain. This table generalises the same idea — ordered 1-based levels,
-- one actor per cell, a per-cell SLA, org- or property-scope, is_active — across the
-- procurement, petty cash, payment and ticket domains, and additionally allows naming a
-- ROLE so the matrix survives staff changes.
--
-- Unit note: escalation_levels stores minutes; SPOC SLAs are business-day-ish and are
-- stored in HOURS here. Callers converting between the two must multiply by 60.

CREATE TABLE IF NOT EXISTS public.workflow_spoc_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- NULL = org-wide default; a property row shadows the org row at the same level.
    property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,

    domain              TEXT NOT NULL
                        CHECK (domain IN ('procurement', 'petty_cash', 'payment', 'ticket')),
    -- Free text on purpose: each domain's own lifecycle names its stages
    -- (petty cash 'submitted'/'approved'/'paid', payments 'to_align'/'aligned', …).
    stage               TEXT NOT NULL CHECK (length(btrim(stage)) > 0),
    -- 1-based and capped at 10, matching escalation_levels.level_number and the
    -- 10-level cap enforced in app/api/escalation/hierarchies/route.ts.
    level               INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),

    -- CASCADE, not SET NULL: a person-only cell (the only shape the grid produces for a
    -- named SPOC) nulled to (NULL, NULL) violates workflow_spoc_rules_actor_present
    -- below, which would abort the parent DELETE with an error naming a table the
    -- operator has never heard of. Dropping the now-unowned cell is the honest outcome.
    spoc_user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    spoc_role           TEXT,
    -- Time allowed at this rung before the caller escalates to level + 1.
    sla_hours           INTEGER CHECK (sla_hours IS NULL OR sla_hours > 0),

    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A cell must name somebody: a person, a role, or both (person wins, role is fallback).
    CONSTRAINT workflow_spoc_rules_actor_present
        CHECK (spoc_user_id IS NOT NULL OR (spoc_role IS NOT NULL AND length(btrim(spoc_role)) > 0))
);

-- One rule per (scope, domain, stage, level). property_id NULL is folded onto the nil
-- UUID so org-wide rows collide with each other but never with a property's rows —
-- the nil UUID can never be a real properties.id, so no false collision is possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_spoc_rule
    ON public.workflow_spoc_rules (
        organization_id,
        COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
        domain,
        stage,
        level
    );

-- Resolver lookup: resolveSpoc() filters org + domain + stage + is_active, orders by level.
CREATE INDEX IF NOT EXISTS idx_wsr_lookup
    ON public.workflow_spoc_rules (organization_id, domain, stage, level)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_wsr_property ON public.workflow_spoc_rules (property_id);
CREATE INDEX IF NOT EXISTS idx_wsr_spoc_user ON public.workflow_spoc_rules (spoc_user_id);

-- ---------------------------------------------------------------------------
-- RLS: members READ the matrix (the admin grid and any client-side preview);
-- every write goes through the service-role API (app/api/workflows/spoc/route.ts),
-- which enforces org-admin / property-admin authorship. No INSERT/UPDATE/DELETE
-- policy is defined on purpose — service role bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflow_spoc_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wsr members read rules" ON public.workflow_spoc_rules;
CREATE POLICY "wsr members read rules" ON public.workflow_spoc_rules FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = workflow_spoc_rules.organization_id
              AND om.is_active)
);
