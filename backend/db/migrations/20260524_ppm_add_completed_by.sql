-- =============================================================================
-- PPM: Track who completed a task and when
-- =============================================================================

ALTER TABLE ppm_schedules
    ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Index for filtering/compliance reports
CREATE INDEX IF NOT EXISTS idx_ppm_schedules_completed_by ON ppm_schedules(completed_by);
