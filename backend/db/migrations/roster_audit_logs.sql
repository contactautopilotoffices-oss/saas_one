-- =========================================================
-- ROSTER AUDIT LOGS
-- =========================================================

CREATE TABLE IF NOT EXISTS roster_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Staff member whose roster changed
    roster_date date NOT NULL,
    old_shift_id uuid REFERENCES shift_configurations(id) ON DELETE SET NULL,
    new_shift_id uuid REFERENCES shift_configurations(id) ON DELETE SET NULL,
    changed_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- The person who made the change
    action text NOT NULL, -- e.g. 'CREATED', 'UPDATED', 'DELETED', 'IMPORTED'
    created_at timestamptz DEFAULT now()
);

-- Indexes for fast lookup by user and date (since we'll query history per cell)
CREATE INDEX IF NOT EXISTS idx_roster_audit_user_date ON roster_audit_logs(user_id, roster_date);

-- RLS
ALTER TABLE roster_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_audit_logs_select ON roster_audit_logs;
CREATE POLICY roster_audit_logs_select ON roster_audit_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS roster_audit_logs_insert ON roster_audit_logs;
CREATE POLICY roster_audit_logs_insert ON roster_audit_logs FOR INSERT WITH CHECK (true);
