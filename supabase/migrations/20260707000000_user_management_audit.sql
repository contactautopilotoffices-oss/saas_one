-- Create user_management_audit_logs table
CREATE TABLE IF NOT EXISTS public.user_management_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL, -- e.g., 'delete_user', 'update_role', 'assign_property', 'remove_staff'
    target_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    admin_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.user_management_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies for user_management_audit_logs
CREATE POLICY "Enable CRUD for authenticated users" ON public.user_management_audit_logs
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add updated_by and updated_at to property_memberships
ALTER TABLE public.property_memberships 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Add updated_by and updated_at to organization_memberships
ALTER TABLE public.organization_memberships 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Add updated_by and updated_at to users (if not exists)
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
