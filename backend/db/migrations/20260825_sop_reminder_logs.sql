-- Migration: Create sop_reminder_logs deduplication table for SOP Checklist WhatsApp & Push notifications
-- Date: 2026-08-25

CREATE TABLE IF NOT EXISTS sop_reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES sop_templates(id) ON DELETE CASCADE,
    reminder_type TEXT NOT NULL, -- 'pre_start', 'started', 'overdue'
    slot_date DATE NOT NULL,     -- e.g. '2026-08-25'
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(template_id, reminder_type, slot_date)
);

CREATE INDEX IF NOT EXISTS idx_sop_reminder_logs_lookup 
ON sop_reminder_logs(template_id, reminder_type, slot_date);

ALTER TABLE sop_reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sop_reminder_logs_service_role" 
ON sop_reminder_logs 
FOR ALL 
USING (true);
