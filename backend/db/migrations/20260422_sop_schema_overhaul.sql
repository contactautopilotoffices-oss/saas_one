-- Migration: SOP Schema Overhaul
-- Description: Add due_at, relax completed_by for system-generation, and update statuses.
-- Date: 2026-04-22

-- 1. Add due_at, is_late and relax completed_by
ALTER TABLE sop_completions 
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT FALSE,
    ALTER COLUMN completed_by DROP NOT NULL;

-- 2. Update status constraint
-- First, drop the old one (check the name in your DB if it's different)
ALTER TABLE sop_completions 
    DROP CONSTRAINT IF EXISTS sop_completions_status_check;

ALTER TABLE sop_completions 
    ADD CONSTRAINT sop_completions_status_check 
    CHECK (status IN ('pending', 'in_progress', 'completed', 'partial', 'missed'));

-- 3. Set default status to pending
ALTER TABLE sop_completions 
    ALTER COLUMN status SET DEFAULT 'pending';

-- 4. Move existing data (Best effort)
-- If slot_time and completion_date exist, we can try to backfill due_at
UPDATE sop_completions 
SET due_at = (completion_date + COALESCE(slot_time, '00:00:00'::TIME))::TIMESTAMPTZ
WHERE due_at IS NULL;

-- 5. Add unique constraint to prevent duplicate slots
-- WARNING: This will fail if there are existing duplicates for the same (template, due_at)
ALTER TABLE sop_completions 
    ADD CONSTRAINT sop_completions_template_due_unique UNIQUE (template_id, due_at);

-- 6. Index for performance
CREATE INDEX IF NOT EXISTS idx_sop_completions_due_at ON sop_completions(due_at);
CREATE INDEX IF NOT EXISTS idx_sop_completions_template_due ON sop_completions(template_id, due_at);
