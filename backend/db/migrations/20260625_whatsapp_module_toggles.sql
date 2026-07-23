-- Migration: Add WhatsApp Module Toggles to system_config
-- Description: Sets up the default enabled state for module-specific WhatsApp notifications

INSERT INTO system_config (key, value, description)
VALUES 
    ('whatsapp_ticketing_enabled', 'true'::jsonb, 'Toggle for WhatsApp notifications in the Ticketing / Snags module'),
    ('whatsapp_meeting_room_enabled', 'true'::jsonb, 'Toggle for WhatsApp notifications in the Meeting Room booking module'),
    ('whatsapp_ppm_enabled', 'true'::jsonb, 'Toggle for WhatsApp notifications in the PPM maintenance module'),
    ('whatsapp_procurement_enabled', 'true'::jsonb, 'Toggle for WhatsApp notifications in the Procurement module'),
    ('whatsapp_crm_enabled', 'true'::jsonb, 'Toggle for WhatsApp notifications in the CRM / Business Development module')
ON CONFLICT (key) DO NOTHING;
