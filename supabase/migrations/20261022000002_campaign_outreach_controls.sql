-- Migration: Campaign Outreach Controls & Property Showcase Settings
-- Date: 2026-10-22

-- 1. Add outreach toggle and property showcase photo columns to crm_lead_distribution_rules
ALTER TABLE public.crm_lead_distribution_rules
ADD COLUMN IF NOT EXISTS outreach_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS property_photo_url TEXT,
ADD COLUMN IF NOT EXISTS property_name TEXT;

-- 2. Enable outreach for Bangalore pilot by default with verified centre showcase photo
UPDATE public.crm_lead_distribution_rules
SET 
  outreach_enabled = true,
  property_name = 'Purva Gainz · Bangalore',
  property_photo_url = 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'
WHERE campaign IN ('bangalore', 'bengaluru');

-- 3. Ensure all other campaigns default to outreach_enabled = false until rolled out
UPDATE public.crm_lead_distribution_rules
SET outreach_enabled = false
WHERE campaign NOT IN ('bangalore', 'bengaluru') AND outreach_enabled IS NULL;
