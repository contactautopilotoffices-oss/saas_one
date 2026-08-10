-- Purchase mailbox digest — action items pulled from the shared purchase@ inbox.
--
-- A cron (/api/cron/sync-purchase-mailbox) reads the shared mailbox over the Zoho Mail
-- REST API, groups messages into threads and classifies each thread into one of four
-- buckets so the purchase team sees what is actually waiting on them:
--   awaiting_reply     — the mailbox was asked something and has not answered
--   unactioned_request — someone needs an item and nobody has responded
--   no_discovery       — something was shared and no conversation started
--   other              — already handled / nothing pending
--
-- PRIVACY: rows here mirror the contents of a shared mailbox. Everything is org-scoped
-- and written only by the service role; members get read access plus the ability to tick
-- a thread off (is_resolved), nothing more.

CREATE TABLE IF NOT EXISTS public.mailbox_threads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    thread_id           TEXT NOT NULL,              -- Zoho Mail threadId (or messageId for singletons)
    subject             TEXT,
    from_address        TEXT,                       -- sender of the newest inbound message
    participants        TEXT[] NOT NULL DEFAULT '{}',
    last_message_at     TIMESTAMPTZ,
    message_count       INTEGER NOT NULL DEFAULT 0,
    snippet             TEXT,
    category            TEXT NOT NULL DEFAULT 'other'
                        CHECK (category IN ('awaiting_reply','unactioned_request','no_discovery','other')),
    waiting_on          TEXT,                       -- who owes the next move ("Purchase team" / a sender)
    classified_by       TEXT,                       -- 'ai' | 'heuristic' — so ops can tell how a row was bucketed
    is_resolved         BOOLEAN NOT NULL DEFAULT false,
    -- Server-set only (app/api/accounts/mailbox/[id]). Never trust a browser clock here:
    -- resolved_at is compared against Zoho's server-side message timestamp to decide
    -- whether a thread should reopen, so a slow client clock would resurrect a resolved
    -- thread on every sync, forever.
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    raw                 JSONB,                      -- trimmed message headers + summaries, never full bodies
    synced_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, thread_id)
);

-- CREATE TABLE IF NOT EXISTS above is a no-op if an earlier draft of this migration was
-- already run, so resolved_by is added separately to keep the file re-runnable.
ALTER TABLE public.mailbox_threads ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_threads_bucket
    ON public.mailbox_threads (organization_id, category, last_message_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — every write goes through the service role: the sync (cron) and the resolve
-- toggle (app/api/accounts/mailbox/[id], which calls resolveAccountsAccess). Members
-- get SELECT only, matching po_payments / zoho_purchase_orders / po_workflow_state —
-- no other accounts table grants members a direct write.
--
-- SELECT is scoped BY ROLE, not by bare membership. This table mirrors a shared mailbox:
-- subjects, counterparty addresses, participant lists and per-message summaries. Org
-- membership alone is NOT a sufficient credential for it — app/api/vendors/maintenance
-- and app/api/super-tenant both create real logins with an active organization_memberships
-- row for external parties, who would otherwise read the purchase team's negotiations
-- with their own competitors.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mailbox_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read mailbox threads" ON public.mailbox_threads;
CREATE POLICY "org members read mailbox threads" ON public.mailbox_threads FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = mailbox_threads.organization_id
              AND om.is_active
              AND om.role::text IN ('org_super_admin','org_admin','master_admin',
                                    'purchase_manager','purchase_executive','procurement','accounts'))
    OR EXISTS (SELECT 1 FROM property_memberships pm
            WHERE pm.user_id = auth.uid()
              AND pm.organization_id = mailbox_threads.organization_id
              AND pm.is_active
              AND pm.role::text IN ('org_super_admin','org_admin','master_admin',
                                    'purchase_manager','purchase_executive','procurement','accounts'))
);

-- No UPDATE policy and no column GRANT on purpose. The previous membership-only UPDATE
-- policy let any org member (including a maintenance vendor) empty the purchase team's
-- entire queue in one request, unattributably and un-self-healing — the resync
-- deliberately never rewrites is_resolved.
DROP POLICY IF EXISTS "org members resolve mailbox threads" ON public.mailbox_threads;
REVOKE UPDATE ON public.mailbox_threads FROM anon, authenticated;

-- Realtime so a teammate ticking a thread off disappears from everyone's digest.
ALTER TABLE public.mailbox_threads REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='mailbox_threads') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.mailbox_threads;
    END IF;
END $$;
