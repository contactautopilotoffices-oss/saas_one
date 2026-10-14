-- Migration: 20261014000001_sync_meta_ticket_template_params.sql
-- Description: Align ticket_assigned_v1 (7 params) and ticket_completed_v1 / ticket_completed_v1_media (5 params) with approved Meta / AiSensy signatures

UPDATE public.organization_settings
SET whatsapp_templates = jsonb_set(
    jsonb_set(
        jsonb_set(
            COALESCE(whatsapp_templates, '{}'::jsonb),
            '{ticket_assigned,params}',
            '["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone"]'::jsonb
        ),
        '{ticket_completed,params}',
        '["user_name", "ticket_number", "title", "property", "resolved_by"]'::jsonb
    ),
    '{ticket_completed_media,params}',
    '["user_name", "ticket_number", "title", "property", "resolved_by"]'::jsonb
)
WHERE whatsapp_templates IS NOT NULL;
