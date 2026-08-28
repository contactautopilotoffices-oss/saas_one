-- Migration: Add attendee_email column to meeting_room_bookings
-- Allows sending email confirmations to external attendees/guests when a room is booked.

ALTER TABLE public.meeting_room_bookings
ADD COLUMN IF NOT EXISTS attendee_email TEXT DEFAULT NULL;

COMMENT ON COLUMN public.meeting_room_bookings.attendee_email IS 'Optional email address (or comma-separated addresses) of attendee/guest to notify upon booking';
