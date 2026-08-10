-- Council dispatch — turning findings into assigned work.
--
-- Until now the council produced a findings list and stopped. A list nobody owns is a
-- report, not an outcome. This table is the closed loop: every finding is routed to a
-- named person (via workflow_spoc_rules where configured, by role otherwise), carries an
-- SLA derived from its severity, and records what actually happened to it.
--
-- The outcome columns exist so impact can be measured rather than asserted: status +
-- closed_at + outcome_note answer "did anything change because the council noticed?",
-- and dismissed_reason captures the false positives honestly rather than hiding them.
--
-- Writes go through the service role (dispatch runs inside the convening cron and the
-- master-admin routes). RLS grants an assignee read access to their OWN rows, so this
-- table can later back a "my council queue" view outside master admin without a
-- second migration.

CREATE TABLE IF NOT EXISTS public.council_assignments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id         UUID NOT NULL REFERENCES council_sessions(id) ON DELETE CASCADE,
    -- One assignment per finding: dispatch is idempotent and re-running the cron after a
    -- partial failure must not fan the same finding out to the same person twice.
    finding_id         UUID NOT NULL UNIQUE REFERENCES council_findings(id) ON DELETE CASCADE,

    agent_key          TEXT NOT NULL,          -- which council lens raised it
    severity           TEXT NOT NULL CHECK (severity IN ('P0','P1','P2')),
    domain             TEXT NOT NULL,          -- SPOC domain used for routing

    assignee_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_role      TEXT,                   -- the role the routing landed on
    -- How the assignee was chosen. 'unassigned' is a first-class outcome, not an error:
    -- it means no SPOC rule and no member holding the fallback role, which is itself
    -- something a human needs to see rather than have silently swallowed.
    routed_by          TEXT NOT NULL DEFAULT 'unassigned'
                       CHECK (routed_by IN ('spoc_rule','role_fallback','unassigned')),
    routing_note       TEXT,

    sla_hours          INTEGER,
    due_at             TIMESTAMPTZ,

    status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','acked','done','dismissed')),
    outcome_note       TEXT,
    dismissed_reason   TEXT,                   -- why it was not real; the false-positive record
    acked_at           TIMESTAMPTZ,
    closed_at          TIMESTAMPTZ,
    closed_by          UUID REFERENCES users(id) ON DELETE SET NULL,

    notified_at        TIMESTAMPTZ,
    notify_skipped     TEXT,                   -- why no notification was sent, if none was

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_council_assignments_queue
    ON public.council_assignments (org_id, status, severity, due_at);
CREATE INDEX IF NOT EXISTS idx_council_assignments_assignee
    ON public.council_assignments (assignee_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_council_assignments_session
    ON public.council_assignments (session_id);

-- ---------------------------------------------------------------------------
-- RLS. Service role writes. Org admins read everything; an assignee reads their own
-- rows so the queue can surface to the person who owns the work.
-- ---------------------------------------------------------------------------
ALTER TABLE public.council_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org admins read council assignments" ON public.council_assignments;
CREATE POLICY "org admins read council assignments" ON public.council_assignments FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = council_assignments.org_id
              AND om.is_active
              AND om.role::text IN ('org_super_admin','master_admin','org_admin'))
);

DROP POLICY IF EXISTS "assignee reads own council assignments" ON public.council_assignments;
CREATE POLICY "assignee reads own council assignments" ON public.council_assignments FOR SELECT USING (
    assignee_user_id = auth.uid()
);

REVOKE INSERT, UPDATE, DELETE ON public.council_assignments FROM anon, authenticated;
