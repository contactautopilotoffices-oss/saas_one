-- Migration: 20261008000001_hr_performance_indexes.sql
-- Description: Optimized indexes for HR Tickets to eliminate full table scans and make ticket queries load instantly

-- 1. Composite index for organization tickets ordered by creation time (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_hr_tickets_org_created_desc 
ON public.hr_tickets (organization_id, created_at DESC);

-- 2. Index for filtering tickets by assigned_to and raised_by with created_at
CREATE INDEX IF NOT EXISTS idx_hr_tickets_assigned_created 
ON public.hr_tickets (assigned_to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_tickets_raised_created 
ON public.hr_tickets (raised_by_user_id, created_at DESC);

-- 3. GIN index on employee_snapshot JSONB to accelerate jsonb key queries
CREATE INDEX IF NOT EXISTS idx_hr_tickets_employee_snapshot_gin 
ON public.hr_tickets USING gin (employee_snapshot);

-- 4. Index on status and ticket_type for dashboard metric aggregations
CREATE INDEX IF NOT EXISTS idx_hr_tickets_org_type_status 
ON public.hr_tickets (organization_id, ticket_type, status);
