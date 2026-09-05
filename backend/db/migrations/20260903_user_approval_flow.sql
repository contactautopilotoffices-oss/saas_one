-- ========================================================
-- USER APPROVAL FLOW & AUDIT TRAIL MIGRATION
-- ========================================================

-- 1. Add approval columns to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'pending';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Auto-approve all existing users to ensure zero disruption
UPDATE public.users
SET is_approved = true,
    approval_status = 'approved',
    approved_at = COALESCE(created_at, now())
WHERE is_approved IS NOT TRUE;

-- 3. Master admin should always be approved
UPDATE public.users
SET is_approved = true,
    approval_status = 'approved',
    approved_at = now()
WHERE is_master_admin = true;

-- 4. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_approval ON public.users (is_approved, approval_status);
CREATE INDEX IF NOT EXISTS idx_users_approved_by ON public.users (approved_by);

-- 5. RLS policies for property_memberships and organization_memberships
DROP POLICY IF EXISTS "pm_insert_own" ON public.property_memberships;
CREATE POLICY "pm_insert_own" ON public.property_memberships
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "om_insert_own" ON public.organization_memberships;
CREATE POLICY "om_insert_own" ON public.organization_memberships
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
