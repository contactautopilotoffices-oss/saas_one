-- =============================================================================
-- FIX: PPM write path — "mark as done" silently updates 0 rows
-- =============================================================================
-- Diagnosed 09-Nov-2026. Run in the Supabase SQL editor, top to bottom.
--
-- ROOT CAUSE
--   public.ppm_schedules has RLS enabled but only ONE policy:
--     ppm_schedules_select_clean  (SELECT)
--   There is no UPDATE policy, so an UPDATE issued with the user-scoped
--   (authenticated) Supabase client matches zero rows and is silently dropped.
--
--   PATCH /api/ppm/schedules/[id] is the only PPM route that uses the
--   user-scoped client for its write (app/api/ppm/schedules/[id]/route.ts:81).
--   Every other PPM route uses the service-role client and bypasses RLS,
--   which is why upload / clear / reports / attachments still work.
--
--   Symptom: 0 of 22 done for Nov-2026, 0 of 28 for Oct-2026,
--   last done_date anywhere = 29-Jul-2026, last successful status write
--   = 05-Aug-2026 09:59 UTC.
--
-- SCOPE OF THIS SCRIPT
--   Section 1  adds the missing UPDATE policy          <- the actual fix
--   Section 2  closes the completed_by schema drift    <- optional, no behaviour change
--   Section 3  verification SELECTs                    <- read-only
--
--   This script does NOT backfill any task as done. Which Aug-Oct tasks were
--   actually performed is an ops call, not a technical one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The missing UPDATE policy
-- -----------------------------------------------------------------------------
-- Mirrors the shape of tickets_update_clean: authenticated AND the row belongs
-- to a property or organization the caller is a member of. Maintenance vendors
-- are additionally allowed on the tasks assigned to their own vendor record.
--
-- Deliberately NOT the blanket `auth.role() = 'authenticated'` used by
-- mat_req_update_clean / req_update_clean — that would let any signed-in user
-- of any tenant edit any PPM row.
--
-- No WITH CHECK clause: for FOR UPDATE, Postgres then applies the USING
-- expression to the new row as well, which stops a row being moved into an
-- organization the caller is not a member of. Same as tickets_update_clean.

DROP POLICY IF EXISTS ppm_schedules_update_clean ON public.ppm_schedules;

CREATE POLICY ppm_schedules_update_clean ON public.ppm_schedules
    FOR UPDATE
    USING (
        auth.role() = 'authenticated'
        AND (
            -- property-scoped staff (property admins, engineers)
            property_id IN (
                SELECT pm.property_id
                FROM public.property_memberships pm
                WHERE pm.user_id = auth.uid()
                  AND (pm.is_active IS TRUE OR pm.is_active IS NULL)
            )
            -- org-scoped staff (org super admin, org admin, owner, tech)
            OR organization_id IN (
                SELECT om.organization_id
                FROM public.organization_memberships om
                WHERE om.user_id = auth.uid()
                  AND (om.is_active IS TRUE OR om.is_active IS NULL)
            )
            -- maintenance vendors, on their own tasks only
            OR vendor_id IN (
                SELECT mv.id
                FROM public.maintenance_vendors mv
                WHERE mv.user_id = auth.uid()
            )
        )
    );


-- -----------------------------------------------------------------------------
-- 2. OPTIONAL — close the completed_by schema drift
-- -----------------------------------------------------------------------------
-- backend/db/migrations/20260524_ppm_add_completed_by.sql was never applied to
-- this database, so ppm_schedules.completed_by and .completed_at do not exist.
--
-- This does not change any behaviour today: the PATCH route stores the
-- completer inside the attachments JSONB (attachments.completed_by /
-- .completed_by_name / .completed_at), not in these columns. Running this only
-- makes the columns available so the route and the compliance reports can be
-- pointed at them later. Safe to skip if you want section 1 alone.

ALTER TABLE public.ppm_schedules
    ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ppm_schedules_completed_by
    ON public.ppm_schedules(completed_by);


-- -----------------------------------------------------------------------------
-- 3. Verification (read-only — run after the above)
-- -----------------------------------------------------------------------------

-- 3a. ppm_schedules should now show both a SELECT and an UPDATE policy.
SELECT polname,
       CASE polcmd::text
            WHEN 'r' THEN 'SELECT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'a' THEN 'INSERT'
            WHEN 'd' THEN 'DELETE'
            WHEN '*' THEN 'ALL'
       END AS command
FROM pg_policy
WHERE polrelid = 'public.ppm_schedules'::regclass
ORDER BY polname;

-- 3b. The columns from section 2, if it was run.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ppm_schedules'
  AND column_name IN ('completed_by', 'completed_at');

-- 3c. Current backlog, for comparison after the team marks tasks done.
SELECT to_char(planned_date, 'YYYY-MM') AS month,
       status,
       count(*) AS tasks
FROM public.ppm_schedules
WHERE planned_date >= '2026-08-01'
GROUP BY 1, 2
ORDER BY 1, 2;
