-- Migration: 1-Tap Lead Outreach, SLA Escalation, and Performance Tracking
-- Date: 2026-10-22

-- 1. Add 1-tap interaction and SLA metric columns to crm_leads
ALTER TABLE public.crm_leads 
ADD COLUMN IF NOT EXISTS outreach_variant TEXT DEFAULT 'variant_a',
ADD COLUMN IF NOT EXISTS outreach_button_tapped TEXT,
ADD COLUMN IF NOT EXISTS outreach_tapped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS call_sla_breached BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_smb_nurture BOOLEAN DEFAULT false;

-- 2. Create crm_lead_slas table to monitor 10-minute Call Me Now SLAs
CREATE TABLE IF NOT EXISTS public.crm_lead_slas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES public.users(id),
    sla_type TEXT NOT NULL DEFAULT 'call_me_now_10m',
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    target_sla_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'met', 'breached', 'escalated')),
    escalated_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for fast cron lookups
CREATE INDEX IF NOT EXISTS idx_crm_lead_slas_status ON public.crm_lead_slas(status, target_sla_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_nudge_pending ON public.crm_leads(created_at) 
WHERE nudge_sent_at IS NULL AND outreach_button_tapped IS NULL;
