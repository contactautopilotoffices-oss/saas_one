-- Create organization_settings table for scalable org-wise configuration
CREATE TABLE IF NOT EXISTS public.organization_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    email_preferences JSONB DEFAULT '{"procurement": true, "meeting_rooms": true, "tickets": true, "visitors": true}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- Optional: Create policy to allow admins to read/update their org settings
CREATE POLICY "Allow org users to read settings" ON public.organization_settings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_memberships
            WHERE user_id = auth.uid() AND organization_id = organization_settings.organization_id
        )
        OR 
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND is_master_admin = true
        )
    );
