-- Migration: 20260903_user_approval_flow.sql
-- Adds user approval workflow fields and migrates existing users to approved.

-- 1. Add approval columns to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'pending';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Add constraint for approval_status if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_user_approval_status'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT check_user_approval_status
        CHECK (approval_status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- 3. Create indexes for fast querying of pending users
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON public.users (is_approved, approval_status);
CREATE INDEX IF NOT EXISTS idx_users_approved_by ON public.users (approved_by);

-- 4. Auto-approve all existing users so zero existing users are locked out
UPDATE public.users
SET is_approved = true,
    approval_status = 'approved',
    approved_at = COALESCE(approved_at, now())
WHERE is_approved IS NOT TRUE;

-- 5. Master admins must always be approved
UPDATE public.users
SET is_approved = true,
    approval_status = 'approved'
WHERE is_master_admin = true;

-- 6. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
