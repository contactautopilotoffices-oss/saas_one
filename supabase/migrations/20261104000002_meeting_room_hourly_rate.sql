-- Price per hour for each meeting room, used by the meeting room revenue sheet
-- (GET /api/meeting-rooms/revenue). Nullable: a room with no price is valued at 0
-- and flagged on the sheet as "rate not set". Amount is in INR, before GST.

ALTER TABLE public.meeting_rooms
    ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2);

ALTER TABLE public.meeting_rooms
    DROP CONSTRAINT IF EXISTS meeting_rooms_hourly_rate_non_negative;

ALTER TABLE public.meeting_rooms
    ADD CONSTRAINT meeting_rooms_hourly_rate_non_negative CHECK (hourly_rate IS NULL OR hourly_rate >= 0);

COMMENT ON COLUMN public.meeting_rooms.hourly_rate IS 'Price per booked hour in INR, before GST. Used for the meeting room revenue sheet.';

NOTIFY pgrst, 'reload schema';
