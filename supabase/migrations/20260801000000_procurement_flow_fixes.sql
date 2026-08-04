-- Migration: Procurement Flow Fixes and Delivery Photo Additions
-- Run in Supabase SQL Editor

-- 1. Add approver_comment to public.material_request_comparatives
ALTER TABLE public.material_request_comparatives 
ADD COLUMN IF NOT EXISTS approver_comment TEXT;

-- 2. Add delivery_photos to public.material_requests
ALTER TABLE public.material_requests 
ADD COLUMN IF NOT EXISTS delivery_photos TEXT[] DEFAULT '{}'::text[];
