-- Migration: Add missing values to app_role enum
-- Description: The OrgAdminDashboard role dropdown includes 'org_admin'
--              (org-level admin) and 'security' (property-level security) but
--              neither was ever added to the app_role enum. Any save that
--              writes those values fails with 22P02.
--
--              57+ files reference 'org_admin' across CRM access checks, RLS
--              policies, and admin UI. Adding it is required for the
--              OrgAdminDashboard role editor to work.
--
-- Idempotent: ADD VALUE IF NOT EXISTS prevents re-runs from erroring.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'security';
