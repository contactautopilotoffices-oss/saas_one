-- Migration: Add meeting room reminder tracking columns and omnichannel defaults
-- Date: 2026-10-14
-- Feature: Omnichannel Meeting Room Reminders (Pre-Start & Ending-Soon Reminders)

-- 1. Add reminder tracking columns to meeting_room_bookings
ALTER TABLE public.meeting_room_bookings
ADD COLUMN IF NOT EXISTS start_reminder_sent_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS end_reminder_sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.meeting_room_bookings.start_reminder_sent_at IS 'Timestamp when pre-meeting reminder notification was dispatched';
COMMENT ON COLUMN public.meeting_room_bookings.end_reminder_sent_at IS 'Timestamp when meeting ending soon reminder notification was dispatched';

-- 2. Create index for fast reminder queries
CREATE INDEX IF NOT EXISTS idx_meeting_room_bookings_reminders 
ON public.meeting_room_bookings(booking_date, status, start_reminder_sent_at, end_reminder_sent_at);

-- 3. Update organization_settings.notification_matrix with default meeting room reminder rules
UPDATE public.organization_settings
SET notification_matrix = jsonb_set(
    jsonb_set(
        COALESCE(notification_matrix, '{}'::jsonb),
        '{meeting_rooms,meeting_room_start_reminder}',
        COALESCE(
            notification_matrix->'meeting_rooms'->'meeting_room_start_reminder',
            '{
                "enabled": true,
                "channels": {"email": true, "whatsapp": true, "push": true},
                "roles": ["property_admin"],
                "user_ids": [],
                "notify_requester": true,
                "reminder_minutes": 10
            }'::jsonb
        ),
        true
    ),
    '{meeting_rooms,meeting_room_end_reminder}',
    COALESCE(
        notification_matrix->'meeting_rooms'->'meeting_room_end_reminder',
        '{
            "enabled": true,
            "channels": {"email": true, "whatsapp": true, "push": true},
            "roles": ["property_admin"],
            "user_ids": [],
            "notify_requester": true,
            "reminder_minutes": 10
        }'::jsonb
    ),
    true
)
WHERE notification_matrix IS NOT NULL;

-- 4. Update organization_settings.whatsapp_templates with default Meta campaign signatures
UPDATE public.organization_settings
SET whatsapp_templates = jsonb_set(
    jsonb_set(
        COALESCE(whatsapp_templates, '{}'::jsonb),
        '{meeting_room_start_reminder}',
        COALESCE(
            whatsapp_templates->'meeting_room_start_reminder',
            '{
                "campaign_name": "meeting_room_start_reminder_v1",
                "params": ["user_name", "room_name", "property", "remaining_minutes", "start_time"]
            }'::jsonb
        ),
        true
    ),
    '{meeting_room_end_reminder}',
    COALESCE(
        whatsapp_templates->'meeting_room_end_reminder',
        '{
            "campaign_name": "meeting_room_end_reminder_v1",
            "params": ["user_name", "room_name", "property", "remaining_minutes", "end_time"]
        }'::jsonb
    ),
    true
)
WHERE whatsapp_templates IS NOT NULL;
