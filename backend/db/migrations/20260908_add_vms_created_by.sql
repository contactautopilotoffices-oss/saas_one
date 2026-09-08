-- Migration: Ensure created_by column exists on visitor_logs table & reload schema cache
ALTER TABLE public.visitor_logs 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
