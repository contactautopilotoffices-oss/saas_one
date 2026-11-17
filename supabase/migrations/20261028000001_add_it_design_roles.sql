-- Add the "it" and "design" roles (the IT and Design teams' own logins and consoles).
--
-- Used by:
--   * the IT and Design consoles (frontend/components/dashboard/DepartmentConsole.tsx), opened for these roles after sign-in
--   * meeting room booking (frontend/lib/meetingRooms/creditFreeRoles.ts): both teams book rooms without credits
--   * Asset Management (backend/lib/assets/access.ts): IT sees and manages every asset in the organisation
--
-- Mirrors the pattern used to add earlier roles (20261022000001_add_tech_role.sql).
-- Run this on its own: a value added to an enum cannot be used in the same transaction that adds it.
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'it';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'design';
