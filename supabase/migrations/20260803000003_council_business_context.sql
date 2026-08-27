-- Business context for the Agent Council — the layer that stops the agents being blind.
--
-- The council reads operational numbers well (529 PPMs overdue, 107 SLA breaches) but has
-- no model of the BUSINESS those numbers belong to. It does not know which sites are
-- flagship vs satellite, which org is a paying client vs our own, what a Property Admin is
-- actually accountable for, or who a role reports to. So it can say "SS Plaza has 212
-- active tickets" but never "SS Plaza is our largest client site and its Property Admin's
-- KRA is 95% SLA compliance, so this is a contract risk, not just a queue".
--
-- Two kinds of context exist and they are handled differently:
--
--   DERIVED  — already in the database (orgs, sites, teams, roles, issue taxonomy,
--              escalation ladders). No table needed; backend/lib/council/dataPack.ts
--              reads it directly into the `org_context` section.
--
--   CURATED  — lives only in people's heads: KRAs, site tiers, client classification,
--              role accountability. THIS table holds it, so Dipti/Naresh can feed the
--              council once and have every future session inherit it.
--
-- Deliberately one flexible table rather than five rigid ones: the shape of "what the
-- business knows" is not stable yet, and five half-filled tables would be worse than one
-- honest key-value-with-structure. Tighten it once the real shape is known.

CREATE TABLE IF NOT EXISTS public.council_business_context (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- What kind of knowledge this row carries.
    kind         TEXT NOT NULL CHECK (kind IN (
                    'kra',              -- what a role/team is measured on
                    'role_definition',  -- what a role is accountable for, and reports to
                    'site_profile',     -- tier, category, client, contract shape
                    'client_profile',   -- who the client is, commercial sensitivity
                    'hierarchy',        -- who reports to whom
                    'glossary',         -- house vocabulary the LLM will not know
                    'policy'            -- a rule the org runs by
                 )),

    -- What the row is ABOUT. subject_key is intentionally free text so it can name a role
    -- ('property_admin'), a team ('HVAC'), a site ('SS Plaza') or an org, without forcing
    -- a join that would break the moment someone renames a site.
    subject_type TEXT NOT NULL CHECK (subject_type IN ('role','team','property','organization','global')),
    subject_key  TEXT NOT NULL,

    title        TEXT NOT NULL,
    body         TEXT NOT NULL,

    -- Structured extras the personas can compute with rather than only read:
    --   kra          {"metric":"SLA compliance","target":95,"unit":"%","cadence":"monthly"}
    --   site_profile {"tier":"flagship","category":"managed_office","seats":40000,"client":"TCS"}
    --   hierarchy    {"reports_to":"ops_head","escalates_to":"org_super_admin"}
    attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Provenance matters: an agent citing a KRA should be able to say who set it.
    provided_by  TEXT,
    source_note  TEXT,

    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One statement per (kind, subject) so re-importing a corrected sheet updates in place
    -- instead of silently doubling every KRA.
    UNIQUE (org_id, kind, subject_type, subject_key, title)
);

CREATE INDEX IF NOT EXISTS idx_council_business_context_lookup
    ON public.council_business_context (org_id, kind, subject_type, is_active);

-- ---------------------------------------------------------------------------
-- RLS. Service role writes (the import route). Org admins read.
-- ---------------------------------------------------------------------------
ALTER TABLE public.council_business_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org admins read business context" ON public.council_business_context;
CREATE POLICY "org admins read business context" ON public.council_business_context FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = council_business_context.org_id
              AND om.is_active
              AND om.role::text IN ('org_super_admin','master_admin','org_admin'))
);

REVOKE INSERT, UPDATE, DELETE ON public.council_business_context FROM anon, authenticated;
