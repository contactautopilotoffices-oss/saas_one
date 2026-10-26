-- ==============================================================================
-- MIGRATION: 20261014000001_sync_meta_ticket_template_params.sql
-- DESCRIPTION: Synchronizes organization_settings.whatsapp_templates JSONB map
--              with live approved Meta / AiSensy campaign parameters for ticketing suite:
--              1. ticket_created_v3: 10 params (9 body + dynamic CTA ticket_id)
--              2. ticket_created_v3_media: 9 params (photo header + 9 body parameters)
--              3. ticket_assigned_v1: 7 params (body parameters only, no CTA param)
--              4. ticket_completed_v1: 5 params (body parameters only, no CTA button)
--              5. ticket_completed_v1_media: 5 params (after-photo header + 5 body parameters)
--              6. reminder_ticket_sla_v1: 7 params
-- ==============================================================================

-- 1. Synchronize existing organization settings
UPDATE public.organization_settings
SET whatsapp_templates = COALESCE(whatsapp_templates, '{}'::jsonb) || jsonb_build_object(
    'ticket_created', jsonb_build_object(
        'campaign_name', 'ticket_created_v3',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone', 'ticket_id')
    ),
    'ticket_created_media', jsonb_build_object(
        'campaign_name', 'ticket_created_v3_media',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'),
        'is_media', true
    ),
    'ticket_assigned', jsonb_build_object(
        'campaign_name', 'ticket_assigned_v1',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone')
    ),
    'ticket_completed', jsonb_build_object(
        'campaign_name', 'ticket_completed_v1',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'resolved_by')
    ),
    'ticket_completed_media', jsonb_build_object(
        'campaign_name', 'ticket_completed_v1_media',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'resolved_by'),
        'is_media', true
    ),
    'reminder_ticket_sla', jsonb_build_object(
        'campaign_name', 'reminder_ticket_sla_v1',
        'params', jsonb_build_array('user_name', 'ticket_number', 'title', 'property', 'sla_deadline', 'priority', 'assignee_name')
    )
)
WHERE true;
