-- Migration: 20260917000003_hr_ticket_acknowledgement_and_manager_tracking.sql
-- Description: Add manager_user_id, assigned_history, acknowledged_at, acknowledged_by_user_id, acknowledgement_note to hr_tickets

ALTER TABLE hr_tickets
ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_history JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS acknowledgement_note TEXT;

-- Backfill manager_user_id from employee_profiles for existing tickets
UPDATE hr_tickets t
SET manager_user_id = (
    SELECT 
        CASE 
            WHEN ep_mgr.user_id IS NOT NULL THEN ep_mgr.user_id
            ELSE ep.reporting_manager_id
        END
    FROM employee_profiles ep
    LEFT JOIN employee_profiles ep_mgr ON ep.reporting_manager_id = ep_mgr.id
    WHERE ep.user_id = t.raised_by_user_id
    LIMIT 1
)
WHERE t.manager_user_id IS NULL;

-- Backfill assigned_history with initial assigned_to_user_id for existing tickets
UPDATE hr_tickets
SET assigned_history = jsonb_build_array(assigned_to_user_id)
WHERE (assigned_history IS NULL OR assigned_history = '[]'::jsonb) AND assigned_to_user_id IS NOT NULL;
