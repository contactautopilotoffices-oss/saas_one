-- ====================================================================
-- HR Ticket Manager & Escalation History Tracking Migration
-- Copy and paste this script directly into your Supabase SQL Editor
-- ====================================================================

-- 1. Ensure manager_user_id and assigned_history columns exist on hr_tickets
ALTER TABLE public.hr_tickets
ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_history JSONB DEFAULT '[]'::jsonb;

-- 2. Backfill manager_user_id from employee_snapshot or employee_profiles for existing tickets
UPDATE public.hr_tickets t
SET manager_user_id = COALESCE(
    CASE 
        WHEN (t.employee_snapshot->>'manager_user_id') ~ '^[0-9a-fA-F-]{36}$' 
        THEN (t.employee_snapshot->>'manager_user_id')::uuid 
        ELSE NULL 
    END,
    (
        SELECT 
            CASE 
                WHEN ep_mgr.user_id IS NOT NULL THEN ep_mgr.user_id
                ELSE ep.reporting_manager_id
            END
        FROM public.employee_profiles ep
        LEFT JOIN public.employee_profiles ep_mgr ON ep.reporting_manager_id = ep_mgr.id
        WHERE ep.user_id = t.raised_by_user_id
        LIMIT 1
    )
)
WHERE t.manager_user_id IS NULL;

-- 3. Backfill assigned_history with all historical level assignees, managers, and audit log actors
UPDATE public.hr_tickets t
SET assigned_history = (
    SELECT jsonb_agg(DISTINCT uid)
    FROM (
        SELECT t.assigned_to_user_id AS uid WHERE t.assigned_to_user_id IS NOT NULL
        UNION
        SELECT t.manager_user_id AS uid WHERE t.manager_user_id IS NOT NULL
        UNION
        SELECT (old_values->>'assigned_to')::uuid AS uid 
        FROM public.hr_ticket_audit_logs 
        WHERE ticket_id = t.id 
          AND old_values->>'assigned_to' IS NOT NULL 
          AND old_values->>'assigned_to' ~ '^[0-9a-fA-F-]{36}$'
        UNION
        SELECT (new_values->>'assigned_to')::uuid AS uid 
        FROM public.hr_ticket_audit_logs 
        WHERE ticket_id = t.id 
          AND new_values->>'assigned_to' IS NOT NULL 
          AND new_values->>'assigned_to' ~ '^[0-9a-fA-F-]{36}$'
        UNION
        SELECT actor_user_id AS uid 
        FROM public.hr_ticket_audit_logs 
        WHERE ticket_id = t.id AND actor_user_id IS NOT NULL
    ) sub
    WHERE uid IS NOT NULL
)
WHERE t.assigned_history IS NULL OR t.assigned_history = '[]'::jsonb OR jsonb_array_length(t.assigned_history) = 0;

-- 4. Create performance indexes for instant filtering
CREATE INDEX IF NOT EXISTS idx_hr_tickets_manager_user_id ON public.hr_tickets(manager_user_id);
CREATE INDEX IF NOT EXISTS idx_hr_tickets_assigned_history ON public.hr_tickets USING gin(assigned_history);
