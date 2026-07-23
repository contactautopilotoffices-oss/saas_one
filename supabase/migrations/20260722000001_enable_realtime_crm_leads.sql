-- Enable Supabase Realtime for the CRM leads table.
--
-- Why: lead edits made in the detail drawer (status changes, reassignment,
-- follow-up dates) were not reflected in the leads table until a hard refresh,
-- because the table kept its own copy of the rows. Streaming crm_leads changes
-- lets every open client patch the affected row live (incl. a teammate's edits).
--
-- REPLICA IDENTITY FULL: makes UPDATE/DELETE WAL payloads carry all columns
-- (not just the PK), so the client-side channel filter on organization_id
-- matches on updates and deletes too.
--
-- Safe + reversible. To roll back:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_leads;
--   ALTER TABLE public.crm_leads REPLICA IDENTITY DEFAULT;

ALTER TABLE public.crm_leads REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'crm_leads'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
    END IF;
END $$;
