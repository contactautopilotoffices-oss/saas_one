-- Add the "accounts" role (finance / payments team).
--
-- Used by:
--   * the Accounts dashboard + Payment Tracker (aligning & completing PO payments)
--   * petty cash disbursement / settlement validation
--
-- Mirrors the pattern used to add earlier roles (20260619000003_app_role_org_admin.sql).
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounts';
