-- ====================================================================
-- HR Ticket: repair assigned_history for tickets that already escalated
--
-- The previous backfill (20260918000001) only touched tickets whose
-- assigned_history was still empty. Tickets that escalated before the
-- history was being maintained kept a single-entry array, so the level-N
-- owner dropped out of the ticket list the moment the ticket moved to
-- level N+1. This migration MERGES every known past holder into the
-- array for all tickets instead of replacing it.
-- ====================================================================

ALTER TABLE public.hr_tickets
ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_history JSONB DEFAULT '[]'::jsonb;

WITH holders AS (
    SELECT t.id AS ticket_id, uid
    FROM public.hr_tickets t
    CROSS JOIN LATERAL (
        SELECT t.assigned_to_user_id AS uid
        UNION
        SELECT t.manager_user_id
        UNION
        SELECT CASE
                   WHEN (t.employee_snapshot->>'manager_user_id') ~ '^[0-9a-fA-F-]{36}$'
                   THEN (t.employee_snapshot->>'manager_user_id')::uuid
               END
        UNION
        SELECT l.actor_user_id
        FROM public.hr_ticket_audit_logs l
        WHERE l.ticket_id = t.id
        UNION
        SELECT (l.old_values->>'assigned_to')::uuid
        FROM public.hr_ticket_audit_logs l
        WHERE l.ticket_id = t.id
          AND l.old_values->>'assigned_to' ~ '^[0-9a-fA-F-]{36}$'
        UNION
        SELECT (l.new_values->>'assigned_to')::uuid
        FROM public.hr_ticket_audit_logs l
        WHERE l.ticket_id = t.id
          AND l.new_values->>'assigned_to' ~ '^[0-9a-fA-F-]{36}$'
        UNION
        SELECT (l.new_values->>'assigned_to_user_id')::uuid
        FROM public.hr_ticket_audit_logs l
        WHERE l.ticket_id = t.id
          AND l.new_values->>'assigned_to_user_id' ~ '^[0-9a-fA-F-]{36}$'
    ) src(uid)
    WHERE uid IS NOT NULL
),
merged AS (
    SELECT ticket_id, jsonb_agg(DISTINCT to_jsonb(uid::text)) AS history
    FROM holders
    GROUP BY ticket_id
)
UPDATE public.hr_tickets t
SET assigned_history = m.history,
    employee_snapshot = COALESCE(t.employee_snapshot, '{}'::jsonb)
                        || jsonb_build_object('assigned_history', m.history)
FROM merged m
WHERE m.ticket_id = t.id
  AND (t.assigned_history IS NULL OR NOT (t.assigned_history @> m.history));

CREATE INDEX IF NOT EXISTS idx_hr_tickets_assigned_history
    ON public.hr_tickets USING gin(assigned_history);
