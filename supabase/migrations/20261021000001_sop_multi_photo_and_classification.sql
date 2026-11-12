-- Migration: SOP Multi-Photo Standards, Multi-Photo Submissions & AI Classification
-- Date: 2026-10-21
-- Description:
--   1. Adds 'reference_photos' JSONB to sop_checklist_items (supports multi-clean benchmark photos like Basin, Toilet, Floor).
--   2. Adds 'photos' JSONB to sop_completion_items (supports multiple field photos per step).
--   3. Adds 'ai_photo_matches' JSONB to sop_completion_items (stores AI classification matches & missing area detection).
--   4. Preserves 100% backwards compatibility with legacy reference_photo_url and photo_url columns.

-- 1. Multi Clean Benchmark Reference Photos on sop_checklist_items
ALTER TABLE public.sop_checklist_items
  ADD COLUMN IF NOT EXISTS reference_photos JSONB DEFAULT '[]'::jsonb;

-- 2. Multi Field Photos & AI Photo Matches on sop_completion_items
ALTER TABLE public.sop_completion_items
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_photo_matches JSONB DEFAULT '[]'::jsonb;

-- 3. Comments for documentation
COMMENT ON COLUMN public.sop_checklist_items.reference_photos IS 
  'Array of clean standard reference photos for this step, e.g. [{"id": "ref_1", "label": "Washbasin", "url": "..."}, {"id": "ref_2", "label": "Commode", "url": "..."}]';

COMMENT ON COLUMN public.sop_completion_items.photos IS 
  'Array of field photos captured for this step, e.g. [{"id": "p1", "url": "...", "checked_at": "..."}]';

COMMENT ON COLUMN public.sop_completion_items.ai_photo_matches IS 
  'AI classification mapping each field photo to clean reference standard, and identifying missing/remaining areas';
