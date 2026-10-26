-- =============================================================================
-- SATEJ — conversation per requirement
-- -----------------------------------------------------------------------------
-- The chat panel on a Satej requirement: what the team asked, what Satej
-- answered, and any change Satej PROPOSED. A proposal is never applied by the
-- model; a person presses Apply, and action_status records what happened.
-- Voice-call minutes land here too (role 'satej', kind 'call_minutes').
--
-- Access as for the other satej_* tables: RLS on, no policies, service role
-- only, every /api/satej route checks the caller's organisation first.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.satej_messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requirement_id   uuid NOT NULL REFERENCES public.satej_requirements(id) ON DELETE CASCADE,
    role             text NOT NULL CHECK (role IN ('user', 'satej')),
    kind             text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'call_minutes')),
    author_user_id   uuid,
    author_name      text,
    body             text NOT NULL,
    -- A change Satej proposed: { type: 'edit' | 'find_more' | 'approve_calls' | ..., ... }
    action           jsonb,
    action_status    text CHECK (action_status IN ('proposed', 'applied', 'dismissed', 'failed')),
    action_result    text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_messages_requirement_idx
    ON public.satej_messages (requirement_id, created_at);

ALTER TABLE public.satej_messages ENABLE ROW LEVEL SECURITY;
