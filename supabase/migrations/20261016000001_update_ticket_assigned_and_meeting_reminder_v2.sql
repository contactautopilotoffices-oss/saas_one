-- Migration: 20261016000001_update_ticket_assigned_and_meeting_reminder_v2.sql
-- Description: Update ticket_assigned to ticket_assigned_v2 and meeting_room_start_reminder to meeting_room_start_reminder_v2

UPDATE public.organization_settings
SET whatsapp_templates = jsonb_set(
    jsonb_set(
        COALESCE(whatsapp_templates, '{}'::jsonb),
        '{ticket_assigned}',
        '{"campaign_name": "ticket_assigned_v2", "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone"]}'::jsonb
    ),
    '{meeting_room_start_reminder}',
    '{"campaign_name": "meeting_room_start_reminder_v2", "params": ["user_name", "room_name", "property", "remaining_minutes", "start_time"]}'::jsonb
)
WHERE whatsapp_templates IS NOT NULL;
