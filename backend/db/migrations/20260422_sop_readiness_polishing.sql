-- Migration: SOP Readiness Polishing
-- Description: Indexes for dashboard, updated_at tracking, and refined missed logic.
-- Date: 2026-04-22

-- 1. Add updated_at column to main tables
ALTER TABLE sop_completions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sop_completion_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Create handle_updated_at function if not exists
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach trigger to track audit trail
DROP TRIGGER IF EXISTS trig_sop_completions_updated_at ON sop_completions;
CREATE TRIGGER trig_sop_completions_updated_at
BEFORE UPDATE ON sop_completions
FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS trig_sop_completion_items_updated_at ON sop_completion_items;
CREATE TRIGGER trig_sop_completion_items_updated_at
BEFORE UPDATE ON sop_completion_items
FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 4. Optimized Index for Dashboard (Property + Date + Status)
-- This keeps the mobile dashboard extremely fast even with tens of thousands of rows.
CREATE INDEX IF NOT EXISTS idx_sop_completions_dashboard 
ON sop_completions(property_id, completion_date, status);

-- 5. Refactored Missed Status Logic
-- Industry standard: Mark as missed ONLY after the window has actually closed in IST.
CREATE OR REPLACE FUNCTION update_missed_sop_completions()
RETURNS void AS $$
BEGIN
    UPDATE sop_completions sc
    SET status = 'missed'
    FROM sop_templates st
    WHERE sc.template_id = st.id
      AND sc.status IN ('pending', 'in_progress')
      AND sc.is_late = FALSE -- Don't mark as missed if they are already actively filling it late
      AND (
          -- If current time is 30 minutes past the window end (grace period)
          NOW() > (
            CASE 
              WHEN st.end_time >= st.start_time 
              THEN (sc.completion_date + st.end_time) AT TIME ZONE 'Asia/Kolkata'
              ELSE (sc.completion_date + INTERVAL '1 day' + st.end_time) AT TIME ZONE 'Asia/Kolkata'
            END
            + INTERVAL '30 minutes' 
          )
      );
END;
$$ LANGUAGE plpgsql;
