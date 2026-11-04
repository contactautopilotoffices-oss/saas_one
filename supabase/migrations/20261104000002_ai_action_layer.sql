-- AI Action Layer: per-org access settings, settings history, and the AI action log.
-- Plan: docs/AI_ACTION_LAYER_PLAN.md (sections 6.5, 8.3). NOT applied automatically: a human runs this migration.
--
-- Until this runs, the AI layer stays OFF for every org (a missing settings table is treated as "disabled").
-- All writes go through the server (service role). Logged-in users get read access only where stated below.

-- ---------------------------------------------------------------------------
-- 1. Settings: one row per org. config is validated by settingsSchema in backend/lib/aiLayer/settings.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_access_settings (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    config          jsonb NOT NULL DEFAULT '{"enabled": false}'::jsonb,
    updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_access_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_access_settings_read ON public.ai_access_settings;
CREATE POLICY ai_access_settings_read ON public.ai_access_settings
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = ai_access_settings.organization_id
          AND om.role = 'org_super_admin'
          AND om.is_active
    ));
-- No INSERT / UPDATE / DELETE policies: only the server (after its own org super admin check) writes settings.

-- ---------------------------------------------------------------------------
-- 2. Settings history: who changed what, when, before and after. Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_access_settings_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    changed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    before          jsonb,
    after           jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_settings_history_org ON public.ai_access_settings_history (organization_id, created_at DESC);

ALTER TABLE public.ai_access_settings_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_access_settings_history_read ON public.ai_access_settings_history;
CREATE POLICY ai_access_settings_history_read ON public.ai_access_settings_history
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = ai_access_settings_history.organization_id
          AND om.role = 'org_super_admin'
          AND om.is_active
    ));

-- ---------------------------------------------------------------------------
-- 3. AI action log: one row per turn.
--    HR anonymity (plan gap S22): rows for sensitive entries have actor_user_id = NULL, a keyed hash in actor_hash,
--    no fields / result_ref, and visibility = 'hr'. Those rows are readable only by HR roles of the org, never by
--    org super admins, so the log can't reveal who raised an anonymous or confidential HR item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_action_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    op_id           uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_user_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
    actor_hash      text,
    visibility      text NOT NULL DEFAULT 'org_admin' CHECK (visibility IN ('org_admin', 'hr')),
    channel         text NOT NULL CHECK (channel IN ('app_chat', 'whatsapp', 'app_voice')),
    language        text NOT NULL CHECK (language IN ('en', 'hi', 'hinglish')),
    entry_id        text,
    decision        text NOT NULL CHECK (decision IN ('answered', 'asked', 'confirm_shown', 'accepted', 'acted', 'shadow', 'cancelled', 'refused', 'handed_off', 'error')),
    refusal_reason  text,
    fields          jsonb,
    result_ref      text,
    topic           text,
    model           text,
    tokens_in       integer NOT NULL DEFAULT 0,
    tokens_out      integer NOT NULL DEFAULT 0,
    latency_ms      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- A sensitive row must never carry the person's id.
    CONSTRAINT ai_action_log_hr_anonymous CHECK (visibility <> 'hr' OR (actor_user_id IS NULL AND fields IS NULL AND result_ref IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_ai_action_log_org_time ON public.ai_action_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_actor_time ON public.ai_action_log (organization_id, actor_user_id, created_at DESC);
-- Idempotency: one confirmed operation runs once, even if "Yes" arrives twice at the same moment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_action_log_accepted_op ON public.ai_action_log (op_id) WHERE decision = 'accepted';

ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_log_org_admin_read ON public.ai_action_log;
CREATE POLICY ai_action_log_org_admin_read ON public.ai_action_log
    FOR SELECT TO authenticated
    USING (
        visibility = 'org_admin'
        AND EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = ai_action_log.organization_id
              AND om.role = 'org_super_admin'
              AND om.is_active
        )
    );

DROP POLICY IF EXISTS ai_action_log_hr_read ON public.ai_action_log;
CREATE POLICY ai_action_log_hr_read ON public.ai_action_log
    FOR SELECT TO authenticated
    USING (
        visibility = 'hr'
        AND EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = ai_action_log.organization_id
              AND om.role IN ('hr', 'hr_head')
              AND om.is_active
        )
    );
-- No INSERT / UPDATE / DELETE policies: rows are written by the server only and never edited.
