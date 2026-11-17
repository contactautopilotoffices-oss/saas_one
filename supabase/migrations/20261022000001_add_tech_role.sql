-- Add the "tech" role (the Tech team's own login and console).
--
-- Used by:
--   * the Tech console (frontend/components/dashboard/TechDashboard.tsx), opened for this role after sign-in
--   * the Task Manager Control Centre, which only the Tech team may open (requireControlCentre)
--
-- Mirrors the pattern used to add earlier roles (20260723000001_add_accounts_role.sql).
-- Run this on its own: a value added to an enum cannot be used in the same transaction that adds it.
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tech';
