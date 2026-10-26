-- Complete audit fields used by User Management approval/assignment actions.
-- Additive and repeatable; existing roles, activation and approval states stay intact.
BEGIN;
ALTER TABLE public.property_memberships
 ADD COLUMN IF NOT EXISTS updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.organization_memberships
 ADD COLUMN IF NOT EXISTS updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.users
 ADD COLUMN IF NOT EXISTS updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
COMMIT;
NOTIFY pgrst, 'reload schema';
