-- Checklist AI vision: strict parameter checks + checker corrections that the AI learns from.
-- NOT applied automatically: a human runs this migration. Until it runs, scoring still works
-- (the new columns are written with a fallback) and the feedback buttons return an error.
-- All writes go through the server (service role) after a reviewer check.

-- ---------------------------------------------------------------------------
-- 1. Completion item flags written by the AI scorer.
--    ai_needs_review: at least one parameter could not be verified in the staff photos
--                     (not visible, wrong angle, or a reference angle has no matching photo).
--    ai_pass:         the pass/fail the scorer actually computed (was only re-derived before).
-- ---------------------------------------------------------------------------
ALTER TABLE public.sop_completion_items
    ADD COLUMN IF NOT EXISTS ai_needs_review boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ai_pass boolean;

CREATE INDEX IF NOT EXISTS idx_sop_completion_items_ai_needs_review
    ON public.sop_completion_items (completion_id) WHERE ai_needs_review;

-- ---------------------------------------------------------------------------
-- 2. Checker corrections. One row per parameter verdict a checker / property admin reviewed.
--    The scorer reads recent rows for the same step, and for the same parameter name across the
--    organization, and puts them in the prompt as standing rules.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sop_ai_feedback (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id         uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    template_id         uuid REFERENCES public.sop_templates(id) ON DELETE SET NULL,
    checklist_item_id   uuid NOT NULL REFERENCES public.sop_checklist_items(id) ON DELETE CASCADE,
    completion_id       uuid REFERENCES public.sop_completions(id) ON DELETE SET NULL,
    completion_item_id  uuid REFERENCES public.sop_completion_items(id) ON DELETE SET NULL,
    parameter_name      text NOT NULL CHECK (char_length(parameter_name) BETWEEN 1 AND 200),
    -- lower-cased, trimmed name used to share learning across checklists
    parameter_key       text NOT NULL CHECK (char_length(parameter_key) BETWEEN 1 AND 200),
    ai_status           text,
    verdict             text NOT NULL CHECK (verdict IN ('correct', 'incorrect')),
    corrected_status    text CHECK (corrected_status IS NULL OR corrected_status IN ('pass', 'needs_attention', 'fail', 'not_visible')),
    guidance            text CHECK (guidance IS NULL OR char_length(guidance) <= 500),
    is_active           boolean NOT NULL DEFAULT true,
    created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sop_ai_feedback_item ON public.sop_ai_feedback (checklist_item_id, created_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sop_ai_feedback_org_param ON public.sop_ai_feedback (organization_id, parameter_key, created_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sop_ai_feedback_completion ON public.sop_ai_feedback (completion_id);

-- ---------------------------------------------------------------------------
-- RLS: read for members of the property; no write policies (server only).
-- ---------------------------------------------------------------------------
ALTER TABLE public.sop_ai_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sop_ai_feedback_read ON public.sop_ai_feedback;
CREATE POLICY sop_ai_feedback_read ON public.sop_ai_feedback FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.property_memberships pm WHERE pm.user_id = auth.uid()
            AND pm.property_id = sop_ai_feedback.property_id AND pm.is_active)
        OR EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.user_id = auth.uid()
            AND om.organization_id = sop_ai_feedback.organization_id AND om.is_active)
    );
