-- Add email_templates column to organization_settings
ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS email_templates JSONB DEFAULT '{}'::jsonb;
