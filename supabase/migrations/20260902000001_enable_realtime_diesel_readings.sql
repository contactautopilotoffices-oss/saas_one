-- Enable Supabase Realtime for the diesel_readings table.
--
-- Why: the NFC tap-to-log flow (app/scan/[generatorId]) submits a reading from
-- a staff member's phone, and the diesel analytics dashboard open on another
-- screen needs to reflect it immediately without a manual refresh.
--
-- REPLICA IDENTITY FULL: makes UPDATE/DELETE WAL payloads carry all columns
-- (not just the PK), so the client-side channel filter on property_id
-- matches on updates and deletes too.
--
-- Safe + reversible. To roll back:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.diesel_readings;
--   ALTER TABLE public.diesel_readings REPLICA IDENTITY DEFAULT;

ALTER TABLE public.diesel_readings REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'diesel_readings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.diesel_readings;
    END IF;
END $$;
