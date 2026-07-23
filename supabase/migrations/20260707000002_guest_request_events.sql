-- Create guest_request_events table for timeline
CREATE TABLE IF NOT EXISTS public.guest_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_request_id UUID NOT NULL REFERENCES public.guest_requests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.guest_request_events ENABLE ROW LEVEL SECURITY;

-- Policies for guest_request_events
CREATE POLICY "Enable CRUD for authenticated users" ON public.guest_request_events
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
