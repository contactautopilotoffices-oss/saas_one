-- Migration: Add missing super_tenant value to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_tenant';
