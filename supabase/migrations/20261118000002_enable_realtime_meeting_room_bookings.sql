-- Enable Supabase Realtime for the meeting_room_bookings table.
--
-- Why: Bookings created, updated (confirmed/cancelled), or deleted
-- were not reflected in the timeline, list view, or slot availability
-- until a full page reload. Enabling Realtime allows every active client
-- viewing the booking timeline or room cards to update live (BookMyShow-style).
--
-- REPLICA IDENTITY FULL: makes UPDATE/DELETE WAL payloads carry all columns
-- (not just the PK), so the client-side channel filter on property_id
-- matches on updates and deletes too.

ALTER TABLE public.meeting_room_bookings REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'meeting_room_bookings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_room_bookings;
    END IF;
END $$;

-- Ensure authenticated users can read meeting room bookings for realtime events
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.meeting_room_bookings'::regclass
          AND polname = 'Authenticated users can view meeting room bookings'
    ) THEN
        CREATE POLICY "Authenticated users can view meeting room bookings"
            ON public.meeting_room_bookings
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END $$;
