-- AI Assistant learning loop (docs/AI_ACTION_LAYER_PLAN.md, "Learning loop"). Modelled on the Task Manager's
-- whatsapp_bot_review_items / whatsapp_bot_eval_cases / whatsapp_bot_prompts, but per organization.
-- NOT applied automatically: a human runs this migration. Until it runs, the learning loop stays off and the AI works
-- exactly as before. All writes go through the server (service role) after an org super admin check.

-- ---------------------------------------------------------------------------
-- 1. Review items: messages the AI probably got wrong (only while the org's learning loop is on).
--    The person's message text is kept so an admin can teach the right answer. Phone-like digit runs are masked
--    before saving, HR complaints are never saved, and items expire after 30 days unless taught.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_review_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    channel         text NOT NULL CHECK (channel IN ('app_chat', 'whatsapp', 'app_voice')),
    message_text    text NOT NULL CHECK (char_length(message_text) <= 600),
    follow_up_text  text CHECK (follow_up_text IS NULL OR char_length(follow_up_text) <= 600),
    bot_reply       text CHECK (bot_reply IS NULL OR char_length(bot_reply) <= 600),
    entry_id        text,
    triggers        text[] NOT NULL DEFAULT '{}',
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taught', 'ignored')),
    resolved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_ai_review_items_org_open ON public.ai_review_items (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Taught examples: "this message means this question / action". Shown to the AI as examples for this
--    organization, and run as test cases before a new instruction version can go live.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_examples (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    message_text    text NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 600),
    entry_id        text NOT NULL,
    fields          jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_review_id uuid REFERENCES public.ai_review_items(id) ON DELETE SET NULL,
    created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_examples_org ON public.ai_examples (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Instruction versions: extra guidance for the AI, written by the org super admin. A version goes live only
--    after a test run against the taught examples that scores at least as well as the live one. The safety rules
--    (who may see what, no deletes / approvals in chat, HR) stay in code and can't be changed from here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    instructions    text NOT NULL CHECK (char_length(instructions) <= 4000),
    status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    pass_rate       numeric,
    tested_count    integer,
    tested_at       timestamptz,
    created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    activated_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_org ON public.ai_prompt_versions (organization_id, created_at DESC);
-- At most one live version per organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_prompt_versions_active ON public.ai_prompt_versions (organization_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- RLS: read-only for the org's super admins; no write policies (server only).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_review_items_read ON public.ai_review_items;
CREATE POLICY ai_review_items_read ON public.ai_review_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.user_id = auth.uid()
        AND om.organization_id = ai_review_items.organization_id AND om.role = 'org_super_admin' AND om.is_active));

DROP POLICY IF EXISTS ai_examples_read ON public.ai_examples;
CREATE POLICY ai_examples_read ON public.ai_examples FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.user_id = auth.uid()
        AND om.organization_id = ai_examples.organization_id AND om.role = 'org_super_admin' AND om.is_active));

DROP POLICY IF EXISTS ai_prompt_versions_read ON public.ai_prompt_versions;
CREATE POLICY ai_prompt_versions_read ON public.ai_prompt_versions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.user_id = auth.uid()
        AND om.organization_id = ai_prompt_versions.organization_id AND om.role = 'org_super_admin' AND om.is_active));
