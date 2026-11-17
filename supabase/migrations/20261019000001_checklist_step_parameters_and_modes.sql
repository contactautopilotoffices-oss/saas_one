-- Migration: Checklist Step Parameters, Property Settings, and Basic/Advanced Modes
-- Date: 2026-10-19
-- Description:
--   1. Adds 'parameters' JSONB to sop_checklist_items (sub-checks under steps with no photo requirement).
--   2. Adds 'parameter_values' JSONB to sop_completion_items (records values/toggles for parameters).
--   3. Adds 'checklist_mode' column to properties ('basic' | 'advanced').
--   4. Creates 'checklist_property_settings' table for omnichannel reminders, approver configuration, AI scoring threshold.
--   5. Adds approver workflow & avg score columns to sop_completions.
--   6. Updates fn_clone_sop_checklist_items() to initialize parameter_values as '{}'::jsonb.

-- 1. Step Parameters on sop_checklist_items
ALTER TABLE public.sop_checklist_items
  ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '[]'::jsonb;

-- 2. Parameter Values, AI Parameter Breakdown, and Step Approvals on sop_completion_items
ALTER TABLE public.sop_completion_items
  ADD COLUMN IF NOT EXISTS parameter_values JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_parameter_scores JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS step_approval_status TEXT DEFAULT 'pending'
    CHECK (step_approval_status IN ('pending', 'approved', 'rejected', 'not_required')),
  ADD COLUMN IF NOT EXISTS step_approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS step_approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_approved_at TIMESTAMPTZ;

-- 3. Property Checklist Mode
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS checklist_mode TEXT NOT NULL DEFAULT 'basic'
  CHECK (checklist_mode IN ('basic', 'advanced'));

-- 4. Checklist Property Settings Table
CREATE TABLE IF NOT EXISTS public.checklist_property_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id             UUID NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  checklist_mode          TEXT NOT NULL DEFAULT 'basic' CHECK (checklist_mode IN ('basic', 'advanced')),
  reminder_enabled        BOOLEAN NOT NULL DEFAULT true,
  reminder_lead_time_mins INTEGER NOT NULL DEFAULT 15,
  reminder_channels       TEXT[] NOT NULL DEFAULT '{push}',
  approver_required       BOOLEAN NOT NULL DEFAULT false,
  approver_user_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ai_scoring_enabled      BOOLEAN NOT NULL DEFAULT false,
  ai_scoring_threshold    INTEGER DEFAULT 70,
  cad_enabled             BOOLEAN NOT NULL DEFAULT false,
  timezone                TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on property_id
CREATE INDEX IF NOT EXISTS idx_checklist_prop_settings_property_id
  ON public.checklist_property_settings (property_id);

-- Enable RLS
ALTER TABLE public.checklist_property_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view checklist settings for their properties" ON public.checklist_property_settings;
DROP POLICY IF EXISTS "Admins can update checklist settings" ON public.checklist_property_settings;
DROP POLICY IF EXISTS "checklist_property_settings_authenticated_all" ON public.checklist_property_settings;

CREATE POLICY "checklist_property_settings_authenticated_all"
  ON public.checklist_property_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Approver and AI Aggregate columns on sop_completions
ALTER TABLE public.sop_completions
  ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'not_required'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'not_required')),
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS ai_avg_score INTEGER;

-- 6. Trigger function to clone items on completion creation
CREATE OR REPLACE FUNCTION fn_clone_sop_checklist_items()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sop_completion_items WHERE completion_id = NEW.id) THEN
        INSERT INTO sop_completion_items (
            completion_id,
            checklist_item_id,
            is_checked,
            parameter_values
        )
        SELECT
            NEW.id,
            id,
            false,
            '{}'::jsonb
        FROM sop_checklist_items
        WHERE template_id = NEW.template_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
