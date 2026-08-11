-- Migration: Add missing columns to properties table for soft deletes & status management
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
