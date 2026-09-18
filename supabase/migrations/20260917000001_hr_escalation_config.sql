-- Migration: 20260917000001_hr_escalation_config.sql
-- Description: Add hr_escalation_config column to organization_settings table for dynamic escalation level hierarchy & step assignees

ALTER TABLE IF EXISTS public.organization_settings
ADD COLUMN IF NOT EXISTS hr_escalation_config JSONB DEFAULT '{}'::jsonb;
