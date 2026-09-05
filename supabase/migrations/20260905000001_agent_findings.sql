-- =============================================================================
-- AGENT FINDINGS + DISPOSITIONS
--
-- WHY THIS TABLE EXISTS
-- Without it a finding has no life beyond one email. Every scan re-raises the
-- same duplicate invoice, nobody can say "this is closed", and the agent never
-- learns that a class of finding was a false positive. Persisting the finding is
-- what makes closure, re-raise detection and reinforcement possible at all.
--
-- WHO ACTUALLY ANSWERS
-- The people who work the items (procurement) close them — not the executive who
-- receives the summary. A CEO may never click anything, and the loop must still
-- close. So `disposition` is written by whoever does the work, and the exec view
-- simply READS it.
--
-- DISPOSITION IS ALSO THE TRAINING SIGNAL
-- 'not_an_issue' means the finding should not have been raised. That is exactly
-- oem_agent_feedback.signal = 'reject'. Rather than asking anyone to rate an
-- agent, the trigger below derives the reinforcement row from the disposition.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.oem_agent_findings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key        text NOT NULL,

    -- Stable identity ACROSS scans. Same problem next week = same finding_key,
    -- so a closed item is recognised instead of re-raised as new.
    finding_key      text NOT NULL,

    priority         text NOT NULL CHECK (priority IN ('critical','action','watch','closed')),
    title            text NOT NULL,
    vendor           text,
    property         text,
    amount           numeric(14,2),
    problem          text,

    -- Lifecycle across scans.
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    times_seen       integer NOT NULL DEFAULT 1,
    last_run_id      uuid REFERENCES public.oem_agent_runs(id) ON DELETE SET NULL,

    -- The answer. NULL = still open.
    disposition      text CHECK (disposition IN ('done','not_an_issue','in_progress','blocked','need_info')),
    disposition_note text,
    dispositioned_by uuid REFERENCES public.users(id),
    dispositioned_at timestamptz,

    -- Set when a finding marked 'done' shows up again in a later scan. This is
    -- the number that matters: work reported as finished that did not stick.
    reopened_count   integer NOT NULL DEFAULT 0,

    created_at       timestamptz NOT NULL DEFAULT now(),

    -- One row per finding per agent per org. Re-scans UPSERT onto this.
    CONSTRAINT oem_agent_findings_uniq UNIQUE (organization_id, agent_key, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_oem_findings_open
    ON public.oem_agent_findings (organization_id, agent_key, last_seen_at DESC)
    WHERE disposition IS NULL;

CREATE INDEX IF NOT EXISTS idx_oem_findings_key
    ON public.oem_agent_findings (organization_id, agent_key, finding_key);

COMMENT ON COLUMN public.oem_agent_findings.finding_key IS
    'Stable across scans. The detector must derive it from the problem (vendor + invoice + PO set), never from a timestamp or row order, or closure never sticks.';
COMMENT ON COLUMN public.oem_agent_finding_events.proof_path IS
    'Supabase storage path under the po_documents bucket, namespaced <org>/findings/<finding_id>/. Sign on read with signPoDocument(); never store a signed URL.';
COMMENT ON COLUMN public.oem_agent_findings.reopened_count IS
    'Incremented when a finding previously marked done is seen again. High values mean the fix is not holding.';

-- --- Audit trail: every answer, not just the latest -------------------------
CREATE TABLE IF NOT EXISTS public.oem_agent_finding_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id   uuid NOT NULL REFERENCES public.oem_agent_findings(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    disposition  text NOT NULL CHECK (disposition IN ('done','not_an_issue','in_progress','blocked','need_info')),
    note         text,

    -- PROOF OF COMPLETION. Storage PATH, not a URL — the repo convention for every
    -- private bucket (document_bank.file_path, po_documents.file_url both hold
    -- paths and are signed on read). A signed URL baked into a row expires and
    -- becomes a dead link in an audit six months later.
    proof_path   text,
    proof_name   text,
    proof_type   text,
    proof_bytes  bigint,
    -- 'email' when answered from a digest link, 'console' from the app.
    source       text NOT NULL DEFAULT 'email' CHECK (source IN ('email','console','api')),
    created_by   uuid REFERENCES public.users(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_finding_events_finding
    ON public.oem_agent_finding_events (finding_id, created_at DESC);

-- --- RLS: same org-member model as the rest of the agent runtime ------------
ALTER TABLE public.oem_agent_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_agent_finding_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_findings' AND policyname = 'oem_select_org_member') THEN
        CREATE POLICY oem_select_org_member ON public.oem_agent_findings
            FOR SELECT USING (public.oem_is_org_member(organization_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_findings' AND policyname = 'oem_update_org_member') THEN
        CREATE POLICY oem_update_org_member ON public.oem_agent_findings
            FOR UPDATE USING (public.oem_is_org_member(organization_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_finding_events' AND policyname = 'oem_select_org_member') THEN
        CREATE POLICY oem_select_org_member ON public.oem_agent_finding_events
            FOR SELECT USING (public.oem_is_org_member(organization_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_agent_finding_events' AND policyname = 'oem_insert_org_member') THEN
        CREATE POLICY oem_insert_org_member ON public.oem_agent_finding_events
            FOR INSERT WITH CHECK (public.oem_is_org_member(organization_id));
    END IF;
END $$;
