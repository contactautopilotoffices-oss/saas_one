-- Migration: Configurable Follow-Up Nudge Timing & Outreach Settings
-- Date: 2026-10-22
-- Description: Allows organization admins to manage nudge delay timing (e.g. 2h, 4h, 8h, 24h) from the UI.

-- 1. Create crm_outreach_settings table for organization-wide outreach configurations
CREATE TABLE IF NOT EXISTS public.crm_outreach_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
    nudge_enabled BOOLEAN NOT NULL DEFAULT true,
    nudge_delay_hours NUMERIC(4, 1) NOT NULL DEFAULT 4.0,
    nudge_template_name TEXT NOT NULL DEFAULT 'autopilot_lead_nudge_v1',
    sla_call_now_minutes INT NOT NULL DEFAULT 10,
    after_hours_start TIME NOT NULL DEFAULT '19:00:00',
    after_hours_end TIME NOT NULL DEFAULT '09:00:00',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add campaign-level nudge overrides to crm_lead_distribution_rules
ALTER TABLE public.crm_lead_distribution_rules
ADD COLUMN IF NOT EXISTS nudge_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS nudge_delay_hours NUMERIC(4, 1) DEFAULT 4.0;

-- 3. Enable RLS on crm_outreach_settings
ALTER TABLE public.crm_outreach_settings ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: All authenticated users can read outreach settings
DROP POLICY IF EXISTS "Allow members to read crm outreach settings" ON public.crm_outreach_settings;
DROP POLICY IF EXISTS "Allow authenticated to read crm outreach settings" ON public.crm_outreach_settings;
CREATE POLICY "Allow authenticated to read crm outreach settings"
ON public.crm_outreach_settings
FOR SELECT
TO authenticated
USING (true);

-- 5. RLS Policy: Org Admins and Super Admins can update settings
DROP POLICY IF EXISTS "Allow admins to update crm outreach settings" ON public.crm_outreach_settings;
CREATE POLICY "Allow admins to update crm outreach settings"
ON public.crm_outreach_settings
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = crm_outreach_settings.organization_id
          AND om.user_id = auth.uid()
          AND om.is_active = true
          AND om.role IN ('org_super_admin', 'org_admin', 'ops_super_admin', 'bd_admin')
    )
);

-- 6. Insert default settings for existing organizations
INSERT INTO public.crm_outreach_settings (organization_id, nudge_enabled, nudge_delay_hours, nudge_template_name, sla_call_now_minutes)
SELECT 
    id AS organization_id,
    true AS nudge_enabled,
    4.0 AS nudge_delay_hours,
    'autopilot_lead_nudge_v1' AS nudge_template_name,
    10 AS sla_call_now_minutes
FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;
