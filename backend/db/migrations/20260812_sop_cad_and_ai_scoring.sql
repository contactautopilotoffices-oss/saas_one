-- Migration: SOP CAD + AI Cleanliness Scoring
-- Description: Add CAD support to templates, reference photos to checklist items, and AI scoring to completion items.
-- Date: 2026-08-12

-- 1. CAD metadata on templates
ALTER TABLE sop_templates
  ADD COLUMN IF NOT EXISTS cad_file_url TEXT,
  ADD COLUMN IF NOT EXISTS cad_file_type TEXT CHECK (cad_file_type IN ('dwg','dxf','pdf','image')),
  ADD COLUMN IF NOT EXISTS cad_converted_image_url TEXT,
  ADD COLUMN IF NOT EXISTS cad_areas JSONB DEFAULT '[]'::jsonb;

-- 2. Reference photo support on checklist items
ALTER TABLE sop_checklist_items
  ADD COLUMN IF NOT EXISTS reference_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS reference_photo_source TEXT CHECK (reference_photo_source IN ('cad','uploaded')),
  ADD COLUMN IF NOT EXISTS cad_area_id TEXT;

-- 3. AI cleanliness scoring on completion items
ALTER TABLE sop_completion_items
  ADD COLUMN IF NOT EXISTS ai_cleanliness_score INTEGER CHECK (ai_cleanliness_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_cleanliness_reason TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_used TEXT,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;

-- 4. Create storage buckets for CAD and reference photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('sop-cad-files', 'sop-cad-files', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('sop-cad-images', 'sop-cad-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('sop-reference-photos', 'sop-reference-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies for sop-cad-files
DROP POLICY IF EXISTS "Allow authenticated uploads to sop-cad-files" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to sop-cad-files" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sop-cad-files');

DROP POLICY IF EXISTS "Allow public viewing of sop-cad-files" ON storage.objects;
CREATE POLICY "Allow public viewing of sop-cad-files" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'sop-cad-files');

DROP POLICY IF EXISTS "Allow owners to delete their own sop-cad-files" ON storage.objects;
CREATE POLICY "Allow owners to delete their own sop-cad-files" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'sop-cad-files' AND owner = auth.uid());

-- 6. Storage policies for sop-cad-images
DROP POLICY IF EXISTS "Allow authenticated uploads to sop-cad-images" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to sop-cad-images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sop-cad-images');

DROP POLICY IF EXISTS "Allow public viewing of sop-cad-images" ON storage.objects;
CREATE POLICY "Allow public viewing of sop-cad-images" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'sop-cad-images');

DROP POLICY IF EXISTS "Allow owners to delete their own sop-cad-images" ON storage.objects;
CREATE POLICY "Allow owners to delete their own sop-cad-images" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'sop-cad-images' AND owner = auth.uid());

-- 7. Storage policies for sop-reference-photos
DROP POLICY IF EXISTS "Allow authenticated uploads to sop-reference-photos" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to sop-reference-photos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sop-reference-photos');

DROP POLICY IF EXISTS "Allow public viewing of sop-reference-photos" ON storage.objects;
CREATE POLICY "Allow public viewing of sop-reference-photos" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'sop-reference-photos');

DROP POLICY IF EXISTS "Allow owners to delete their own sop-reference-photos" ON storage.objects;
CREATE POLICY "Allow owners to delete their own sop-reference-photos" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'sop-reference-photos' AND owner = auth.uid());
