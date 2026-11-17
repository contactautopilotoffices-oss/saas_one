-- =============================================================================
-- SATEJ — versions of Meera's caller script
-- -----------------------------------------------------------------------------
-- Meera (the Bolna voice agent that phones vendors) can now be edited from the
-- Satej console. Every publish saves the script that was live BEFORE it and the
-- one published, so any change can be read back and restored.
--
-- RLS on, no policies: service role only, behind /api/satej/voice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.satej_voice_versions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    bolna_agent_id     text NOT NULL,
    kind               text NOT NULL CHECK (kind IN ('before_publish', 'published')),
    welcome_message    text NOT NULL,
    system_prompt      text NOT NULL,
    note               text,
    published_by_id    uuid,
    published_by_name  text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_voice_versions_org_idx
    ON public.satej_voice_versions (organization_id, created_at DESC);

ALTER TABLE public.satej_voice_versions ENABLE ROW LEVEL SECURITY;
