-- =============================================================================
-- SATEJ — vendor discovery agent
-- -----------------------------------------------------------------------------
-- A purchase requirement goes in; Satej finds local vendors on the web, has the
-- Bolna voice agent (Meera) call them, scores each call with a fixed rulebook
-- and sends the ranked shortlist on WhatsApp. Spec: docs/satej/AGENT_SPEC.md.
--
-- Three tables — one row per requirement, per vendor found, per Bolna call.
-- Each keeps the few columns that are queried plus the full record as JSON in
-- `data` (backend/lib/satej/repo.ts owns the shape).
--
-- Access: RLS on, NO policies. Only the service role reads or writes these
-- tables; every /api/satej route checks the caller's organisation membership
-- first (backend/lib/satej/access.ts). A browser client gets nothing.
--
-- Also registers Satej in the Agent Console (oem_agents) for every
-- organisation, as 'shadow'. Setting it to 'paused' there stops new work.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.satej_requirements (
    id               uuid PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code             text NOT NULL UNIQUE,                 -- REQ-YYMMDD-NNNN, what people quote
    status           text NOT NULL CHECK (status IN (
                         'submitted','needs_clarification','structured','discovering','awaiting_call_approval',
                         'calling','calls_done','analyzing','ranked','notified','failed','cancelled')),
    batch_id         text,                                  -- Bolna batch of the current round
    locked_until     timestamptz,                           -- worker lock; see repo.tryLock
    data             jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_requirements_org_created_idx
    ON public.satej_requirements (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS satej_requirements_status_idx
    ON public.satej_requirements (status, updated_at);
-- A webhook resolves its requirement by batch id, so one batch must map to one requirement.
CREATE UNIQUE INDEX IF NOT EXISTS satej_requirements_batch_idx
    ON public.satej_requirements (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.satej_vendors (
    id               uuid PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requirement_id   uuid NOT NULL REFERENCES public.satej_requirements(id) ON DELETE CASCADE,
    phone            text NOT NULL,                         -- E.164, +91…
    data             jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_vendors_requirement_idx
    ON public.satej_vendors (requirement_id, created_at);

CREATE TABLE IF NOT EXISTS public.satej_calls (
    id               uuid PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requirement_id   uuid NOT NULL REFERENCES public.satej_requirements(id) ON DELETE CASCADE,
    vendor_id        uuid REFERENCES public.satej_vendors(id) ON DELETE SET NULL,
    execution_id     text NOT NULL UNIQUE,                  -- Bolna execution id; webhooks upsert on it
    to_number        text NOT NULL,
    status           text NOT NULL,                         -- Bolna's execution status, verbatim
    data             jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_calls_requirement_idx
    ON public.satej_calls (requirement_id, created_at);
-- The do-not-recall rule: "has this organisation called this number in the last N days?"
CREATE INDEX IF NOT EXISTS satej_calls_recent_idx
    ON public.satej_calls (organization_id, to_number, created_at);

ALTER TABLE public.satej_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satej_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satej_calls ENABLE ROW LEVEL SECURITY;

-- Agent Console registration. Guarded so this migration also runs on a database
-- where the agent runtime (20260825000001) has not been applied.
DO $$
BEGIN
    IF to_regclass('public.oem_agents') IS NOT NULL THEN
        INSERT INTO public.oem_agents (organization_id, agent_key, display_name, department, role_description, status)
        SELECT o.id,
               'satej',
               'Satej',
               'procurement',
               'Finds local vendors for a purchase requirement, has Meera (Bolna voice) call them, scores every call '
               || 'with a fixed rulebook and sends the ranked shortlist to the purchase team on WhatsApp. '
               || 'A person approves every call list before any vendor is dialled.',
               'shadow'
          FROM public.organizations o
        ON CONFLICT (organization_id, agent_key) DO NOTHING;
    END IF;
END $$;
