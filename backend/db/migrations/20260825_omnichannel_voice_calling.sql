-- Migration: Omnichannel Voice Calling System (Plivo Virtual Number + Bolna AI Voice Agent)
-- Date: 2026-08-25

CREATE TABLE IF NOT EXISTS omnichannel_call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    recipient_phone TEXT NOT NULL,
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,           -- 'CHECKLIST_STARTED', 'CHECKLIST_OVERDUE', 'PPM_REMINDER', 'TEST_CALL'
    spoken_script TEXT,                 -- the exact resolved text/prompt spoken to the user
    call_status TEXT NOT NULL DEFAULT 'initiated', -- 'initiated', 'in_progress', 'completed', 'failed', 'busy'
    duration_seconds INT DEFAULT 0,
    recording_url TEXT,
    bolna_call_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_org_date ON omnichannel_call_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_event_date ON omnichannel_call_logs(event_type, created_at DESC);

ALTER TABLE omnichannel_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "omnichannel_call_logs_service_role" 
ON omnichannel_call_logs 
FOR ALL 
USING (true);
