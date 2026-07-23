-- Ensure guest-photos bucket exists (if not already created)
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-photos', 'guest-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any to prevent conflicts
DROP POLICY IF EXISTS "Restrict MIME types on guest-photos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access for guest-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to guest-photos" ON storage.objects;

-- Create policy to allow uploads but strictly enforce MIME types matching images
CREATE POLICY "Restrict MIME types on guest-photos"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
    bucket_id = 'guest-photos' 
    AND (
        -- Enforce allowed MIME types
        (storage.extension(name) = 'jpg' AND (mimetype = 'image/jpeg' OR mimetype = 'image/jpg')) OR
        (storage.extension(name) = 'jpeg' AND mimetype = 'image/jpeg') OR
        (storage.extension(name) = 'png' AND mimetype = 'image/png') OR
        (storage.extension(name) = 'webp' AND mimetype = 'image/webp') OR
        (storage.extension(name) = 'gif' AND mimetype = 'image/gif')
    )
);

-- Ensure public read access (so dashboard can load images)
CREATE POLICY "Public Access for guest-photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'guest-photos');
