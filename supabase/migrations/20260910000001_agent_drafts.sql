-- =============================================================================
-- AGENT COMPOSITION DRAFTS — save progress, and come back to it
--
-- WHY THIS TABLE EXISTS
-- The composer (app/api/agents/compose + AgentConsole's "Describe it" panel) is
-- a ONE-SHOT FORM. An operator types a description, waits ~30s for a model
-- round-trip, reads the open questions, answers them, reads the diff — and if
-- the tab is closed, the laptop sleeps, the session refreshes or they navigate
-- to another module, ALL OF IT IS GONE. There is no list of work in progress
-- and no way back to it. The next attempt starts from an empty textarea.
--
-- That is not a cosmetic annoyance: composing an agent is the most expensive
-- single interaction in this product (one LLM call over a whole-org table
-- sweep), and it is the one most likely to be interrupted, because the operator
-- is deliberately being asked to go and think about the open questions.
--
-- So a composition in progress gets a row. Nothing here is an agent, and
-- nothing here is live: this is the operator's unfinished sentence, kept.
--
-- WHY THE PROPOSAL IS STORED AND NOT RECOMPUTED
-- `proposal` holds the composer's last output verbatim. Re-running compose() to
-- restore a draft would (a) cost another model call, and (b) return a DIFFERENT
-- proposal — the model is not deterministic and the org's table row-counts move
-- underneath it. An operator who answered three open questions against
-- proposal A must come back to proposal A, or their answers refer to a document
-- that no longer exists.
--
-- WHY THERE IS NO UNIQUE KEY ON agent_key
-- agent_key is NULL for a brand-new agent, and NULLs are distinct in a UNIQUE
-- index, so "one draft per agent" cannot be expressed here without silently
-- allowing unlimited NULL rows anyway. Identity is the surrogate `id`, which
-- the client holds for the life of the composing session; the API upserts on
-- it. Two parallel drafts against the same agent are legal and visible in the
-- list, which is better than one clobbering the other.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.oem_agent_drafts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- A draft belongs to the person composing it, not to the org at large. The
    -- list is per-user (see the RLS write policies below and the GET handler).
    created_by       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- NULL = composing a BRAND-NEW agent. Set = editing an existing one, which
    -- is a different diff on accept, so the distinction has to survive a resume.
    -- Deliberately NOT a foreign key to oem_agents: a draft may name a key that
    -- does not exist yet (that is the point), and an agent later retired must
    -- not cascade-delete the operator's unfinished rewrite of it.
    agent_key        text,

    -- What the operator would recognise this row by in a list. Usually the
    -- composer's proposed display_name once there is a proposal; before that,
    -- NULL and the UI falls back to the description snippet.
    title            text,

    -- The sentence the operator typed. The one field that must never be lost.
    description      text NOT NULL DEFAULT '',

    -- Answers to proposal.open_questions, keyed by the question text (the
    -- composer does not assign question ids). jsonb, not text[], because the
    -- key -> answer association is what makes it resumable; a positional array
    -- silently re-associates every answer if the next proposal reorders them.
    answers          jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The last /api/agents/compose proposal, verbatim. NULL = the operator has
    -- typed a description but not composed yet.
    proposal         jsonb,

    -- The last /api/agents/plan output, verbatim. Separate column because Plan
    -- and Build are separate actions in the console and either may be the only
    -- one an operator has run.
    plan             jsonb,

    -- How far through, as a state the UI can render without re-deriving it:
    --   describing -> text only, no model call has been made
    --   proposed   -> a proposal exists and is being reviewed / answered
    --   applied    -> accepted into the registry; kept as history, not resumable
    --   abandoned  -> explicitly discarded by the operator
    -- 'applied' and 'abandoned' are terminal. Rows are kept rather than deleted
    -- so "what did we try and drop" is answerable; the API hides them from the
    -- resume list.
    status           text NOT NULL DEFAULT 'describing'
                     CHECK (status IN ('describing','proposed','applied','abandoned')),

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The only query the console makes: this person's open drafts, newest first.
CREATE INDEX IF NOT EXISTS idx_oem_agent_drafts_mine
    ON public.oem_agent_drafts (organization_id, created_by, updated_at DESC);

COMMENT ON COLUMN public.oem_agent_drafts.agent_key IS
    'NULL means a brand-new agent. Not a foreign key: a draft legitimately names a key that does not exist yet, and retiring an agent must not delete the unfinished rewrite of it.';
COMMENT ON COLUMN public.oem_agent_drafts.proposal IS
    'The composer output verbatim. Never recomputed on resume — a second compose() call costs another model round-trip and returns a different document, orphaning the answers the operator already wrote against the first one.';
COMMENT ON COLUMN public.oem_agent_drafts.answers IS
    'Keyed by open-question TEXT, not by position. A positional array re-associates every answer the moment the next proposal reorders its questions.';

-- --- updated_at is the sort key, so it may not depend on the client ---------
-- The list is ordered by updated_at and the UI prints "saved 2m ago" from it.
-- An autosaving client that forgets to send it (or sends a clock that is
-- minutes off) would reorder the operator's own drafts. The database stamps it.
CREATE OR REPLACE FUNCTION public.oem_agent_drafts_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oem_agent_drafts_touch ON public.oem_agent_drafts;
CREATE TRIGGER trg_oem_agent_drafts_touch
    BEFORE UPDATE ON public.oem_agent_drafts
    FOR EACH ROW EXECUTE FUNCTION public.oem_agent_drafts_touch();

-- --- RLS: org member to read, and only the AUTHOR to write -----------------
-- SELECT follows the same org-member model as oem_agents / oem_agent_findings.
-- The write policies are tighter on purpose: a draft is one person's unfinished
-- sentence, being autosaved every couple of seconds. If any org member could
-- UPDATE it, two people with the console open on the same row would overwrite
-- each other's typing with no conflict and no error — which is the exact class
-- of silent loss this whole table exists to prevent.
ALTER TABLE public.oem_agent_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_drafts' AND policyname = 'oem_select_org_member') THEN
        CREATE POLICY oem_select_org_member ON public.oem_agent_drafts
            FOR SELECT USING (public.oem_is_org_member(organization_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_drafts' AND policyname = 'oem_insert_own') THEN
        CREATE POLICY oem_insert_own ON public.oem_agent_drafts
            FOR INSERT WITH CHECK (public.oem_is_org_member(organization_id) AND created_by = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_drafts' AND policyname = 'oem_update_own') THEN
        CREATE POLICY oem_update_own ON public.oem_agent_drafts
            FOR UPDATE USING (public.oem_is_org_member(organization_id) AND created_by = auth.uid())
            WITH CHECK (public.oem_is_org_member(organization_id) AND created_by = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_drafts' AND policyname = 'oem_delete_own') THEN
        CREATE POLICY oem_delete_own ON public.oem_agent_drafts
            FOR DELETE USING (public.oem_is_org_member(organization_id) AND created_by = auth.uid());
    END IF;
END $$;
