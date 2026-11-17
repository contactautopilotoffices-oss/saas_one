-- Unified Brain: settings, the conversation thread, staged files, memory and the record of every turn.
-- Plan: docs/WHATSAPP_UNIFIED_BRAIN_PLAN.md. NOT applied automatically: a person runs this migration.
--
-- Until this runs, the brain stays OFF for every org (a missing settings table is read as "off") and every WhatsApp
-- and in-app message is answered exactly as today.
--
--   ai_brain_settings          one row per org: off / shadow / live, pilot list, channels, grid, skill modes, limits
--   ai_brain_settings_history  who changed what, before and after (append-only)
--   ai_brain_threads           one conversation per person per org (plus a separate one for shadow runs)
--   ai_brain_attachments       photos and files a person sent, staged for 24 hours until attached to a ticket or task
--                              (the files live under brain-staging/ in the existing private bucket "task-attachments")
--   ai_brain_memory            preferences a person agreed to have remembered (closed key list, enforced in code)
--   ai_brain_episodes          one line per action a person did through the brain, for "what did I do last week"
--   ai_brain_turns             the trace: one row per turn with its model calls, tool calls, tokens, cost and outcome
--
-- Safety:   ADDITIVE ONLY. Seven new tables; no existing table, row or policy is changed.
--           Every table has RLS on and NO policies: only the server (service role) reads and writes them, after its
--           own checks. Logged-in users cannot read or write these tables directly.
-- Apply by hand, after 20261114000001. Safe to re-run.
-- Rollback: DROP TABLE public.ai_brain_turns, public.ai_brain_episodes, public.ai_brain_memory,
--           public.ai_brain_attachments, public.ai_brain_threads, public.ai_brain_settings_history,
--           public.ai_brain_settings;  (and empty brain-staging/ in the task-attachments bucket)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Settings. config is validated by brainSettingsSchema in backend/lib/aiLayer/brain/config.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_brain_settings (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    config          jsonb NOT NULL DEFAULT '{"mode": "off"}'::jsonb,
    updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_brain_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_brain_settings_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    changed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    before          jsonb,
    after           jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_brain_settings_history_org ON public.ai_brain_settings_history (organization_id, created_at DESC);
ALTER TABLE public.ai_brain_settings_history ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Thread: the open question or proposal, handles shown to the model, and the last turns. shadow = true is the
--    separate thread used while the brain only watches, so going live starts clean.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_brain_threads (
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    shadow          boolean NOT NULL DEFAULT false,
    state           jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id, shadow)
);
ALTER TABLE public.ai_brain_threads ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Staged files. A row is "open" while used_at IS NULL and expires_at is in the future.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_brain_attachments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    handle          text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('image', 'document')),
    mime            text NOT NULL,
    size_bytes      integer NOT NULL,
    sha256          text NOT NULL,
    storage_path    text NOT NULL,
    caption         text,
    channel         text NOT NULL CHECK (channel IN ('whatsapp', 'app_chat')),
    message_id      text,
    received_at     timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    used_by         text,
    used_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_brain_attachments_open ON public.ai_brain_attachments (organization_id, user_id, received_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_brain_attachments_expiry ON public.ai_brain_attachments (expires_at) WHERE used_at IS NULL;
ALTER TABLE public.ai_brain_attachments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Memory: what the person agreed to have remembered. Deleted with the person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_brain_memory (
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    key             text NOT NULL,
    value           text NOT NULL,
    label           text NOT NULL,
    source          text,
    confirmed_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at    timestamptz,
    PRIMARY KEY (organization_id, user_id, key)
);
ALTER TABLE public.ai_brain_memory ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_brain_episodes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    skill_id        text NOT NULL,
    summary         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    fts             tsvector GENERATED ALWAYS AS (to_tsvector('simple', summary)) STORED
);
CREATE INDEX IF NOT EXISTS idx_ai_brain_episodes_person ON public.ai_brain_episodes (organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_brain_episodes_fts ON public.ai_brain_episodes USING gin (fts);
ALTER TABLE public.ai_brain_episodes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. The trace: one row per turn. user_text / reply_text are cleared after the org's retention period; HR matters are
--    never stored as text. model_calls and tool_calls hold the per-call detail (doctrine L4, L14).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_brain_turns (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    channel         text NOT NULL CHECK (channel IN ('whatsapp', 'app_chat')),
    shadow          boolean NOT NULL DEFAULT false,
    message_id      text,
    user_text       text,
    reply_text      text,
    outcome         text NOT NULL,
    reason          text,
    skill_id        text,
    handoff_to      text,
    lang            text,
    model           text,
    key_slot        integer,
    tokens_in       integer NOT NULL DEFAULT 0,
    tokens_out      integer NOT NULL DEFAULT 0,
    cache_read      integer NOT NULL DEFAULT 0,
    cost_usd        numeric(12, 6),
    latency_ms      integer NOT NULL DEFAULT 0,
    grounded        boolean,
    had_file        boolean NOT NULL DEFAULT false,
    model_calls     jsonb NOT NULL DEFAULT '[]'::jsonb,
    tool_calls      jsonb NOT NULL DEFAULT '[]'::jsonb,
    hops            jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_brain_turns_org_time ON public.ai_brain_turns (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_brain_turns_person_time ON public.ai_brain_turns (organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_brain_turns_key_time ON public.ai_brain_turns (key_slot, created_at) WHERE key_slot IS NOT NULL;
ALTER TABLE public.ai_brain_turns ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
