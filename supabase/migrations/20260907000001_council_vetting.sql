-- ============================================================================
-- COUNCIL VETTING — a council persona reviews a runtime agent's work.
-- ----------------------------------------------------------------------------
-- Ira reports to Nair. After each scan, Nair (a council_agents persona, run
-- through the council LLM) reads Ira's findings and writes a verdict here.
-- The verdict is stamped on the digest so the reader knows a second pair of
-- eyes looked, and it lands in the same council log the console already joins
-- onto every agent card — so nothing new is needed to display it.
--
-- Two changes, both additive:
--   1. oem_council_log.review_type gains 'vetting'.
--   2. council_agents gets an UPDATE policy for org admins, so a persona (the
--      one prompt in this system that a model actually executes) can be edited
--      from the Agent Console rather than only by the service role.
-- ============================================================================

ALTER TABLE public.oem_council_log
    DROP CONSTRAINT IF EXISTS oem_council_log_review_type_check;

ALTER TABLE public.oem_council_log
    ADD CONSTRAINT oem_council_log_review_type_check
    CHECK (review_type IN (
        'prompt_change', 'goal_binding', 'bundle_change',
        'performance_review', 'escalation', 'note',
        'vetting'
    ));

COMMENT ON CONSTRAINT oem_council_log_review_type_check ON public.oem_council_log IS
    'vetting = a council persona reviewed a runtime agent''s findings (decided_by = council). details carries { agent_key, reviewer, verdict, findings_reviewed, concerns[] }.';

-- Persona edits from the console. The API still checks membership + admin
-- role before writing through the service role; this policy is the
-- defence-in-depth layer so a direct client write is also scoped.
ALTER TABLE public.council_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.council_agents ADD COLUMN IF NOT EXISTS persona_version INT NOT NULL DEFAULT 1;

DROP POLICY IF EXISTS "org admins update council agents" ON public.council_agents;
CREATE POLICY "org admins update council agents" ON public.council_agents
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.organization_id = council_agents.org_id
              AND m.user_id = auth.uid()
              AND m.role IN ('org_admin', 'org_super_admin')
        )
    );
