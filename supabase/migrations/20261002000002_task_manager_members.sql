-- Migration: 20261002000002_task_manager_members.sql
-- Description: Dedicated enrollment table for Employee Task Manager (Head Office)
-- Safe, additive-only migration. Does NOT alter, drop, or affect any existing tables.

CREATE TABLE IF NOT EXISTS public.tm_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    designation TEXT,
    is_superuser BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_tm_members_phone UNIQUE (phone)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tm_members_phone ON public.tm_members (phone);
CREATE INDEX IF NOT EXISTS idx_tm_members_user_id ON public.tm_members (user_id);
CREATE INDEX IF NOT EXISTS idx_tm_members_department ON public.tm_members (department);
CREATE INDEX IF NOT EXISTS idx_tm_members_is_superuser ON public.tm_members (is_superuser);

-- Enable Row Level Security
ALTER TABLE public.tm_members ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "Service role access on tm_members" ON public.tm_members;
CREATE POLICY "Service role access on tm_members"
    ON public.tm_members
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Allow authenticated users to view active members
DROP POLICY IF EXISTS "Authenticated users view tm_members" ON public.tm_members;
CREATE POLICY "Authenticated users view tm_members"
    ON public.tm_members
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Initial Seed for Sahil Gorde as Superuser
INSERT INTO public.tm_members (user_id, phone, full_name, department, designation, is_superuser, is_active)
SELECT 
    id, 
    phone, 
    full_name, 
    'Tech', 
    'AI Intern & Superuser', 
    true, 
    true
FROM public.users
WHERE phone = '8433649199' OR phone LIKE '%8433649199'
ON CONFLICT (phone) DO UPDATE 
SET is_superuser = true, is_active = true, updated_at = timezone('utc', now());
